import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'rustaline',
  description: 'Valine 自托管替代品 · Material 3 评论系统',
  base: '/rustaline/',

  vue: {
    template: {
      compilerOptions: {
        // mdui 为 Web Components（自定义元素），告知 Vue 不要按组件解析，
        // 否则 SSR 会把它们渲染成 <!----> 注释并导致 hydration 不匹配
        isCustomElement: (tag) => tag.startsWith('mdui-'),
      },
    },
  },

  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/quick-start' },
      { text: '评论接入', link: '/comment/sdk' },
      {
        text: 'GitHub',
        link: 'https://github.com/baiyuanneko/rustaline',
      },
    ],
    sidebar: [
      {
        text: '指南',
        items: [{ text: '快速开始', link: '/guide/quick-start' }],
      },
      {
        text: '评论系统',
        items: [{ text: '博客接入（SDK）', link: '/comment/sdk' }],
      },
    ],
    search: { provider: 'local' },
    outline: { label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '返回顶部',
  },
})
