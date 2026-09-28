import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'rustaline',
  description: '类似 Valine 的开源评论服务',
  base: '/rustaline/',

  head: [['link', { rel: 'icon', type: 'image/webp', href: '/icon.webp' }]],

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
    logo: '/icon.webp',

    nav: [
      { text: '快速上手', link: '/guide/quick-start' },
      { text: '人员感谢名单', link: '/thanks' },
      {
        text: 'GitHub',
        link: 'https://github.com/baiyuanneko/rustaline',
      },
    ],
    sidebar: [
      { text: '快速上手', link: '/guide/quick-start' },
      { text: '人员感谢名单', link: '/thanks' },
    ],
    search: { provider: 'local' },
    outline: { label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '返回顶部',
  },
})
