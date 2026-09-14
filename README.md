# bynrust26

Rust Web 项目脚手架：axum 0.8 + sea-orm 2.0（默认 SQLite，可切换 PostgreSQL / MySQL）+ JWT 认证（Redis 黑名单）+ utoipa OpenAPI。

内置 **rustaline 评论系统**（Valine 自托管替代品）：匿名评论、楼中楼回复、LeanCloud 数据导入、Material 3 风格管理面板与零依赖评论 SDK。

## 技术栈

- Web：axum 0.8、tower-http（trace / cors / fs）
- ORM：sea-orm 2 + sea-orm-migration（独立 `migration` crate）
- 认证：jsonwebtoken 签发 access token（jti = uuid），logout 后 jti 写入 Redis 黑名单
- 配置：`config` crate 分层加载（`config/default.toml` < `config/local.toml` < `APP_*` 环境变量），dotenvy 加载 `.env`
- 文档：utoipa 5 + utoipa-swagger-ui，Swagger UI 在 `/swagger-ui/`
- 静态文件：`ServeDir` 兜底挂载 `static/` 于根路径（显式路由 `/api/**`、`/health`、`/swagger-ui` 优先），含评论 SDK、演示页与管理面板
- 前端视觉：官网与管理面板使用本地 vendor 的 [mdui](https://www.mdui.org) 2.1.5（Material 3 / Material You Web Components）；评论 SDK 保持零依赖单文件，仅按 Material 3 风格实现
- 评论反垃圾：单 IP 内存滑动窗口限流 + 蜜罐字段 + 可选先审后发（moderation）

## 快速开始

方式一：全 Docker（推荐，无需手动 cargo run，内置热重载）

```bash
docker compose -f docker-compose.dev.yml up -d          # 起 app + redis（首次需构建镜像+编译，较慢）
docker compose -f docker-compose.dev.yml logs -f app    # 看应用日志
# app 容器内运行 cargo-watch：保存代码即自动增量重编译并重启应用，无需任何手动操作
# 容器以与宿主机同 UID/GID 的非 root 用户运行（默认 1000，可用 DEV_UID/DEV_GID 环境变量覆盖），
# 写出的文件（./data、编译缓存卷）归属宿主机当前用户
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
- 评论演示页: http://localhost:8080/（设 `APP_ENABLE_INTRODUCTION_INDEX=false` 可关闭，此后访问 / 返回 307 跳转 /admin/，管理面板「演示页」入口会提示已禁用）
- 管理面板: http://localhost:8080/admin/（首次启动时由 `APP_INITIAL_ADMIN_USERNAME` / `APP_INITIAL_ADMIN_PASSWORD` 种入数据库，之后可在设置页改密码）
- 脚手架示例页: http://localhost:8080/scaffold-demo.html
- 健康检查: `curl http://localhost:8080/health`

## rustaline 评论系统（Valine 替代品）

自托管匿名评论服务，数据模型兼容 Valine/LeanCloud（objectId/QQAvatar/pid/rid/insertedAt 等字段全保留），可无损导入历史评论。

### 博客接入（评论 SDK）

任意静态页面引入 SDK + 两行初始化即可：

```html
<script src="https://你的域名/sdk/rustaline.js"></script>
<div id="comments"></div>
<script>
  new Rustaline({
    el: '#comments',
    server: 'https://你的域名',   // 同源部署可留空 ''
    url: location.pathname,       // 文章标识，默认当前路径
    lang: 'auto',                 // 界面语言：'auto'（默认，按访客浏览器探测）| 'zh-CN' | 'en'
    colorPattern: '#2196f3',      // 主题种子色（默认淡蓝），由它派生整套 Material 3 配色
    darkMode: 'auto',             // 'auto'（默认，跟随访客系统）| 'light' | 'dark'
  });
</script>
```

界面文案也支持自定义覆盖（可借此扩展其他语言）：`lang: { submit: '发表评论', empty: '还没有评论' }` 会浅合并到内置字典上，只需给出要改的键；内置字典完整键列表见浏览器控制台 `Rustaline.langs`。

SDK 零依赖单文件：楼中楼分页渲染（root 倒序分页 + 每楼回复预览 + 按需展开）、回复表单、头像推导（QQ 头像 > gravatar > 默认 SVG）、蜜罐反垃圾；评论正文支持 Markdown 子集（`[链接]`、`![图片]`（渲染为带图标的链接，点击弹模态框看图）、`**粗体**`、`*斜体*`、`` `代码` ``），自写极简渲染器全程 DOM 构建、URL 限 http(s)，无 XSS 面；配色由 `colorPattern` 种子色派生（默认淡蓝，多实例可各自不同），`darkMode` 控制明暗（默认跟随系统），CSS 变量（`--rs-*`）可进一步定制。

### 公共接口（匿名，无需登录）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/comments?url=<文章URL>&page=N&page_size=M` | 按楼分页：`{ count, root_total, page, page_size, roots }`；root（顶层评论）倒序分页（默认 10、上限 20/页），每楼带 `reply_count` 与最早 5 条 `replies` 预览；`count` 为该 url 可见评论总数（含全部回复） |
| GET | `/api/v1/comments/replies?url=<文章URL>&rid=<楼rootId>&offset=&limit=` | 楼内回复展开：`{ total, results }`，时间升序（limit 上限 50）；rid 须指向同 url 的顶层评论，否则 400 |
| POST | `/api/v1/comments` | 提交评论 `{ url, comment, nick?, mail?, link?, pid?, rid? }`；白名单之外字段（如 qq_avatar）一律忽略，rid 由服务端按父评论推导（伪造或不一致 400）；ip/ua 服务端采集（UA 截断 512 字符），字段长度对齐列宽，限流 429 |

### 管理接口（需管理员 JWT）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/comments` | 分页列表（status/url/keyword/from 过滤，from 为 UTC 起始日期 YYYY-MM-DD），含 ip/mail/ua |
| PATCH | `/api/v1/admin/comments/{id}` | 审核：`{ status: "approved"\|"pending"\|"spam" }` |
| DELETE | `/api/v1/admin/comments/{id}` | 删除（子评论自动降级为根评论） |
| POST | `/api/v1/admin/comments/import/valine` | 导入 LeanCloud 导出 JSON（单批 ≤1000 条，按 objectId 幂等） |
| GET | `/api/v1/admin/comments/stats` | 统计（按状态计数、今日新增、url 排行前 30） |
| GET | `/api/v1/admin/config` | 当前生效的 comment 配置（只读） |
| POST | `/api/v1/admin/account/password` | 修改管理员密码 `{ current_password, new_password }`（新密码 ≥8 字符；成功后全部 token 失效需重新登录） |

### 管理面板

`/admin/` 原生 ES Modules 单页应用，使用本地 vendor 的 mdui 2.1.5 Web Components：登录、Dashboard 统计、评论管理（过滤/分页/审核/删除）、Valine 导入（文件/粘贴 → 浏览器端分批上传，真实进度条 + 汇总报告，支持十万级数据）、配置查看、修改密码。

管理面板与演示首页均为中英双语界面：默认按浏览器语言判定（`zh*` → 中文，其余 → English），演示页右上角「中文 / English」按钮与管理面板「外观」对话框里的语言选项可手动切换，偏好持久化于 localStorage `rustaline-lang`（SDK 在演示页上也会跟随该偏好）。新增其他语言只需在各端字典文件里补一个同构字典对象。

### 导入 Valine 历史数据

LeanCloud 控制台导出 Comment 表 JSON 后，在管理面板「导入」页选择文件即可；兼容 `{"results":[...]}` 与顶层数组两种格式、`{"__type":"Date","iso":...}` 与裸 ISO 两种日期形态。已存在的 objectId 自动跳过，可安全重复导入。

### 评论配置（`[comment]` 段）

| 环境变量（简写） | 嵌套写法 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `APP_COMMENT_MODERATION` | `APP_COMMENT__MODERATION` | true 时新评论需审核后才公开 | `false` |
| `APP_COMMENT_MAX_LENGTH` | `APP_COMMENT__MAX_LENGTH` | 评论内容最大长度 | `10000` |
| `APP_COMMENT_RATE_LIMIT_PER_MINUTE` | `APP_COMMENT__RATE_LIMIT_PER_MINUTE` | 单 IP 每分钟最多提交数 | `5` |
| `APP_COMMENT_DEFAULT_NICK` | `APP_COMMENT__DEFAULT_NICK` | 未填昵称时的默认昵称 | `Anonymous` |
| `APP_AVATAR_CDN` | `APP_COMMENT__AVATAR_CDN` | 邮箱头像 CDN（gravatar 协议镜像）；置空 = 禁用邮箱头像层 | `https://gravatar.loli.net/avatar/` |

注意：时间字段为 UTC 朴素时间（无时区后缀），前端展示时已按 UTC 解析转本地；跨域部署 SDK 时保持默认放开 CORS 或按需收紧（`routes/mod.rs` 的 CorsLayer）。

示例调用：

```bash
# 登录（首次启动时由 APP_INITIAL_ADMIN_USERNAME / APP_INITIAL_ADMIN_PASSWORD 种入）-> 带 token 访问 -> 登出
TOKEN=$(curl -s -X POST localhost:8080/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"please-change-me"}' | jq -r .access_token)
curl localhost:8080/api/v1/admin/config -H "Authorization: Bearer $TOKEN"
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
| `APP_JWT_SECRET` | `APP_JWT__SECRET` | JWT 签名密钥；启动时校验强度（拒绝已知弱默认值，要求 ≥32 字节，不满足即启动失败）。用 `openssl rand -base64 48` 生成 | 无（占位值会被拒绝） |
| `APP_JWT_TTL_SECS` | `APP_JWT__TTL_SECS` | token 有效期（秒） | `86400`（24h） |
| `APP_JWT_BLACKLIST_ENABLED` | `APP_JWT__BLACKLIST_ENABLED` | 是否启用 logout 黑名单；启用时 Redis 不可达则启动失败 | `true` |
| `APP_INITIAL_ADMIN_USERNAME` | `APP_INITIAL_ADMIN__USERNAME` | 管理员初始用户名（唯一管理员用户）：仅首次启动、admins 表为空时作为种子入库；入库后忽略 | 无 |
| `APP_INITIAL_ADMIN_PASSWORD` | `APP_INITIAL_ADMIN__PASSWORD` | 管理员初始密码；改密码 = 管理面板「设置」页自助修改（改后全部 token 失效） | 无 |
| `APP_LOG_LEVEL` | `APP_LOG__LEVEL` | 日志级别（env-filter 语法） | `info` |

## 测试

```bash
cargo test
```

集成测试（`app/tests/api.rs`）使用内存 SQLite + 完整 router（tower `oneshot`，不起端口）。黑名单用例会拉起本机 `redis-server` 临时实例，二进制不存在时自动跳过该用例。

## Docker

```bash
# 需要注入 APP_JWT_SECRET（见 .env.example，缺失即拒绝启动）；
# 首次启动还需 APP_INITIAL_ADMIN_PASSWORD 作为管理员种子（入库后可移除）
docker compose up --build     # app + redis，SQLite 数据在 sqlite-data 卷
```

换 PostgreSQL / MySQL：见 `docker-compose.yml` 顶部注释（`--build-arg CARGO_FEATURES="--no-default-features --features postgres"`）。

国内网络加速：crates.io 走项目 `.cargo/config.toml`（阿里云镜像，容器内外都生效）；Dockerfile 内 apt 已换阿里云源。注意 `utoipa-swagger-ui` 的 build script 会从 github.com 直连下载 Swagger UI zip（约 4MB），全新构建（无 target 缓存）时网络慢可能导致该步耗时较长或失败，届时可临时用 `SWAGGER_UI_DOWNLOAD_URL` 环境变量指定镜像地址。Docker Hub 拉镜像加速需要配置 daemon 镜像站（`/etc/docker/daemon.json` 的 `registry-mirrors`，改完 `sudo systemctl restart docker`），按需自行配置。

## 常用命令

```bash
cargo build                      # 构建
cargo test                       # 全部测试
cargo clippy --all-targets -- -D warnings   # lint
cargo fmt --check                # 格式检查
```
