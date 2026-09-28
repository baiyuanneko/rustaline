---
layout: home

hero:
  name: rustaline
  text: 类似 Valine 的开源评论服务
  image:
    src: /icon.webp
    alt: rustaline logo
  tagline: Rustaline 是一个基于 Rust 语言，使用 axum 框架与 Sea-ORM 开发的简单评论服务。支持楼中楼与 Gravatar。支持从 Valine 迁移数据。
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/baiyuanneko/rustaline
---

## 快速开始

```html [your-post.html]
<!-- ① 引入 SDK -->
<script src="https://你部署的评论服务域名/sdk/rustaline.js"></script>

<!-- ② 挂载点 + 初始化 -->
<div id="comments"></div>
<script>
  new Rustaline({
    el: '#comments',                     // 挂载点（CSS 选择器或 DOM 元素）
    server: 'https://你部署的评论服务域名',          // rustaline 服务地址
    url: location.pathname,             // 文章标识，默认当前路径
    lang: 'auto',                       // 语言：'auto'（跟随浏览器）| 'zh-CN' | 'en'，或自定义字典
    placeholder: '说点什么吧…',
    gravatarCdn: 'https://gravatar.loli.net/avatar/',  // 头像 CDN（gravatar 协议镜像）
    colorPattern: '#2196f3',            // 主题种子色，派生整套配色
    darkMode: 'auto'                    // 明暗：'auto'（跟随系统）| 'light' | 'dark'
  });
</script>
```

## 关于 AI 使用

本项目主要用 AI 完成，作者我（baiyuanneko）也不会 Rust 喵，不过咱还是有古法编程功底的：在 vibe coding 热潮之前（2025.6）就已经是 Java 软件开发工程师了，而且在 2025 年之前就手写和维护过很多 Java/TS/Python/React/Vue 项目，所以对于项目的安全性和可靠性还是有基本的保证的，并且对 Rust 的这些最佳实践也有学习。也欢迎任何用户如果发现问题及时在 Issues 中反馈喵！

以及本项目也由 [欧阳淇淇](https://ouyangqiqi.cn/) 与 [HyacinthHaru](https://github.com/HyacinthHaru) 帮忙用顶尖模型（GPT-6 Astra / Claude Fable 5.1 / Kimi K3 Max 等）扫描过安全性并做 Code Review，所以不用太担心本项目的安全问题（

<div class="rs-home-footer">
  <div class="rs-home-footer__row">
    <span>Made with ♥️ by <a href="https://byn.moe/" target="_blank" rel="noopener noreferrer">baiyuanneko</a>，BSD 3-Clause "New" or "Revised" License Licensed.</span>
  </div>
  <div class="rs-home-footer__thanks">
    Special thanks to <a href="https://ouyangqiqi.cn/" target="_blank" rel="noopener noreferrer">欧阳淇淇</a>, <a href="https://github.com/HyacinthHaru" target="_blank" rel="noopener noreferrer">HyacinthHaru</a> and more (see <a href="https://baiyuanneko.github.io/rustaline/thanks" target="_blank" rel="noopener noreferrer">full list</a>) for help to the development of Rustaline!
  </div>
</div>
