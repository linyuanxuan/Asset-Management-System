/**
 * 极简 .env 加载器（不依赖 dotenv，减少第三方依赖）。
 * 规则：KEY=VALUE 一行一条，# 开头为注释，支持用单/双引号包裹值。
 */
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const envPath = file || path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return false;

  const text = fs.readFileSync(envPath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

module.exports = { loadEnv };
