/**
 * 认证与会话管理
 *  - 管理员密码：scrypt 加盐哈希（Node 内置），不可逆
 *  - 会话：内存 Map + HMAC 签名 HttpOnly Cookie（SameSite=Strict），空闲超时自动失效
 *  - 服务重启后会话失效，需重新登录（本地单机场景可接受，且更安全）
 */
const crypto = require('crypto');

const COOKIE_NAME = 'dasid';
const sessions = new Map();

const ttlMs = () => Math.max(5, Number(process.env.SESSION_TTL_MINUTES || 120)) * 60 * 1000;

/* ---------------- 密码哈希 ---------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const hash = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

/* ---------------- Cookie / 会话 ---------------- */

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch (_) {
      out[k] = v;
    }
  }
  return out;
}

function sign(sid) {
  return crypto.createHmac('sha256', String(process.env.SESSION_SECRET || '')).update(sid).digest('base64url');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: ttlMs(),
  };
}

function createSession(res, username) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(sid, { username, createdAt: now, expiresAt: now + ttlMs() });
  res.cookie(COOKIE_NAME, `${sid}.${sign(sid)}`, cookieOpts());
  return sid;
}

function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;

  const sid = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!safeEqual(sig, sign(sid))) return null;

  const session = sessions.get(sid);
  if (!session) return null;

  const now = Date.now();
  if (now > session.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  // 滑动续期
  session.expiresAt = now + ttlMs();
  return session;
}

function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) {
    const idx = token.lastIndexOf('.');
    if (idx > 0) sessions.delete(token.slice(0, idx));
  }
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', path: '/' });
}

/* ---------------- 中间件 ---------------- */

/** 所有资产类接口必须通过：未登录直接 401，不返回任何数据 */
function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', path: '/' });
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  req.session = session;
  req.user = session.username;
  next();
}

/** 清理过期会话，避免内存常驻 */
function startSessionCleanup() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [sid, s] of sessions) {
      if (now > s.expiresAt) sessions.delete(sid);
    }
  }, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  requireAuth,
  startSessionCleanup,
};
