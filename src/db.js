/**
 * SQLite 单文件数据库。
 * 优先使用 Node 22.5+ 内置的 node:sqlite（零原生依赖，无需编译），
 * 若运行在旧版 Node 上则回退到 better-sqlite3（需自行 npm i better-sqlite3）。
 *
 * 迁移/备份只需复制 data/assets.db 一个文件（WAL 模式下连同 -wal 文件一起复制或先停服）。
 */
const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  data        TEXT    NOT NULL DEFAULT '{}',
  expire_at   TEXT    NOT NULL DEFAULT '',
  notes       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
CREATE INDEX IF NOT EXISTS idx_assets_expire   ON assets(expire_at);
`;

let db = null;
let engine = '';

/** 屏蔽 node:sqlite 的 ExperimentalWarning，其它警告照常输出 */
function installWarningFilter() {
  const original = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const message = typeof warning === 'string' ? warning : (warning && warning.message) || '';
    const type = typeof rest[0] === 'string' ? rest[0] : (warning && warning.name) || '';
    if (type === 'ExperimentalWarning' && /SQLite/i.test(message)) return;
    return original.call(process, warning, ...rest);
  };
}

function createDatabase(file) {
  installWarningFilter();

  try {
    // eslint-disable-next-line node/no-unsupported-features/node-builtins
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(file);
    database.exec('PRAGMA journal_mode = WAL;');
    database.exec('PRAGMA synchronous = NORMAL;');
    engine = 'node:sqlite';
    return database;
  } catch (err) {
    let Database;
    try {
      Database = require('better-sqlite3');
    } catch (_) {
      console.error('\n[数据库] 当前 Node 版本不支持内置 node:sqlite，且未安装 better-sqlite3。');
      console.error('  方案一（推荐）：升级 Node 到 22.5 以上');
      console.error('  方案二：在本目录执行 npm install better-sqlite3\n');
      process.exit(1);
    }
    const database = new Database(file);
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    engine = 'better-sqlite3';
    return database;
  }
}

function getDb() {
  if (db) return db;

  const root = path.join(__dirname, '..');
  const file = path.resolve(root, process.env.DB_PATH || './data/assets.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  db = createDatabase(file);
  db.exec(SCHEMA);

  try {
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  } catch (_) {
    /* Windows 或权限不足时忽略 */
  }

  return db;
}

function getEngine() {
  return engine;
}

module.exports = { getDb, getEngine };
