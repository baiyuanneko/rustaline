
# rustaline - 类似 Valine 的开源评论服务

Rustaline 是一个基于 Rust 语言，使用 axum 框架与 Sea-ORM 开发的简单评论服务。支持楼中楼与 Gravatar。支持从 Valine 迁移数据。

## 通过 Docker Compose 部署后端与数据库

### 第一步：启动

```bash
# ① 准备环境变量：JWT 密钥必填（≥32 字节），首次启动的管理员账号种子
cp .env.example .env
#    .env 中设置：
#      APP_JWT_SECRET=$(openssl rand -base64 48)   # 缺失或过弱时应用拒绝启动
#      APP_INITIAL_ADMIN_USERNAME=admin
#      APP_INITIAL_ADMIN_PASSWORD=<初始密码>        # 仅首次入库时生效，之后走管理面板改密
#      APP_PORT=8080                               # 宿主机发布端口（默认 8080，仅绑 127.0.0.1）

# ② 构建并启动
docker compose up -d --build

# ③ 验证
curl http://localhost:8080/health        # APP_PORT 改了的话换对应端口
```

### 第二步：反向代理（caddy）

compose 把 app 发布到宿主机 `127.0.0.1:$APP_PORT`（在 `.env` 里设 `APP_PORT`，默认 8080），Caddyfile 指向同一端口即可（Caddy 自动设置 `X-Forwarded-For` 并签发 TLS）：

```caddy
comments.example.com {
	reverse_proxy 127.0.0.1:8080   # 端口与 APP_PORT 保持一致
}
```

## 调用前端 SDK 加载评论服务

后端部署后，任意静态页面引入 SDK + 两行初始化即可（`server` 填你的 rustaline 服务地址）：

```html
<!-- ① 引入 SDK -->
<script src="https://你部署的评论服务域名/sdk/rustaline.js"></script>

<!-- ② 挂载点 + 初始化 -->
<div id="comments"></div>
<script>
  new Rustaline({
    el: '#comments',
    server: 'https://你部署的评论服务域名',  // rustaline 服务地址
    url: location.pathname,    // 文章标识，默认当前路径
    lang: 'auto',              // 'auto'（跟随浏览器）| 'zh-CN' | 'en'
    colorPattern: '#2196f3',   // Material 3 种子色，派生整套配色
    darkMode: 'auto',          // 'auto'（跟随系统）| 'light' | 'dark'
  });
</script>
```

## 关于 AI 使用

本项目主要用 AI 完成，作者我（baiyuanneko）也不会 Rust 喵，不过咱还是有古法编程功底的：在 vibe coding 热潮之前（2025.6）就已经是 Java 软件开发工程师了，而且在 2025 年之前就手写和维护过很多 Java/TS/Python/React/Vue 项目，所以对于项目的安全性和可靠性还是有基本的保证的，并且对 Rust 的这些最佳实践也有学习。也欢迎任何用户如果发现问题及时在 Issues 中反馈喵！

以及本项目也由 [欧阳淇淇](https://ouyangqiqi.cn/) 与 [HyacinthHaru](https://github.com/HyacinthHaru) 帮忙用顶尖模型（GPT-6 Astra / Claude Fable 5.1 / Kimi K3 Max 等）扫描过安全性并做 Code Review，所以不用太担心本项目的安全问题（

## Authors

- [baiyuanneko](https://byn.moe/)

### Special thanks

- [欧阳淇淇](https://ouyangqiqi.cn/), [HyacinthHaru](https://github.com/HyacinthHaru) 提供 GPT-6 Astra、Claude Fable 5.1、Kimi K3 Max 等模型对本项目进行安全性扫描与 Code Review
- and more (see [full list](https://baiyuanneko.github.io/rustaline/thanks))



## License

BSD 3-Clause "New" or "Revised" License