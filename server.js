/**
 * 个人数字资产台账管理系统 —— 本地单机服务
 * 启动：node server.js  （或 npm start）
 * 仅监听 127.0.0.1，不对外网提供服务。
 */
require('./src/env').loadEnv();

const path = require('path');
const express = require('express');
const { getSession, startSessionCleanup, requireAuth } = require('./src/auth');
const { publicSchema } = require('./src/schema');
const authRouter = require('./src/routes/auth');
const assetsRouter = require('./src/routes/assets');
const { getDb } = require('./src/db');

/* ---------------- 启动前强制检查配置 ---------------- */

function abort(message) {
  console.error('\n[启动失败] ' + message + '\n');
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(String(process.env.AES_KEY || ''))) {
  abort('AES_KEY 未配置或格式不正确（需 64 位十六进制）。\n  解决：复制 .env.example 为 .env，然后运行 npm run init');
}
if (!String(process.env.ADMIN_PASSWORD_HASH || '').startsWith('scrypt$')) {
  abort('管理员密码哈希未配置。\n  解决：运行 npm run init 设置管理员密码（自动写入 .env）');
}
if (String(process.env.SESSION_SECRET || '').length < 32) {
  abort('SESSION_SECRET 未配置或长度不足 32 位。\n  解决：运行 npm run init 自动生成');
}

/* ---------------- 应用 ---------------- */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.tailwindcss.com",
      "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; ')
  );
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// 请求日志：只打方法/路径/状态/耗时，绝不打印请求体或任何密钥
app.use((req, res, next) => {
  const started = Date.now();
  const urlPath = String(req.originalUrl || req.url).split('?')[0];
  res.on('finish', () => {
    console.log(`${req.method} ${urlPath} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

// 写操作的来源校验（配合 SameSite=Strict Cookie，防跨站请求伪造）
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.headers.host) {
      return res.status(403).json({ error: '请求来源校验失败' });
    }
  } catch (_) {
    return res.status(403).json({ error: '请求来源校验失败' });
  }
  next();
});

/* ---------------- 页面路由 ---------------- */

const PUBLIC_DIR = path.join(__dirname, 'public');

app.get(['/', '/index.html'], (req, res) => {
  if (!getSession(req)) return res.redirect('/login.html');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get(['/login', '/login.html'], (req, res) => {
  if (getSession(req)) return res.redirect('/');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

/* ---------------- API ---------------- */

app.use('/api/auth', authRouter);
app.get('/api/schema', requireAuth, (req, res) => res.json(publicSchema()));
app.use('/api/assets', assetsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

/* ---------------- 静态资源 ---------------- */

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    dotfiles: 'deny',
    etag: true,
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.use((req, res) => res.status(404).send('404 Not Found'));

// 统一错误处理：只输出简要信息，不泄露堆栈与请求体
app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求数据格式错误' });
  }
  console.error('[error]', err && err.message ? err.message : 'unknown');
  if (res.headersSent) return;
  res.status(500).json({ error: '服务器内部错误' });
});

/* ---------------- 启动 ---------------- */

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);

getDb(); // 提前初始化数据库，失败立即暴露
startSessionCleanup();

app.listen(PORT, HOST, () => {
  console.log('--------------------------------------------------');
  console.log(' 个人数字资产台账已启动');
  console.log(` 地址: http://${HOST}:${PORT}`);
  console.log(' 仅本机可访问，按 Ctrl+C 停止');
  console.log('--------------------------------------------------');
});

process.on('SIGINT', () => {
  console.log('\n正在退出...');
  process.exit(0);
});
