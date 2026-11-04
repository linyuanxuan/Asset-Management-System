/**
 * 输入校验与清洗（防 XSS / 超长 / 类型混淆）。
 * 策略：
 *  1) 只接受 schema 中声明过的字段，其余一律丢弃（防字段注入）；
 *  2) 去除控制字符、首尾空白、限制长度；
 *  3) 返回的 secretKeys 由调用方统一加密，明文不落库；
 *  4) 前端渲染统一走 textContent，不拼接 HTML，形成双层 XSS 防线。
 */
const { getCategory } = require('./schema');

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanString(value, max) {
  if (typeof value === 'number') value = String(value);
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, '').trim().slice(0, max || 300);
}

function cleanNumber(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null; // null = 非法
  return Math.round(n * 1e6) / 1e6;
}

function cleanDate(value) {
  const s = cleanString(value, 10);
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 构建入库记录（敏感字段此处仍是明文，由调用方加密）。
 * @param {object} body 请求体 { category, data }
 * @param {object|null} oldData 编辑场景的旧存储数据，用于实现"敏感字段留空=不修改"
 */
function buildRecord(body, oldData) {
  if (!isPlainObject(body)) return { error: '请求体格式错误' };
  const category = getCategory(body.category);
  if (!category) return { error: '资产分类不合法' };

  const input = isPlainObject(body.data) ? body.data : {};
  const data = {};
  const secretKeys = [];

  for (const field of category.fields) {
    if (field.secret) secretKeys.push(field.key);

    if (!Object.prototype.hasOwnProperty.call(input, field.key)) {
      data[field.key] = oldData && oldData[field.key] !== undefined ? oldData[field.key] : '';
      continue;
    }

    const raw = input[field.key];
    let value;

    if (field.type === 'number') {
      value = cleanNumber(raw);
      if (value === null) return { error: `「${field.label}」必须是不小于 0 的数字` };
    } else if (field.type === 'date') {
      value = cleanDate(raw);
      if (value === null) return { error: `「${field.label}」日期格式应为 YYYY-MM-DD` };
    } else if (field.type === 'select') {
      value = cleanString(raw, field.max || 50);
      if (value && Array.isArray(field.options) && !field.options.includes(value)) {
        return { error: `「${field.label}」取值不在允许范围` };
      }
    } else {
      value = cleanString(raw, field.max || 300);
    }

    if (field.secret) {
      // 空字符串 = 不修改，沿用旧密文
      data[field.key] = value === '' && oldData && oldData[field.key] ? oldData[field.key] : value;
    } else {
      data[field.key] = value;
    }
  }

  const titleField = category.fields.find((f) => f.key === category.titleField);
  const title = cleanString(data[category.titleField], 150);
  if (!title) return { error: `「${titleField ? titleField.label : category.titleField}」不能为空` };

  if (data.notes !== undefined) data.notes = cleanString(data.notes, 2000);

  return {
    record: {
      category: category.key,
      title,
      expire_at: data.expire_at || '',
      notes: data.notes || '',
      data,
    },
    secretKeys,
  };
}

module.exports = { buildRecord, cleanString };
