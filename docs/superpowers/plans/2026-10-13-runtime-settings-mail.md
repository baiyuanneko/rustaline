# 后台业务设置与邮件提醒实施计划

> 代理执行要求：使用 superpowers:subagent-driven-development，逐任务实施和审查；本会话已获用户批准持续实现。

**目标：** 后台能够持久保存并即时应用评论/验证码规则，配置 SMTP 后发送管理员新评论与评论者回复提醒。

**架构：** 启动配置负责基础设施和密钥，单行 app_settings 负责业务设置；请求使用数据库快照。评论事务同时创建 mail_jobs，后台工作任务通过租约领取并发送邮件。

**技术栈：** Rust edition 2024、Axum 0.8、Sea-ORM 2、Tokio、lettre 0.11、标准 AEAD、SQLite/PostgreSQL/MySQL、原生 JavaScript 与本地 mdui 2.1.5。

**设计：** docs/superpowers/specs/2026-10-13-runtime-settings-mail-design.md

## 全局约束

- 迁入现有数据库，默认 SQLite；新增迁移使用 sea-query 跨库写法，不修改已发布迁移。
- 旧 comment TOML/APP_* 只在设置表为空时播种；已有数据库设置优先，后台保存后重启不可被旧环境变量覆盖。
- 部署连接、JWT、日志、静态文件/Swagger/首页启动开关和 captcha HMAC 密钥保留原配置入口。
- 保持现有 GET /api/v1/admin/config 字段、公共分页契约、匿名评论和公共响应隐私边界。
- PoW 规则、签名格式、Redis 原子消费及图形码单 Lua 校验保持现有契约；默认两种验证码均开启。
- 所有新增管理接口要求 AuthUser，DTO ToSchema、utoipa 和 OpenAPI 同步。
- SMTP 密码加密存储，不进入响应/日志；空字符串保留，不 trim 密码，clear_password 显式清除。
- 邮件 SMTP 默认关闭；管理员新评论/评论者回复两项分别开关；待审核回复不提前发送，历史/导入不追发。
- 用户内容通过 DOM/textContent 渲染，后台/SDK 新文案必须同时提供中文和英文；SDK 保持零依赖单文件。
- workspace.dependencies 统一新增依赖；完成后 cargo build、cargo test、cargo clippy --all-targets -- -D warnings、cargo fmt --check 和 docs 构建均须验证。
- 仅使用本机假 SMTP 做自动发送测试，不发送外部真实邮件；每次真实 SMTP 操作总超时 30 秒。

## Task 1: 设置持久化、旧配置适配与即时生效 API

**文件：** 新增 migration/src/m20261013_000001_create_app_settings.rs、app/src/entities/app_settings.rs、app/src/dto/settings.rs、app/src/services/settings_service.rs、app/src/handlers/settings.rs；修改 migration/src/lib.rs、entities/dto/services/handlers 模块、config.rs、main.rs、error.rs、routes/mod.rs、openapi.rs、comment/captcha/admin_comment handlers、middleware/rate_limit.rs、app/tests/api.rs、根/app Cargo.toml 与 Cargo.lock。

**接口契约：**

```rust
// settings_service.rs 提供下列接口；快照拥有配置，不跨 await 持有锁。
pub struct SettingsSnapshot {
    pub revision: i64,
    pub comment: crate::config::CommentConfig,
    pub mail: crate::config::MailConfig,
    pub password_needs_reset: bool,
}
pub async fn initialize(db: &sea_orm::DatabaseConnection, bootstrap: &crate::config::AppConfig)
    -> Result<SettingsSnapshot, crate::error::AppError>;
pub async fn load(db: &sea_orm::DatabaseConnection, jwt_secret: &str)
    -> Result<SettingsSnapshot, crate::error::AppError>;
// RuntimeSettings(snapshot) 是 FromRequestParts<AppState> extractor。
// 评论限流中间件读取一次并放入 request.extensions；handler 复用该快照。
```

SMTP `MailConfig` 使用 enabled、host、port、security（starttls/tls/none）、username、password、from_email、from_name、admin_email、notify_admin、notify_reply、site_name、site_url、language（zh-CN/en）；默认 disabled/587/starttls/中文。password 的 Debug 必须脱敏，数据库 JSON 永远排除原文密码和 captcha.secret。

