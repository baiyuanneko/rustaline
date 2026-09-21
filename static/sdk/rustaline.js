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
      powComputing: '安全校验计算中…',
      captchaPlaceholder: '图形验证码',
      captchaRefresh: '换一张',
      captchaLoading: '验证码加载中…',
      captchaLoadError: '验证码加载失败，点击重试',
      captchaTitle: '图形验证码',
      captchaHint: '请输入图片中的字符（不区分大小写）',
      captchaConfirm: '确定',
      errPow: '安全校验失败，请重试',
      errCaptcha: '图形验证码错误或已过期，请重新输入',
      timeJustNow: '刚刚',
      timeMinutesAgo: function (n) { return n + ' 分钟前'; },
      timeHoursAgo: function (n) { return n + ' 小时前'; },
      timeDaysAgo: function (n) { return n + ' 天前'; },
      linkConfirmTitle: '离开 rustaline',
      linkConfirmText: '即将在新标签页打开外部链接，确定继续吗？',
      linkConfirmCancel: '取消',
      linkConfirmProceed: '继续访问'
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
      powComputing: 'Running security check…',
      captchaPlaceholder: 'Characters in the image',
      captchaRefresh: 'Refresh',
      captchaLoading: 'Loading captcha…',
      captchaLoadError: 'Failed to load captcha, click to retry',
      captchaTitle: 'Captcha',
      captchaHint: 'Enter the characters in the image (not case-sensitive)',
      captchaConfirm: 'Confirm',
      errPow: 'Security check failed, please try again',
      errCaptcha: 'Captcha is incorrect or expired, please try again',
      timeJustNow: 'just now',
      timeMinutesAgo: function (n) { return n === 1 ? '1 minute ago' : n + ' minutes ago'; },
      timeHoursAgo: function (n) { return n === 1 ? '1 hour ago' : n + ' hours ago'; },
      timeDaysAgo: function (n) { return n === 1 ? '1 day ago' : n + ' days ago'; },
      linkConfirmTitle: 'Leaving this page',
      linkConfirmText: 'The external link will open in a new tab. Continue?',
      linkConfirmCancel: 'Cancel',
      linkConfirmProceed: 'Continue'
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

