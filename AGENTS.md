# AGENTS.md

## 项目结构

Cargo workspace，两个 crate：

```
bynrust26/
├── Cargo.toml            # workspace 根，[workspace.dependencies] 统一版本
├── config/default.toml   # 默认配置（local.toml 为本机覆盖，已 gitignore）
├── static/               # 静态文件目录，ServeDir 兜底挂载于根路径（目录请求返回 index.html）；
│                         # static.introduction_index=false（APP_ENABLE_INTRODUCTION_INDEX）时 / 改挂 307 重定向到 /admin/（routes/mod.rs）
│   ├── index.html        # rustaline 评论系统演示主页（mdui 风格，引入 sdk/rustaline.js；中英双语 data-i18n 标记）
│   ├── index-i18n.js     # 演示页 i18n：独立小字典（zh-CN/en）+ data-i18n 填充 + 右上角语言切换按钮
│   ├── icon.webp         # 站点图标（各页面 favicon + 演示主页左上角 logo）
│   ├── theme.js          # mdui 主题初始化（默认种子色 #2196f3 Material 蓝；主题色与明暗模式 light/dark/auto 均持久化于 localStorage，页面侧经 window.rustalineTheme 读写）
│   ├── vendor/mdui/      # 本地 vendor 的 mdui 2.1.5（mdui.global.js / mdui.css / LICENSE / SHA256SUMS）
│   ├── sdk/rustaline.js  # 评论 SDK：零依赖单文件，Material 3 视觉，全局 Rustaline 类，支持多实例；内置 zh-CN/en 双字典（lang 参数 / Rustaline.langs）；配色由 colorPattern 种子色派生（默认 #2196f3 淡蓝），darkMode 控制明暗（默认 auto 跟随系统）
│   └── admin/            # 管理面板：原生 ES Modules SPA（hash 路由）+ mdui Web Components，中英双语
│       ├── js/i18n.js    # 运行期字典 + t() + applyStaticTexts()（[data-i18n] 填充），语言判定 localStorage rustaline-lang > navigator.language
│       ├── js/markdown.js# 极简 Markdown 子集渲染（与 SDK 内 renderMarkdown 同构，纯 DOM 构建）
│       └── js/views/     # login / dashboard / comments / import / settings
├── migration/            # sea-orm-migration 独立 crate（CLI + Migrator）
│   └── src/m*_*.rs       # 迁移文件，按时间戳命名并注册进 lib.rs 的 Migrator
└── app/                  # 应用 crate（bin 名 bynrust26，lib 名 app）
    ├── src/
    │   ├── main.rs       # 启动流程与优雅退出（into_make_service_with_connect_info 注入客户端 IP）
    │   ├── lib.rs        # 模块声明（集成测试依赖 lib target）
    │   ├── config.rs     # 分层配置加载（default.toml < local.toml < APP_* env）
    │   ├── state.rs      # AppState（db / redis / config / 各 RateLimiter / captcha_memory / captcha_signing_key / admin）
    │   ├── error.rs      # AppError -> 统一 JSON { code, message }
    │   ├── openapi.rs    # utoipa 聚合 + Swagger UI
    │   ├── routes/       # 路由装配（公共 /api/v1/comments、/api/v1/captcha/*、认证 /api/v1/admin/*）
    │   ├── handlers/     # 薄层：解析请求 -> 调 service -> 响应；带 utoipa::path 注解（captcha.rs = 验证码三个 GET）
    │   ├── services/     # 领域逻辑（comment_service / captcha_service / import_service）
    │   ├── dto/          # 请求/响应模型（derive utoipa ToSchema）
    │   ├── auth/         # jwt 签发/校验、Redis 黑名单、AuthUser extractor、admin.rs 管理员账号（种子/登录/改密）
    │   ├── middleware/   # rate_limit：IP 滑动窗口限流（评论提交 + 登录 + PoW/图形码签发各一实例；过期条目由 check 摊销清扫 + 容量上限，防历史 IP 无界增长，M-1）+ ClientIp extractor
    │   └── entities/     # sea-orm 实体（comments / admins）
    └── tests/api.rs      # 端到端集成测试（内存 SQLite + 临时 redis-server）
```

## 业务模块：rustaline 评论系统

