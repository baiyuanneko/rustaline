// 演示首页 i18n：运行期小字典 + data-i18n 填充 + 右上角语言切换。
// 与管理面板 admin/js/i18n.js 同源设计但独立成文件（本页无构建、无模块，纯 IIFE 全局）。
// 语言判定：localStorage rustaline-lang > navigator.language（zh* → zh-CN，其余 → en）。
// 新增语言 = 在 DICTS 里补一个同构字典对象，逻辑零改动。
(function () {
  'use strict';

  var STORAGE_KEY = 'rustaline-lang';
  var SUPPORTED = ['zh-CN', 'en'];

  var DICTS = {
    'zh-CN': {
      'meta.title': 'rustaline — Valine 自托管替代品',
      'meta.desc': 'rustaline 是一个无依赖、可自托管的评论系统，作为 Valine 的现代替代。一个 script + 两行代码即可拥有完整评论。',

      'nav.quickstart': '快速开始',
      'nav.demo': '在线演示',

      'hero.t1': '类似',
      'hero.t3': '的',
      'hero.t2': '开源评论服务',
      'hero.lede': 'Rustaline 是一个基于 Rust 语言，使用 axum 框架与 Sea-ORM 开发的简单评论服务。支持楼中楼与 Gravatar。支持从 Valine 迁移数据。',
      'hero.ctaDemo': '立即试试评论 ↓',
      'hero.ctaDocs': '查看接入文档',
      'hero.ctaAdmin': '进入管理员后台 →',

      'qs.title': '快速开始',
      'qs.code1': '<!-- ① 引入 SDK（同源部署，或填完整 URL 跨域调用）-->',
      'qs.code2': '<!-- ② 挂载点 + 初始化 -->',
      'qs.codeEl': '// 挂载点（CSS 选择器或 DOM 元素）',
      'qs.code3': '// 留空 = 同源；可填 https://api.example.com',
      'qs.code4': '// 文章标识，默认当前路径',
      'qs.codeLang': "// 语言：'auto'（跟随浏览器）| 'zh-CN' | 'en'，或自定义字典",
      'qs.codePlaceholder': "'说点什么吧…'",
      'qs.codeCdn': '// 头像 CDN（gravatar 协议镜像）',
      'qs.codeColor': '// 主题种子色，派生整套配色',
      'qs.codeDark': "// 明暗：'auto'（跟随系统）| 'light' | 'dark'",

      'demo.title': '在线演示',
      'demo.advanced': '自定义配置参数',
      'demo.advLang': '语言',
      'demo.advDark': '明暗',
      'demo.advColor': '主题色',
      'demo.advColorCustom': '自定义颜色',

      'footer.madeWith': 'Made with ♥️ by ',
      'footer.license': ', BSD 3-Clause "New" or "Revised" License Licensed.',
      'footer.api': 'API 文档',
      'footer.health': '健康检查',

      'lang.toggle': '切换语言',
    },

    en: {
      'meta.title': 'rustaline — a self-hosted Valine alternative',
      'meta.desc': 'rustaline is a dependency-free, self-hosted comment system — a modern alternative to Valine. One script tag plus two lines of code for a complete comment section.',

      'nav.quickstart': 'Quick start',
      'nav.demo': 'Live demo',

      'hero.t1': 'A ',
      'hero.t3': '-like ',
      'hero.t2': 'open-source comment service',
      'hero.lede': 'Rustaline is a simple comment service written in Rust with the axum framework and Sea-ORM. It supports nested replies and Gravatar, and you can migrate your data from Valine.',
      'hero.ctaDemo': 'Try the demo ↓',
      'hero.ctaDocs': 'Integration guide',
      'hero.ctaAdmin': 'Admin panel →',

      'qs.title': 'Quick start',
      'qs.code1': '<!-- ① Load the SDK (same-origin, or a full URL for cross-origin) -->',
      'qs.code2': '<!-- ② Mount point + init -->',
      'qs.codeEl': '// mount point (CSS selector or DOM element)',
      'qs.code3': '// empty = same-origin; or e.g. https://api.example.com',
      'qs.code4': '// post identifier, defaults to current path',
      'qs.codeLang': "// language: 'auto' (follow browser) | 'zh-CN' | 'en', or a custom dict",
      'qs.codePlaceholder': "'Say something…'",
      'qs.codeCdn': '// avatar CDN (gravatar-compatible mirror)',
      'qs.codeColor': '// theme seed color; derives the full palette',
      'qs.codeDark': "// dark mode: 'auto' (follow system) | 'light' | 'dark'",

      'demo.title': 'Live demo',
      'demo.advanced': 'Customize parameters',
      'demo.advLang': 'Language',
      'demo.advDark': 'Theme mode',
      'demo.advColor': 'Theme color',
      'demo.advColorCustom': 'Custom color',

      'footer.madeWith': 'Made with ♥️ by ',
      'footer.license': ', BSD 3-Clause "New" or "Revised" License Licensed.',
      'footer.api': 'API docs',
      'footer.health': 'Health check',

      'lang.toggle': 'Switch language',
    },
  };

  function getLang() {
    var saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
    if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    var nav = (navigator.language || '').toLowerCase();
    return nav.indexOf('zh') === 0 ? 'zh-CN' : 'en';
  }

  function setLang(code) {
    if (SUPPORTED.indexOf(code) === -1) return;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch (_) {
      /* ignore */
    }
  }

  /** 取文案（纯字符串字典）；回退链：当前语言 → zh-CN → key 本身（空字符串是合法值，不能用 || 判空） */
  function t(key) {
    var lang = getLang();
    var v = DICTS[lang] && DICTS[lang][key];
    if (v == null) v = DICTS['zh-CN'][key];
    return v != null ? v : key;
  }

  /** 填充静态 HTML：[data-i18n] → textContent；同步 html lang / title / meta description */
  function applyStaticTexts(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    document.documentElement.lang = getLang();
    document.title = t('meta.title');
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('meta.desc'));
  }

  /** 右上角语言切换：展示对方语言名，点击持久化并整页刷新（SDK 实例语言在构造时定型） */
  function initToggle() {
    var btn = document.getElementById('lang-toggle');
    if (!btn) return;
    btn.textContent = getLang() === 'zh-CN' ? 'English' : '中文';
    btn.setAttribute('aria-label', t('lang.toggle'));
    btn.addEventListener('click', function () {
      setLang(getLang() === 'zh-CN' ? 'en' : 'zh-CN');
      location.reload();
    });
  }

  window.rustalineIndexI18n = {
    getLang: getLang,
    setLang: setLang,
    t: t,
    applyStaticTexts: applyStaticTexts,
  };

  // 本脚本以非 defer 方式置于 body 末尾，此时上方 DOM 已解析完毕，可立即填充
  applyStaticTexts();
  initToggle();
})();
