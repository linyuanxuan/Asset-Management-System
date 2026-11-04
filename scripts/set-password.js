/**
 * 初始化 / 重置管理员密码：
 *   node scripts/set-password.js <新密码>
 *   npm run init -- <新密码>
 *
 * 行为：
 *  1) 若 .env 不存在，自动从 .env.example 复制；
 *  2) 生成 AES_KEY（64 位 hex）、SESSION_SECRET（若缺失）；
 *  3) 计算 scrypt 加盐哈希并写入 ADMIN_PASSWORD_HASH；
 *  4) 屏幕上只显示脱敏结果，不回显密码与密钥。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('../src/auth');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

const password = process.argv[2];
if (!password || String(password).length < 8) {
  console.error('用法: npm run init -- <管理员密码，至少 8 位>');
  console.error('示例: npm run init -- MyStr0ngP@ss');
  process.exit(1);
}

let lines;
if (fs.existsSync(envPath)) {
  lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
} else if (fs.existsSync(examplePath)) {
  lines = fs.readFileSync(examplePath, 'utf8').split(/\r?\n/);
} else {
  lines = ['HOST=127.0.0.1', 'PORT=3000', 'ADMIN_USERNAME=admin'];
}

function setKey(lines, key, value) {
  const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

function getKey(lines, key) {
  const line = lines.find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  return line ? line.slice(line.indexOf('=') + 1).trim() : '';
}

let aesKey = getKey(lines, 'AES_KEY');
if (!/^[0-9a-fA-F]{64}$/.test(aesKey)) {
  aesKey = crypto.randomBytes(32).toString('hex');
  setKey(lines, 'AES_KEY', aesKey);
}

let sessionSecret = getKey(lines, 'SESSION_SECRET');
if (sessionSecret.length < 32) {
  sessionSecret = crypto.randomBytes(48).toString('base64url');
  setKey(lines, 'SESSION_SECRET', sessionSecret);
}

setKey(lines, 'ADMIN_PASSWORD_HASH', hashPassword(password));

// 清理可能存在的明文密码行，避免误留
for (let i = lines.length - 1; i >= 0; i--) {
  if (/^\s*ADMIN_PASSWORD\s*=/.test(lines[i])) lines.splice(i, 1);
}

fs.writeFileSync(envPath, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
try {
  if (process.platform !== 'win32') fs.chmodSync(envPath, 0o600);
} catch (_) {
  /* ignore */
}

console.log('--------------------------------------------------');
console.log(' 配置已写入 .env');
console.log(' 管理员账号 : ' + (getKey(lines, 'ADMIN_USERNAME') || 'admin'));
console.log(' 密码哈希   : ' + hashPasswordPreview(getKey(lines, 'ADMIN_PASSWORD_HASH')));
console.log(' AES_KEY    : ' + aesKey.slice(0, 8) + '...' + aesKey.slice(-8) + '（请单独备份）');
console.log('--------------------------------------------------');
console.log(' 下一步: npm start  然后浏览器打开 http://127.0.0.1:3000');
console.log(' 提醒: .env 与 data/assets.db 严禁上传到网络');
console.log('--------------------------------------------------');

function hashPasswordPreview(hash) {
  const parts = String(hash).split('$');
  return `${parts[0]}$...${String(parts[5] || '').slice(0, 8)}...（已加盐哈希）`;
}
