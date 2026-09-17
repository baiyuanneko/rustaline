// 极简 Markdown 子集渲染 → DocumentFragment（纯 DOM 构建，无 HTML 字符串解析）。
// 支持：`code`、[链接](url)、![图片](url)（渲染为带图标的链接，点击弹模态框看图）、
// **粗体**、*斜体*、~~删除线~~；URL 仅接受 http(s)，非法 / 未闭合语法一律按原文纯文本。
// 注意：与 static/sdk/rustaline.js 中的 renderMarkdown 保持同构同步
// （SDK 受单文件零依赖约束无法 import 本模块；模态框实现两端各自就地取材）。

function safeLinkUrl(link) {
  if (!link) return null;
  const s = String(link).trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

const MD_RE_SOURCE =
  '`([^`]+)`' +                        // 1: 行内代码
  '|!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)' +    // 2,3: 图片（以链接形式渲染）
  '|\\[([^\\]]+)\\]\\(([^)\\s]+)\\)' +     // 4,5: 链接
  '|\\*\\*((?:[^*]|\\*(?!\\*))+)\\*\\*' +  // 6: 粗体（内部允许单个 *，便于嵌斜体/链接）
  '|(?<!\\*)\\*(?!\\*)([^*]+?)(?<!\\*)\\*(?!\\*)' + // 7: 斜体（两侧不得再贴 *，防 **未闭合 误判）
  '|~~([^~]+)~~';                        // 8: 删除线

// 图片链接前置图标（静态 SVG 常量，固定写死，不拼任何用户数据）
const MD_IMAGE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'style="vertical-align:-0.15em;margin-right:3px" aria-hidden="true">' +
  '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/>' +
  '<path d="m21 15-3.5-3.5a1.5 1.5 0 0 0-2 0L6 21"/></svg>';

// 图片查看框关闭按钮图标（同上，静态常量）
const MD_CLOSE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
  'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M6 6l12 12M18 6L6 18"/></svg>';

function svgIcon(svgHtml) {
  const template = document.createElement("template");
  template.innerHTML = svgHtml;
  return template.content.firstChild;
}

function mdImageIcon() {
  return svgIcon(MD_IMAGE_ICON);
}

/** 文本链接点击涟漪（宿主需 position:relative; clip-path:inset(0)，见 admin.css .rs-md-link） */
function spawnRipple(anchor, e) {
  const rect = anchor.getBoundingClientRect();
  const d = Math.max(rect.width, rect.height) * 2;
  // 去重 + 定时兜底：animationend 在后台标签页会暂停，不清理会永久残留堆积
  const old = anchor.querySelector(".rs-ripple");
  if (old) old.remove();
  const dot = document.createElement("span");
  dot.className = "rs-ripple";
  dot.style.width = dot.style.height = `${d}px`;
  dot.style.left = `${e.clientX - rect.left - d / 2}px`;
  dot.style.top = `${e.clientY - rect.top - d / 2}px`;
  anchor.appendChild(dot);
  dot.addEventListener("animationend", () => dot.remove(), { once: true });
  setTimeout(() => { if (dot.parentNode) dot.remove(); }, 900);
}

/**
 * 外链离开确认模态框（mdui-dialog）：文本链接点击后不再直接跳转，先确认再新标签打开。
 * 文案走 i18n（labels.linkConfirm*），url 已过 safeLinkUrl（仅 http/https）。
 */
function showLinkConfirmModal(url, labels) {
  // 单例守卫：连发 click（长按松开等）不得叠出多个对话框
  document.querySelectorAll("mdui-dialog.link-confirm").forEach((d) => d.remove());
  const dialog = document.createElement("mdui-dialog");
  dialog.className = "link-confirm";
  dialog.closeOnEsc = true;
  dialog.closeOnOverlayClick = true;
  dialog.headline = (labels && labels.linkConfirmTitle) || "Open external link?";

  const body = document.createElement("div");
  body.className = "link-confirm__body";
  const text = document.createElement("div");
  text.className = "link-confirm__text";
  text.textContent = (labels && labels.linkConfirmText) || "The external link will open in a new tab. Continue?";
  const urlLine = document.createElement("div");
  urlLine.className = "link-confirm__url";
  urlLine.textContent = url;
  body.appendChild(text);
  body.appendChild(urlLine);

  const cancel = document.createElement("mdui-button");
  cancel.slot = "action";
  cancel.variant = "text";
  cancel.textContent = (labels && labels.linkConfirmCancel) || "Cancel";
  cancel.addEventListener("click", () => { dialog.open = false; });

  const proceed = document.createElement("mdui-button");
  proceed.slot = "action";
  proceed.variant = "filled";
  proceed.textContent = (labels && labels.linkConfirmProceed) || "Continue";
  proceed.addEventListener("click", () => {
    const w = window.open(url, "_blank", "noopener");
    if (w) w.opener = null;
    dialog.open = false;
  });

  dialog.appendChild(body);
  dialog.appendChild(cancel);
  dialog.appendChild(proceed);
  dialog.addEventListener("closed", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  requestAnimationFrame(() => { dialog.open = true; });
}

/**
 * 图片查看模态框（mdui-dialog）。安全：url 已过 safeLinkUrl（仅 http/https）；
 * img 上下文不执行脚本（含 SVG）；no-referrer 防泄露；alt / 错误文案一律 textContent。
 */
function showImageModal(url, label, errorText, closeLabel) {
  const dialog = document.createElement("mdui-dialog");
  dialog.className = "image-viewer";
  dialog.closeOnEsc = true;
  dialog.closeOnOverlayClick = true;
  if (label) dialog.headline = label;

  const close = () => {
    dialog.open = false;
  };

  // 右上角关闭按钮（挂在相对定位容器上，图片加载失败时也不消失）
  const wrap = document.createElement("div");
  wrap.className = "image-viewer__wrap";
  const closeBtn = document.createElement("mdui-button-icon");
  closeBtn.className = "image-viewer__close";
  closeBtn.setAttribute("aria-label", closeLabel || "Close");
  closeBtn.appendChild(svgIcon(MD_CLOSE_ICON));
  closeBtn.addEventListener("click", close);

  const img = document.createElement("img");
  img.className = "image-viewer__img";
  img.src = url;
  img.alt = label || "";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    // 加载失败：换成错误文案 + 原始链接（仍允许用户自行新标签打开）
    const tip = document.createElement("div");
    tip.className = "image-viewer__error";
    tip.textContent = errorText || "Failed to load image:";
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener nofollow ugc";
    a.textContent = url;
    tip.appendChild(document.createTextNode(" "));
    tip.appendChild(a);
    img.replaceWith(tip);
  };
  wrap.appendChild(img);
  wrap.appendChild(closeBtn);
  dialog.appendChild(wrap);

  dialog.addEventListener("closed", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  requestAnimationFrame(() => {
    dialog.open = true;
  });
}

/**
 * @param {string} text 评论原文
 * @param {{ image?: string, imageError?: string, close?: string }} labels 图片链接兜底文字 / 加载失败文案 / 关闭按钮 aria
 * @param {number} [depth] 内部递归深度（外部调用勿传）
 * @returns {DocumentFragment}
 */
export function renderMarkdown(text, labels, depth) {
  const frag = document.createDocumentFragment();
  const src = String(text == null ? "" : text);
  const imageLabel = (labels && labels.image) || "image";
  // 每次调用用新正则实例：避免递归调用共享 lastIndex 互相踩位
  const re = new RegExp(MD_RE_SOURCE, "g");
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(src.slice(last, m.index)));
    if (m[1] !== undefined) {
      const code = document.createElement("code");
      code.textContent = m[1];
      frag.appendChild(code);
    } else if (m[2] !== undefined || m[4] !== undefined) {
      const isImg = m[2] !== undefined;
      const label = isImg ? m[2] || imageLabel : m[4];
      const safe = safeLinkUrl(isImg ? m[3] : m[5]);
      if (safe) {
        const a = document.createElement("a");
        a.href = safe;
        a.target = "_blank";
        a.rel = "noopener nofollow ugc";
        if (isImg) {
          a.className = "rs-md-image";
          a.appendChild(mdImageIcon());
          a.addEventListener("click", (e) => {
            e.preventDefault();
            showImageModal(safe, label, labels && labels.imageError, labels && labels.close);
          });
        } else {
          // 文本链接：按下即涟漪，点击弹确认模态框，不直接跳转；禁掉原生拖拽 ghost
          a.classList.add("rs-md-link");
          a.addEventListener("pointerdown", (e) => {
            spawnRipple(a, e);
          });
          a.addEventListener("click", (e) => {
            e.preventDefault();
            showLinkConfirmModal(safe, labels);
          });
          a.addEventListener("dragstart", (e) => {
            e.preventDefault();
          });
        }
        a.appendChild(document.createTextNode(label));
        frag.appendChild(a);
      } else {
        frag.appendChild(document.createTextNode(m[0])); // 非法 URL：整段原文
      }
    } else if (m[6] !== undefined || m[7] !== undefined || m[8] !== undefined) {
      const tag = m[6] !== undefined ? "strong" : m[7] !== undefined ? "em" : "del";
      const inner = m[6] !== undefined ? m[6] : m[7] !== undefined ? m[7] : m[8];
      const node = document.createElement(tag);
      if (!depth) node.appendChild(renderMarkdown(inner, labels, 1));
      else node.textContent = inner;
      frag.appendChild(node);
    }
    last = re.lastIndex;
  }
  if (last < src.length) frag.appendChild(document.createTextNode(src.slice(last)));
  return frag;
}