/* ---- 图形验证码模态框（挂 document.body，主题变量由 JS 从 .rs-root 拷贝） ---- */
.rs-captcha-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.5);
}
.rs-captcha-dialog {
  width: 300px;
  max-width: 100%;
  background: var(--rs-surface-container-lowest, #fff);
  color: var(--rs-on-surface, #1a1c1e);
  border-radius: var(--rs-radius-md, 16px);
  box-shadow: var(--rs-elevation-3, 0 8px 24px rgba(0, 0, 0, 0.22));
  padding: 22px 22px 18px;
  animation: rs-captcha-pop 0.16s ease-out;
}
@keyframes rs-captcha-pop {
  from { transform: scale(0.94); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}
.rs-captcha-dialog__title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--rs-on-surface, #1a1c1e);
}
.rs-captcha-dialog__hint {
  font-size: 12px;
  color: var(--rs-on-surface-variant, #42474e);
  margin: 0 0 14px;
}
.rs-captcha-dialog__img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 168 / 64;
  border-radius: var(--rs-radius-xs, 8px);
  border: 1px solid var(--rs-outline, #74777f);
  background: var(--rs-surface-container-lowest, #fff);
  cursor: pointer;
}
.rs-captcha-dialog__img--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--rs-on-surface-variant, #42474e);
  cursor: pointer;
  user-select: none;
  padding: 0 8px;
  text-align: center;
}
.rs-captcha-dialog__imgrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.rs-captcha-dialog__input {
  width: 100%;
  font: inherit;
  color: var(--rs-on-surface, #1a1c1e);
  background: var(--rs-surface-container-lowest, #fff);
  border: 1px solid var(--rs-outline, #74777f);
  border-radius: var(--rs-radius-xs, 8px);
  padding: 10px 12px;
  outline: none;
  box-sizing: border-box;
  letter-spacing: 1px;
}
.rs-captcha-dialog__input:focus {
  border-color: var(--rs-primary, #0b76cb);
  box-shadow: 0 0 0 1px var(--rs-primary, #0b76cb);
}
.rs-captcha-dialog__error {
  margin-top: 8px;
  font-size: 12px;
  color: var(--rs-error, #ba1a1a);
  min-height: 16px;
}
.rs-captcha-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.rs-captcha-dialog__actions .rs-btn { height: 36px; padding: 0 16px; font-size: 13px; }

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

/* ---- 外链确认：涟漪 + 模态卡片 ---- */
/* 涟漪裁剪用 clip-path 而非 overflow:hidden：overflow 非 visible 的 inline-block
   基线会变成盒子底边缘，导致链接与周围文字不在同一水平线上 */
.rs-md-link, a.rs-author { display: inline-block; position: relative; clip-path: inset(0); }
.rs-ripple {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  background: currentColor;
  opacity: 0.25;
  transform: scale(0);
  animation: rs-ripple 0.55s ease-out forwards;
}
@keyframes rs-ripple {
  to { transform: scale(2.6); opacity: 0; }
}
.rs-link-confirm .rs-link-confirm__card {
  /* 遮罩挂在 body 下、不在 .rs-root 内，令牌需显式回落 */
  background: var(--rs-surface-container-lowest, #ffffff);
  color: var(--rs-on-surface, #191f25);
  border: 1px solid var(--rs-outline-variant, #d1dae0);
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28);
  max-width: min(92vw, 440px);
  padding: 22px;
  cursor: default;
}
.rs-link-confirm__title { font-weight: 700; font-size: 16px; margin-bottom: 8px; }
.rs-link-confirm__text { font-size: 13.5px; color: var(--rs-on-surface-variant, #405f77); line-height: 1.6; }
.rs-link-confirm__url {
  margin: 12px 0 4px;
  padding: 9px 12px;
  background: var(--rs-surface-container, #eaeef1);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--rs-on-surface-variant, #405f77);
  word-break: break-all;
  max-height: 72px;
  overflow: auto;
}
.rs-link-confirm__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.rs-link-confirm__btn { height: 36px; padding: 0 18px; font-size: 13.5px; }
.rs-link-confirm__btn.rs-btn--ghost { color: var(--rs-primary, #0b76cb); border-color: var(--rs-outline, #5b7e9a); background: transparent; }
.rs-link-confirm__btn.rs-btn--primary { background: var(--rs-primary, #0b76cb); color: var(--rs-on-primary, #ffffff); }
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

  // 当前打开中的确认框的关闭函数：开新框前先干净关掉旧框（含 keydown 监听），
  // 防止长按松开连发 click 叠出多个隐形遮罩挡住整页（表现为页面卡死）
  var activeLinkConfirmClose = null;

  /**
   * 外链离开确认模态框：点击作者 / Markdown 链接不再直接跳转，先弹窗询问。
   * 布局复用 rs-image-overlay 的遮罩层；「继续访问」在新标签打开（noopener nofollow ugc）。
   */
  function showLinkConfirmModal(url, labels) {
    if (activeLinkConfirmClose) activeLinkConfirmClose();
    var overlay = document.createElement('div');
    overlay.className = 'rs-image-overlay rs-link-confirm';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.tabIndex = -1;

    function close() {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (activeLinkConfirmClose === close) activeLinkConfirmClose = null;
    }
    var onKey = function (e) { if (e.key === 'Escape') close(); };

    var card = document.createElement('div');
    card.className = 'rs-link-confirm__card';

    var title = document.createElement('div');
    title.className = 'rs-link-confirm__title';
    title.textContent = langVal(labels, 'linkConfirmTitle');

    var text = document.createElement('div');
    text.className = 'rs-link-confirm__text';
    text.textContent = langVal(labels, 'linkConfirmText');

    var urlLine = document.createElement('div');
    urlLine.className = 'rs-link-confirm__url';
    urlLine.textContent = url;

    var actions = document.createElement('div');
    actions.className = 'rs-link-confirm__actions';

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'rs-btn rs-btn--ghost rs-link-confirm__btn';
    cancel.textContent = langVal(labels, 'linkConfirmCancel');
    cancel.addEventListener('click', close);

    var proceed = document.createElement('button');
    proceed.type = 'button';
    proceed.className = 'rs-btn rs-btn--primary rs-link-confirm__btn';
    proceed.textContent = langVal(labels, 'linkConfirmProceed');
    proceed.addEventListener('click', function () {
      var w = window.open(url, '_blank', 'noopener');
      if (w) w.opener = null;
      close();
    });

    actions.appendChild(cancel);
    actions.appendChild(proceed);
    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(urlLine);
    card.appendChild(actions);
    overlay.appendChild(card);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);
    activeLinkConfirmClose = close;
    document.body.appendChild(overlay);
    overlay.focus();
  }

  /** 给外链锚点挂「确认后新标签打开」拦截；涟漪在按下瞬间即触发（长按也有反馈） */
  function attachLinkConfirm(anchor, url, labels) {
    anchor.addEventListener('pointerdown', function (e) {
      spawnRipple(anchor, e);
    });
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      showLinkConfirmModal(url, labels);
    });
    // 长按拖动会触发浏览器原生链接拖拽 ghost，视觉上像页面失控，直接禁掉
    anchor.addEventListener('dragstart', function (e) {
      e.preventDefault();
    });
  }

  /** 在锚点内生成一次点击涟漪（.rs-md-link / a.rs-author 需 position:relative; clip-path:inset(0)） */
  function spawnRipple(anchor, e) {
    var rect = anchor.getBoundingClientRect();
    var d = Math.max(rect.width, rect.height) * 2;
    // 去重：同一锚点上同时只保留一个涟漪节点（animationend 在后台标签页会被暂停，
    // 不清理会永久残留堆积，节点多了拖垮页面）
    var old = anchor.querySelector('.rs-ripple');
    if (old) old.remove();
    var dot = document.createElement('span');
    dot.className = 'rs-ripple';
    dot.style.width = dot.style.height = d + 'px';
    dot.style.left = (e.clientX - rect.left - d / 2) + 'px';
    dot.style.top = (e.clientY - rect.top - d / 2) + 'px';
    anchor.appendChild(dot);
    dot.addEventListener('animationend', function () { dot.remove(); });
    setTimeout(function () { if (dot.parentNode) dot.remove(); }, 900);
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
          } else {
            // 文本链接：拦截直接跳转，弹确认模态框（涟漪为样式层效果）
            a.classList.add('rs-md-link');
            attachLinkConfirm(a, safe, labels);
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

  // ===== 纯 JS SHA-256 兜底实现 ==============================================
  // 当 crypto.subtle 不可用（明文 HTTP 部署等非安全上下文）时使用。
  // 内嵌 js-sha256 v1.0.0（MIT License, Copyright (c) 2014-2026 Chen, Yi-Cyuan,
  // https://github.com/emn178/js-sha256），在隔离函数作用域内执行，不向全局挂任何变量。
  // 该库是经过广泛验证的 SHA-256 实现；此处只取 sha256(字符串)->十六进制摘要 一个能力。
  var fallbackSha256Hex = (function () {
    var mod = { exports: {} };
    (function (module) {
      /**
       * [js-sha256]{@link https://github.com/emn178/js-sha256}
       *
       * @version 1.0.0
       * @author Chen, Yi-Cyuan [emn178@gmail.com]
       * @copyright Chen, Yi-Cyuan 2014-2026
       * @license MIT
       */
      !function(t,h){"object"==typeof exports&&"undefined"!=typeof module?module.exports=h():"function"==typeof define&&define.amd?define(h):(t="undefined"!=typeof globalThis?globalThis:t||self).sha256=h()}(this,function(){"use strict";var t="undefined"!=typeof ArrayBuffer,h=function(h){if("string"===typeof h)return[h,!0];if(Array.isArray(h))return[h,!1];if(t&&h){if(h.constructor===ArrayBuffer)return[new Uint8Array(h),!1];if(ArrayBuffer.isView(h))return[h,!1]}throw new Error("input is invalid type")},i="0123456789abcdef".split(""),s=[-2147483648,8388608,32768,128],e=[24,16,8,0],r=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],n=["hex","array","digest","arrayBuffer"],o=[],a=function(t,h){return function(i){return new c(h,!0).update(i)[t]()}},f=function(t){var h=a("hex",t);h.create=function(){return new c(t)},h.update=function(t){return h.create().update(t)};for(var i=0;i<n.length;++i){var s=n[i];h[s]=a(s,t)}return h},u=function(t,h){return function(i,s){return new y(i,h,!0).update(s)[t]()}},l=function(t){var h=u("hex",t);h.create=function(h){return new y(h,t)},h.update=function(t,i){return h.create(t).update(i)};for(var i=0;i<n.length;++i){var s=n[i];h[s]=u(s,t)}return h};function c(t,h){h?(o[0]=o[16]=o[1]=o[2]=o[3]=o[4]=o[5]=o[6]=o[7]=o[8]=o[9]=o[10]=o[11]=o[12]=o[13]=o[14]=o[15]=0,this.blocks=o):this.blocks=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],t?(this.h0=3238371032,this.h1=914150663,this.h2=812702999,this.h3=4144912697,this.h4=4290775857,this.h5=1750603025,this.h6=1694076839,this.h7=3204075428):(this.h0=1779033703,this.h1=3144134277,this.h2=1013904242,this.h3=2773480762,this.h4=1359893119,this.h5=2600822924,this.h6=528734635,this.h7=1541459225),this.block=this.start=this.bytes=this.hBytes=0,this.finalized=this.hashed=!1,this.first=!0,this.is224=t}function y(t,i,s){var e,r=h(t);if(t=r[0],r[1]){var n,o=[],a=t.length,f=0;for(e=0;e<a;++e)(n=t.charCodeAt(e))<128?o[f++]=n:n<2048?(o[f++]=192|n>>>6,o[f++]=128|63&n):n<55296||n>=57344?(o[f++]=224|n>>>12,o[f++]=128|n>>>6&63,o[f++]=128|63&n):(n=65536+((1023&n)<<10|1023&t.charCodeAt(++e)),o[f++]=240|n>>>18,o[f++]=128|n>>>12&63,o[f++]=128|n>>>6&63,o[f++]=128|63&n);t=o}t.length>64&&(t=new c(i,!0).update(t).array());var u=[],l=[];for(e=0;e<64;++e){var y=t[e]||0;u[e]=92^y,l[e]=54^y}c.call(this,i,s),this.update(l),this.oKeyPad=u,this.inner=!0,this.sharedMemory=s}c.prototype.update=function(t){if(this.finalized)throw new Error("finalize already called");var i=h(t);t=i[0];for(var s,r,n=i[1],o=0,a=t.length,f=this.blocks;o<a;){if(this.hashed&&(this.hashed=!1,f[0]=this.block,this.block=f[16]=f[1]=f[2]=f[3]=f[4]=f[5]=f[6]=f[7]=f[8]=f[9]=f[10]=f[11]=f[12]=f[13]=f[14]=f[15]=0),n)for(r=this.start;o<a&&r<64;++o)(s=t.charCodeAt(o))<128?f[r>>>2]|=s<<e[3&r++]:s<2048?(f[r>>>2]|=(192|s>>>6)<<e[3&r++],f[r>>>2]|=(128|63&s)<<e[3&r++]):s<55296||s>=57344?(f[r>>>2]|=(224|s>>>12)<<e[3&r++],f[r>>>2]|=(128|s>>>6&63)<<e[3&r++],f[r>>>2]|=(128|63&s)<<e[3&r++]):(s=65536+((1023&s)<<10|1023&t.charCodeAt(++o)),f[r>>>2]|=(240|s>>>18)<<e[3&r++],f[r>>>2]|=(128|s>>>12&63)<<e[3&r++],f[r>>>2]|=(128|s>>>6&63)<<e[3&r++],f[r>>>2]|=(128|63&s)<<e[3&r++]);else for(r=this.start;o<a&&r<64;++o)f[r>>>2]|=t[o]<<e[3&r++];this.lastByteIndex=r,this.bytes+=r-this.start,r>=64?(this.block=f[16],this.start=r-64,this.hash(),this.hashed=!0):this.start=r}return this.bytes>4294967295&&(this.hBytes+=this.bytes/4294967296|0,this.bytes=this.bytes%4294967296),this},c.prototype.finalize=function(){if(!this.finalized){this.finalized=!0;var t=this.blocks,h=this.lastByteIndex;t[16]=this.block,t[h>>>2]|=s[3&h],this.block=t[16],h>=56&&(this.hashed||this.hash(),t[0]=this.block,t[16]=t[1]=t[2]=t[3]=t[4]=t[5]=t[6]=t[7]=t[8]=t[9]=t[10]=t[11]=t[12]=t[13]=t[14]=t[15]=0),t[14]=this.hBytes<<3|this.bytes>>>29,t[15]=this.bytes<<3,this.hash()}},c.prototype.hash=function(){var t,h,i,s,e,n,o,a,f,u=this.h0,l=this.h1,c=this.h2,y=this.h3,p=this.h4,d=this.h5,b=this.h6,v=this.h7,w=this.blocks;for(t=16;t<64;++t)h=((e=w[t-15])>>>7|e<<25)^(e>>>18|e<<14)^e>>>3,i=((e=w[t-2])>>>17|e<<15)^(e>>>19|e<<13)^e>>>10,w[t]=w[t-16]+h+w[t-7]+i|0;for(f=l&c,t=0;t<64;t+=4)this.first?(this.is224?(n=300032,v=(e=w[0]-1413257819)-150054599|0,y=e+24177077|0):(n=704751109,v=(e=w[0]-210244248)-1521486534|0,y=e+143694565|0),this.first=!1):(h=(u>>>2|u<<30)^(u>>>13|u<<19)^(u>>>22|u<<10),s=(n=u&l)^u&c^f,v=y+(e=v+(i=(p>>>6|p<<26)^(p>>>11|p<<21)^(p>>>25|p<<7))+(p&d^~p&b)+r[t]+w[t])|0,y=e+(h+s)|0),h=(y>>>2|y<<30)^(y>>>13|y<<19)^(y>>>22|y<<10),s=(o=y&u)^y&l^n,b=c+(e=b+(i=(v>>>6|v<<26)^(v>>>11|v<<21)^(v>>>25|v<<7))+(v&p^~v&d)+r[t+1]+w[t+1])|0,h=((c=e+(h+s)|0)>>>2|c<<30)^(c>>>13|c<<19)^(c>>>22|c<<10),s=(a=c&y)^c&u^o,d=l+(e=d+(i=(b>>>6|b<<26)^(b>>>11|b<<21)^(b>>>25|b<<7))+(b&v^~b&p)+r[t+2]+w[t+2])|0,h=((l=e+(h+s)|0)>>>2|l<<30)^(l>>>13|l<<19)^(l>>>22|l<<10),s=(f=l&c)^l&y^a,p=u+(e=p+(i=(d>>>6|d<<26)^(d>>>11|d<<21)^(d>>>25|d<<7))+(d&b^~d&v)+r[t+3]+w[t+3])|0,u=e+(h+s)|0,this.chromeBugWorkAround=!0;this.h0=this.h0+u|0,this.h1=this.h1+l|0,this.h2=this.h2+c|0,this.h3=this.h3+y|0,this.h4=this.h4+p|0,this.h5=this.h5+d|0,this.h6=this.h6+b|0,this.h7=this.h7+v|0},c.prototype.hex=function(){this.finalize();var t=this.h0,h=this.h1,s=this.h2,e=this.h3,r=this.h4,n=this.h5,o=this.h6,a=this.h7,f=i[t>>>28&15]+i[t>>>24&15]+i[t>>>20&15]+i[t>>>16&15]+i[t>>>12&15]+i[t>>>8&15]+i[t>>>4&15]+i[15&t]+i[h>>>28&15]+i[h>>>24&15]+i[h>>>20&15]+i[h>>>16&15]+i[h>>>12&15]+i[h>>>8&15]+i[h>>>4&15]+i[15&h]+i[s>>>28&15]+i[s>>>24&15]+i[s>>>20&15]+i[s>>>16&15]+i[s>>>12&15]+i[s>>>8&15]+i[s>>>4&15]+i[15&s]+i[e>>>28&15]+i[e>>>24&15]+i[e>>>20&15]+i[e>>>16&15]+i[e>>>12&15]+i[e>>>8&15]+i[e>>>4&15]+i[15&e]+i[r>>>28&15]+i[r>>>24&15]+i[r>>>20&15]+i[r>>>16&15]+i[r>>>12&15]+i[r>>>8&15]+i[r>>>4&15]+i[15&r]+i[n>>>28&15]+i[n>>>24&15]+i[n>>>20&15]+i[n>>>16&15]+i[n>>>12&15]+i[n>>>8&15]+i[n>>>4&15]+i[15&n]+i[o>>>28&15]+i[o>>>24&15]+i[o>>>20&15]+i[o>>>16&15]+i[o>>>12&15]+i[o>>>8&15]+i[o>>>4&15]+i[15&o];return this.is224||(f+=i[a>>>28&15]+i[a>>>24&15]+i[a>>>20&15]+i[a>>>16&15]+i[a>>>12&15]+i[a>>>8&15]+i[a>>>4&15]+i[15&a]),f},c.prototype.toString=c.prototype.hex,c.prototype.digest=function(){this.finalize();var t=this.h0,h=this.h1,i=this.h2,s=this.h3,e=this.h4,r=this.h5,n=this.h6,o=this.h7,a=[t>>>24&255,t>>>16&255,t>>>8&255,255&t,h>>>24&255,h>>>16&255,h>>>8&255,255&h,i>>>24&255,i>>>16&255,i>>>8&255,255&i,s>>>24&255,s>>>16&255,s>>>8&255,255&s,e>>>24&255,e>>>16&255,e>>>8&255,255&e,r>>>24&255,r>>>16&255,r>>>8&255,255&r,n>>>24&255,n>>>16&255,n>>>8&255,255&n];return this.is224||a.push(o>>>24&255,o>>>16&255,o>>>8&255,255&o),a},c.prototype.array=c.prototype.digest,c.prototype.arrayBuffer=function(){this.finalize();var t=new ArrayBuffer(this.is224?28:32),h=new DataView(t);return h.setUint32(0,this.h0),h.setUint32(4,this.h1),h.setUint32(8,this.h2),h.setUint32(12,this.h3),h.setUint32(16,this.h4),h.setUint32(20,this.h5),h.setUint32(24,this.h6),this.is224||h.setUint32(28,this.h7),t},y.prototype=new c,y.prototype.finalize=function(){if(c.prototype.finalize.call(this),this.inner){this.inner=!1;var t=this.array();c.call(this,this.is224,this.sharedMemory),this.update(this.oKeyPad),this.update(t),c.prototype.finalize.call(this)}};var p=f(),d=f(!0);p.sha256=p,p.sha224=d,p.hmac=l(),d.hmac=l(!0);const b="object"==typeof globalThis?globalThis:"object"==typeof self?self:"object"==typeof window?window:"object"==typeof global?global:void 0;return b&&(b.sha224=d),p});
    })(mod);
    var exported = mod.exports;
    return typeof exported === 'function' ? exported : exported.sha256;
  })();

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
      powComputing: false, // PoW 计算中（乐观插入之前的等待态）
      expandedSubtrees: {}, // 深度占位条已就地展开的节点 id
      expandedThreads: {},  // 已拉取全量回复的楼 root id
      loadingReplies: {},   // 正在拉全量的楼 root id
      optimisticIds: new Set()  // 乐观插入过的评论 id（用于在后台刷新失败时识别）
    };

    // 表单草稿（在 reply 模式切换时保留输入）
    this.draft = { nick: '', mail: '', link: '', comment: '' };

    // 验证码状态：开关由服务端 /captcha/config 下发；探测失败默认全部关闭（不阻塞旧页面）
    this.captcha = {
      pow: { enabled: false, difficulty: 4 },
      image: { enabled: false },
      loaded: false,
      // 当前图形码
      captchaId: '',
      captchaImage: '',
      captchaLoading: false,
      captchaError: false
    };

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
    this._fetchCaptchaConfig();
  }

  // ---- 网络层 ----

  Rustaline.prototype._apiBase = function () {
    return this.opts.server + '/api/v1/comments';
  };

  Rustaline.prototype._captchaBase = function (path) {
    return this.opts.server + '/api/v1/captcha/' + path;
  };

  // ---- 验证码 ----

  /** 探测服务端验证码开关；任何失败都静默降级为全部关闭 */
  Rustaline.prototype._fetchCaptchaConfig = function () {
    var self = this;
    fetch(this._captchaBase('config'), { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        self.captcha.pow.enabled = !!(data && data.pow && data.pow.enabled);
        self.captcha.pow.difficulty =
          (data && data.pow && typeof data.pow.difficulty === 'number') ? data.pow.difficulty : 4;
        self.captcha.image.enabled = !!(data && data.image && data.image.enabled);
        self.captcha.loaded = true;
        // 图形码不在初始化时预拉：改为点「发表评论」弹模态框时才拉取，
        // 避免每次页面加载都消耗一次签发（签发接口 60 次/分钟/IP）
        self._render();
      })
      .catch(function () {
        // 探测失败：保持默认关闭，不影响评论基础功能
        self.captcha.loaded = true;
      });
  };

  /** 拉取一张图形验证码；失败显示可点击重试的占位条 */
  /**
   * 拉取一张图形验证码；失败显示可点击重试的占位条。
   * 返回 Promise，在图片到位（或失败占位）渲染完成后 resolve，
   * 供提交失败后的错误条在「重拉导致的重渲染」之后再追加，避免被冲掉。
   */
  Rustaline.prototype._loadImageCaptcha = function () {
    var self = this;
    this.captcha.captchaLoading = true;
    this.captcha.captchaError = false;
    this._render();
    return fetch(this._captchaBase('image'), { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        self.captcha.captchaId = data.captcha_id || '';
        self.captcha.captchaImage = data.image || '';
        self.captcha.captchaLoading = false;
        self.captcha.captchaError = false;
        self._render();
        self._notifyCaptchaImageChange();
      })
      .catch(function () {
        self.captcha.captchaLoading = false;
        self.captcha.captchaError = true;
        self.captcha.captchaId = '';
        self.captcha.captchaImage = '';
        self._render();
        self._notifyCaptchaImageChange();
      });
  };

  /// 图形码状态变化通知（模态框打开期间由其同步图片区）
  Rustaline.prototype._notifyCaptchaImageChange = function () {
    if (this.captcha.onImageChange) {
      try { this.captcha.onImageChange(); } catch (_) { /* ignore */ }
    }
  };

  /**
   * 弹出图形验证码模态框，返回 Promise：
   *   - 用户点「确定」且输入非空 -> resolve(输入内容)
   *   - 用户取消（取消按钮 / Esc / 点遮罩）-> resolve(null)
   * 已有模态框打开时直接 resolve(null)（不叠加第二个框）。
   * returnFocusEl：关闭后焦点归还的元素（提交按钮）；errorText：初始错误文案（重试场景）。
   */
  Rustaline.prototype._openCaptchaModal = function (returnFocusEl, errorText) {
    var self = this;
    var lang = this.lang;
    if (this._captchaModal) return Promise.resolve(null);

    this.captcha.modalError = errorText || '';

    // 没有可用的已加载图形码时先拉一张（拉取中模态框显示占位）
    var hasUsable = this.captcha.captchaId && this.captcha.captchaImage && !this.captcha.captchaLoading;
    if (!hasUsable) this._loadImageCaptcha();

    var overlay = document.createElement('div');
    overlay.className = 'rs-captcha-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', lang.captchaTitle);

    // 模态框挂在 body 上（_render 会清空 root，不能挂 root），
    // 因此把根元素解析出的 --rs-* 设计令牌拷贝过来，保证跟随实例配色与明暗模式
    try {
      var cs = global.getComputedStyle(this.el);
      for (var i = 0; i < cs.length; i++) {
        var name = cs[i];
        if (name.indexOf('--rs-') === 0) {
          overlay.style.setProperty(name, cs.getPropertyValue(name));
        }
      }
    } catch (_) { /* 取不到就用 CSS 里的兜底色 */ }

    var dialog = document.createElement('div');
    dialog.className = 'rs-captcha-dialog';

    var imgBox = h('div', {
      class: 'rs-captcha-dialog__img rs-captcha-dialog__img--placeholder',
      text: lang.captchaLoading
    });
    var refreshBtn = h('button', {
      type: 'button', class: 'rs-btn rs-btn--ghost', text: lang.captchaRefresh
    });
    var input = h('input', {
      type: 'text', class: 'rs-captcha-dialog__input',
      placeholder: lang.captchaPlaceholder, maxlength: 10,
      autocomplete: 'off', 'autocapitalize': 'off', 'spellcheck': 'false'
    });
    var errBox = h('div', { class: 'rs-captcha-dialog__error', text: this.captcha.modalError });
    var cancelBtn = h('button', { type: 'button', class: 'rs-btn rs-btn--ghost', text: lang.cancelReply });
    var confirmBtn = h('button', { type: 'button', class: 'rs-btn rs-btn--primary', text: lang.captchaConfirm });

    dialog.appendChild(h('h3', { class: 'rs-captcha-dialog__title', text: lang.captchaTitle }));
    dialog.appendChild(h('p', { class: 'rs-captcha-dialog__hint', text: lang.captchaHint }));
    dialog.appendChild(h('div', { class: 'rs-captcha-dialog__imgrow' }, imgBox, refreshBtn));
    dialog.appendChild(input);
    dialog.appendChild(errBox);
    dialog.appendChild(h('div', { class: 'rs-captcha-dialog__actions' }, cancelBtn, confirmBtn));
    overlay.appendChild(dialog);

    refreshBtn.addEventListener('click', function () {
      errBox.textContent = '';
      self._loadImageCaptcha();
    });

    // 图片区随 captcha 状态重绘
    function paintImage() {
      var c = self.captcha;
      var box;
      if (c.captchaLoading || (!c.captchaImage && !c.captchaError)) {
        box = h('div', { class: 'rs-captcha-dialog__img rs-captcha-dialog__img--placeholder', text: lang.captchaLoading });
      } else if (c.captchaError) {
        box = h('div', {
          class: 'rs-captcha-dialog__img rs-captcha-dialog__img--placeholder',
          text: lang.captchaLoadError, title: lang.captchaLoadError
        });
      } else {
        box = h('img', {
          class: 'rs-captcha-dialog__img', src: c.captchaImage,
          alt: lang.captchaTitle, title: lang.captchaRefresh
        });
      }
      box.addEventListener('click', refresh);
      imgBox.replaceWith(box);
      imgBox = box;
    }
    function refresh() {
      errBox.textContent = '';
      self._loadImageCaptcha();
    }
    this.captcha.onImageChange = paintImage;
    paintImage();

    var resolveRef = null;
    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      if (self.captcha.onImageChange === paintImage) self.captcha.onImageChange = null;
      if (prevOverflow !== null) document.body.style.overflow = prevOverflow;
      overlay.remove();
      self._captchaModal = null;
      if (returnFocusEl && returnFocusEl.focus) { try { returnFocusEl.focus(); } catch (_) {} }
      if (resolveRef) resolveRef(result);
    }
    function confirm() {
      var code = input.value.trim();
      if (!code) {
        errBox.textContent = lang.captchaPlaceholder;
        input.focus();
        return;
      }
      close(code);
    }

    cancelBtn.addEventListener('click', function () { close(null); });
    confirmBtn.addEventListener('click', confirm);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      e.stopPropagation();
    });
    var onKey = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      else if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKey, true);

    // 打开期间锁页面滚动
    var prevOverflow = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';

    document.body.appendChild(overlay);
    this._captchaModal = overlay;
    input.focus();

    return new Promise(function (resolve) { resolveRef = resolve; });
  };

  /**
   * 计算 PoW：找使 SHA-256(challenge + ':' + nonce) 前 difficulty 个十六进制位为 0 的 nonce。
   * 优先 Web Crypto（安全上下文），不可用时走内联纯 JS 实现；循环分块让出主线程。
   * 返回 { challenge, nonce }。
   */
  Rustaline.prototype._solvePow = function (difficulty) {
    var self = this;
    return fetch(this._captchaBase('pow'), { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('pow challenge failed');
        return res.json();
      })
      .then(function (data) {
        var challenge = data.challenge;
        var diff = typeof data.difficulty === 'number' ? data.difficulty : difficulty;
        return self._minePow(challenge, diff).then(function (nonce) {
          return { challenge: challenge, nonce: nonce };
        });
      });
  };

  Rustaline.prototype._minePow = function (challenge, difficulty) {
    var subtle = global.crypto && global.crypto.subtle;
    var prefix = '';
    for (var i = 0; i < difficulty; i++) prefix += '0';
    var nonce = 0;

    function hexFromArrayBuffer(buf) {
      var arr = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < arr.length; i++) hex += ('0' + arr[i].toString(16)).slice(-2);
      return hex;
    }

    function attemptChunk(resolve, reject) {
      try {
        var bound = Math.min(nonce + 256, 0xffffffff); // 分块：256 次后让出事件循环
        if (subtle) {
          // Web Crypto：每次 digest 是异步微任务，顺序检查 256 个候选
          var chain = Promise.resolve();
          var hit = -1;
          for (var n = nonce; n < bound; n++) {
            (function (candidate) {
              chain = chain.then(function () {
                if (hit >= 0) return;
                var msg = challenge + ':' + candidate;
                return subtle.digest('SHA-256', new TextEncoder().encode(msg))
                  .then(function (hash) {
                    if (hit < 0 && hexFromArrayBuffer(hash).slice(0, difficulty) === prefix) {
                      hit = candidate;
                    }
                  });
              });
            })(n);
          }
          chain.then(function () {
            if (hit >= 0) return resolve(hit);
            nonce = bound;
            if (nonce >= 0xffffffff) return reject(new Error('pow exceeded nonce range'));
            setTimeout(function () { attemptChunk(resolve, reject); }, 0);
          });
        } else {
          // 纯 JS 兜底（明文 HTTP 等无 subtle 的环境）：js-sha256 直接吃字符串
          for (n = nonce; n < bound; n++) {
            var hex = fallbackSha256Hex(challenge + ':' + n);
            if (hex.slice(0, difficulty) === prefix) return resolve(n);
          }
          nonce = bound;
          if (nonce >= 0xffffffff) return reject(new Error('pow exceeded nonce range'));
          setTimeout(function () { attemptChunk(resolve, reject); }, 0);
        }
      } catch (e) {
        reject(e);
      }
    }
    return new Promise(attemptChunk);
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

    // 操作行（PoW 计算中文案由按钮直接展示）
    var hint = h('span', { class: 'rs-form__hint' }, this._t('formHint'));
    var btnText = this.state.powComputing
      ? lang.powComputing
      : (this.state.submitting ? lang.submitting : lang.submit);
    var submitBtn = h('button', {
      type: 'submit', class: 'rs-btn rs-btn--primary',
      text: btnText,
      disabled: !!(this.state.submitting || this.state.powComputing)
    });
    form.appendChild(h('div', { class: 'rs-form__actions' }, hint, submitBtn));

    // 持有引用便于读值
    form._rs_refs = {
      nickInput: nickInput, mailInput: mailInput, linkInput: linkInput,
      textarea: textarea, hp: hp, submitBtn: submitBtn
    };
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
      var authorLink = h('a', {
        class: 'rs-author', href: safeUrl,
        target: '_blank', rel: 'noopener nofollow ugc',
        text: c.nick
      });
      // 点击作者不直接跳转：先弹确认模态框
      attachLinkConfirm(authorLink, safeUrl, this.lang);
      headChildren.push(authorLink);
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
      // 文本链接确认框文案：labels 是逐键解析的扁平对象，必须显式带上（漏了就是空白模态框）
      linkConfirmTitle: langVal(this.lang, 'linkConfirmTitle'),
      linkConfirmText: langVal(this.lang, 'linkConfirmText'),
      linkConfirmCancel: langVal(this.lang, 'linkConfirmCancel'),
      linkConfirmProceed: langVal(this.lang, 'linkConfirmProceed'),
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
    if (this.state.submitting || this.state.powComputing) return; // 防重复提交

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

    // 图形验证码走模态框收集：点「发表评论」先弹框，用户确认后才继续
    // PoW 计算与提交（取消则什么都不做，表单内容保留）
    if (this.captcha.image.enabled) {
      var submitBtn = refs.submitBtn || null;
      this._openCaptchaModal(submitBtn).then(function (code) {
        if (code == null) return; // 用户取消
        body.captcha_id = self.captcha.captchaId;
        body.captcha_code = code;
        self._continueSubmit(body, optimistic, { comment: comment, replyTarget: replyTarget });
      });
      return;
    }
    this._continueSubmit(body, optimistic, { comment: comment, replyTarget: replyTarget });
  };

  /**
   * 客户端校验与图形码收集完成后的后续流程：
   * 持久化身份 -> PoW 计算（在乐观插入之前）-> 乐观插入 -> 提交 -> 成功替换 / 失败回滚。
   */
  Rustaline.prototype._continueSubmit = function (body, optimistic, ctx) {
    var self = this;
    var lang = this.lang;
    var comment = ctx.comment;
    var replyTarget = ctx.replyTarget;

    // 持久化用户身份到 localStorage（仅昵称/邮箱/链接，不含评论）
    try {
      if (global.localStorage) {
        localStorage.setItem('rs_user', JSON.stringify({ nick: body.nick || '', mail: body.mail || '', link: body.link || '' }));
      }
    } catch (_) { /* ignore */ }

    // PoW 在乐观插入之前计算（可能耗时数百毫秒～数秒，避免用户先看到「已发出」假象）。
    // 计算期间按钮展示「安全校验计算中…」并禁用
    if (this.captcha.pow.enabled) {
      this.state.powComputing = true;
      this._render();
    }

    var powPromise = this.captcha.pow.enabled
      ? this._solvePow(this.captcha.pow.difficulty)
      : Promise.resolve(null);

    powPromise
      .then(function (solution) {
        if (solution) body.pow = solution;
        self._dispatchSubmission(body, optimistic, {
          comment: comment,
          replyTarget: replyTarget
        });
      })
      .catch(function () {
        // 计算失败：恢复按钮态，提示用户重试（不插入乐观评论）
        self.state.powComputing = false;
        self._render();
        var formNow = self.el.querySelector('.rs-form');
        if (formNow) self._showFormError(formNow, lang.errPow);
      });
  };

  /**
   * PoW 计算通过后真正发送：清空表单 -> 乐观插入 -> fetch -> 成功替换 / 失败回滚。
   * ctx 携带提交前快照，失败时恢复草稿与回复上下文。
   */
  Rustaline.prototype._dispatchSubmission = function (body, optimistic, ctx) {
    var self = this;
    var lang = this.lang;
    var replyTarget = ctx.replyTarget;

    // 清空评论框 + 退出回复模式
    this.draft.comment = '';
    this.draft.nick = body.nick || '';
    this.draft.mail = body.mail || '';
    this.draft.link = body.link || '';
    this.state.replyTo = null;

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
    this.state.powComputing = false; // PoW 已完成，进入提交态
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
          // 尝试从 body 读 message；识别服务端验证码错误并归类（用于本地文案与刷新图形码）
          return res.json().then(function (j) {
            var msg = (j && (j.message || j.error)) || lang.errGeneric;
            var kind = 'http';
            if (/pow verification failed/i.test(msg)) {
              kind = 'pow';
              msg = lang.errPow;
            } else if (/captcha code/i.test(msg)) {
              kind = 'captcha';
              msg = lang.errCaptcha;
            }
            throw Object.assign(new Error(msg), { _kind: kind, _status: res.status });
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
        self.state.powComputing = false;
        self.state.replyTo = replyTarget; // 恢复回复上下文，方便重试
        self.draft.comment = ctx.comment; // 恢复评论内容
        self._render();

        // 图形码错误：服务端已作废旧码，重新弹模态框（带错误文案 + 新图）让用户重输，
        // 比在表单里插错误条更贴近「弹框收集」这一交互
        if (err && err._kind === 'captcha' && self.captcha.image.enabled) {
          self.captcha.captchaId = '';
          self._openCaptchaModal(null, err.message || lang.errCaptcha).then(function (code) {
            if (code == null) return;
            body.captcha_id = self.captcha.captchaId;
            body.captcha_code = code;
            // 重新走完整提交流程（PoW 需重新求解：上一枚 challenge 已被消费）
            self._continueSubmit(body, optimistic, ctx);
          });
          return;
        }
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
