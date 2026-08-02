# AGENTS.md

## 项目结构

Cargo workspace，两个 crate：

```
bynrust26/
├── Cargo.toml            # workspace 根，[workspace.dependencies] 统一版本
├── config/default.toml   # 默认配置（local.toml 为本机覆盖，已 gitignore）
├── static/               # 静态文件目录，ServeDir 挂载于 /static（目录请求返回 index.html）
├── migration/            # sea-orm-migration 独立 crate（CLI + Migrator）
│   └── src/m*_*.rs       # 迁移文件，按时间戳命名并注册进 lib.rs 的 Migrator
└── app/                  # 应用 crate（bin 名 bynrust26，lib 名 app）
    ├── src/
    │   ├── main.rs       # 启动流程与优雅退出
    │   ├── lib.rs        # 模块声明（集成测试依赖 lib target）
    │   ├── config.rs     # 分层配置加载（default.toml < local.toml < APP_* env）
    │   ├── state.rs      # AppState（db / redis / config）
    │   ├── error.rs      # AppError -> 统一 JSON { code, message }
    │   ├── openapi.rs    # utoipa 聚合 + Swagger UI
    │   ├── routes/       # 路由装配
    │   ├── handlers/     # 薄层：解析请求 -> 调 service -> 响应；带 utoipa::path 注解
    │   ├── services/     # 领域逻辑（含 argon2 密码哈希）
    │   ├── dto/          # 请求/响应模型（derive utoipa ToSchema）
    │   ├── auth/         # jwt 签发/校验、Redis 黑名单、AuthUser extractor
    │   └── entities/     # sea-orm 实体（可由 sea-orm-cli 重新生成）
    └── tests/api.rs      # 端到端集成测试（内存 SQLite + 临时 redis-server）
```

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
- 除 register / login / health / swagger 外，接口一律加 `AuthUser` extractor 参数做认证。
- 需要登录的接口在 utoipa 注解里加 `security(("bearer_auth" = []))`。
- 迁移用 sea-query 跨库写法（`sea_orm_migration::schema::*` 辅助函数），不要写单库专有 SQL；新迁移文件命名 `mYYYYMMDD_NNNNNN_<描述>.rs` 并注册进 `migration/src/lib.rs`。
- 时间戳统一 `chrono::NaiveDateTime`（实体 `DateTime`，migration 用 `date_time(...)`），由 service 层显式赋值。
- 表名用复数（`users`），避免与数据库保留字冲突。
- 密码只存 argon2 哈希；任何响应不得包含 `password_hash` 字段。
- 依赖版本统一改根 `Cargo.toml` 的 `[workspace.dependencies]`，成员 crate 用 `xxx.workspace = true` 引用。
- 完成改动后必须跑通：`cargo build`、`cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check`。
