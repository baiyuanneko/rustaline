# 快速上手

## 第一步：通过 Docker Compose 部署后端与数据库

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

### 可选：直接使用 GitHub Actions 镜像

Actions 自动测试、构建并发布 AMD64 / ARM64 镜像到 `ghcr.io/<仓库拥有者>/rustaline`；fork 的镜像使用 fork 拥有者的名字。分支标签为 `dev` / `main`，默认分支另提供 `latest`，每次构建另提供 `sha-<短提交号>`，`v*` 标签生成版本标签。

准备好 `.env` 后添加实际镜像地址，便可免本机编译启动：

```bash
# .env 中添加，替换为实际发布仓库
RUSTALINE_IMAGE=ghcr.io/hyb-oyqq/rustaline:dev
docker compose -f docker-compose.yml -f docker-compose.image.yml pull
docker compose -f docker-compose.yml -f docker-compose.image.yml up -d --no-build
```

公开 GHCR 包可匿名拉取，私有包需先 `docker login ghcr.io`。手动构建在 Actions 的 **Build and publish Docker image** 中点击 **Run workflow**，发布标签与构建信息见运行摘要。

## 第二步：反向代理（caddy）

compose 把 app 发布到宿主机 `127.0.0.1:$APP_PORT`（在 `.env` 里设 `APP_PORT`，默认 8080），Caddyfile 指向同一端口即可（Caddy 自动设置 `X-Forwarded-For` 并签发 TLS）：

```caddy
comments.example.com {
	reverse_proxy 127.0.0.1:8080   # 端口与 APP_PORT 保持一致
}
```

## 第三步：引入 SDK

在博客页面中引入 SDK + 两行初始化即可（`server` 填你的 rustaline 服务地址）：

```html
<!-- ① 引入 SDK -->
<script src="https://你部署的评论服务域名/sdk/rustaline.js"></script>

<!-- ② 挂载点 + 初始化 -->
<div id="comments"></div>
<script>
  new Rustaline({
    el: '#comments',
    server: 'https://你部署的评论服务域名',  // rustaline 服务地址
    url: location.pathname,                 // 文章标识，默认当前路径
    lang: 'auto',                           // 'auto'（跟随浏览器）| 'zh-CN' | 'en'
    colorPattern: '#2196f3',                // Material 3 种子色，派生整套配色
    darkMode: 'auto',                       // 'auto'（跟随系统）| 'light' | 'dark'
  });
</script>
```

## 常用参数

管理员在 `/admin/` 的「设置」页可以调整评论规则和验证码，配置 SMTP 新评论/回复邮件提醒，保存后即时生效；详见[后台设置与邮件提醒](./settings)。

旧版本升级会自动把当前有效的评论配置写入数据库，之后以后台保存的设置为准，原评论环境变量不再覆盖数据库设置。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `el` | — | 挂载点选择器（必填） |
| `server` | `''` | rustaline 服务地址 |
| `url` | `location.pathname` | 文章标识，同一篇文章的评论按它聚合 |
| `lang` | `'auto'` | 界面语言，也支持传入字典对象覆盖文案 |
| `colorPattern` | `'#2196f3'` | Material 3 种子色 |
| `darkMode` | `'auto'` | 明暗模式 |

## 特性

- 楼中楼分页渲染（顶层倒序分页 + 每楼回复预览 + 按需展开）
- 头像推导：QQ 头像 > gravatar > 默认 SVG
- 评论正文 Markdown 子集（链接、图片、粗斜体、删除线、行内代码），DOM 构建渲染，无 XSS 面
- 可选 PoW / 图形验证码反垃圾，由服务端开关控制

::: warning 时区
服务端时间序列化为 UTC 朴素时间，SDK 会按 UTC 解析显示，无需额外处理。
:::
