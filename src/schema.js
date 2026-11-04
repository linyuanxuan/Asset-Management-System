/**
 * 资产分类与字段定义：前后端唯一数据源。
 * 服务端据此做参数校验 + 敏感字段加密；前端通过 GET /api/schema 动态渲染表单。
 *
 * 字段属性：
 *   key      存储键名
 *   label    中文显示名
 *   type     text | number | date | password | textarea | select
 *   secret   true = AES 加密存储，列表接口只返回掩码
 *   expire   true = 该字段参与到期提醒
 *   required 必填
 *   max      最大长度
 */
const MASK = '••••••••';

const CATEGORIES = [
  {
    key: 'ai',
    name: 'AI 资源',
    titleField: 'platform',
    fields: [
      { key: 'platform', label: 'AI 平台名称', type: 'text', required: true, max: 100, placeholder: '如：OpenAI / Claude / 通义千问' },
      { key: 'endpoint', label: '接口地址', type: 'text', max: 300, placeholder: 'https://api.example.com/v1' },
      { key: 'api_key', label: 'API Key', type: 'password', secret: true, max: 1000 },
      { key: 'model', label: '模型名称', type: 'text', max: 200, placeholder: '如：gpt-4o / claude-sonnet-4' },
      { key: 'quota_total', label: '总额度', type: 'number', min: 0 },
      { key: 'quota_used', label: '已使用额度', type: 'number', min: 0 },
      { key: 'quota_left', label: '剩余额度', type: 'number', min: 0 },
      { key: 'expire_at', label: '额度到期时间', type: 'date', expire: true },
      { key: 'notes', label: '备注', type: 'textarea', max: 2000 },
    ],
  },
  {
    key: 'account',
    name: '账号资产',
    titleField: 'platform',
    fields: [
      { key: 'platform', label: '平台名称', type: 'text', required: true, max: 100, placeholder: '如：GitHub / 阿里云账号' },
      { key: 'login_url', label: '登录地址', type: 'text', max: 300 },
      { key: 'account', label: '账号', type: 'text', max: 150 },
      { key: 'email', label: '邮箱', type: 'text', max: 150 },
      { key: 'password', label: '密码', type: 'password', secret: true, max: 500, placeholder: '加密存储' },
      { key: 'phone', label: '绑定手机号', type: 'text', max: 50 },
      { key: 'registered_at', label: '注册时间', type: 'date' },
      { key: 'notes', label: '备注', type: 'textarea', max: 2000 },
    ],
  },
  {
    key: 'cloud',
    name: '云 & 服务器',
    titleField: 'name',
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true, max: 100, placeholder: '如：VPS-HK-01 / example.com' },
      { key: 'kind', label: '资产类型', type: 'select', max: 50, options: ['IDC 服务器', 'VPS', 'Cloudflare Pages', '域名', 'DNS', 'SSL 证书'] },
      { key: 'ip', label: '服务器 IP / 域名', type: 'text', max: 200 },
      { key: 'ssh_port', label: 'SSH 端口', type: 'text', max: 10, placeholder: '22' },
      { key: 'login_user', label: '登录账号', type: 'text', max: 100, placeholder: 'root' },
      { key: 'secret', label: '登录密码 / SSH 私钥', type: 'password', secret: true, max: 8000, placeholder: '加密存储' },
      { key: 'dns', label: 'DNS 信息', type: 'text', max: 500, placeholder: 'NS / 解析记录说明' },
      { key: 'cert', label: '证书信息', type: 'text', max: 500, placeholder: '颁发者 / 到期日 / 部署位置' },
      { key: 'expire_at', label: '到期 / 续费时间', type: 'date', expire: true },
      { key: 'notes', label: '备注', type: 'textarea', max: 2000 },
    ],
  },
  {
    key: 'credential',
    name: '其他凭证',
    titleField: 'name',
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true, max: 100, placeholder: '如：Netflix 会员 / 某接口密钥' },
      { key: 'kind', label: '类型', type: 'select', max: 50, options: ['订阅服务', '会员', '接口密钥', '其他'] },
      { key: 'account', label: '关联账号', type: 'text', max: 150 },
      { key: 'secret', label: '密钥 / 卡密 / 密码', type: 'password', secret: true, max: 4000, placeholder: '加密存储' },
      { key: 'expire_at', label: '到期时间', type: 'date', expire: true },
      { key: 'notes', label: '备注', type: 'textarea', max: 2000 },
    ],
  },
];

const categoryMap = new Map(CATEGORIES.map((c) => [c.key, c]));

function getCategory(key) {
  return categoryMap.get(String(key || '')) || null;
}

/** 导出用：所有字段并集（按 key 去重，首次出现的 label 为准） */
function allFields() {
  const seen = new Map();
  for (const c of CATEGORIES) {
    for (const f of c.fields) {
      if (!seen.has(f.key)) seen.set(f.key, f);
    }
  }
  return [...seen.values()];
}

function publicSchema() {
  return {
    mask: MASK,
    warnDays: Math.max(1, Number(process.env.WARN_DAYS || 30)),
    categories: CATEGORIES,
  };
}

module.exports = { CATEGORIES, MASK, getCategory, allFields, publicSchema };