Valine 自托管替代品。comments 表完整兼容 Valine 字段（id 即 objectId、QQAvatar→qq_avatar、pid/rid 楼中楼、insertedAt→inserted_at），新增 `status`（approved/pending/spam）支撑审核。公共接口匿名（`GET/POST /api/v1/comments` + `GET /api/v1/comments/replies`），管理接口走 AuthUser（`/api/v1/admin/comments*`）；Valine 导入按 objectId 幂等，单批 ≤1000 条。详见 README「rustaline 评论系统」一节。

公共列表为**楼中楼分页契约**：`GET /api/v1/comments?url=&page=` 按 root（pid IS NULL）倒序分页（默认 10、上限 20/页），返回 `{ count, root_total, page, page_size, roots }`，每楼带 `reply_count` 与最早 5 条 `replies` 预览；`count` = 该 url 全部 approved 数（含回复）。楼内展开走 `GET /api/v1/comments/replies?url=&rid=&offset=&limit=`（时间升序，limit ≤50，rid 须指向同 url 顶层评论否则 400）。SDK 侧：超过 3 层的嵌套折叠为「继续查看这段对话」占位条（就地展开零请求），预览不全的楼尾部出「查看全部 N 条回复」（调 replies 接口拉全量）。

提交走白名单：只收 `url/comment/nick/mail/link/pid/rid/hp` 及验证码字段 `pow/captcha_id/captcha_code`，其余字段（含 qq_avatar）serde 忽略；rid 由服务端按父评论推导，客户端显式 rid 与推导值不一致 → 400；顶层提交的 rid 一律丢弃。各字段长度与建表迁移 varchar 对齐（常量集中在 `comment_service.rs` 顶部，改动需两边同步）；UA 服务端截断 512 字符。登录接口固定 5 次/分钟/IP 限流（`login_rate_limit_middleware`，与评论限流独立）。

评论验证码（`services/captcha_service.rs`，配置在 `[comment.captcha]`，**默认两种都开启**（`APP_COMMENT_POW_ENABLED=false` / `APP_COMMENT_CAPTCHA_IMAGE_ENABLED=false` 可分别关掉））：PoW 与图形码是两套相互独立的开关（env `APP_COMMENT_POW_*` / `APP_COMMENT_CAPTCHA_IMAGE_*`），同开为 AND；校验顺序固定为蜜罐 → PoW → 图形码 → 字段校验 → 落库。PoW = SHA-256 hashcash（`SHA-256(challenge:nonce)` 十六进制前 N 位为 0），challenge 是 **HMAC 签名令牌**（密钥取 `captcha.secret`，留空由 jwt.secret 以 HMAC 标签 `rustaline-captcha-v1` 域分离派生），载荷含 `v/rnd/iat/exp/ip?`，签发无状态、提交时先验签+过期+可选 IP 绑定，再算一次哈希验前导零，最后 Redis `SET captcha:pow:<rnd> 1 NX EX` 原子消费防重放；图形码用 `captcha` crate 在 `spawn_blocking` 中生成 4 位字符 PNG（`generate_image()` 里的 4 字符 / view(168,64) / 单向 Wave / 轻噪声 是可读性优先的参数组合，改动会同步影响识别率，单测已锁死尺寸与位数），答案仅存服务端（`captcha:img:<id>` = `answer:剩余次数`，小写比对、错 N 次作废、成功即删）；Redis 路径用**单条 Lua 脚本**（`VERIFY_IMAGE_SCRIPT`）原子完成「读取→比对→删除/扣次」，禁止拆回多步命令（并发下会一码多用/扣次丢失/凭证复活，H-5）；内存路径单次持锁 + `subtle` 常量时间比较）。两类凭证都 Redis 优先、进程内内存表（`CaptchaMemoryStore`，带 TTL 清理与容量上限）兜底；多副本必须配 Redis。公共接口 `GET /api/v1/captcha/{config,pow,image}` 匿名开放，pow/image 签发各自限流 60 次/分钟/IP；**pow/image 端点尊重各自开关：关闭后返回 404**（config 端点恒可用，SDK 探测依赖它，M-2——不加门控时关闭的图形码仍可被触发栅格化 + PNG 编码 + 写存储，且 image_ttl_secs=0 时 SETEX 会 500）。SDK 侧 `/captcha/config` 探测失败按指数退避重试（至多 3 次，1s 起每次翻倍），仍失败保持全关（兼容旧服务端）但 `configOk` 留 false，提交前会限时 5s 再探一次、成功才按真实开关走 PoW/图形码（H-10，防瞬时网络抖动让整页会话永久无法评论）。PoW 优先 `crypto.subtle`（仅安全上下文可用，明文 HTTP 下不存在），回退到**内联的 js-sha256 v1.0.0（MIT，版权头保留在 rustaline.js 内）**纯 JS 实现，循环每 256 次让出事件循环；PoW 在乐观插入之前计算；图形码改为**模态框收集**（`_openCaptchaModal`，挂在 document.body 并把 `.rs-root` 解析出的 `--rs-*` 令牌拷贝到遮罩上以跟随主题；`_render` 会清空 root 故不能挂 root）：点提交先弹框、确认后才走 PoW 与提交，取消则保留草稿；服务端判错时重弹模态框并换新图；图形码在弹框时才按需拉取（不在 SDK 初始化时预拉）。改 PoW 拼接格式/前导零规则时，必须前后端与测试三处同步。