设置表 id=1，schema_version=1，revision 初值 1，content TEXT，smtp_password_ciphertext nullable TEXT，时间为 NaiveDateTime。PATCH 请求有 revision 与可选 comment/mail 分组；各分组字段可选，未提交字段保持，SMTP clear_password 规则依照设计。返回现有 config 字段及 comment.captcha、mail（password_configured/password_needs_reset）、revision。

- [ ] 在现有 API 测试中先添加认证 PATCH 更新审核规则和非法输入用例；以下请求在旧代码上应返回 405，而期望 200，先运行并确认失败。

```rust
#[tokio::test]
async fn admin_settings_patch_changes_next_comment_without_restart() {
    let app = build_app(None, false).await;
    let token = login(&app).await;
    let (status, _) = call(&app, json_request("PATCH", "/api/v1/admin/config",
        Some(json!({"revision": 1, "comment": {"moderation": true}})), Some(&token))).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = call(&app, submit_comment_req("/settings-test", "new comment")).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["pending"], true);
}
```

- [ ] 新增 schema/entity 和可序列化配置；为 MailConfig 支持默认值与 APP_MAIL_* 映射，保留旧无 mail 配置能够反序列化的用例。
- [ ] 实现一次性 initialize 与 load；播种使用唯一 id 冲突保护；schema_version 缺字段补默认，未来版本拒绝覆盖；使用 AES-256-GCM 等标准 AEAD 加密密码，HMAC-SHA256 标签 rustaline-settings-v1 从 JWT 派生 key，随机 nonce。
- [ ] 实现 GET/PATCH handler 与 service 更新：检查 revision 后条件 UPDATE，0 行返回 409；校验 comment/captcha 数值、默认昵称长度、SMTP 端口/邮箱/站点 URL、账号密码组合；新 AppError Conflict 映射 409。
- [ ] 改主程序和 API 测试构造路径，在迁移后 initialize，再校验实际 settings；接入所有评论配置消费者和限流快照；验证码签名 key 仍取部署 captcha.secret/JWT，不随数据库字段污染。
- [ ] 补充并验证升级保留数据、播种幂等/并发、重启读取 DB、revision 冲突、参数拒绝、密码保留/替换/清除/错误 JWT 解密，以及公共响应不暴露邮件秘密的行为测试。设置测试使用真实内存 SQLite；预期值直接写字面量，不由被测代码构造。
- [ ] 执行定向测试、cargo build、cargo test、cargo clippy --all-targets -- -D warnings、cargo fmt --check，提交本任务变更并记录命令/结果；交由独立任务审查。

## Task 2: 持久邮件队列、SMTP 与评论事件接入

**文件：** 新增 migration/src/m20261013_000002_create_mail_jobs.rs、app/src/entities/mail_jobs.rs、app/src/services/mail_service.rs、app/src/services/mail_worker.rs、app/src/dto/mail.rs、app/src/handlers/mail.rs、app/tests/mail.rs 与测试支持；修改 comments migration（新增独立 ALTER 迁移而非改原文件）、entities/comments.rs、dto/comment.rs、services/comment_service.rs、services/import_service.rs、handlers/comment.rs、handlers/admin_comment.rs、main.rs、routes/openapi/module 注册与 Cargo 依赖。

**接口契约：** Task 1 的 SettingsSnapshot/MailConfig 是运行配置来源。create_comment 接入邮件设置时可以增加明确 mail 参数，所有调用同步修改；update_status 在同一数据库事务更新评论及已有等待任务。入队函数接收 ConnectionTrait（支持事务），worker 接收 AppState。

```rust
pub async fn enqueue_new_comment<C: sea_orm::ConnectionTrait>(
    db: &C, mail: &crate::config::MailConfig, comment: &crate::entities::comments::Model,
) -> Result<(), crate::error::AppError>;
// 独立 worker 提供 spawn_worker(AppState) 和可等待的 shutdown。
// 管理接口 POST /admin/mail/test {"to":"admin@example.com"}；GET /admin/mail/status。
```

新增 comments.reply_notification boolean 默认 true，提交 DTO #[serde(default = "default_true")]；Valine import 写 true，is_notified 仍按导入原值保留。唯一 event_key 分别是 admin:<comment-id> 和 reply:<comment-id>；任务状态 pending/waiting_approval/processing/sent/failed/cancelled。

