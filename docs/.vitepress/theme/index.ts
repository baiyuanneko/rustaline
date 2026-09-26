import DefaultTheme from 'vitepress/theme'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp() {
    // mdui 依赖浏览器环境（自定义元素、matchMedia 等），仅客户端加载，规避 SSR 问题
    import('mdui')
      .then((mdui) => {
        // 服务端渲染（SSR）阶段也会走到这里，浏览器 API 不可用，直接跳过
        if (typeof document === 'undefined') return

        mdui.setColorScheme('#2196f3')

        // VitePress 通过切换 <html class="dark"> 控制明暗；mdui 组件用 setTheme 跟随。
        // setTheme 会写 <html> 的 class 属性，又会触发本 observer，因此必须记录上次
        // 值去重，否则会形成无限回调循环把页面卡死
        let applied: 'light' | 'dark' | '' = ''
        const applyTheme = () => {
          const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
          if (theme === applied) return
          applied = theme
          mdui.setTheme(theme)
        }
        applyTheme()
        new MutationObserver(applyTheme).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class'],
        })
      })
      .catch(() => {
        // mdui 加载失败不阻塞文档站，仅组件降级为未定义的普通标签
      })
  },
}
