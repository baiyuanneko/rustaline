/*!
 * rustaline.js — 无依赖、原生 ES2018+ 评论组件库（Valine 自托管替代品）
 *
 * 用法：
 *   <script src="/sdk/rustaline.js"></script>
 *   <script>new Rustaline({ el: '#comments' });</script>
 *
 * 支持同页面多实例：每个实例拥有独立的 el/server/url 配置与内部状态。
 *
 * 语言：lang: 'auto'（默认，按浏览器语言探测）| 'zh-CN' | 'en'；
 *       也可传自定义字典对象（如 { submit: '发表' }），浅合并覆盖内置文案。
 *       内置字典见 Rustaline.langs，扩展其他语言照其结构即可。
 *
 * 视觉：内置 Material 3 设计令牌，零依赖单文件，不加载任何 webfont。
 *       配色由 colorPattern 种子色派生（默认淡蓝 #2196f3，非法值回落默认）；
 *       darkMode: 'auto'（默认，跟随系统）| 'light' | 'dark'。
 *       例：new Rustaline({ colorPattern: '#e91e63', darkMode: 'dark' })
 *
 * 安全：所有用户输入一律以 textContent / createTextNode 渲染，绝不 innerHTML 拼接；
 *       link 字段严格校验仅允许 http(s):// 前缀，否则降级为纯文本展示。
 *
 * 接口契约（M-2 楼中楼分页）：
 *   GET  {server}/api/v1/comments?url=<encoded>&page=N
 *        → { count, root_total, page, page_size, roots: [Thread] }
 *        count = 该 url 可见评论总数（含回复）；roots 按时间倒序分页
 *   GET  {server}/api/v1/comments/replies?url=&rid=<rootId>&offset=&limit=
 *        → { total, results: [Comment] }（楼内回复，时间升序）
 *   POST {server}/api/v1/comments → Comment（创建后的）
 *   Thread = Comment 平铺字段 + { reply_count, replies: [Comment 预览，升序 ≤5 条] }
 *   Comment 字段：{ id, comment, nick, link, avatar, url, pid, rid, inserted_at,
 *                  ua_summary }
 *   ua_summary 为服务端解析的评论者环境摘要（如 "Chrome 126 · Windows"），
 *   仅当后端 comment.display_commenter_user_agent = true 时下发，否则为 null（不渲染）
 *
 * 全局只挂 window.Rustaline，不污染其他名字空间。
 */