- [ ] 先用 Task 1 配置 API 打开本机 SMTP，写真实 TCP 假 SMTP 的管理员/回复发送测试并确认现有代码不会收到邮件；先写待审状态不发、重复批准只发送一次的行为期望。
- [ ] 新增 mail_jobs 跨库表与 comments 新列：任务含持久收件人、评论关联、attempts、next_attempt_at、lease_token/lease_until、last_error、timestamps，event_key unique；对待处理查询加状态/时间索引。
- [ ] 使用 lettre 异步 transport 处理 STARTTLS/TLS/none 和可选认证，纯文本模板中固定 Message-ID 来源于任务 id；站点链接仅 HTTP/HTTPS；超时/错误记录简化类别，不记录 SMTP 密码/完整用户内容。
- [ ] 评论落库事务内按开关入队，蜜罐提前假返回，导入不调用队列；管理员包括待审评论；回复只给直接父评论的有效邮箱，检查父偏好并跳过自己回复自己。
- [ ] 审核只激活已存在 waiting_approval 任务，既有记录不凭状态变化生成新事件；删除或 spam 取消未发送事件。worker 发送前重新校验存在/approved/父存在与开关，成功才更新 is_notified。
- [ ] 实现领取条件更新与 120 秒租约；SMTP 总超时 30 秒；最多 5 次尝试，间隔 30/120/600/1800 秒；恢复超时租约，清理超过 30 天终态任务；关闭 SMTP 时暂停发送。
- [ ] 主程序启动/优雅退出管理 worker；新增认证测试邮件/状态 API、脱敏错误及 OpenAPI，测试只用本机假 SMTP。
- [ ] 验证管理员/回复、审核、偏好/空邮箱/自回复、导入/蜜罐、密码错误、发送失败重试、重启恢复/多领取者、关闭 SMTP 与租约恢复等实际行为，随后运行四项 Cargo 检查、提交并独立审查。

## Task 3: 后台编辑、SDK 运行期适配、文档与端到端验证

**文件：** 修改 static/admin/js/views/settings.js、api.js、i18n.js、admin.css、static/sdk/rustaline.js、config/default.toml、.env.example、README.md、AGENTS.md、docs/guide/quick-start.md；新增必要的浏览器回归脚本/记录（临时截图放忽略目录）。

**接口契约：** 使用已实现 GET/PATCH /admin/config 的 revision/comment.captcha/mail，POST /admin/mail/test 的 to，GET /admin/mail/status；公共 /captcha/config 添加 reply_notification_enabled；提交 body 可带 reply_notification。

- [ ] 先通过浏览器回归验证当前设置页无编辑/保存/测试入口、SDK 已打开页面在后台改验证码后按旧开关提交，记录预期失败；使用实际 HTTP 后端与本机假 SMTP，不把整个应用 mock 掉。
- [ ] 设置页改为评论、验证码、邮件表单；原改密卡片保持独立；保存带 revision，显示校验/409 与加载状态；SMTP 密码留空保留，显式清除，测试仅使用保存后的配置；发送状态独立刷新。
- [ ] 每项新增文案在中文/英文 DICTS 同时添加，沿用现有 mdui 2.1.5 原生组件/DOM 构建；用户值不进入 innerHTML；响应式表单和操作按钮在窄屏可使用。
- [ ] SDK 每次提交前 5 秒限时刷新验证码配置；已确认支持配置的新后端暂时失败时保留草稿并提示重试，旧无接口后端保留兼容；动态变化校验失败刷新开关，不自动重复提交。
- [ ] SDK 显示邮件回复偏好并送 reply_notification；保留新旧客户端默认 true；新增字典文案；公共 captcha handler/DTO/OpenAPI 的通知开关字段同步。
- [ ] 更新部署文档：一次性播种/数据库优先规则、后台配置 SMTP 与测试步骤、两类通知/审核行为、加密密码与 JWT 轮换、旧版本回退和后台修改不回写文件；示例默认 SMTP 关闭。
- [ ] 使用浏览器验证中文/英文、浅色/深色、桌面/窄屏、配置保存/重启、冲突提示、密码清除/测试邮件、动态验证码和草稿恢复；查看控制台与网络错误。
- [ ] 运行 cargo build、cargo test、cargo clippy --all-targets -- -D warnings、cargo fmt --check、docs/npm build 与 git diff --check，整理验证证据，提交并接受独立审查。

## 执行收尾

- [ ] 为全分支生成审查包，独立检查与批准设计的符合性、数据库事务/队列领取、秘密处理及兼容边界；处理实际发现。
- [ ] 最后有代码改动时重跑受影响测试与规定检查，将交付代码保留在项目功能分支，报告入口、迁移规则、实际测试结果和限制。