JWT 密钥启动时强制校验（`config.rs::validate_jwt_secret`，在 main.rs 调用）：拒绝已知弱默认值、要求 ≥32 字节，不满足即启动失败；`docker-compose.yml` 用 `${APP_JWT_SECRET:?}` 缺失报错（dev compose 保留仅本地的 ≥32 字节默认值）。生产 compose 的配置注入渠道：`env_file: .env`（`required: false`）把项目 `.env` 整体传入容器，未被 environment 引用的 `APP_*`（审核 / 验证码 / Swagger 开关等）靠它生效——Compose 只拿 `.env` 做插值、不会自动传容器，删掉该声明这些开关会静默丢失（H-13）；`environment` 固定的容器内项（DB/Redis 地址等）优先级高于 env_file，`.env` 的本机路径不会覆盖。生产 compose 的 Redis 挂命名卷 `redis-data` 并开 `--appendonly yes`：JWT 注销黑名单与 PoW 防重放消费记录在 `down`/`up` 重建容器后必须存活（H-14），去掉卷声明会让匿名卷随 down 删除、未过期凭证复活。

单管理员入库：`admins` 表仅一行（迁移 m20260903_000001）。`APP_INITIAL_ADMIN_USERNAME` / `APP_INITIAL_ADMIN_PASSWORD` 仅在表为空时作首次种子（此时缺失即启动失败），入库后被完全忽略（改动无效，可从 env 移除）。密码只存 argon2 哈希；login 查库比对发 JWT（sub = 用户名，claims 带 ver = token_version）；改密码走管理面板设置页（`POST /api/v1/admin/account/password`，校验当前密码、新密码 ≥8 字符），改密自增 token_version 使包括当前在内的全部旧 token 立即失效；AuthUser 在验签 + 黑名单后查库比对 token_version（单管理员低频，每请求一次 DB 查询可接受）。


## mdui vendor 管理

- 版本固定：`static/vendor/mdui/VERSION` 当前为 `2.1.5`；不得直接修改 vendor 文件。
- 文件：`mdui.global.js`、`mdui.css`、`LICENSE`、`VERSION`、`SHA256SUMS`。
- 升级步骤：
  1. `npm pack mdui@<版本>` 并解包；
  2. 覆盖 `mdui.global.js`、`mdui.css`、`LICENSE`；
  3. 更新 `VERSION`；
  4. 在 `static/vendor/mdui/` 下执行 `sha256sum mdui.global.js mdui.css > SHA256SUMS`；
  5. 全量跑一遍主页 / 管理面板的 Playwright 回归；
  6. 更新 README 与本文件中的版本号。
- 校验：`cd static/vendor/mdui && sha256sum -c SHA256SUMS`。

## 构建 / 测试命令

```bash
cargo build                                   # 构建（默认 sqlite feature）
cargo test                                    # 全部测试（黑名单用例需要本机 redis-server，缺失时自动跳过）
cargo clippy --all-targets -- -D warnings     # lint，提交前必须通过
cargo fmt                                     # 格式化（rustfmt.toml: edition 2024）
cargo run -p app                              # 本地运行
cargo run -p migration -- <up|down|status>    # 手动迁移（读 DATABASE_URL / .env）
```

DB 切换：`--no-default-features --features postgres|mysql`（app 与 migration 的 feature 同名联动）。

## 代码约定

