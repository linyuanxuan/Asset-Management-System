/**
 * 敏感字段加解密：AES-256-GCM（带认证标签，防篡改）
 * 存储格式： enc:v1:<base64(iv[12] | tag[16] | ciphertext)>
 * 密钥来自 .env 的 AES_KEY（64 位 hex）。密钥不落库、不进日志。
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const hex = String(process.env.AES_KEY || '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('AES_KEY 未配置或格式错误（需 64 位十六进制字符串）');
  }
  return Buffer.from(hex, 'hex');
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return '';
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function decrypt(value) {
  if (value === null || value === undefined || value === '') return '';
  if (!isEncrypted(value)) return String(value); // 兼容历史明文行
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (raw.length <= IV_LEN + TAG_LEN) return '';
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted };
