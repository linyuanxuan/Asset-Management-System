/**
 * 资产 CRUD + 搜索 + 分类筛选 + 单字段解密 + CSV 导出
 * 安全要点：
 *  - 全部路由挂 requireAuth，未登录一律 401
 *  - 列表接口只返回敏感字段的掩码，明文必须走 /reveal 单独获取（No-Store 缓存）
 *  - 写入前统一走 buildRecord 校验清洗，敏感字段 AES-256-GCM 加密入库
 */
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../auth');
const { encrypt, decrypt } = require('../crypto');
const { getCategory, allFields, MASK } = require('../schema');
const { buildRecord } = require('../validate');

const router = express.Router();
router.use(requireAuth);

/* ---------------- 工具 ---------------- */

function nowIso() {
  return new Date().toISOString();
}

function parseData(row) {
  try {
    const obj = JSON.parse(row.data || '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

/** 列表/详情返回体：敏感字段换成掩码，另给 secretSet 供前端显示"已设置" */
function toPublic(row) {
  const data = parseData(row);
  const category = getCategory(row.category);
  const secretSet = {};

  if (category) {
    for (const field of category.fields) {
      if (!field.secret) continue;
      const value = data[field.key];
      secretSet[field.key] = Boolean(value);
      data[field.key] = value ? MASK : '';
    }
  }

  return {
    id: row.id,
    category: row.category,
    title: row.title,
    notes: row.notes,
    expire_at: row.expire_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    data,
    secretSet,
  };
}

function getRow(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) return null;
  return getDb().prepare('SELECT * FROM assets WHERE id = ?').get(numId) || null;
}

function escapeLike(str) {
  return str.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/* ---------------- CSV 导出（必须放在 /:id 之前） ---------------- */

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

router.get('/export.csv', (req, res) => {
  const includeSecrets = String(req.query.secrets || '0') === '1';
  const category = getCategory(req.query.category);
  const q = String(req.query.q || '').trim().slice(0, 100);

  const where = [];
  const params = [];
  if (category) {
    where.push('category = ?');
    params.push(category.key);
  }
  if (q) {
    where.push("(title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    params.push(like, like);
  }
  const sql = `SELECT * FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, (expire_at = ''), expire_at, id`;
  const rows = getDb().prepare(sql).all(...params);

  // 按分类导出时只输出该分类的字段列，全部导出时取所有字段并集
  const fields = category ? category.fields : allFields();
  const header = ['分类', ...fields.map((f) => f.label), '创建时间', '更新时间'];

  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    const data = parseData(row);
    const cat = getCategory(row.category);
    const cells = [cat ? cat.name : row.category];
    for (const field of fields) {
      let value = data[field.key];
      if (field.secret) {
        if (!includeSecrets) {
          value = '';
        } else {
          try {
            value = decrypt(value);
          } catch (_) {
            value = '（解密失败）';
          }
        }
      }
      cells.push(value === undefined || value === null ? '' : String(value));
    }
    cells.push(row.created_at, row.updated_at);
    lines.push(cells.map(csvCell).join(','));
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `assets-${stamp}${includeSecrets ? '-with-secrets' : ''}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send('\uFEFF' + lines.join('\r\n'));
});

/* ---------------- 列表 ---------------- */

router.get('/', (req, res) => {
  const category = getCategory(req.query.category);
  const q = String(req.query.q || '').trim().slice(0, 100);

  const where = [];
  const params = [];
  if (category) {
    where.push('category = ?');
    params.push(category.key);
  }
  if (q) {
    where.push("(title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    params.push(like, like);
  }

  const sql = `SELECT * FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY (expire_at = ''), expire_at, id DESC`;
  const rows = getDb().prepare(sql).all(...params);
  res.json({ assets: rows.map(toPublic), warnDays: Math.max(1, Number(process.env.WARN_DAYS || 30)) });
});

/* ---------------- 单条详情 ---------------- */

router.get('/:id', (req, res) => {
  const row = getRow(req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json({ asset: toPublic(row) });
});

/* ---------------- 单字段解密 ---------------- */

router.get('/:id/reveal/:field', (req, res) => {
  const row = getRow(req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });

  const category = getCategory(row.category);
  const field = category && category.fields.find((f) => f.key === req.params.field);
  if (!field || !field.secret) return res.status(400).json({ error: '该字段不支持查看明文' });

  const stored = parseData(row)[field.key];
  if (!stored) return res.json({ value: '' });

  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ value: decrypt(stored) });
  } catch (_) {
    console.error('[assets] 字段解密失败 id=' + row.id);
    res.status(500).json({ error: '解密失败，请检查 AES_KEY 是否被更换' });
  }
});

/* ---------------- 新增 ---------------- */

router.post('/', (req, res) => {
  const result = buildRecord(req.body, null);
  if (result.error) return res.status(400).json({ error: result.error });

  const { record, secretKeys } = result;
  for (const key of secretKeys) {
    record.data[key] = record.data[key] ? encrypt(record.data[key]) : '';
  }

  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO assets (category, title, data, expire_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(record.category, record.title, JSON.stringify(record.data), record.expire_at, record.notes, ts, ts);

  const row = getRow(info.lastInsertRowid);
  res.status(201).json({ asset: toPublic(row) });
});

/* ---------------- 编辑 ---------------- */

router.put('/:id', (req, res) => {
  const existing = getRow(req.params.id);
  if (!existing) return res.status(404).json({ error: '记录不存在' });

  const body = req.body || {};
  // 不允许跨分类改类型（字段结构不同），分类变更请新建
  if (body.category && body.category !== existing.category) {
    return res.status(400).json({ error: '不支持修改资产分类，请新建记录' });
  }

  const oldData = parseData(existing);
  const result = buildRecord({ category: existing.category, data: body.data }, oldData);
  if (result.error) return res.status(400).json({ error: result.error });

  const { record, secretKeys } = result;
  for (const key of secretKeys) {
    const value = record.data[key];
    // 已是密文（留空沿用）则不再二次加密
    if (typeof value === 'string' && value.startsWith('enc:v1:')) continue;
    record.data[key] = value ? encrypt(value) : '';
  }

  getDb()
    .prepare(
      `UPDATE assets SET title = ?, data = ?, expire_at = ?, notes = ?, updated_at = ? WHERE id = ?`
    )
    .run(record.title, JSON.stringify(record.data), record.expire_at, record.notes, nowIso(), existing.id);

  res.json({ asset: toPublic(getRow(existing.id)) });
});

/* ---------------- 删除 ---------------- */

router.delete('/:id', (req, res) => {
  const existing = getRow(req.params.id);
  if (!existing) return res.status(404).json({ error: '记录不存在' });
  getDb().prepare('DELETE FROM assets WHERE id = ?').run(existing.id);
  res.json({ ok: true, id: existing.id });
});

module.exports = router;
