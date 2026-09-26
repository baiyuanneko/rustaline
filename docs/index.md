---
layout: home

hero:
  name: rustaline
  text: 类似 Valine 的开源评论服务
  tagline: Rustaline 是一个基于 Rust 语言，使用 axum 框架与 Sea-ORM 开发的简单评论服务。支持楼中楼与 Gravatar。支持从 Valine 迁移数据。
  actions:
    - theme: brand
      text: 查看接入文档
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/baiyuanneko/rustaline
---

## 快速开始

```html [your-post.html]
<!-- ① 引入 SDK（同源部署，或填完整 URL 跨域调用） -->
<script src="/sdk/rustaline.js"></script>

<!-- ② 挂载点 + 初始化 -->
<div id="comments"></div>
<script>
  new Rustaline({
    el: '#comments',                     // 挂载点（CSS 选择器或 DOM 元素）
    server: '',                         // 留空 = 同源；可填 https://api.example.com
    url: location.pathname,             // 文章标识，默认当前路径
    lang: 'auto',                       // 语言：'auto'（跟随浏览器）| 'zh-CN' | 'en'，或自定义字典
    placeholder: '说点什么吧…',
    gravatarCdn: 'https://gravatar.loli.net/avatar/',  // 头像 CDN（gravatar 协议镜像）
    colorPattern: '#2196f3',            // 主题种子色，派生整套配色
    darkMode: 'auto'                    // 明暗：'auto'（跟随系统）| 'light' | 'dark'
  });
</script>
```

<div class="rs-home-footer">
  <div class="rs-home-footer__row">
    <span>Made with ♥️ by <a href="https://byn.moe/" target="_blank" rel="noopener noreferrer">baiyuanneko</a>，BSD 3-Clause "New" or "Revised" License Licensed.</span>
  </div>
  <div class="rs-home-footer__thanks">
    Special thanks to <a href="https://ouyangqiqi.cn/" target="_blank" rel="noopener noreferrer">欧阳淇淇</a>, <a href="https://github.com/HyacinthHaru" target="_blank" rel="noopener noreferrer">HyacinthHaru</a> and more for help to the development of Rustaline!
  </div>
</div>