(function (global, factory) {
  'use strict';

  if (global.Rustaline) return; // 防重复加载

  // ===== 语言字典 ============================================================
  // 内置 zh-CN / en。值可以是字符串（%d 为数字占位）或函数 fn(n) => string（处理复数）。
  // 扩展其他语言：照此结构补一个字典，或实例化时经 lang 传自定义对象浅合并覆盖。

  var LANGS = {
    'zh-CN': {
      loading: '加载中…',
      empty: '这里还没有评论，来抢沙发吧',
      error: '评论加载失败',
      retry: '重试',
      submit: '发表评论',
      submitting: '发表中…',
      reply: '回复',
      cancelReply: '取消',
      replyTo: '回复 @',
      nick: '昵称',
      mail: '邮箱',
      link: '网址',
      nickPlaceholder: '昵称',
      nickRequired: '请填写昵称',
      mailPlaceholder: '邮箱（可选，不公开）',
      linkPlaceholder: '网址（可选）',
      commentPlaceholder: '说点什么吧',
      commentRequired: '请填写评论内容',
      commentTooLong: '评论内容过长（上限 10000 字）',
      mailInvalid: '邮箱格式不正确',
      linkInvalid: '网址必须以 http:// 或 https:// 开头',
      loadMore: '加载更多评论',
      viewAllReplies: '查看全部 %d 条回复',
      continueThread: '继续查看这段对话（%d 条）›',
      formHint: '支持基本 Markdown 格式；昵称邮箱将保存在浏览器本地。',
      mdImage: '图片',
      mdImageError: '图片加载失败：',
      close: '关闭',
      anonymous: '匿名',
      countLabel: '评论',
      errNetwork: '网络错误，请稍后再试',
      errRate: '操作太频繁，请稍后再试',
      errGeneric: '发表失败，请稍后再试',
      timeJustNow: '刚刚',
      timeMinutesAgo: function (n) { return n + ' 分钟前'; },
      timeHoursAgo: function (n) { return n + ' 小时前'; },
      timeDaysAgo: function (n) { return n + ' 天前'; }
    },
    'en': {
      loading: 'Loading…',
      empty: 'No comments yet. Be the first!',
      error: 'Failed to load comments',
      retry: 'Retry',
      submit: 'Post Comment',
      submitting: 'Posting…',
      reply: 'Reply',
      cancelReply: 'Cancel',
      replyTo: 'Reply to @',
      nick: 'Nickname',
      mail: 'Email',
      link: 'Website',
      nickPlaceholder: 'Nickname',
      nickRequired: 'Please enter your nickname',
      mailPlaceholder: 'Email (optional, not public)',
      linkPlaceholder: 'Website (optional)',
      commentPlaceholder: 'Say something',
      commentRequired: 'Please enter your comment',
      commentTooLong: 'Comment is too long (max 10000 characters)',
      mailInvalid: 'Invalid email address',
      linkInvalid: 'Website must start with http:// or https://',
      loadMore: 'Load more comments',
      viewAllReplies: function (n) { return n === 1 ? 'View 1 reply' : 'View all ' + n + ' replies'; },
      continueThread: function (n) { return n === 1 ? 'Continue this thread (1) ›' : 'Continue this thread (' + n + ') ›'; },
      formHint: 'Basic Markdown is supported; nickname and email are saved in your browser.',
      mdImage: 'image',
      mdImageError: 'Failed to load image:',
      close: 'Close',
      anonymous: 'Anonymous',
      countLabel: function (n) { return n === 1 ? 'Comment' : 'Comments'; },
      errNetwork: 'Network error, please try again later',
      errRate: 'Too many requests, please try again later',
      errGeneric: 'Failed to post, please try again later',
      timeJustNow: 'just now',
      timeMinutesAgo: function (n) { return n === 1 ? '1 minute ago' : n + ' minutes ago'; },
      timeHoursAgo: function (n) { return n === 1 ? '1 hour ago' : n + ' hours ago'; },
      timeDaysAgo: function (n) { return n === 1 ? '1 day ago' : n + ' days ago'; }
    }
  };

  /** 浏览器语言探测：zh* → zh-CN，其余 → en（仅 lang:'auto' 时使用） */
  function detectLangCode() {
    var nav = global.navigator && (global.navigator.language || global.navigator.userLanguage);
    return /^zh/i.test(String(nav || '')) ? 'zh-CN' : 'en';
  }

  /**
   * 解析 lang 选项为完整字典：
   * - 缺省 / 'auto'        → 按浏览器语言探测
   * - 'zh-CN' / 'zh' / 'en' 等 → 内置字典（不认识的代码回退 zh-CN）
   * - 自定义对象            → 浅合并到自动探测的内置字典上（支持只覆盖个别键）
   */
  function resolveLang(opt) {
    if (opt && typeof opt === 'object') {
      return Object.assign({}, LANGS[detectLangCode()], opt);
    }
    var code = opt || 'auto';
    if (code === 'auto') code = detectLangCode();
    if (typeof code === 'string' && /^zh/i.test(code)) code = 'zh-CN';
    if (typeof code === 'string' && /^en/i.test(code)) code = 'en';
    return LANGS[code] || LANGS['zh-CN'];
  }

  // ===== 默认配置 ============================================================

  var DEFAULTS = {
    el: '#rustaline',                                  // 挂载点（选择器或元素）
    server: '',                                        // 后端基地址，'' = 同源
    url: '',                                           // 文章标识，'' = location.pathname
    placeholder: '',                                   // 评论框占位文案，'' = 跟随语言字典 commentPlaceholder
    lang: 'auto',                                      // 'auto' | 'zh-CN' | 'en' | 自定义字典对象
    gravatarCdn: 'https://gravatar.loli.net/avatar/',  // 头像 CDN，可换 https://gravatar.com/avatar/
    colorPattern: '#2196f3',                           // 主题种子色（#rgb/#rrggbb），派生整套令牌；非法值回落默认蓝
    darkMode: 'auto'                                   // 'auto'（跟随系统）| 'light' | 'dark'
  };

  // ===== 主题：种子色派生（零依赖 HSL 近似 Material 3 色调映射） ================

  function clampNum(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /** '#rgb' / '#rrggbb'（可省略 #）→ {r,g,b}；非法返回 null */
  function parseHexColor(input) {
    var hex = String(input == null ? '' : input).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  /** {r,g,b} → {h:0-360, s:0-100, l:0-100} */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };
    var d = max - min;
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: s * 100, l: l * 100 };
  }

  /** {h,s,l} → '#rrggbb' */
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clampNum(s, 0, 100) / 100; l = clampNum(l, 0, 100) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    var to = function (v) {
      var n = Math.round((v + m) * 255);
      return (n < 16 ? '0' : '') + n.toString(16);
    };
    return '#' + to(rgb[0]) + to(rgb[1]) + to(rgb[2]);
  }

  /** {h,s,l} → 'r, g, b'（供 rgba() 阴影拼接） */
  function hslToRgbCsv(h, s, l) {
    var hex = hslToHex(h, s, l);
    var c = parseHexColor(hex);
    return c.r + ', ' + c.g + ', ' + c.b;
  }

  /**
   * 由种子色派生整套颜色令牌，返回 { light: {...}, dark: {...} }。
   * 彩色令牌保留种子色相/饱和度、按 M3 色调重排明度；
   * 中性令牌（surface/outline 系）取同一色相、压低饱和度做轻微着色；
   * error 三件套固定红色，不随种子变化。
   */
  function deriveTokens(seedHex) {
    var rgb = parseHexColor(seedHex);
    if (!rgb) return null;
    var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    var h = hsl.h;
    var s = clampNum(hsl.s, 30, 90);      // 彩色令牌饱和度：灰种子也能出可读彩色
    var ns = clampNum(hsl.s * 0.22, 6, 24); // 中性令牌饱和度：轻微色相着色
    var f = hslToHex;

    var light = {
      '--rs-primary': f(h, s, 42),
      '--rs-on-primary': '#ffffff',
      '--rs-primary-container': f(h, Math.min(s, 92), 90),
      '--rs-on-primary-container': f(h, s, 12),
      '--rs-surface': f(h, ns, 98),
      '--rs-surface-container-lowest': '#ffffff',
      '--rs-surface-container-low': f(h, ns, 96),
      '--rs-surface-container': f(h, ns, 93),
      '--rs-surface-container-high': f(h, ns, 90),
      '--rs-on-surface': f(h, ns, 12),
      '--rs-on-surface-variant': f(h, Math.min(ns + 10, 40), 36),
      '--rs-outline': f(h, Math.min(ns + 6, 30), 48),
      '--rs-outline-variant': f(h, ns, 85),
      '--rs-error': '#ba1a1a',
      '--rs-error-container': '#ffdad6',
      '--rs-on-error-container': '#410002',
      '--rs-elevation-1': '0 1px 2px rgba(' + hslToRgbCsv(h, ns, 12) + ', 0.08), 0 1px 3px 1px rgba(' + hslToRgbCsv(h, ns, 12) + ', 0.06)',
      '--rs-elevation-2': '0 2px 6px 2px rgba(' + hslToRgbCsv(h, ns, 12) + ', 0.10)'
    };
    var dark = {
      '--rs-primary': f(h, s, 80),
      '--rs-on-primary': f(h, s, 20),
      '--rs-primary-container': f(h, s, 30),
      '--rs-on-primary-container': f(h, Math.min(s, 92), 90),
      '--rs-surface': f(h, ns, 8),
      '--rs-surface-container-lowest': f(h, ns, 5),
      '--rs-surface-container-low': f(h, ns, 11),
      '--rs-surface-container': f(h, ns, 14),
      '--rs-surface-container-high': f(h, ns, 19),
      '--rs-on-surface': f(h, ns, 90),
      '--rs-on-surface-variant': f(h, Math.min(ns + 10, 40), 78),
      '--rs-outline': f(h, Math.min(ns + 6, 30), 62),
      '--rs-outline-variant': f(h, ns, 30),
      '--rs-error': '#ffb4ab',
      '--rs-error-container': '#93000a',
      '--rs-on-error-container': '#ffdad6',
      '--rs-elevation-1': '0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 3px 1px rgba(0, 0, 0, 0.30)',
      '--rs-elevation-2': '0 2px 6px 2px rgba(0, 0, 0, 0.45)'
    };
    return { light: light, dark: dark };
  }

  /** 令牌对象 → css 文本（'--rs-x: v;...'） */
  function tokensToCss(tokens) {
    var out = '';
    for (var k in tokens) {
      if (Object.prototype.hasOwnProperty.call(tokens, k)) out += k + ':' + tokens[k] + ';';
    }
    return out;
  }

  // ===== 注入样式（一次性，加 rs- 前缀防污染）================================

  var STYLE_TEXT = `
/* ===== Material 3 视觉令牌（SDK 内置，零依赖，不加载任何字体） ===== */
/* 默认令牌 = 种子色 #2196f3 经 deriveTokens 派生的淡蓝配色，作为无 JS 派生时的兜底； */
/* 实例构造时会按 colorPattern 重新派生并以更高优先级（.rs-root.rs-inst-N）覆盖       */
.rs-root, .rs-root * { box-sizing: border-box; }

.rs-root {
  --rs-primary: #0b76cb;
  --rs-on-primary: #ffffff;
  --rs-primary-container: #cfe8fc;
  --rs-on-primary-container: #03223a;
  --rs-surface: #f9fafb;
  --rs-surface-container-lowest: #ffffff;
  --rs-surface-container-low: #f3f5f7;
  --rs-surface-container: #eaeef1;
  --rs-surface-container-high: #e0e6eb;
  --rs-on-surface: #191f25;
  --rs-on-surface-variant: #405f77;
  --rs-outline: #5b7e9a;
  --rs-outline-variant: #d1dae0;
  --rs-error: #ba1a1a;
  --rs-error-container: #ffdad6;
  --rs-on-error-container: #410002;
  --rs-font: 'Maple Mono NF CN', 'Maple Mono', 'SF Mono', 'JetBrains Mono', 'Fira Code',
             Consolas, 'Liberation Mono', Menlo, 'Noto Sans Mono CJK SC', 'Noto Sans Mono', Courier, 'Noto Sans CJK SC', 'Source Han Sans CN',
             'Source Han Sans', '思源黑体 CN', '思源黑体', 'PingFang SC', '微软雅黑', 'Microsoft YaHei',
             sans-serif;
  --rs-font-mono: 'Maple Mono NF CN', 'Maple Mono', 'SF Mono', 'JetBrains Mono', 'Fira Code',
                  Consolas, 'Liberation Mono', Menlo, 'Noto Sans Mono CJK SC', 'Noto Sans Mono', Courier, 'Noto Sans CJK SC', 'Source Han Sans CN',
                  'Source Han Sans', '思源黑体 CN', '思源黑体', 'PingFang SC', '微软雅黑', 'Microsoft YaHei',
                  sans-serif;
  --rs-radius: 16px;
  --rs-radius-sm: 12px;
  --rs-radius-xs: 8px;
  --rs-gap: 14px;
  --rs-font-size: 14px;
  --rs-line-height: 1.7;
  --rs-avatar-size: 40px;
  --rs-elevation-1: 0 1px 2px rgba(25, 31, 37, 0.08), 0 1px 3px 1px rgba(25, 31, 37, 0.06);
  --rs-elevation-2: 0 2px 6px 2px rgba(25, 31, 37, 0.10);

  font-family: var(--rs-font);
  font-size: var(--rs-font-size);
  line-height: var(--rs-line-height);
  color: var(--rs-on-surface);
  background: var(--rs-surface-container-low);
  border: 1px solid var(--rs-outline-variant);
  border-radius: var(--rs-radius);
  box-shadow: var(--rs-elevation-1);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  margin: 24px auto;
  padding: 20px;
  max-width: 760px;
}

.rs-root * { font-family: inherit; }

.rs-count {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 13px;
  letter-spacing: 0.02em;
  color: var(--rs-on-surface-variant);
}
.rs-count__num {
  font-size: 18px;
  font-weight: 700;
  color: var(--rs-on-surface);
  font-variant-numeric: tabular-nums;
}
.rs-count__divider { flex: 1; height: 1px; background: var(--rs-outline-variant); }

/* ---- 表单 ---- */
.rs-form { margin-bottom: 24px; }
.rs-form__meta-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 10px;
}
.rs-form__reply-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--rs-primary-container);
  border-radius: var(--rs-radius-sm);
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--rs-on-primary-container);
}
.rs-form__reply-bar strong { color: var(--rs-on-primary-container); font-weight: 700; word-break: break-all; }
.rs-form__reply-cancel {
  margin-left: auto;
  background: transparent;
  border: 0;
  color: var(--rs-on-primary-container);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: var(--rs-radius-xs);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.rs-form__reply-cancel:hover { opacity: 0.75; }

.rs-input, .rs-textarea {
  width: 100%;
  font: inherit;
  color: var(--rs-on-surface);
  background: var(--rs-surface-container-lowest);
  border: 1px solid var(--rs-outline);
  border-radius: var(--rs-radius-xs);
  padding: 11px 14px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  outline: none;
}
.rs-input::placeholder, .rs-textarea::placeholder { color: var(--rs-on-surface-variant); opacity: 0.8; }
.rs-input:hover, .rs-textarea:hover { background: var(--rs-surface-container-low); }
.rs-input:focus, .rs-textarea:focus {
  border-color: var(--rs-primary);
  border-width: 2px;
  padding: 10px 13px;
  box-shadow: none;
  background: var(--rs-surface-container-lowest);
}
.rs-textarea {
  min-height: 120px;
  resize: vertical;
  line-height: var(--rs-line-height);
  padding: 12px 14px;
}

.rs-form__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.rs-form__hint {
  font-size: 12px;
  color: var(--rs-on-surface-variant);
  flex: 1;
  min-width: 0;
}
.rs-form__hint a { color: var(--rs-primary); text-decoration: none; }
.rs-form__hint a:hover { text-decoration: underline; }

.rs-btn {
  appearance: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  border-radius: 999px;
  height: 40px;
  padding: 0 22px;
  border: 1px solid transparent;
  transition: box-shadow 0.15s ease, background-color 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
}
.rs-btn--primary {
  background: var(--rs-primary);
  color: var(--rs-on-primary);
  box-shadow: var(--rs-elevation-1);
}
.rs-btn--primary:hover { box-shadow: var(--rs-elevation-2); }
.rs-btn--primary:active { box-shadow: none; }
.rs-btn--primary:disabled { opacity: 0.55; cursor: default; box-shadow: none; }
.rs-btn--ghost {
  background: transparent;
  color: var(--rs-primary);
  border-color: var(--rs-outline);
}
.rs-btn--ghost:hover { background: var(--rs-primary-container); border-color: transparent; }

.rs-form__error {
  margin-top: 10px;
  padding: 10px 14px;
  background: var(--rs-error-container);
  color: var(--rs-on-error-container);
  border-radius: var(--rs-radius-xs);
  font-size: 13px;
}

.rs-honeypot {
  position: absolute !important;
  left: -9999px !important;
  top: -9999px !important;
  width: 1px !important; height: 1px !important;
  opacity: 0 !important;
  pointer-events: none !important;
  tabindex: -1 !important;
  aria-hidden: true !important;
}

/* ---- 评论列表 ---- */
.rs-list { list-style: none; margin: 0; padding: 0; }
.rs-comment {
  position: relative;
  padding: 16px 0;
  border-bottom: 1px solid var(--rs-outline-variant);
}
.rs-list > .rs-comment:first-child { padding-top: 0; }
.rs-list > .rs-comment:last-child { border-bottom: 0; }
.rs-comment__main {
  display: grid;
  grid-template-columns: var(--rs-avatar-size) 1fr;
  gap: 12px;
}
.rs-avatar {
  width: var(--rs-avatar-size);
  height: var(--rs-avatar-size);
  border-radius: 999px;
  display: block;
  background: var(--rs-primary-container);
  color: var(--rs-on-primary-container);
  object-fit: cover;
  user-select: none;
  -webkit-user-drag: none;
}
.rs-comment__body { min-width: 0; }
.rs-comment__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-bottom: 4px;
}
.rs-author {
  font-weight: 700;
  font-size: 14px;
  color: var(--rs-on-surface);
  text-decoration: none;
  word-break: break-word;
}
.rs-author:hover { text-decoration: underline; text-underline-offset: 2px; }
.rs-author--op { color: var(--rs-primary); }
.rs-comment__time {
  font-size: 12px;
  color: var(--rs-on-surface-variant);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
/* 评论者环境徽章（ua_summary）：小号 pill，服务端未下发时不渲染 */
.rs-comment__ua {
  font-size: 11px;
  line-height: 1;
  color: var(--rs-on-surface-variant);
  background: var(--rs-surface-container);
  border-radius: 999px;
  padding: 4px 9px;
  white-space: nowrap;
  align-self: center;
}
.rs-comment__content {
  font-size: var(--rs-font-size);
  line-height: var(--rs-line-height);
  color: var(--rs-on-surface);
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: pre-wrap; /* 保留换行；textContent 天然防 XSS */
  margin: 2px 0 8px;
}
.rs-comment__content a { color: var(--rs-primary); text-decoration: none; }
.rs-comment__content a:hover { text-decoration: underline; }
.rs-comment__content code {
  background: var(--rs-surface-container-high);
  border-radius: 6px;
  padding: 1px 6px;
  font-family: var(--rs-font-mono);
  font-size: 0.92em;
  white-space: normal; /* code 段也允许随 pre-wrap 换行 */
}

/* ---- 图片查看模态框（SDK 无外部组件库，自绘 overlay） ---- */
.rs-image-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
  cursor: zoom-out;
  animation: rs-fade-in 0.15s ease;
  outline: none;
}
.rs-image-overlay__img {
  max-width: min(92vw, 1200px);
  max-height: 88vh;
  border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
  background: #fff;
  cursor: default;
}
.rs-image-overlay__error { color: #fff; font-size: 14px; word-break: break-all; }
.rs-image-overlay__error a { color: #9ed1fa; }
.rs-image-overlay__close {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s ease;
}
.rs-image-overlay__close:hover { background: rgba(255, 255, 255, 0.26); }
@keyframes rs-fade-in { from { opacity: 0; } to { opacity: 1; } }
.rs-comment__actions { display: flex; gap: 14px; align-items: center; }
.rs-reply-btn {
  background: transparent;
  border: 0;
  padding: 2px 8px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--rs-primary);
  cursor: pointer;
  border-radius: var(--rs-radius-xs);
  transition: background-color 0.15s ease;
}
.rs-reply-btn:hover { background: var(--rs-primary-container); }
.rs-comment__children {
  list-style: none;
  padding: 2px 0 0 calc(var(--rs-avatar-size) + 14px);
  margin: 0;
  position: relative;
}
.rs-comment__children::before {
  content: '';
  position: absolute;
  left: calc((var(--rs-avatar-size) + 14px) / 2);
  top: 0; bottom: 6px;
  width: 2px;
  background: var(--rs-outline-variant);
  border-radius: 1px;
}
.rs-comment__children > .rs-comment { padding: 14px 0; border-bottom: 0; }
.rs-comment__children > .rs-comment::before {
  content: '';
  position: absolute;
  left: calc(-1 * ((var(--rs-avatar-size) + 14px) / 2));
  top: calc(var(--rs-avatar-size) / 2);
  width: calc((var(--rs-avatar-size) + 14px) / 2 - 10px);
  height: 2px;
  background: var(--rs-outline-variant);
}
.rs-reply-snip { color: var(--rs-on-surface-variant); font-weight: 500; font-size: 13px; }
.rs-reply-snip strong { color: var(--rs-on-surface); font-weight: 700; }

/* ---- 楼中楼：楼尾展开 / 深度占位 / 加载更多（M-2） ---- */
.rs-load-more { text-align: center; padding: 14px 0 4px; }
.rs-thread__more-wrap, .rs-subtree-toggle-wrap {
  margin: 2px 0 10px calc(var(--rs-avatar-size) + 14px);
}
.rs-thread__more, .rs-subtree-toggle {
  appearance: none;
  border: 0;
  background: none;
  padding: 4px 0;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--rs-primary);
}
.rs-thread__more:hover, .rs-subtree-toggle:hover { text-decoration: underline; }
.rs-thread__more:disabled { opacity: .55; cursor: default; text-decoration: none; }

/* ---- 状态 / 骨架 ---- */
.rs-status {
  padding: 32px 16px;
  text-align: center;
  color: var(--rs-on-surface-variant);
  background: var(--rs-surface-container);
  border-radius: var(--rs-radius-sm);
  font-size: 14px;
}
.rs-status__icon { display: block; margin: 0 auto 10px; width: 32px; height: 32px; opacity: 0.6; }
.rs-status--error { background: var(--rs-error-container); color: var(--rs-on-error-container); }
.rs-skeleton-list { list-style: none; margin: 0; padding: 0; }
.rs-skeleton {
  display: grid;
  grid-template-columns: var(--rs-avatar-size) 1fr;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--rs-outline-variant);
}
.rs-skeleton:first-child { padding-top: 0; }
.rs-skeleton:last-child { border-bottom: 0; }
.rs-skeleton__avatar {
  width: var(--rs-avatar-size);
  height: var(--rs-avatar-size);
  border-radius: 999px;
}
.rs-skeleton__avatar, .rs-skeleton__line {
  background: linear-gradient(90deg,
    var(--rs-surface-container-high) 25%,
    var(--rs-surface-container-low) 50%,
    var(--rs-surface-container-high) 75%);
  background-size: 200% 100%;
  animation: rs-shimmer 1.4s ease-in-out infinite;
  border-radius: var(--rs-radius-xs);
}
.rs-skeleton__line { height: 12px; margin: 6px 0; }
.rs-skeleton__line--short { width: 32%; }
.rs-skeleton__line--mid { width: 78%; }
@keyframes rs-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ---- 深色模式：由 darkMode 参数控制（auto 时 JS 按系统偏好切 rs-dark 类） ---- */
.rs-root.rs-dark {
  --rs-primary: #9ed1fa;
  --rs-on-primary: #053861;
  --rs-primary-container: #085491;
  --rs-on-primary-container: #cfe8fc;
  --rs-surface: #101518;
  --rs-surface-container-lowest: #0a0d0f;
  --rs-surface-container-low: #171d22;
  --rs-surface-container: #1d252b;
  --rs-surface-container-high: #27323a;
  --rs-on-surface: #e0e6eb;
  --rs-on-surface-variant: #b6c9d8;
  --rs-outline: #85a1b7;
  --rs-outline-variant: #3d4e5c;
  --rs-error: #ffb4ab;
  --rs-error-container: #93000a;
  --rs-on-error-container: #ffdad6;
  --rs-elevation-1: 0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 3px 1px rgba(0, 0, 0, 0.30);
  --rs-elevation-2: 0 2px 6px 2px rgba(0, 0, 0, 0.45);
}

/* ---- 移动端 ---- */
@media (max-width: 560px) {
  .rs-root { margin: 16px 0; padding: 16px; font-size: 13.5px; }
  .rs-form__meta-row { grid-template-columns: 1fr; }
  .rs-comment__children { padding-left: calc(var(--rs-avatar-size) + 6px); }
  .rs-comment__children::before { left: calc((var(--rs-avatar-size) + 6px) / 2); }
  .rs-comment__children > .rs-comment::before { left: calc(-1 * ((var(--rs-avatar-size) + 6px) / 2)); }
  .rs-thread__more-wrap, .rs-subtree-toggle-wrap { margin-left: calc(var(--rs-avatar-size) + 6px); }
}

`;

  var STYLE_ID = 'rs-style-injected';

  // 实例序号：为每个实例生成独立的主题样式类（rs-inst-N），保证多实例配色互不干扰
  var INSTANCE_SEQ = 0;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  // ===== 工具函数 ==========================================================

  /** 简易字符串 hash（djb2 变体），用于头像配色稳定取色 */
  function hashString(s) {
    s = String(s || '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  /** 转 XML 文本安全（用于 SVG data-uri 内文本节点） */
  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 取昵称首字符作为默认头像字符（支持中英文，emoji 取码点） */
  function initialOf(name) {
    var s = String(name || '').trim();
    if (!s) return '?';
    // 取第一个"字形簇"的码点；emoji 与 CJK 都能正确显示
    var codePoint = s.codePointAt(0);
    return codePoint > 0xFFFF ? String.fromCodePoint(codePoint) : s.charAt(0).toUpperCase();
  }

  /** 暖色调头像配色板（深色背景 + 白字，对比度足够） */
  var AVATAR_PALETTE = [
    '#b45309', '#9a3412', '#a16207', '#4d7c0f',
    '#0e7490', '#1d4ed8', '#6d28d9', '#be185d',
    '#b91c1c', '#0f766e', '#5b21b6', '#9f1239'
  ];

  /** 生成默认头像 SVG data-uri（圆形 + 首字符 + 稳定背景色） */
  function defaultAvatar(name) {
    var initial = initialOf(name);
    var bg = AVATAR_PALETTE[hashString(name || initial) % AVATAR_PALETTE.length];
    // SVG 内文本字体大小视字符宽度调整（双码点 emoji / 宽 CJK）
    var fontSize = /[\u4e00-\u9fff\u3000-\u30ff\uff00-\uffef]/.test(initial) ? 34 : 36;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" rx="40" ry="40" fill="' + bg + '"/>' +
      '<text x="50%" y="50%" dy=".35em" text-anchor="middle" ' +
      'font-family="\'Maple Mono NF CN\', \'Maple Mono\', \'SF Mono\', \'JetBrains Mono\', \'Fira Code\', Consolas, \'Liberation Mono\', Menlo, \'Noto Sans Mono CJK SC\', \'Noto Sans Mono\', Courier, \'Noto Sans CJK SC\', \'Source Han Sans CN\', \'Source Han Sans\', \'思源黑体 CN\', \'思源黑体\', \'PingFang SC\', \'微软雅黑\', \'Microsoft YaHei\', sans-serif" ' +
      'font-size="' + fontSize + '" font-weight="600" fill="#ffffff">' + escapeXml(initial) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /**
   * 解析服务端返回的 avatar 字段：
   * - 完整 http(s) URL → 原样使用
   * - 32 位 hex（gravatar 哈希）→ 拼 gravatarCdn
   * - 其他非空字符串 → 视为相对路径，拼 server 前缀
   * - null / 空 → 用昵称生成默认头像
   */
  function resolveAvatar(avatar, nick, server, gravatarCdn, anonName) {
    if (avatar && /^https?:\/\//i.test(avatar)) return avatar;
    if (avatar && /^[a-f0-9]{32}$/i.test(avatar)) {
      return (gravatarCdn || '') + avatar + '?d=identicon&s=80';
    }
    if (avatar && avatar.indexOf('/') === 0) {
      return (server || '') + avatar;
    }
    if (avatar && /^https?:/i.test(avatar) === false && avatar.indexOf('/') !== -1) {
      // 形如 "path/to/x" 的相对路径
      return (server || '') + '/' + avatar.replace(/^\/+/, '');
    }
    return defaultAvatar(nick || anonName || 'Anonymous');
  }

  /** 校验 link 字段：仅允许 http(s):// 前缀，防 javascript: 等协议 */
  function safeLinkUrl(link) {
    if (!link) return null;
    var s = String(link).trim();
    if (/^https?:\/\//i.test(s)) return s;
    return null;
  }

  /**
   * 极简 Markdown 子集渲染 → DocumentFragment（纯 DOM 构建，无 HTML 字符串解析）。
   * 支持：`code`、[链接](url)、![图片](url)（渲染为带图标的链接，点击弹模态框看图）、
   * **粗体**、*斜体*、~~删除线~~；URL 仅接受 http(s)（safeLinkUrl），非法 / 未闭合语法一律按原文纯文本。
   * bold 内部允许单层 * 以便嵌斜体/链接（递归深度 1）。
   * 注意：与 static/admin/js/markdown.js 保持同构同步。
   */
  var MD_RE_SOURCE =
    '`([^`]+)`' +                    // 1: 行内代码
    '|!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)' +  // 2,3: 图片（以链接形式渲染）
    '|\\[([^\\]]+)\\]\\(([^)\\s]+)\\)' +   // 4,5: 链接
    '|\\*\\*((?:[^*]|\\*(?!\\*))+)\\*\\*' + // 6: 粗体（内部允许单个 *）
    '|(?<!\\*)\\*(?!\\*)([^*]+?)(?<!\\*)\\*(?!\\*)' + // 7: 斜体（两侧不得再贴 *，防 **未闭合 误判）
    '|~~([^~]+)~~';                  // 8: 删除线

  // 图片链接前置图标（静态 SVG 常量，固定写死，不拼任何用户数据）
  var MD_IMAGE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'style="vertical-align:-0.15em;margin-right:3px" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/>' +
    '<path d="m21 15-3.5-3.5a1.5 1.5 0 0 0-2 0L6 21"/></svg>';

  // 图片查看框关闭按钮图标（同上，静态常量）
  var MD_CLOSE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6L6 18"/></svg>';

  function svgIcon(svgHtml) {
    var template = document.createElement('template');
    template.innerHTML = svgHtml;
    return template.content.firstChild;
  }

  function mdImageIcon() {
    return svgIcon(MD_IMAGE_ICON);
  }

  /**
   * 图片查看模态框：遮罩 + 居中 img，点遮罩 / Esc 关闭。
   * 安全：url 已过 safeLinkUrl（仅 http/https，javascript: 到不了这里）；
   * img 上下文不执行脚本（含 SVG）；no-referrer 防查看者信息泄露；
   * alt / 错误文案一律 textContent。
   */
  function showImageModal(url, label, errorText, closeLabel) {
    var overlay = document.createElement('div');
    overlay.className = 'rs-image-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', label || 'image');
    overlay.tabIndex = -1;

    function close() {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    }
    var onKey = function (e) { if (e.key === 'Escape') close(); };

    // 右上角关闭按钮（加载失败兜底时也要保留，故先建好后单独持有引用）
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'rs-image-overlay__close';
    closeBtn.setAttribute('aria-label', closeLabel || 'Close');
    closeBtn.appendChild(svgIcon(MD_CLOSE_ICON));
    closeBtn.addEventListener('click', close);

    var img = document.createElement('img');
    img.className = 'rs-image-overlay__img';
    img.src = url;
    img.alt = label || '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = function () {
      // 加载失败：换成错误文案 + 原始链接（仍允许用户自行新标签打开），关闭按钮保留
      var tip = document.createElement('div');
      tip.className = 'rs-image-overlay__error';
      tip.textContent = errorText || 'Failed to load image:';
      var a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener nofollow ugc';
      a.textContent = url;
      tip.appendChild(document.createTextNode(' '));
      tip.appendChild(a);
      overlay.replaceChildren(tip, closeBtn);
    };
    overlay.appendChild(img);
    overlay.appendChild(closeBtn);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close(); // 点图本身不关，点遮罩才关
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    overlay.focus();
  }

  /** 给图片链接挂点击查看器（函数参数天然按次绑定，规避 var 循环闭包共享） */
  function attachImageViewer(anchor, url, label, labels) {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      showImageModal(url, label, labels && labels.imageError, labels && labels.close);
    });
  }

  function renderMarkdown(text, labels, depth) {
    var frag = document.createDocumentFragment();
    var src = String(text == null ? '' : text);
    var imageLabel = (labels && labels.image) || 'image';
    // 每次调用用新正则实例：避免递归调用共享 lastIndex 互相踩位
    var re = new RegExp(MD_RE_SOURCE, 'g');
    var last = 0, m;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(src.slice(last, m.index)));
      if (m[1] !== undefined) {
        var code = document.createElement('code');
        code.textContent = m[1];
        frag.appendChild(code);
      } else if (m[2] !== undefined || m[4] !== undefined) {
        var isImg = m[2] !== undefined;
        var label = isImg ? (m[2] || imageLabel) : m[4];
        var safe = safeLinkUrl(isImg ? m[3] : m[5]);
        if (safe) {
          var a = document.createElement('a');
          a.href = safe;
          a.target = '_blank';
          a.rel = 'noopener nofollow ugc';
          if (isImg) {
            a.className = 'rs-md-image';
            a.appendChild(mdImageIcon());
            attachImageViewer(a, safe, label, labels);
          }
          a.appendChild(document.createTextNode(label));
          frag.appendChild(a);
        } else {
          frag.appendChild(document.createTextNode(m[0])); // 非法 URL：整段原文
        }
      } else if (m[6] !== undefined || m[7] !== undefined || m[8] !== undefined) {
        var tag = m[6] !== undefined ? 'strong' : m[7] !== undefined ? 'em' : 'del';
        var inner = m[6] !== undefined ? m[6] : m[7] !== undefined ? m[7] : m[8];
        var node = document.createElement(tag);
        if (!depth) node.appendChild(renderMarkdown(inner, labels, 1));
        else node.textContent = inner;
        frag.appendChild(node);
      }
      last = re.lastIndex;
    }
    if (last < src.length) frag.appendChild(document.createTextNode(src.slice(last)));
    return frag;
  }

  /** 简易邮箱校验（与服务端宽松对齐，最终以服务端为准） */
  function looksLikeMail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }

  /**
   * 相对时间（文案取自语言字典，支持单复数函数）：
   *   < 60s    timeJustNow
   *   < 60min  timeMinutesAgo
   *   < 24h    timeHoursAgo
   *   < 30d    timeDaysAgo
   *   >= 30d   YYYY-MM-DD
   * 未来时间或解析失败 → 原 ISO 截断展示
   */
  // 服务端返回 UTC 朴素时间（NaiveDateTime，无时区后缀），必须按 UTC 解析，
  // 否则 new Date() 会当作本地时间，导致东八区下新评论显示"8 小时前"
  function parseServerTime(iso) {
    if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(iso)) {
      return new Date(iso + 'Z');
    }
    return new Date(iso);
  }

  function langVal(lang, key, n) {
    var v = lang && lang[key];
    if (typeof v === 'function') return v(n);
    if (typeof v === 'string') return n != null ? v.replace('%d', n) : v;
    return '';
  }

  function formatRelativeTime(iso, lang) {
    if (!iso) return '';
    var t = parseServerTime(iso).getTime();
    if (isNaN(t)) return String(iso).slice(0, 16).replace('T', ' ');
    var diff = (Date.now() - t) / 1000;
    if (diff < 0) return String(iso).slice(0, 16).replace('T', ' '); // 未来时间，退化
    if (diff < 60) return langVal(lang, 'timeJustNow');
    if (diff < 3600) return langVal(lang, 'timeMinutesAgo', Math.floor(diff / 60));
    if (diff < 86400) return langVal(lang, 'timeHoursAgo', Math.floor(diff / 3600));
    if (diff < 2592000) return langVal(lang, 'timeDaysAgo', Math.floor(diff / 86400));
    var d = new Date(t);
    var Y = d.getFullYear();
    var M = String(d.getMonth() + 1).padStart(2, '0');
    var D = String(d.getDate()).padStart(2, '0');
    return Y + '-' + M + '-' + D;
  }

  /** 解析 el 参数为 DOM 元素 */
  function resolveEl(el) {
    if (!el) throw new Error('[rustaline] el is required');
    if (typeof el === 'string') {
      var found = document.querySelector(el);
      if (!found) throw new Error('[rustaline] element not found: ' + el);
      return found;
    }
    if (el.nodeType === 1) return el;
    throw new Error('[rustaline] invalid el');
  }

  /** 极简 DOM 构造助手：所有文本节点天然防 XSS */
  function h(tag, attrs) {
    var children = [];
    for (var i = 2; i < arguments.length; i++) children.push(arguments[i]);
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class' || k === 'className') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') {
          // 仅限 SDK 内部静态文案，绝不传入用户数据
          el.innerHTML = v;
        } else if (k.indexOf('on') === 0 && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'style' && typeof v === 'object') {
          for (var sk in v) el.style[sk] = v[sk];
        } else if (k === 'dataset' && typeof v === 'object') {
          for (var dk in v) el.dataset[dk] = v[dk];
        } else {
          el.setAttribute(k, v === true ? '' : v);
        }
      }
    }
    appendChildren(el, children);
    return el;
  }

  function appendChildren(parent, children) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) { appendChildren(parent, c); continue; }
      parent.appendChild(
        typeof c === 'string' || typeof c === 'number'
          ? document.createTextNode(String(c))
          : c
      );
    }
  }

  var ICON_RETRY = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
  var ICON_EMPTY = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  // ===== 主类 ===============================================================

  function Rustaline(opts) {
    this.opts = Object.assign({}, DEFAULTS, opts || {});
    if (!this.opts.url) this.opts.url = global.location ? global.location.pathname : '/';
    // 去掉末尾斜杠归一化（与服务端约定一致）
    if (this.opts.url.length > 1 && this.opts.url.slice(-1) === '/') {
      this.opts.url = this.opts.url.slice(0, -1);
    }
    this.opts.server = String(this.opts.server || '').replace(/\/+$/, '');

    // 语言：解析为完整字典（内置 zh-CN/en 或自定义覆盖），placeholder 缺省跟随字典
    this.lang = resolveLang(this.opts.lang);
    if (!this.opts.placeholder) this.opts.placeholder = langVal(this.lang, 'commentPlaceholder');

    this.el = resolveEl(this.opts.el);
    this.el.classList.add('rs-root');

    // 主题：按 colorPattern 派生令牌注入本实例专属样式（多实例互不干扰）；
    // 非法种子色返回 null，回落到全局样式表里的默认淡蓝令牌
    this._themeClass = 'rs-inst-' + (++INSTANCE_SEQ);
    this.el.classList.add(this._themeClass);
    this._styleEl = null;
    var tokens = deriveTokens(this.opts.colorPattern);
    if (tokens) {
      this._styleEl = document.createElement('style');
      this._styleEl.textContent =
        '.rs-root.' + this._themeClass + '{' + tokensToCss(tokens.light) + '}\n' +
        '.rs-root.' + this._themeClass + '.rs-dark{' + tokensToCss(tokens.dark) + '}';
      (document.head || document.documentElement).appendChild(this._styleEl);
    }

    // 明暗：auto 跟随系统并监听切换；light/dark 强制
    this._darkMql = null;
    this._onDarkChange = null;
    var self = this;
    var applyDark = function (isDark) { self.el.classList.toggle('rs-dark', !!isDark); };
    var mode = String(this.opts.darkMode || 'auto').toLowerCase();
    if (mode === 'dark') {
      applyDark(true);
    } else if (mode === 'light') {
      applyDark(false);
    } else if (global.matchMedia) {
      this._darkMql = global.matchMedia('(prefers-color-scheme: dark)');
      applyDark(this._darkMql.matches);
      this._onDarkChange = function (e) { applyDark(e.matches); };
      if (this._darkMql.addEventListener) this._darkMql.addEventListener('change', this._onDarkChange);
      else if (this._darkMql.addListener) this._darkMql.addListener(this._onDarkChange); // 旧浏览器兜底
    }

    // 内部状态
    this.state = {
      loading: true,
      error: null,
      threads: [],         // 楼列表：[{root, reply_count, replies:[预览或全量]}]
      count: 0,            // 该 url 可见评论总数（含回复，供「N 条评论」文案）
      rootTotal: 0,        // 楼总数（分页依据）
      page: 0,             // 已加载到的页码
      pageSize: 10,
      loadingMore: false,
      replyTo: null,       // 当前回复目标 comment 对象；null = 顶级
      submitting: false,
      expandedSubtrees: {}, // 深度占位条已就地展开的节点 id
      expandedThreads: {},  // 已拉取全量回复的楼 root id
      loadingReplies: {},   // 正在拉全量的楼 root id
      optimisticIds: new Set()  // 乐观插入过的评论 id（用于在后台刷新失败时识别）
    };

    // 表单草稿（在 reply 模式切换时保留输入）
    this.draft = { nick: '', mail: '', link: '', comment: '' };

    // 若 LocalStorage 可用，复用上次的昵称/邮箱/链接（很多博客 SDK 的标准做法）
    try {
      var saved = global.localStorage && JSON.parse(localStorage.getItem('rs_user') || 'null');
      if (saved) {
        this.draft.nick = saved.nick || '';
        this.draft.mail = saved.mail || '';
        this.draft.link = saved.link || '';
      }
    } catch (_) { /* ignore */ }

    injectStyles();
    this._render(); // 先渲染骨架，再异步拉取
    this._fetchComments();
  }

  // ---- 网络层 ----

  Rustaline.prototype._apiBase = function () {
    return this.opts.server + '/api/v1/comments';
  };

  /** 取当前语言文案：字符串支持 %d 数字占位，函数值 fn(n) 处理单复数 */
  Rustaline.prototype._t = function (key, n) {
    return langVal(this.lang, key, n);
  };

  Rustaline.prototype._fetchComments = function (page, append) {
    var self = this;
    page = page || 1;
    if (append) {
      if (this.state.loadingMore) return;
      this.state.loadingMore = true;
    } else {
      this.state.loading = true;
      this.state.error = null;
    }
    this._render();

    var url = this._apiBase() + '?url=' + encodeURIComponent(this.opts.url) + '&page=' + page;
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var fetched = data && Array.isArray(data.roots) ? data.roots.map(function (t) { return normalizeThread(t, self.lang); }) : [];
        if (append) {
          self.state.threads = self.state.threads.concat(fetched);
        } else {
          // 整体替换前保留已展开楼的本地全量回复（服务端只回预览）
          fetched.forEach(function (t) { preserveExpanded(self.state, t); });
          self.state.threads = fetched;
        }
        self.state.count = (data && typeof data.count === 'number') ? data.count : 0;
        self.state.rootTotal = (data && typeof data.root_total === 'number') ? data.root_total : 0;
        self.state.page = (data && typeof data.page === 'number') ? data.page : page;
        self.state.pageSize = (data && typeof data.page_size === 'number') ? data.page_size : 10;
        self.state.loading = false;
        self.state.loadingMore = false;
        self._render();
      })
      .catch(function (err) {
        self.state.loadingMore = false;
        if (append) {
          // 「加载更多」失败不打断已展示内容，仅恢复按钮态
          self._render();
          return;
        }
        self.state.loading = false;
        self.state.error = (err && err.message) || String(err);
        self._render();
      });
  };

  /** 加载下一页楼（append 模式） */
  Rustaline.prototype._loadMore = function () {
    this._fetchComments(this.state.page + 1, true);
  };

  /** 提交成功后的后台对齐：串行重拉已加载的 1..page 页并整体替换（静默失败） */
  Rustaline.prototype._refreshLoadedPages = function () {
    var self = this;
    var pages = Math.max(1, this.state.page);
    var collected = [];
    var lastData = null;
    var chain = Promise.resolve();
    for (var p = 1; p <= pages; p++) {
      (function (pnum) {
        chain = chain.then(function () {
          var url = self._apiBase() + '?url=' + encodeURIComponent(self.opts.url) + '&page=' + pnum;
          return fetch(url, { headers: { 'Accept': 'application/json' } })
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(function (data) {
              lastData = data;
              var threads = (data && Array.isArray(data.roots)) ? data.roots.map(function (t) { return normalizeThread(t, self.lang); }) : [];
              threads.forEach(function (t) { preserveExpanded(self.state, t); });
              collected = collected.concat(threads);
            });
        });
      })(p);
    }
    chain.then(function () {
      self.state.threads = collected;
      if (lastData) {
        if (typeof lastData.count === 'number') self.state.count = lastData.count;
        if (typeof lastData.root_total === 'number') self.state.rootTotal = lastData.root_total;
      }
      self._render();
    }).catch(function () { /* 静默失败：保留当前展示与乐观插入 */ });
  };

  /** 拉取某楼全量回复（分批，每批 ≤50；防御上限 20 批防脏数据死循环） */
  Rustaline.prototype._expandThread = function (rootId) {
    var self = this;
    if (this.state.loadingReplies[rootId]) return;
    this.state.loadingReplies[rootId] = true;
    this._render();

    var collected = [];
    var offset = 0;
    var total = Infinity;
    var batchesLeft = 20;

    function batch() {
      if (collected.length >= total || batchesLeft-- <= 0) return Promise.resolve();
      var url = self._apiBase() + '/replies?url=' + encodeURIComponent(self.opts.url) +
        '&rid=' + encodeURIComponent(rootId) + '&offset=' + offset + '&limit=50';
      return fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(function (data) {
          total = (data && typeof data.total === 'number') ? data.total : 0;
          var list = data && Array.isArray(data.results) ? data.results.map(function (c) { return normalizeComment(c, self.lang); }) : [];
          collected = collected.concat(list);
          offset += list.length;
          if (list.length === 0) return; // 防空转
          return batch();
        });
    }

    batch().then(function () {
      // 现查（可能刚被 refresh 整体替换过 threads 数组）
      var thread = findThread(self.state.threads, rootId);
      if (thread) {
        thread.replies = collected;
        thread.reply_count = total === Infinity ? collected.length : total;
        self.state.expandedThreads[rootId] = true;
      }
    }).catch(function () { /* 静默失败：保留预览 */ })
      .then(function () {
        delete self.state.loadingReplies[rootId];
        self._render();
      });
  };

  function normalizeComment(c, lang) {
    return {
      id: String(c.id != null ? c.id : ''),
      comment: String(c.comment != null ? c.comment : ''),
      nick: String(c.nick != null && c.nick !== '' ? c.nick : langVal(lang, 'anonymous')),
      link: c.link != null ? String(c.link) : null,
      avatar: c.avatar != null ? String(c.avatar) : null,
      url: String(c.url != null ? c.url : ''),
      pid: c.pid != null && c.pid !== '' ? String(c.pid) : null,
      rid: c.rid != null && c.rid !== '' ? String(c.rid) : null,
      inserted_at: c.inserted_at != null ? String(c.inserted_at) : null,
      ua_summary: c.ua_summary != null && c.ua_summary !== '' ? String(c.ua_summary) : null
    };
  }

  /** 服务端 Thread：root 字段与 reply_count/replies 同级平铺 */
  function normalizeThread(t, lang) {
    return {
      root: normalizeComment(t, lang),
      reply_count: typeof t.reply_count === 'number' ? t.reply_count : 0,
      replies: Array.isArray(t.replies) ? t.replies.map(function (c) { return normalizeComment(c, lang); }) : []
    };
  }

  function findThread(threads, rootId) {
    for (var i = 0; i < threads.length; i++) {
      if (threads[i].root.id === rootId) return threads[i];
    }
    return null;
  }

  /** 刷新替换时，已拉全量的楼保留本地 replies（服务端只给 ≤5 条预览） */
  function preserveExpanded(state, thread) {
    if (!state.expandedThreads[thread.root.id]) return;
    var local = findThread(state.threads, thread.root.id);
    if (local && local.replies.length >= thread.replies.length) {
      thread.replies = local.replies;
      if (local.reply_count > thread.reply_count) thread.reply_count = local.reply_count;
    }
  }

  // ---- 渲染层 ----

  Rustaline.prototype._render = function () {
    var self = this;
    var root = this.el;
    root.innerHTML = ''; // 清空结构（仅清自身，不涉及用户数据）
    root.setAttribute('data-rs-state', this.state.loading ? 'loading'
      : this.state.error ? 'error' : 'ready');

    // 校验 replyTo 仍在已加载的楼中：刷新后若目标评论已不在（被删/被审/换页），丢弃以免表单消失
    if (this.state.replyTo) {
      var stillThere = false;
      for (var i = 0; i < this.state.threads.length && !stillThere; i++) {
        var t = this.state.threads[i];
        if (t.root.id === this.state.replyTo.id) { stillThere = true; break; }
        for (var j = 0; j < t.replies.length; j++) {
          if (t.replies[j].id === this.state.replyTo.id) { stillThere = true; break; }
        }
      }
      if (!stillThere) this.state.replyTo = null;
    }

    // 计数头
    root.appendChild(h('div', { class: 'rs-count' },
      h('span', { class: 'rs-count__num', text: String(this.state.count) }),
      h('span', { text: this._t('countLabel', this.state.count) }),
      h('span', { class: 'rs-count__divider' })
    ));

    // 表单（加载中或处于回复态时不在顶部渲染 —— 回复态下表单由评论节点内部挂载）
    if (!this.state.loading && !this.state.replyTo) {
      root.appendChild(this._buildForm());
    }

    // 列表 / 状态视图
    if (this.state.loading) {
      root.appendChild(this._buildSkeleton());
    } else if (this.state.error) {
      root.appendChild(this._buildError());
    } else {
      root.appendChild(this._buildList());
      // 底部「加载更多评论」：已加载楼数 < 楼总数时显示
      if (this.state.threads.length > 0 &&
          this.state.page * this.state.pageSize < this.state.rootTotal) {
        root.appendChild(this._buildLoadMore());
      }
    }
  };

  Rustaline.prototype._buildLoadMore = function () {
    var self = this;
    var lang = this.lang;
    return h('div', { class: 'rs-load-more' },
      h('button', {
        type: 'button', class: 'rs-btn rs-btn--ghost',
        text: this.state.loadingMore ? lang.loading : lang.loadMore,
        disabled: !!this.state.loadingMore,
        onclick: function () { self._loadMore(); }
      })
    );
  };

  Rustaline.prototype._buildForm = function () {
    var self = this;
    var lang = this.lang;
    var isInReply = !!this.state.replyTo;
    var form = h('form', {
      class: 'rs-form' + (isInReply ? ' rs-form--reply' : ''),
      autocomplete: 'off',
      onsubmit: function (e) {
        e.preventDefault();
        self._handleSubmit(form);
      }
    });

    // 回复上下文条
    if (isInReply) {
      var target = this.state.replyTo;
      form.appendChild(h('div', { class: 'rs-form__reply-bar' },
        h('span', { text: lang.replyTo }),
        h('strong', { text: target.nick }),
        h('button', {
          type: 'button',
          class: 'rs-form__reply-cancel',
          text: lang.cancelReply,
          onclick: function () {
            self.state.replyTo = null;
            self._render();
            // 焦点回到顶级评论框
            var ta = self.el.querySelector('.rs-textarea');
            if (ta) ta.focus();
          }
        })
      ));
    }

    // 三栏输入
    var metaRow = h('div', { class: 'rs-form__meta-row' });
    var nickInput = h('input', {
      type: 'text', class: 'rs-input', name: 'nick',
      placeholder: lang.nickPlaceholder, maxlength: 64,
      value: this.draft.nick, autocomplete: 'name',
      oninput: function (e) { self.draft.nick = e.target.value; }
    });
    var mailInput = h('input', {
      type: 'email', class: 'rs-input', name: 'mail',
      placeholder: lang.mailPlaceholder, maxlength: 128,
      value: this.draft.mail, autocomplete: 'email',
      oninput: function (e) { self.draft.mail = e.target.value; }
    });
    var linkInput = h('input', {
      type: 'url', class: 'rs-input', name: 'link',
      placeholder: lang.linkPlaceholder, maxlength: 255,
      value: this.draft.link, autocomplete: 'url',
      oninput: function (e) { self.draft.link = e.target.value; }
    });
    metaRow.appendChild(nickInput);
    metaRow.appendChild(mailInput);
    metaRow.appendChild(linkInput);
    form.appendChild(metaRow);

    // 评论文本域
    var textarea = h('textarea', {
      class: 'rs-textarea', name: 'comment',
      placeholder: this.opts.placeholder,
      maxlength: 10000, required: true,
      oninput: function (e) { self.draft.comment = e.target.value; }
    });
    textarea.value = this.draft.comment;
    form.appendChild(textarea);

    // 蜜罐 input（机器人会自动填 name=hp / url 等常见字段，正常用户看不到填不到）
    var hp = h('input', {
      type: 'text', class: 'rs-honeypot',
      name: 'hp', tabindex: '-1', 'aria-hidden': 'true',
      autocomplete: 'off'
    });
    form.appendChild(hp);

    // 操作行
    var hint = h('span', { class: 'rs-form__hint' }, this._t('formHint'));
    var submitBtn = h('button', {
      type: 'submit', class: 'rs-btn rs-btn--primary',
      text: this.state.submitting ? lang.submitting : lang.submit,
      disabled: !!this.state.submitting
    });
    form.appendChild(h('div', { class: 'rs-form__actions' }, hint, submitBtn));

    // 持有引用便于读值
    form._rs_refs = { nickInput: nickInput, mailInput: mailInput, linkInput: linkInput, textarea: textarea, hp: hp, submitBtn: submitBtn };
    return form;
  };

  Rustaline.prototype._buildSkeleton = function () {
    var list = h('ul', { class: 'rs-skeleton-list' });
    for (var i = 0; i < 3; i++) {
      list.appendChild(h('li', { class: 'rs-skeleton' },
        h('div', { class: 'rs-skeleton__avatar' }),
        h('div', {},
          h('div', { class: 'rs-skeleton__line rs-skeleton__line--short' }),
          h('div', { class: 'rs-skeleton__line rs-skeleton__line--mid' }),
          h('div', { class: 'rs-skeleton__line rs-skeleton__line--mid' })
        )
      ));
    }
    return list;
  };

  Rustaline.prototype._buildError = function () {
    var self = this;
    return h('div', { class: 'rs-status rs-status--error' },
      h('span', { class: 'rs-status__icon', html: ICON_RETRY }),
      h('div', { text: this.lang.error }),
      h('button', {
        type: 'button', class: 'rs-btn rs-btn--ghost',
        style: { marginTop: '12px' },
        text: this.lang.retry,
        onclick: function () { self._fetchComments(); }
      })
    );
  };

  Rustaline.prototype._buildEmpty = function () {
    return h('div', { class: 'rs-status' },
      h('span', { class: 'rs-status__icon', html: ICON_EMPTY }),
      h('div', { text: this.lang.empty })
    );
  };

  /** 楼内建树：replies 按 pid 挂到对应节点；pid 不在本楼（预览截断/脏数据）挂楼根。
   *  从 root DFS 剪枝，环上的节点整体不可达被丢弃（防环）。 */
  function buildReplyTree(thread) {
    var byId = Object.create(null);
    var rootEntry = { node: thread.root, children: [] };
    byId[thread.root.id] = rootEntry;
    var i, c, entry;
    for (i = 0; i < thread.replies.length; i++) {
      c = thread.replies[i];
      if (!byId[c.id]) byId[c.id] = { node: c, children: [] };
    }
    for (i = 0; i < thread.replies.length; i++) {
      c = thread.replies[i];
      entry = byId[c.id];
      if (c.pid && byId[c.pid] && c.pid !== c.id) {
        byId[c.pid].children.push(entry);
      } else {
        rootEntry.children.push(entry);
      }
    }
    // 防环剪枝：只保留 root 可达的节点
    var reachable = Object.create(null);
    (function mark(e) {
      if (reachable[e.node.id]) return;
      reachable[e.node.id] = true;
      for (var k = 0; k < e.children.length; k++) mark(e.children[k]);
    })(rootEntry);
    (function prune(e) {
      e.children = e.children.filter(function (ch) { return reachable[ch.node.id]; });
      for (var k = 0; k < e.children.length; k++) prune(e.children[k]);
    })(rootEntry);
    return rootEntry;
  }

  /** 子树节点总数（含自身之外的 descendants），供深度占位条文案计数 */
  function subtreeSize(entry) {
    var n = 0;
    for (var i = 0; i < entry.children.length; i++) {
      n += 1 + subtreeSize(entry.children[i]);
    }
    return n;
  }

  Rustaline.prototype._buildList = function () {
    if (this.state.threads.length === 0) return this._buildEmpty();

    var ul = h('ul', { class: 'rs-list' });
    for (var i = 0; i < this.state.threads.length; i++) {
      ul.appendChild(this._renderThread(this.state.threads[i]));
    }
    return ul;
  };

  /** 渲染一楼：root 评论 + 楼内子树 + （回复未拉全时）楼尾「查看全部 N 条回复」 */
  Rustaline.prototype._renderThread = function (thread) {
    var self = this;
    var lang = this.lang;

    // 楼内 id → nick 映射，用于跨层回复的 @ 展示
    var nickOf = Object.create(null);
    nickOf[thread.root.id] = thread.root.nick;
    for (var i = 0; i < thread.replies.length; i++) {
      nickOf[thread.replies[i].id] = thread.replies[i].nick;
    }

    var li = this._renderCommentNode(buildReplyTree(thread), null, nickOf, 0);
    li.classList.add('rs-thread');

    if (thread.reply_count > thread.replies.length) {
      var loading = !!this.state.loadingReplies[thread.root.id];
      li.appendChild(h('div', { class: 'rs-thread__more-wrap' },
        h('button', {
          type: 'button', class: 'rs-thread__more',
          text: loading ? lang.loading : this._t('viewAllReplies', thread.reply_count),
          disabled: loading,
          onclick: function () { self._expandThread(thread.root.id); }
        })
      ));
    }
    return li;
  };

  // 楼内嵌套渲染上限：root=0，第 4 层（depth 3 节点的 children）折叠为占位条
  var MAX_DEPTH = 3;

  Rustaline.prototype._renderCommentNode = function (entry, parentEntry, nickOf, depth) {
    var self = this;
    var c = entry.node;
    var server = this.opts.server;
    var gravatarCdn = this.opts.gravatarCdn;

    // 头像
    var avatarSrc = resolveAvatar(c.avatar, c.nick, server, gravatarCdn, langVal(this.lang, 'anonymous'));
    var avatar = h('img', {
      class: 'rs-avatar',
      src: avatarSrc,
      alt: c.nick,
      width: 40, height: 40,
      loading: 'lazy',
      onerror: function () {
        // 头像加载失败 → 退化为默认 SVG
        var fallback = defaultAvatar(c.nick);
        if (avatar.src !== fallback) avatar.src = fallback;
      }
    });

    // 头部：昵称（可作为链接） + 时间
    var headChildren = [];
    var safeUrl = safeLinkUrl(c.link);
    if (safeUrl) {
      headChildren.push(h('a', {
        class: 'rs-author', href: safeUrl,
        target: '_blank', rel: 'noopener nofollow ugc',
        text: c.nick
      }));
    } else {
      headChildren.push(h('span', { class: 'rs-author', text: c.nick }));
    }
    headChildren.push(h('time', {
      class: 'rs-comment__time',
      datetime: c.inserted_at || '',
      title: c.inserted_at || '',
      text: formatRelativeTime(c.inserted_at, this.lang)
    }));
    // 评论者环境徽章：服务端解析的 ua_summary（textContent 渲染防 XSS）；
    // 后端 display_commenter_user_agent=false 或解析不出时为 null，不渲染
    if (c.ua_summary) {
      headChildren.push(h('span', { class: 'rs-comment__ua', text: c.ua_summary }));
    }

    // 内容
    var contentChildren = [];
    // 回复片段：如果该评论有 pid（即回复），且被回复的不是直接的父（即楼中楼跨层），显示 @目标
    // 简化：所有回复都显示 @被回复者昵称（pid 指向的对象）；如果 pid 即为父节点，则不重复显示
    if (c.pid && parentEntry && c.pid !== parentEntry.node.id && nickOf[c.pid]) {
      contentChildren.push(h('span', { class: 'rs-reply-snip' },
        '@', h('strong', { text: nickOf[c.pid] }), ' '
      ));
    }
    contentChildren.push(renderMarkdown(c.comment || '', {
      image: langVal(this.lang, 'mdImage'),
      imageError: langVal(this.lang, 'mdImageError'),
      close: langVal(this.lang, 'close'),
    }));

    // 操作：回复按钮
    var actions = h('div', { class: 'rs-comment__actions' },
      h('button', {
        type: 'button', class: 'rs-reply-btn',
        text: this.lang.reply,
        onclick: function () {
          self.state.replyTo = c;
          self._render();
          // 焦点跳到新位置的文本框
          var ta = self.el.querySelector('.rs-form--reply .rs-textarea') || self.el.querySelector('.rs-textarea');
          if (ta) ta.focus();
        }
      })
    );

    var body = h('div', { class: 'rs-comment__body' },
      h('div', { class: 'rs-comment__head' }, headChildren),
      h('div', { class: 'rs-comment__content' }, contentChildren),
      actions
    );

    var main = h('div', { class: 'rs-comment__main' }, avatar, body);

    var li = h('li', { class: 'rs-comment', 'data-id': c.id }, main);

    // 子评论：超过 MAX_DEPTH 层折叠为「继续查看这段对话」占位条（就地展开，零请求）；
    // 已被用户展开的子树（expandedSubtrees）不受深度限制
    if (entry.children.length > 0) {
      if (depth >= MAX_DEPTH && !this.state.expandedSubtrees[c.id]) {
        li.appendChild(h('div', { class: 'rs-subtree-toggle-wrap' },
          h('button', {
            type: 'button', class: 'rs-subtree-toggle',
            text: this._t('continueThread', subtreeSize(entry)),
            onclick: function () {
              self.state.expandedSubtrees[c.id] = true;
              self._render();
            }
          })
        ));
      } else {
        var childUl = h('ul', { class: 'rs-comment__children' });
        for (var i = 0; i < entry.children.length; i++) {
          childUl.appendChild(this._renderCommentNode(entry.children[i], entry, nickOf, depth + 1));
        }
        li.appendChild(childUl);
      }
    }

    // 若此评论是当前回复目标，把表单挂到它下方
    if (this.state.replyTo && this.state.replyTo.id === c.id) {
      var formWrap = h('div', { class: 'rs-comment__form-slot' }, this._buildForm());
      // 把表单放进 children 区域（视觉上嵌进缩进）
      if (!li.querySelector(':scope > .rs-comment__children')) {
        li.appendChild(h('ul', { class: 'rs-comment__children' }, formWrap));
      } else {
        li.querySelector(':scope > .rs-comment__children').appendChild(formWrap);
      }
    }

    return li;
  };

  // ---- 提交 ----

  Rustaline.prototype._handleSubmit = function (form) {
    var self = this;
    var refs = form._rs_refs || {};
    var lang = this.lang;

    var comment = (refs.textarea ? refs.textarea.value : '').trim();
    var nick = (refs.nickInput ? refs.nickInput.value : '').trim();
    var mail = (refs.mailInput ? refs.mailInput.value : '').trim();
    var link = (refs.linkInput ? refs.linkInput.value : '').trim();
    var hp = refs.hp ? refs.hp.value : '';

    // 清掉旧的错误提示
    var oldErr = form.querySelector('.rs-form__error');
    if (oldErr) oldErr.remove();

    // 客户端校验
    if (!comment) return this._showFormError(form, lang.commentRequired);
    if (comment.length > 10000) return this._showFormError(form, lang.commentTooLong);
    if (mail && !looksLikeMail(mail)) return this._showFormError(form, langVal(lang, 'mailInvalid'));
    var safeLink = link ? safeLinkUrl(link) : null;
    if (link && !safeLink) return this._showFormError(form, langVal(lang, 'linkInvalid'));

    // 组请求体（与服务端契约严格对齐）
    var body = {
      url: this.opts.url,
      comment: comment,
      hp: hp
    };
    if (nick) body.nick = nick.slice(0, 64);
    if (mail) body.mail = mail.slice(0, 128);
    if (safeLink) body.link = safeLink.slice(0, 255);

    var replyTarget = this.state.replyTo;
    if (replyTarget) {
      body.pid = replyTarget.id;
      body.rid = replyTarget.rid || replyTarget.id;
    }

    // 乐观插入：临时构造一个本地评论对象（顶层=新楼头插，回复=楼尾追加），
    // 服务端返回后用真实数据替换；后台刷新失败则保留乐观插入（避免用户输入丢失感）。
    var optimistic = {
      id: '__optimistic_' + (++OPTIMISTIC_SEQ),
      comment: comment,
      nick: nick || langVal(lang, 'anonymous'),
      link: safeLink || null,
      avatar: null,                       // 让 resolveAvatar 退到默认头像
      url: this.opts.url,
      pid: body.pid || null,
      rid: body.rid || null,
      inserted_at: new Date().toISOString(),
      ua_summary: null,                   // 真实数据回来前不显示环境徽章
      _optimistic: true
    };

    var optimisticInserted = false;
    function rollbackOptimistic() {
      if (!optimisticInserted) return;
      if (!replyTarget) {
        for (var i = 0; i < self.state.threads.length; i++) {
          if (self.state.threads[i].root === optimistic) {
            self.state.threads.splice(i, 1);
            break;
          }
        }
        self.state.rootTotal = Math.max(0, self.state.rootTotal - 1);
      } else {
        var thread = findThread(self.state.threads, replyTarget.rid || replyTarget.id);
        if (thread) {
          var idx = thread.replies.indexOf(optimistic);
          if (idx >= 0) thread.replies.splice(idx, 1);
          thread.reply_count = Math.max(0, thread.reply_count - 1);
        }
      }
      self.state.count = Math.max(0, self.state.count - 1);
    }

    // 持久化用户身份到 localStorage（仅昵称/邮箱/链接，不含评论）
    try {
      if (global.localStorage) {
        localStorage.setItem('rs_user', JSON.stringify({ nick: nick, mail: mail, link: link }));
      }
    } catch (_) { /* ignore */ }

    // 清空评论框 + 退出回复模式
    this.draft.comment = '';
    this.draft.nick = nick;
    this.draft.mail = mail;
    this.draft.link = link;
    this.state.replyTo = null;

    // 乐观插入并立刻重渲染（让用户看到自己的评论）：
    // 顶层评论 = 新楼插到列表头（root 倒序）；回复 = 追加到所在楼尾部（楼内升序）
    if (!replyTarget) {
      this.state.threads.unshift({ root: optimistic, reply_count: 0, replies: [] });
      this.state.rootTotal += 1;
    } else {
      var targetThread = findThread(this.state.threads, replyTarget.rid || replyTarget.id);
      if (targetThread) {
        targetThread.replies.push(optimistic);
        targetThread.reply_count += 1;
      }
    }
    this.state.count += 1;
    optimisticInserted = true;
    this.state.submitting = true;
    this._render();

    // 滚到刚插入位置（如果是回复，确保在父评论下）
    // _render 后通过 data-id 定位
    var insertedEl = this.el.querySelector('[data-id="' + cssEscape(optimistic.id) + '"]');
    if (insertedEl && insertedEl.scrollIntoView) {
      try { insertedEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    }

    fetch(this._apiBase(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        if (res.status === 429) {
          throw Object.assign(new Error(lang.errRate), { _kind: 'rate' });
        }
        if (res.status >= 400) {
          // 尝试从 body 读 message
          return res.json().then(function (j) {
            throw Object.assign(new Error((j && (j.message || j.error)) || lang.errGeneric), { _kind: 'http', _status: res.status });
          }, function () {
            throw Object.assign(new Error(lang.errGeneric), { _kind: 'http', _status: res.status });
          });
        }
        return res.json();
      })
      .then(function (created) {
        var real = normalizeComment(created, self.lang);
        // 用真实评论替换乐观占位（保持位置：楼头 / 楼尾）
        if (!replyTarget) {
          for (var i = 0; i < self.state.threads.length; i++) {
            if (self.state.threads[i].root === optimistic) {
              self.state.threads[i].root = real;
              break;
            }
          }
        } else {
          var thread = findThread(self.state.threads, replyTarget.rid || replyTarget.id);
          if (thread) {
            var idx = thread.replies.indexOf(optimistic);
            if (idx >= 0) thread.replies[idx] = real; else thread.replies.push(real);
          }
        }
        self.state.submitting = false;
        self._render();
        // 回复场景的可见性对齐：预览窗口只含最早 5 条，新回复（最新）可能不在其中；
        // 该楼若预览不全或已展开过，立即拉全量让新回复立即可见
        if (replyTarget) {
          var rid = real.rid || replyTarget.rid || replyTarget.id;
          var th = findThread(self.state.threads, rid);
          if (th && (self.state.expandedThreads[rid] || th.reply_count > th.replies.length)) {
            self._expandThread(rid);
          }
        }
        // 后台静默刷新已加载页面对齐（避免 count/排序漂移；失败时保留现状）
        setTimeout(function () { self._refreshLoadedPages(); }, 400);
      })
      .catch(function (err) {
        // 乐观插入回滚（保持表单草稿，让用户能改后重发）
        rollbackOptimistic();
        self.state.submitting = false;
        self.state.replyTo = replyTarget; // 恢复回复上下文，方便重试
        self.draft.comment = comment;     // 恢复评论内容
        self._render();
        // 等下一帧表单挂载后再追加错误条
        var formNow = self.el.querySelector('.rs-form');
        if (formNow) {
          self._showFormError(formNow, err && err.message ? err.message : lang.errNetwork);
        }
      });
  };

  var OPTIMISTIC_SEQ = 0;

  Rustaline.prototype._showFormError = function (form, msg) {
    var existing = form.querySelector('.rs-form__error');
    if (existing) existing.remove();
    var err = h('div', { class: 'rs-form__error', role: 'alert', text: msg });
    form.appendChild(err);
  };

  // 简易 CSS 转义（仅用于 data-id 选择器，data-id 是我们自己生成的 __optimistic_N）
  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return '\\' + c;
    });
  }

  // ---- 公共 API（外部可调用）----

  /** 强制重新拉取评论 */
  Rustaline.prototype.reload = function () {
    this._fetchComments();
  };

  /** 销毁实例：清空挂载点，移除主题样式与系统明暗监听 */
  Rustaline.prototype.destroy = function () {
    this.el.innerHTML = '';
    this.el.classList.remove('rs-root');
    this.el.classList.remove('rs-dark');
    if (this._themeClass) this.el.classList.remove(this._themeClass);
    if (this._darkMql && this._onDarkChange) {
      if (this._darkMql.removeEventListener) this._darkMql.removeEventListener('change', this._onDarkChange);
      else if (this._darkMql.removeListener) this._darkMql.removeListener(this._onDarkChange);
      this._darkMql = null;
      this._onDarkChange = null;
    }
    if (this._styleEl) {
      this._styleEl.remove();
      this._styleEl = null;
    }
    this.el.removeAttribute('data-rs-state');
    this.state.threads = [];
  };

  global.Rustaline = Rustaline;

  // 内置语言字典（供二次开发查阅或扩展）
  Rustaline.langs = LANGS;

  // 暴露工具函数到 Rustaline.util 便于二次开发（可选）
  Rustaline.util = {
    // 保持旧签名：默认 zh-CN 字典；需要其他语言请传第二参数字典
    formatRelativeTime: function (iso, lang) {
      return formatRelativeTime(iso, lang || LANGS['zh-CN']);
    },
    defaultAvatar: defaultAvatar,
    hashString: hashString
  };
})(typeof window !== 'undefined' ? window : this);
