# 快速开始

rustaline 是一个 Rust Web 项目（axum 0.8 + sea-orm 2.0，默认 SQLite，可切换 PostgreSQL / MySQL），内置自托管评论系统。

## Docker 运行（推荐）

```bash
docker compose -f docker-compose.dev.yml up -d
```

首次需要构建镜像并编译，较慢。容器内运行 cargo-watch，保存代码即自动重编译并重启。

## 本地运行

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d redis
cargo run -p app
```

启动后：

- 评论演示页：`http://localhost:8080/`
- 管理面板：`http://localhost:8080/admin/`
- Swagger UI：`http://localhost:8080/swagger-ui/`
- 健康检查：`curl http://localhost:8080/health`

## 界面组件示例

文档站集成了与演示页、管理面板同款的 mdui（Material 3 Web Components）：

<mdui-button variant="filled">Filled</mdui-button>
<mdui-button variant="tonal">Tonal</mdui-button>
<mdui-button variant="outlined">Outlined</mdui-button>
<mdui-button variant="text">Text</mdui-button>

::: tip 主题
组件配色由种子色 `#2196f3` 派生，明暗模式跟随页面右上角的切换。
:::
