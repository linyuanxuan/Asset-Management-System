# 个人数字资产台账管理系统

**[项目介绍页](https://linyuanxuan.github.io/Asset-Management-System/) · [本地应用](http://127.0.0.1:3000) · [快速开始](#四启动步骤) · [备份方法](#五备份与迁移) · [安全设计](#六安全设计说明)**

本地单机运行的数字资产台账，管理 AI 资源、账号、云服务器、其他凭证四类资产，敏感字段 AES-256-GCM 加密入库。

> 仓库：[github.com/linyuanxuan/Asset-Management-System](https://github.com/linyuanxuan/Asset-Management-System)
> 介绍页源码在 [docs/index.html](docs/index.html)，开启 GitHub Pages 后的地址即上方「项目介绍页」。

- 技术栈：Node.js + Express + SQLite（Node 22 内置 `node:sqlite`，无原生编译依赖）+ 原生 HTML/Tailwind CSS
- 仅监听 `127.0.0.1`，不对外网提供服务；无注册、无多用户、无分享

---

## 一、目录结构

```
05 数字资产管理系统/
├── server.js               # 入口：安全响应头、日志、路由挂载、启动自检
├── package.json            # 依赖与脚本
├── .env.example            # 环境变量模板（复制为 .env）
├── .env                    # 实际配置（npm run init 生成，禁止外传）
├── .gitignore              # 已排除 .env / data/ / *.db
├── src/
│   ├── env.js              # 极简 .env 加载器（不依赖 dotenv）
│   ├── crypto.js           # AES-256-GCM 加解密
│   ├── auth.js             # scrypt 密码哈希 + 会话（签名 Cookie）
│   ├── db.js               # SQLite 初始化与建表
│   ├── schema.js           # 四类资产字段定义（前后端唯一数据源）
│   ├── validate.js         # 输入校验、清洗、字段白名单
│   └── routes/
│       ├── auth.js         # 登录 / 登出 / 会话状态（含失败限流）
│       └── assets.js       # 资产 CRUD + 搜索 + 单字段解密 + CSV 导出
├── public/
│   ├── index.html          # 主界面
│   ├── login.html          # 登录页
│   ├── app.js              # 主界面逻辑
│   ├── login.js            # 登录逻辑
│   └── style.css           # 组件样式（Tailwind 补充）
├── scripts/
│   └── set-password.js     # 生成密钥 + 管理员密码哈希，写入 .env
├── docs/
│   └── index.html          # 仓库介绍页（GitHub Pages 首页）
└── data/
    └── assets.db           # SQLite 单文件数据库（首次启动自动创建）
```

## 二、依赖

```json
{
  "dependencies": { "express": "^4.21.2" },
  "engines": { "node": ">=22.5.0" }
}
```

只有 Express 一个第三方依赖。数据库使用 Node 22.5+ 内置的 `node:sqlite`，无需 node-gyp 编译，`npm install` 不会失败。
若你的 Node 低于 22.5：`npm i better-sqlite3`，`src/db.js` 会自动回退到它。

## 三、配置说明（.env）

| 变量 | 说明 |
| --- | --- |
| `HOST` / `PORT` | 监听地址与端口，默认 `127.0.0.1:3000`，不要改成 `0.0.0.0` |
| `ADMIN_USERNAME` | 管理员账号，默认 `admin` |
| `ADMIN_PASSWORD_HASH` | 管理员密码的 scrypt 加盐哈希，由 `npm run init` 生成，**不要手填明文** |
| `AES_KEY` | 敏感字段加密主密钥，64 位十六进制（32 字节），由脚本随机生成 |
| `SESSION_SECRET` | 会话 Cookie 签名密钥，≥32 位随机串 |
| `SESSION_TTL_MINUTES` | 会话空闲超时，默认 120 分钟（有操作自动续期） |
| `COOKIE_SECURE` | 通过反向代理上 HTTPS 时设为 `1` |
| `DB_PATH` | 数据库文件路径，默认 `./data/assets.db` |
| `WARN_DAYS` | 到期提醒阈值（天），默认 30，≤该天数条目标红 |

> **AES_KEY 一旦丢失，已加密的密钥/密码将永久无法解密。** 请与数据库分开备份（例如密码管理器里存一份）。

## 四、启动步骤

```bash
# 1. 安装依赖
npm install

# 2. 初始化：生成 AES_KEY / SESSION_SECRET，并设置管理员密码（≥8 位）
npm run init -- 你的管理员密码

# 3. 启动
npm start          # 等价于 node server.js
```

浏览器打开 <http://127.0.0.1:3000>，用 `admin` + 上一步设置的密码登录。

修改密码：`npm run init -- 新密码`（AES_KEY 保持不变，历史数据仍可解密）。

## 五、备份与迁移

```bash
# 方式一：先停服（Ctrl+C），再复制数据库（最稳）
cp data/assets.db  backup/assets-$(date +%Y%m%d).db

# 方式二：不停服，用 SQLite 在线备份（WAL 模式安全）
# 页面内「导出 CSV」也可做文本级备份（可选是否包含明文密钥）
```

- 运行中直接复制 `.db` 文件可能漏掉 `-wal` 中的数据，**建议停服复制，或同时复制 `assets.db-wal`**。
- 迁移到新机器：拷贝整个项目目录（含 `data/`）+ `.env`，`npm install && npm start` 即可，无需导入导出。
- CSV 导出：页面右上角「导出 CSV」→「脱敏导出」或「导出含明文密钥」（备份用，注意保存位置）。

## 六、安全设计说明

| 要求 | 实现 |
| --- | --- |
| 敏感字段加密存储 | `api_key` / `password` / `secret`(SSH 私钥) / 凭证密钥 全部 AES-256-GCM（随机 IV + 认证标签），库内形如 `enc:v1:<base64>`，改密文会解密失败 |
| 管理员密码 | scrypt(N=16384, r=8, p=1) + 16 字节随机盐，只存哈希，`timingSafeEqual` 比对 |
| 接口鉴权 | 除登录与 `/api/auth/status` 外，所有 `/api/*` 走 `requireAuth`；未登录返回 401，不泄露任何资产数据 |
| 会话 | HMAC-SHA256 签名的 HttpOnly + SameSite=Strict Cookie，默认 120 分钟空闲过期，服务重启即失效 |
| 防暴力破解 | 同 IP 10 分钟内 5 次失败锁定 10 分钟 |
| 传输防护 | 默认只绑 `127.0.0.1`；列表接口返回掩码，明文需单独调用 `/reveal` 且响应 `no-store`；如走 HTTPS 反代可开 `COOKIE_SECURE=1` |
| XSS | 前端全部用 `textContent` 渲染，不拼 HTML；后端清洗控制字符；CSP 限制脚本来源，禁止内联脚本 |
| CSRF | SameSite=Strict + 写操作 Origin/Referer 同源校验 |
| 输入校验 | 字段白名单、类型/长度/日期格式/枚举值校验，非法字段直接丢弃 |
| 日志脱敏 | 只打印方法、路径、状态码、耗时；不打印请求体、密钥、密码 |
| 其他 | `X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy` |

## 七、使用要点

- **分类标签**：顶栏 tab 切换 AI 资源 / 账号资产 / 云 & 服务器 / 其他凭证。
- **到期提醒**：`到期时间` 早于今天 → 红色边框 + 「已过期 N 天」；≤ `WARN_DAYS` → 橙色边框 + 「剩余 N 天」；AI 额度剩余 ≤10% 单独标红。
- **搜索**：模糊匹配平台名称与备注。
- **查看敏感字段**：详情页点「显示」才向后端请求明文，看完可点「隐藏」。
- **编辑时留空敏感字段 = 不修改**，避免误清空。
- **CSV 用 Excel 打开**：已带 UTF-8 BOM，中文不乱码。

## 八、注意事项

1. `.env`、`data/assets.db`、导出的 CSV 都不要上传网盘、Git 仓库或聊天工具。
2. 第一次用请立即执行 `npm run init -- 你的密码`，不要沿用示例值。
3. 本系统设计为单机自用：端口只监听本机，不要做端口映射/内网穿透暴露到公网。
4. 项目未使用持久化 session 存储，重启服务需重新登录，这是刻意的安全取舍。

## 九、发布到 GitHub / GitHub Pages

仓库根目录已备好介绍页 `docs/index.html`，README 顶部有指向它的链接。

**1. 开启 Pages**

仓库 `Settings → Pages → Source: Deploy from a branch → Branch: main / Folder: /docs → Save`。
约 1 分钟后访问 `https://<用户名>.github.io/<仓库名>/`。

**2. 链接已配置好**

README 与介绍页中的链接均指向 `linyuanxuan/Asset-Management-System`。若日后仓库改名，执行：

```bash
grep -rl "Asset-Management-System" README.md docs/index.html
```

**3. 推送前自检（关键）**

```bash
git status --short          # 确认没有 .env、data/、*.db、*.csv
git check-ignore -v .env data/assets.db   # 能被忽略才算安全
```

`.gitignore` 已排除：`node_modules/`、`.env`、`data/`、`*.db`、`*.db-wal`、`*.db-shm`、`backup/`、`*.csv`、`.workbuddy/`。

> 若曾经误提交过 `.env`，改密码 + 换 `AES_KEY` 并清理历史提交，仅删除文件不够。

