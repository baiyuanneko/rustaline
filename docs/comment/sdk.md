# 博客接入（SDK）

任意静态页面引入 SDK + 两行初始化即可：

```html
<script src="https://你的域名/sdk/rustaline.js"></script>
<div id="comments"></div>
<script>
  new Rustaline({
    el: '#comments',
    server: 'https://你的域名',   // 同源部署可留空 ''
    url: location.pathname,       // 文章标识，默认当前路径
    lang: 'auto',                 // 界面语言：'auto'（默认）| 'zh-CN' | 'en'
    colorPattern: '#2196f3',      // 主题种子色（默认淡蓝），派生整套 Material 3 配色
    darkMode: 'auto',             // 'auto'（默认，跟随访客系统）| 'light' | 'dark'
  });
</script>
```

## 常用参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `el` | — | 挂载点选择器（必填） |
| `server` | `''` | 服务端地址，空字符串为同源 |
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