- handler 保持薄：不写 SQL / 不直接访问 `state.db` 做业务，统一走 `services/`。
- 所有错误经 `AppError` 返回；5xx 不向外暴露内部细节（`error.rs` 已处理），新错误源加 `#[from]` 变体。
- 新接口三件套同步更新：`handlers/` 加 `#[utoipa::path]`、`dto/` 加 `ToSchema` 模型、`openapi.rs` 的 `paths(...)` / `components(schemas(...))` 注册。
- 除 login / health / swagger 外，接口一律加 `AuthUser` extractor 参数做认证。**例外**：公共评论接口 `GET/POST /api/v1/comments` 按 Valine 语义匿名开放，靠限流 + 蜜罐 + moderation 防滥用。
- 需要登录的接口在 utoipa 注解里加 `security(("bearer_auth" = []))`。
- 公共评论响应 DTO 绝不包含 ip / mail / ua / status（隐私）；这些字段仅出现在 `/api/v1/admin/*` 响应中。例外一：`ua_summary`（`services/ua.rs` 解析出的评论者环境摘要，如 "Chrome 126 · Windows"），由 `comment.display_commenter_user_agent`（env `APP_DISPLAY_COMMENTER_USER_AGENT`）控制，默认开启；原始 ua 仍绝不进公共响应。例外二：`pending: bool`（由 status 推导的布尔标志，不暴露具体状态值）——仅 POST 创建响应在 moderation 开启时为 true，列表/回复接口只返回 approved 故恒为 false；SDK 收到 `pending=true` 时不做乐观插入，回滚占位并展示「待审核」提示（H-6）。
- 提交评论的 ip/ua 由服务端采集，客户端 body 传的一律忽略。客户端 IP 统一经 `middleware/rate_limit.rs::extract_client_ip` 推导：默认（`server.trust_xff=false`）使用 ConnectInfo 对端 IP、忽略 X-Forwarded-For（防伪造）；反代部署置 `APP_TRUST_XFF=true` 后取 XFF **最右侧**可解析条目（标准反代把真实客户端 IP 追加在链尾，取首项会被客户端伪造），XFF 缺失或全畸形时回退对端 IP。**仅当 app 不可被外部直连、仅经反代可达时才可开启 trust_xff**，否则客户端可伪造 XFF 绕过全部限流。所有限流桶、`comments.ip` 落库与 `captcha.bind_ip` 都走这一个函数。
- 迁移用 sea-query 跨库写法（`sea_orm_migration::schema::*` 辅助函数），不要写单库专有 SQL；新迁移文件命名 `mYYYYMMDD_NNNNNN_<描述>.rs` 并注册进 `migration/src/lib.rs`。
- 时间戳统一 `chrono::NaiveDateTime`（实体 `DateTime`，migration 用 `date_time(...)`），由 service 层显式赋值。序列化为 UTC 朴素时间（无时区后缀）；**前端（SDK / 管理面板）解析时必须按 UTC 处理**（现有 `parseServerTime` 助手），否则非 UTC 时区显示偏差。
- 表名用复数（`comments`），避免与数据库保留字冲突。
- 密码只存 argon2 哈希（管理员密码也仅以哈希形式入库）；任何响应不得包含密码或哈希字段。
- `static/sdk/rustaline.js` 保持**零依赖单文件**：原生 JS IIFE，不引框架 / CDN / npm / 字体；仅使用内置 Material 3 CSS 令牌。
- 官网与管理面板使用**本地 vendor 的 mdui**（见下方「mdui vendor 管理」），不引 CDN、不引入 npm 运行时；面板仍为原生 ES Modules，无构建步骤。
- 前端三端（SDK / 管理面板 / 演示页）中英双语：新增界面文案一律走字典 key（SDK 内置 `LANGS`、面板 `admin/js/i18n.js` 的 `DICTS`、演示页 `index-i18n.js` 的 `DICTS`），禁止硬编码单一语言字符串；新增语言 = 补一个同构字典对象。语言偏好统一持久化于 localStorage `rustaline-lang`；后端 API 错误 message 保持英文不翻。
- 所有用户内容一律 `textContent` / `createTextNode` 渲染防 XSS，禁止 innerHTML 拼接用户数据；静态 SVG 常量可例外，但必须固定写死在本文件内。评论正文的 Markdown 子集渲染（SDK `renderMarkdown` 与 `admin/js/markdown.js`，两者同构同步）只允许 DOM 构建，URL 一律过 safeLinkUrl（仅 http/https），禁止引入 HTML 字符串解析。
- 依赖版本统一改根 `Cargo.toml` 的 `[workspace.dependencies]`，成员 crate 用 `xxx.workspace = true` 引用。
- 完成改动后必须跑通：`cargo build`、`cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check`。
