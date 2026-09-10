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

      'nav.features': '特性',
      'nav.quickstart': '快速开始',
      'nav.demo': '在线演示',
      'nav.scaffold': '脚手架示例',

      'hero.eyebrow': 'Valine 自托管替代',
      'hero.t1': '给你的博客',
      'hero.t2': '装上 ',
      'hero.t3': '现代评论',
      'hero.t4': '。',
      'hero.lede': 'rustaline 是一个零依赖、可自托管的评论系统。一个 script 标签 + 两行初始化代码，即可为任意静态页面带来匿名评论、楼中楼回复、头像推导与垃圾评论防护。',
      'hero.ctaDemo': '立即试试评论 ↓',
      'hero.ctaDocs': '查看接入文档',

      'feat.1.t': '零依赖单文件',
      'feat.1.p': '原生 ES2018+，不依赖 jQuery / Vue / 任何 CDN，一个 rustaline.js 全部搞定。',
      'feat.2.t': '楼中楼回复',
      'feat.2.p': '沿用 Valine 经典 pid / rid 模型，回复嵌进父评论下并 @ 被回复者。',
      'feat.3.t': '内置反垃圾',
      'feat.3.p': '蜜罐字段、IP 限流、可选审核先审后发，多层防护对抗机器人。',
      'feat.4.t': '可定制主题',
      'feat.4.p': 'CSS 变量自由覆盖，深浅色自动跟随系统，移动端原生友好。',
      'feat.5.t': '隐私优先',
      'feat.5.p': '公共 API 永不返回 ip / mail / ua；头像由服务端推导，邮箱不落前端。',
      'feat.6.t': '自托管数据',
      'feat.6.p': '评论落在你自己的 SQLite / PostgreSQL / MySQL，告别 LeanCloud 配额焦虑。',

      'qs.title': '快速开始',
      'qs.desc': '把下面两段代码贴进你的 HTML，评论系统就上线了。',
      'qs.code1': '<!-- ① 引入 SDK（同源部署，或填完整 URL 跨域调用）-->',
      'qs.code2': '<!-- ② 挂载点 + 初始化 -->',
      'qs.code3': '// 留空 = 同源；可填 https://api.example.com',
      'qs.code4': '// 文章标识，默认当前路径',
      'qs.codePlaceholder': "'说点什么吧…'",
      'qs.morePre': '想看完整后端字段定义？参考 ',
      'qs.moreMid': ' 中的 ',
      'qs.morePost': ' 接口。',

      'demo.title': '在线演示',
      'demo.desc': '下面这个评论框就是真实运行的 rustaline 实例。试着发一条评论、点回复、再刷新页面看看。',
      'demo.descNote': '（需要后端服务已启动；若接口未就绪会显示加载失败与重试按钮。）',

      'footer.left': 'rustaline · Valine 自托管替代品 · 基于 axum + sea-orm',
      'footer.api': 'API 文档',
      'footer.scaffold': '脚手架示例',
      'footer.health': '健康检查',

      'lang.toggle': '切换语言',
    },

    en: {
      'meta.title': 'rustaline — a self-hosted Valine alternative',
      'meta.desc': 'rustaline is a dependency-free, self-hosted comment system — a modern alternative to Valine. One script tag plus two lines of code for a complete comment section.',

      'nav.features': 'Features',
      'nav.quickstart': 'Quick start',
      'nav.demo': 'Live demo',
      'nav.scaffold': 'Scaffold demo',

      'hero.eyebrow': 'Self-hosted Valine alternative',
      'hero.t1': 'Give your blog',
      'hero.t2': '',
      'hero.t3': 'modern comments',
      'hero.t4': '.',
      'hero.lede': 'rustaline is a zero-dependency, self-hosted comment system. One script tag and two lines of init code bring anonymous comments, nested replies, avatar resolution and spam protection to any static page.',
      'hero.ctaDemo': 'Try the demo ↓',
      'hero.ctaDocs': 'Integration guide',

      'feat.1.t': 'Zero-dependency single file',
      'feat.1.p': 'Plain ES2018+ — no jQuery, no Vue, no CDN. One rustaline.js does it all.',
      'feat.2.t': 'Nested replies',
      'feat.2.p': 'The classic Valine pid / rid model: replies nest under their parent and @-mention the original author.',
      'feat.3.t': 'Built-in anti-spam',
      'feat.3.p': 'Honeypot field, IP rate limiting and optional pre-moderation — layered defense against bots.',
      'feat.4.t': 'Customizable theme',
      'feat.4.p': 'Override freely with CSS variables; light/dark follows the system; mobile-friendly by default.',
      'feat.5.t': 'Privacy first',
      'feat.5.p': 'The public API never returns ip / mail / ua; avatars are resolved server-side so emails never reach the frontend.',
      'feat.6.t': 'Self-hosted data',
      'feat.6.p': 'Comments live in your own SQLite / PostgreSQL / MySQL — no more LeanCloud quota anxiety.',

      'qs.title': 'Quick start',
      'qs.desc': 'Paste the two snippets below into your HTML and your comment system is live.',
      'qs.code1': '<!-- ① Load the SDK (same-origin, or a full URL for cross-origin) -->',
      'qs.code2': '<!-- ② Mount point + init -->',
      'qs.code3': '// empty = same-origin; or e.g. https://api.example.com',
      'qs.code4': '// post identifier, defaults to current path',
      'qs.codePlaceholder': "'Say something…'",
      'qs.morePre': 'Want the full backend field reference? See ',
      'qs.moreMid': ' for the ',
      'qs.morePost': ' endpoint.',

      'demo.title': 'Live demo',
      'demo.desc': 'The comment box below is a real, running rustaline instance. Post a comment, hit reply, then refresh the page to see it persist.',
      'demo.descNote': '(Requires the backend to be running; if the API is not ready you will see a load-failed state with a retry button.)',

      'footer.left': 'rustaline · a self-hosted Valine alternative · built on axum + sea-orm',
      'footer.api': 'API docs',
      'footer.scaffold': 'Scaffold demo',
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
