# bynrust26

Rust Web 项目脚手架：axum 0.8 + sea-orm 2.0（默认 SQLite，可切换 PostgreSQL / MySQL）+ JWT 认证（Redis 黑名单）+ utoipa OpenAPI。

## 技术栈

- Web：axum 0.8、tower-http（trace / cors / fs）
- ORM：sea-orm 2 + sea-orm-migration（独立 `migration` crate）
- 认证：jsonwebtoken 签发 access token（jti = uuid），logout 后 jti 写入 Redis 黑名单
- 配置：`config` crate 分层加载（`config/default.toml` < `config/local.toml` < `APP_*` 环境变量），dotenvy 加载 `.env`
- 文档：utoipa 5 + utoipa-swagger-ui，Swagger UI 在 `/swagger-ui/`
- 静态文件：`ServeDir` 挂载 `static/` 于 `/static`，含原生 HTML/JS 示例页

## 快速开始

方式一：全 Docker（推荐，无需手动 cargo run，内置热重载）

```bash
docker compose -f docker-compose.dev.yml up -d          # 起 app + redis（首次需构建镜像+编译，较慢）
docker compose -f docker-compose.dev.yml logs -f app    # 看应用日志
# app 容器内运行 cargo-watch：保存代码即自动增量重编译并重启应用，无需任何手动操作
```

方式二：本地运行

```bash
cp .env.example .env          # 按需修改密钥等
docker compose -f docker-compose.dev.yml up -d redis    # 只起 redis（blacklist_enabled=true 时必需）
cargo run -p app              # 启动，监听 0.0.0.0:8080（注意与方式一端口二选一）
```

启动流程：加载配置 → 初始化 tracing → 连数据库 → 自动跑迁移（`Migrator::up`）→ 连 Redis → serve（支持 Ctrl+C / SIGTERM 优雅退出）。

- Swagger UI: http://localhost:8080/swagger-ui/
- OpenAPI JSON: http://localhost:8080/api-doc/openapi.json
- 静态示例页: http://localhost:8080/static/
- 健康检查: `curl http://localhost:8080/health`

示例调用：

```bash
# 注册 -> 登录 -> 带 token 访问
curl -X POST localhost:8080/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"username":"alice","password":"secret123"}'
TOKEN=$(curl -s -X POST localhost:8080/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"username":"alice","password":"secret123"}' | jq -r .access_token)
curl localhost:8080/api/v1/users -H "Authorization: Bearer $TOKEN"
curl -X POST localhost:8080/api/v1/auth/logout -H "Authorization: Bearer $TOKEN"  # 登出后该 token 立即失效
```

## 切换数据库

默认 SQLite（feature `sqlite`）。切换为 PostgreSQL / MySQL：

```bash
cargo build -p app --no-default-features --features postgres   # 或 mysql
```

同时把连接串指过去（任选其一）：

```bash
# .env 或环境变量
APP_DATABASE_URL=postgres://user:pass@localhost:5432/bynrust26
# 或嵌套写法
APP_DATABASE__URL=mysql://user:pass@localhost:3306/bynrust26
```

migration 代码用的是 sea-query 跨库写法，无需改动；实体/migration 在三种数据库下通用。

## sea-orm-cli 用法

```bash
cargo install sea-orm-cli

# 手动执行迁移（应用启动时已自动 up，这里用于 down/fresh/status 等）
DATABASE_URL="sqlite://./data/bynrust26.db?mode=rwc" sea-orm-cli migrate status
DATABASE_URL="sqlite://./data/bynrust26.db?mode=rwc" sea-orm-cli migrate down
# 或者走 workspace 内的 migration 二进制（读取 .env 的 DATABASE_URL）
cargo run -p migration -- status

# 数据库结构变化后重新生成实体（会覆盖 app/src/entities，注意备份手写改动）
sea-orm-cli generate entity -o app/src/entities --with-serde none
```

## 环境变量

优先级：`config/default.toml` < `config/local.toml`（gitignore）< 环境变量。环境变量支持嵌套写法（`__` 分隔层级）和下表的单层简写：

| 环境变量（简写） | 嵌套写法 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `APP_SERVER_HOST` | `APP_SERVER__HOST` | 监听地址 | `0.0.0.0` |
| `APP_SERVER_PORT` | `APP_SERVER__PORT` | 监听端口 | `8080` |
| `APP_DATABASE_URL` | `APP_DATABASE__URL` | 数据库连接串 | `sqlite://./data/bynrust26.db?mode=rwc` |
| `APP_REDIS_URL` | `APP_REDIS__URL` | Redis 连接串 | `redis://127.0.0.1:6379` |
| `APP_JWT_SECRET` | `APP_JWT__SECRET` | JWT 签名密钥（生产必改） | `change-me-in-production` |
| `APP_JWT_TTL_SECS` | `APP_JWT__TTL_SECS` | token 有效期（秒） | `86400`（24h） |
| `APP_JWT_BLACKLIST_ENABLED` | `APP_JWT__BLACKLIST_ENABLED` | 是否启用 logout 黑名单；启用时 Redis 不可达则启动失败 | `true` |
| `APP_LOG_LEVEL` | `APP_LOG__LEVEL` | 日志级别（env-filter 语法） | `info` |

## 测试

```bash
cargo test
```

集成测试（`app/tests/api.rs`）使用内存 SQLite + 完整 router（tower `oneshot`，不起端口）。黑名单用例会拉起本机 `redis-server` 临时实例，二进制不存在时自动跳过该用例。

## Docker

```bash
docker compose up --build     # app + redis，SQLite 数据在 sqlite-data 卷
```

换 PostgreSQL / MySQL：见 `docker-compose.yml` 顶部注释（`--build-arg CARGO_FEATURES="--no-default-features --features postgres"`）。

国内网络加速：crates.io 走项目 `.cargo/config.toml`（阿里云镜像，容器内外都生效）；Dockerfile 内 apt 已换阿里云源。注意 `utoipa-swagger-ui` 的 build script 会从 github.com 直连下载 Swagger UI zip（约 4MB），全新构建（无 target 缓存）时网络慢可能导致该步耗时较长。Docker Hub 拉镜像加速需要配置 daemon 镜像站（`/etc/docker/daemon.json` 的 `registry-mirrors`，改完 `sudo systemctl restart docker`），按需自行配置。

## 常用命令

```bash
cargo build                      # 构建
cargo test                       # 全部测试
cargo clippy --all-targets -- -D warnings   # lint
cargo fmt --check                # 格式检查
```
