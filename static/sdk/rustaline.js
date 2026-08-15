/*!
 * rustaline.js — 无依赖、原生 ES2018+ 评论组件库（Valine 自托管替代品）
 *
 * 用法：
 *   <script src="/sdk/rustaline.js"></script>
 *   <script>new Rustaline({ el: '#comments' });</script>
 *
 * 支持同页面多实例：每个实例拥有独立的 el/server/url 配置与内部状态。
 *
 * 视觉：内置 Material 3 设计令牌，零依赖单文件，不加载任何 webfont。
 *
 * 安全：所有用户输入一律以 textContent / createTextNode 渲染，绝不 innerHTML 拼接；
 *       link 字段严格校验仅允许 http(s):// 前缀，否则降级为纯文本展示。
 *
 * 接口契约（详见 .sisyphus/plans/valine-replacement.md §3.1）：
 *   GET  {server}/api/v1/comments?url=<encoded>  →  { count, results: [Comment] }
 *   POST {server}/api/v1/comments                →  Comment（创建后的）
 *   Comment 字段：{ id, comment, nick, link, avatar, url, pid, rid, inserted_at }
 *
 * 全局只挂 window.Rustaline，不污染其他名字空间。
 */
(function (global, factory) {
  'use strict';

  if (global.Rustaline) return; // 防重复加载

  // ===== 默认配置 ============================================================

  var DEFAULTS = {
    el: '#rustaline',                                  // 挂载点（选择器或元素）
    server: '',                                        // 后端基地址，'' = 同源
    url: '',                                           // 文章标识，'' = location.pathname
    placeholder: '说点什么吧… 千万别留下垃圾评论',
    gravatarCdn: 'https://cravatar.cn/avatar/',        // 头像 CDN，可换 https://gravatar.com/avatar/
    lang: {
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
      commentRequired: '请填写评论内容',
      commentTooLong: '评论内容过长（上限 10000 字）',
      errNetwork: '网络错误，请稍后再试',
      errRate: '操作太频繁，请稍后再试',
      errGeneric: '发表失败，请稍后再试'
    }
  };

  // ===== 注入样式（一次性，加 rs- 前缀防污染）================================

  var STYLE_TEXT = `
/* ===== Material 3 视觉令牌（SDK 内置，零依赖，不加载任何字体） ===== */
.rs-root, .rs-root * { box-sizing: border-box; }

.rs-root {
  --rs-primary: #b45309;
  --rs-on-primary: #ffffff;
  --rs-primary-container: #ffdcc2;
  --rs-on-primary-container: #311300;
  --rs-surface: #fdf8f4;
  --rs-surface-container-lowest: #ffffff;
  --rs-surface-container-low: #f8f3ee;
  --rs-surface-container: #f3ece5;
  --rs-surface-container-high: #eee4db;
  --rs-on-surface: #201a17;
  --rs-on-surface-variant: #57534e;
  --rs-outline: #85736a;
  --rs-outline-variant: #d8ccc2;
  --rs-error: #ba1a1a;
  --rs-error-container: #ffdad6;
  --rs-on-error-container: #410002;
  --rs-font: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui,
             -apple-system, 'Segoe UI', Roboto, sans-serif;
  --rs-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  --rs-radius: 16px;
  --rs-radius-sm: 12px;
  --rs-radius-xs: 8px;
  --rs-gap: 14px;
  --rs-font-size: 14px;
  --rs-line-height: 1.7;
  --rs-avatar-size: 40px;
  --rs-elevation-1: 0 1px 2px rgba(32, 26, 23, 0.08), 0 1px 3px 1px rgba(32, 26, 23, 0.06);
  --rs-elevation-2: 0 2px 6px 2px rgba(32, 26, 23, 0.10);

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
.rs-comment__content {
  font-size: var(--rs-font-size);
  line-height: var(--rs-line-height);
  color: var(--rs-on-surface);
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: pre-wrap; /* 保留换行；textContent 天然防 XSS */
  margin: 2px 0 8px;
}
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

/* ---- 深色模式 ---- */
@media (prefers-color-scheme: dark) {
  .rs-root {
    --rs-primary: #ffb77c;
    --rs-on-primary: #502400;
    --rs-primary-container: #733800;
    --rs-on-primary-container: #ffdcc2;
    --rs-surface: #171310;
    --rs-surface-container-lowest: #0f0c0a;
    --rs-surface-container-low: #201a17;
    --rs-surface-container: #251e1a;
    --rs-surface-container-high: #302720;
    --rs-on-surface: #ede0d9;
    --rs-on-surface-variant: #d8ccc2;
    --rs-outline: #a08d84;
    --rs-outline-variant: #57534e;
    --rs-error: #ffb4ab;
    --rs-error-container: #93000a;
    --rs-on-error-container: #ffdad6;
    --rs-elevation-1: 0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 3px 1px rgba(0, 0, 0, 0.30);
    --rs-elevation-2: 0 2px 6px 2px rgba(0, 0, 0, 0.45);
  }
}

/* ---- 移动端 ---- */
@media (max-width: 560px) {
  .rs-root { margin: 16px 0; padding: 16px; font-size: 13.5px; }
  .rs-form__meta-row { grid-template-columns: 1fr; }
  .rs-comment__children { padding-left: calc(var(--rs-avatar-size) + 6px); }
  .rs-comment__children::before { left: calc((var(--rs-avatar-size) + 6px) / 2); }
  .rs-comment__children > .rs-comment::before { left: calc(-1 * ((var(--rs-avatar-size) + 6px) / 2)); }
}

`;

  var STYLE_ID = 'rs-style-injected';

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
      'font-family="PingFang SC, Microsoft YaHei, sans-serif" ' +
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
  function resolveAvatar(avatar, nick, server, gravatarCdn) {
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
    return defaultAvatar(nick || '匿名');
  }

  /** 校验 link 字段：仅允许 http(s):// 前缀，防 javascript: 等协议 */
  function safeLinkUrl(link) {
    if (!link) return null;
    var s = String(link).trim();
    if (/^https?:\/\//i.test(s)) return s;
    return null;
  }

  /** 简易邮箱校验（与服务端宽松对齐，最终以服务端为准） */
  function looksLikeMail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }

  /**
   * 相对时间（中文）：
   *   < 60s    刚刚
   *   < 60min  x 分钟前
   *   < 24h    x 小时前
   *   < 30d    x 天前
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

  function formatRelativeTime(iso) {
    if (!iso) return '';
    var t = parseServerTime(iso).getTime();
    if (isNaN(t)) return String(iso).slice(0, 16).replace('T', ' ');
    var diff = (Date.now() - t) / 1000;
    if (diff < 0) return String(iso).slice(0, 16).replace('T', ' '); // 未来时间，退化
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
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

    this.el = resolveEl(this.opts.el);
    this.el.classList.add('rs-root');

    // 内部状态
    this.state = {
      loading: true,
      error: null,
      comments: [],        // 服务端返回的扁平列表
      count: 0,
      replyTo: null,       // 当前回复目标 comment 对象；null = 顶级
      submitting: false,
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

  Rustaline.prototype._fetchComments = function () {
    var self = this;
    this.state.loading = true;
    this.state.error = null;
    this._render();

    var url = this._apiBase() + '?url=' + encodeURIComponent(this.opts.url);
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        // 兼容 {count, results:[]} 与裸数组 [] 两种形态
        var list = data && Array.isArray(data.results) ? data.results
                 : Array.isArray(data) ? data
                 : (data && Array.isArray(data.items) ? data.items : []);
        var count = (data && typeof data.count === 'number') ? data.count
                  : (data && typeof data.total === 'number') ? data.total
                  : list.length;
        self.state.comments = list.map(normalizeComment);
        self.state.count = count;
        self.state.loading = false;
        self._render();
      })
      .catch(function (err) {
        self.state.loading = false;
        self.state.error = (err && err.message) || String(err);
        self._render();
      });
  };

  function normalizeComment(c) {
    return {
      id: String(c.id != null ? c.id : ''),
      comment: String(c.comment != null ? c.comment : ''),
      nick: String(c.nick != null && c.nick !== '' ? c.nick : '匿名'),
      link: c.link != null ? String(c.link) : null,
      avatar: c.avatar != null ? String(c.avatar) : null,
      url: String(c.url != null ? c.url : ''),
      pid: c.pid != null && c.pid !== '' ? String(c.pid) : null,
      rid: c.rid != null && c.rid !== '' ? String(c.rid) : null,
      inserted_at: c.inserted_at != null ? String(c.inserted_at) : null
    };
  }

  // ---- 渲染层 ----

  Rustaline.prototype._render = function () {
    var self = this;
    var root = this.el;
    root.innerHTML = ''; // 清空结构（仅清自身，不涉及用户数据）
    root.setAttribute('data-rs-state', this.state.loading ? 'loading'
      : this.state.error ? 'error' : 'ready');

    // 校验 replyTo 仍在列表中：刷新后若目标评论已不在（被删/被审/换页），丢弃以免表单消失
    if (this.state.replyTo) {
      var stillThere = false;
      for (var i = 0; i < this.state.comments.length; i++) {
        if (this.state.comments[i].id === this.state.replyTo.id) { stillThere = true; break; }
      }
      if (!stillThere) this.state.replyTo = null;
    }

    // 计数头
    root.appendChild(h('div', { class: 'rs-count' },
      h('span', { class: 'rs-count__num', text: String(this.state.count) }),
      h('span', { text: '评论' }),
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
    }
  };

  Rustaline.prototype._buildForm = function () {
    var self = this;
    var lang = this.opts.lang;
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
    var hint = h('span', { class: 'rs-form__hint' },
      '支持 Markdown 链接 [文字](https://...)；昵称邮箱将记住在本机'
    );
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
      h('div', { text: this.opts.lang.error }),
      h('button', {
        type: 'button', class: 'rs-btn rs-btn--ghost',
        style: { marginTop: '12px' },
        text: this.opts.lang.retry,
        onclick: function () { self._fetchComments(); }
      })
    );
  };

  Rustaline.prototype._buildEmpty = function () {
    return h('div', { class: 'rs-status' },
      h('span', { class: 'rs-status__icon', html: ICON_EMPTY }),
      h('div', { text: this.opts.lang.empty })
    );
  };

  /** 由扁平列表构造根→子树，返回根评论数组（每项附带 children 数组） */
  Rustaline.prototype._buildTree = function () {
    var all = this.state.comments;
    var byId = Object.create(null);
    var roots = [];

    // 第一遍：构造节点
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      byId[c.id] = { node: c, children: [] };
    }
    // 第二遍：挂载子节点
    for (var j = 0; j < all.length; j++) {
      var c2 = all[j];
      if (c2.pid && byId[c2.pid]) {
        byId[c2.pid].children.push(byId[c2.id]);
      } else {
        roots.push(byId[c2.id]);
      }
    }
    // 服务端按 inserted_at 升序，扁平已天然有序；保险起见再排一次
    roots.sort(byInsertedAsc);
    for (var k in byId) {
      if (Object.prototype.hasOwnProperty.call(byId, k)) {
        byId[k].children.sort(byInsertedAsc);
      }
    }
    return roots;
  };

  function byInsertedAsc(a, b) {
    var ta = a.node.inserted_at ? Date.parse(a.node.inserted_at) : 0;
    var tb = b.node.inserted_at ? Date.parse(b.node.inserted_at) : 0;
    if (isNaN(ta)) ta = 0;
    if (isNaN(tb)) tb = 0;
    return ta - tb;
  }

  Rustaline.prototype._buildList = function () {
    var roots = this._buildTree();
    if (roots.length === 0) return this._buildEmpty();

    // 预建 id → nick 映射，用于回复时 @ 被回复者
    var nickOf = Object.create(null);
    for (var i = 0; i < this.state.comments.length; i++) {
      var c = this.state.comments[i];
      nickOf[c.id] = c.nick;
    }

    var ul = h('ul', { class: 'rs-list' });
    for (var r = 0; r < roots.length; r++) {
      ul.appendChild(this._renderCommentNode(roots[r], null, nickOf));
    }
    return ul;
  };

  Rustaline.prototype._renderCommentNode = function (entry, parentEntry, nickOf) {
    var self = this;
    var c = entry.node;
    var server = this.opts.server;
    var gravatarCdn = this.opts.gravatarCdn;

    // 头像
    var avatarSrc = resolveAvatar(c.avatar, c.nick, server, gravatarCdn);
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
      text: formatRelativeTime(c.inserted_at)
    }));

    // 内容
    var contentChildren = [];
    // 回复片段：如果该评论有 pid（即回复），且被回复的不是直接的父（即楼中楼跨层），显示 @目标
    // 简化：所有回复都显示 @被回复者昵称（pid 指向的对象）；如果 pid 即为父节点，则不重复显示
    if (c.pid && parentEntry && c.pid !== parentEntry.node.id && nickOf[c.pid]) {
      contentChildren.push(h('span', { class: 'rs-reply-snip' },
        '@', h('strong', { text: nickOf[c.pid] }), ' '
      ));
    }
    contentChildren.push(document.createTextNode(c.comment || ''));

    // 操作：回复按钮
    var actions = h('div', { class: 'rs-comment__actions' },
      h('button', {
        type: 'button', class: 'rs-reply-btn',
        text: this.opts.lang.reply,
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

    // 子评论
    if (entry.children.length > 0) {
      var childUl = h('ul', { class: 'rs-comment__children' });
      for (var i = 0; i < entry.children.length; i++) {
        childUl.appendChild(this._renderCommentNode(entry.children[i], entry, nickOf));
      }
      li.appendChild(childUl);
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
    var lang = this.opts.lang;

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
    if (mail && !looksLikeMail(mail)) return this._showFormError(form, '邮箱格式不正确');
    var safeLink = link ? safeLinkUrl(link) : null;
    if (link && !safeLink) return this._showFormError(form, '网址必须以 http:// 或 https:// 开头');

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

    // 乐观插入：临时构造一个本地评论对象追加到 state.comments，
    // 服务端返回后用真实数据替换；后台刷新失败则保留乐观插入（避免用户输入丢失感）。
    var optimistic = {
      id: '__optimistic_' + (++OPTIMISTIC_SEQ),
      comment: comment,
      nick: nick || '匿名',
      link: safeLink || null,
      avatar: null,                       // 让 resolveAvatar 退到默认头像
      url: this.opts.url,
      pid: body.pid || null,
      rid: body.rid || null,
      inserted_at: new Date().toISOString(),
      _optimistic: true
    };

    var optimisticInserted = false;
    function rollbackOptimistic() {
      if (!optimisticInserted) return;
      var idx = self.state.comments.indexOf(optimistic);
      if (idx >= 0) self.state.comments.splice(idx, 1);
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

    // 乐观插入并立刻重渲染（让用户看到自己的评论）
    this.state.comments.push(optimistic);
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
        var real = normalizeComment(created);
        // 用真实评论替换乐观占位（保持位置：直接替换数组项）
        var idx = self.state.comments.indexOf(optimistic);
        if (idx >= 0) {
          self.state.comments[idx] = real;
        } else {
          self.state.comments.push(real);
        }
        self.state.submitting = false;
        self._render();
        // 后台静默刷新对齐（避免 count/排序漂移）
        setTimeout(function () { self._fetchComments(); }, 400);
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

  /** 销毁实例：清空挂载点 */
  Rustaline.prototype.destroy = function () {
    this.el.innerHTML = '';
    this.el.classList.remove('rs-root');
    this.el.removeAttribute('data-rs-state');
    this.state.comments = [];
  };

  global.Rustaline = Rustaline;

  // 暴露工具函数到 Rustaline.util 便于二次开发（可选）
  Rustaline.util = {
    formatRelativeTime: formatRelativeTime,
    defaultAvatar: defaultAvatar,
    hashString: hashString
  };
})(typeof window !== 'undefined' ? window : this);
