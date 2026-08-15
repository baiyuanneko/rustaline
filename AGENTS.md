# AGENTS.md

## 项目结构

Cargo workspace，两个 crate：

```
bynrust26/
├── Cargo.toml            # workspace 根，[workspace.dependencies] 统一版本
├── config/default.toml   # 默认配置（local.toml 为本机覆盖，已 gitignore）
├── static/               # 静态文件目录，ServeDir 兜底挂载于根路径（目录请求返回 index.html）
│   ├── index.html        # rustaline 评论系统演示主页（mdui 风格，引入 sdk/rustaline.js）
│   ├── scaffold-demo.html# 原脚手架示例页（health / 401 / Swagger 演示）
│   ├── theme.js          # mdui 主题初始化（mdui-theme-auto + setColorScheme）
│   ├── vendor/mdui/      # 本地 vendor 的 mdui 2.1.5（mdui.global.js / mdui.css / LICENSE / SHA256SUMS）
│   ├── sdk/rustaline.js  # 评论 SDK：零依赖单文件，Material 3 视觉，全局 Rustaline 类，支持多实例
│   └── admin/            # 管理面板：原生 ES Modules SPA（hash 路由）+ mdui Web Components
│       └── js/views/     # login / dashboard / comments / import / settings
├── migration/            # sea-orm-migration 独立 crate（CLI + Migrator）
│   └── src/m*_*.rs       # 迁移文件，按时间戳命名并注册进 lib.rs 的 Migrator
└── app/                  # 应用 crate（bin 名 bynrust26，lib 名 app）
    ├── src/
    │   ├── main.rs       # 启动流程与优雅退出（into_make_service_with_connect_info 注入客户端 IP）
    │   ├── lib.rs        # 模块声明（集成测试依赖 lib target）
    │   ├── config.rs     # 分层配置加载（default.toml < local.toml < APP_* env）
    │   ├── state.rs      # AppState（db / redis / config / comment_rate_limiter）
    │   ├── error.rs      # AppError -> 统一 JSON { code, message }
    │   ├── openapi.rs    # utoipa 聚合 + Swagger UI
    │   ├── routes/       # 路由装配（公共 /api/v1/comments、认证 /api/v1/admin/*）
    │   ├── handlers/     # 薄层：解析请求 -> 调 service -> 响应；带 utoipa::path 注解
    │   ├── services/     # 领域逻辑（user_service / comment_service / import_service）
    │   ├── dto/          # 请求/响应模型（derive utoipa ToSchema）
    │   ├── auth/         # jwt 签发/校验、Redis 黑名单、AuthUser extractor
    │   ├── middleware/   # rate_limit：IP 滑动窗口限流 + ClientIp extractor
    │   └── entities/     # sea-orm 实体（users / comments，可由 sea-orm-cli 重新生成）
    └── tests/api.rs      # 端到端集成测试（内存 SQLite + 临时 redis-server）
```

## 业务模块：rustaline 评论系统

Valine 自托管替代品。comments 表完整兼容 Valine 字段（id 即 objectId、QQAvatar→qq_avatar、pid/rid 楼中楼、insertedAt→inserted_at），新增 `status`（approved/pending/spam）支撑审核。公共接口匿名（`/api/v1/comments`），管理接口走 AuthUser（`/api/v1/admin/comments*`）；Valine 导入按 objectId 幂等，单批 ≤1000 条。详见 README「rustaline 评论系统」一节。


## mdui vendor 管理

- 版本固定：`static/vendor/mdui/VERSION` 当前为 `2.1.5`；不得直接修改 vendor 文件。
- 文件：`mdui.global.js`、`mdui.css`、`LICENSE`、`VERSION`、`SHA256SUMS`。
- 升级步骤：
  1. `npm pack mdui@<版本>` 并解包；
  2. 覆盖 `mdui.global.js`、`mdui.css`、`LICENSE`；
  3. 更新 `VERSION`；
  4. 在 `static/vendor/mdui/` 下执行 `sha256sum mdui.global.js mdui.css > SHA256SUMS`；
  5. 全量跑一遍主页 / 脚手架 / 管理面板的 Playwright 回归；
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
- 除 register / login / health / swagger 外，接口一律加 `AuthUser` extractor 参数做认证。**例外**：公共评论接口 `GET/POST /api/v1/comments` 按 Valine 语义匿名开放，靠限流 + 蜜罐 + moderation 防滥用。
- 需要登录的接口在 utoipa 注解里加 `security(("bearer_auth" = []))`。
- 公共评论响应 DTO 绝不包含 ip / mail / ua / status（隐私）；这些字段仅出现在 `/api/v1/admin/*` 响应中。
- 提交评论的 ip/ua 由服务端采集（ConnectInfo socket addr 优先、X-Forwarded-For 兜底），客户端 body 传的一律忽略。
- 迁移用 sea-query 跨库写法（`sea_orm_migration::schema::*` 辅助函数），不要写单库专有 SQL；新迁移文件命名 `mYYYYMMDD_NNNNNN_<描述>.rs` 并注册进 `migration/src/lib.rs`。
- 时间戳统一 `chrono::NaiveDateTime`（实体 `DateTime`，migration 用 `date_time(...)`），由 service 层显式赋值。序列化为 UTC 朴素时间（无时区后缀）；**前端（SDK / 管理面板）解析时必须按 UTC 处理**（现有 `parseServerTime` 助手），否则非 UTC 时区显示偏差。
- 表名用复数（`users` / `comments`），避免与数据库保留字冲突。
- 密码只存 argon2 哈希；任何响应不得包含 `password_hash` 字段。
- `static/sdk/rustaline.js` 保持**零依赖单文件**：原生 JS IIFE，不引框架 / CDN / npm / 字体；仅使用内置 Material 3 CSS 令牌。
- 官网与管理面板使用**本地 vendor 的 mdui**（见下方「mdui vendor 管理」），不引 CDN、不引入 npm 运行时；面板仍为原生 ES Modules，无构建步骤。
- 所有用户内容一律 `textContent` / `createTextNode` 渲染防 XSS，禁止 innerHTML 拼接用户数据；静态 SVG 常量可例外，但必须固定写死在本文件内。
- 依赖版本统一改根 `Cargo.toml` 的 `[workspace.dependencies]`，成员 crate 用 `xxx.workspace = true` 引用。
- 完成改动后必须跑通：`cargo build`、`cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check`。
