/**
 * 登录 / 登出 / 当前会话
 *  - 单管理员，无注册
 *  - 登录失败限流：同 IP 10 分钟内最多 5 次，超限锁定 10 分钟
 *  - 日志只记录结果，绝不打印账号密码
 */
const express = require('express');
const { verifyPassword, createSession, destroySession, getSession, requireAuth } = require('../auth');

const router = express.Router();

const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map(); // ip -> { count, firstAt, lockedUntil }

function ipOf(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkLock(ip) {
  const rec = attempts.get(ip);
  if (!rec) return 0;
  const now = Date.now();
  if (rec.lockedUntil && now < rec.lockedUntil) return Math.ceil((rec.lockedUntil - now) / 1000);
  if (rec.lockedUntil && now >= rec.lockedUntil) attempts.delete(ip);
  if (!rec.lockedUntil && now - rec.firstAt > WINDOW_MS) attempts.delete(ip);
  return 0;
}

function recordFail(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, firstAt: now, lockedUntil: 0 };
  if (now - rec.firstAt > WINDOW_MS) {
    rec.count = 0;
    rec.firstAt = now;
  }
  rec.count += 1;
  if (rec.count >= MAX_FAILS) rec.lockedUntil = now + WINDOW_MS;
  attempts.set(ip, rec);
}

router.post('/login', (req, res) => {
  const ip = ipOf(req);

  const locked = checkLock(ip);
  if (locked > 0) {
    return res.status(429).json({ error: `尝试次数过多，请 ${locked} 秒后再试` });
  }

  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim().slice(0, 64) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';

  if (!username || !password) {
    return res.status(400).json({ error: '请输入管理员账号和密码' });
  }

  const expectedUser = String(process.env.ADMIN_USERNAME || 'admin');
  const hash = String(process.env.ADMIN_PASSWORD_HASH || '');

  const userOk = username === expectedUser;
  const passOk = verifyPassword(password, hash);

  if (!userOk || !passOk) {
    recordFail(ip);
    console.warn(`[auth] 登录失败 ip=${ip}`);
    return res.status(401).json({ error: '账号或密码错误' });
  }

  attempts.delete(ip);
  createSession(res, username);
  console.log(`[auth] 登录成功 ip=${ip}`);
  res.json({ ok: true, username });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user, expiresInMinutes: Math.max(5, Number(process.env.SESSION_TTL_MINUTES || 120)) });
});

/** 页面级守卫用：判断是否已登录，不返回敏感信息 */
router.get('/status', (req, res) => {
  res.json({ loggedIn: Boolean(getSession(req)) });
});

module.exports = router;
