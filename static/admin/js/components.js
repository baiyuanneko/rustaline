// 通用 UI 组件：基于 mdui 2 Web Components 的封装。
// 安全约定：所有用户输入字符串均通过 textContent / createTextNode 渲染。
// 静态 SVG 常量只允许出现在本文件的 ICONS 中，禁止拼接任何用户数据。

const ICONS = {
  ok: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`,
  err: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v.5M11 12h1v5h1"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  empty: `<svg viewBox="0 0 96 96" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 28h64l-6 44a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4L16 28z"/><path d="M32 28v-6a16 16 0 0 1 32 0v6"/><circle cx="38" cy="50" r="2" fill="currentColor"/><circle cx="58" cy="50" r="2" fill="currentColor"/></svg>`,
  'chevron-left': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>`,
  'chevron-right': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
};

/** 创建 mdui-icon，并使用项目内联 SVG，不加载 Material Icons 字体 */
export function icon(name) {
  const node = document.createElement("mdui-icon");
  node.setAttribute("aria-hidden", "true");
  const template = document.createElement("template");
  template.innerHTML = ICONS[name] || "";
  while (template.content.firstChild) {
    const child = template.content.firstChild;
    // mdui-icon 的 shadow css 有 ::slotted(svg){fill:currentcolor}，会覆盖 fill="none" 表现属性
    // 把描边图标的 fill 提为内联样式，防止渲染成实心色块
    if (child.nodeName?.toLowerCase() === "svg" && child.getAttribute("fill") === "none") {
      child.style.fill = "none";
    }
    node.appendChild(child);
  }
  return node;
}

export function svg(name) {
  return icon(name);
}

/**
 * 极简 DOM 构造助手。
 * - props.text 使用 textContent
 * - props.onXxx 绑定事件
 * - 其余 key 作为 DOM property 赋值（mdui 组件属性也可直接设置）
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class" || key === "className") {
        node.className = value;
      } else if (key === "text") {
        node.textContent = value;
      } else if (key === "style" && typeof value === "object") {
        Object.assign(node.style, value);
      } else if (key === "dataset" && typeof value === "object") {
        Object.assign(node.dataset, value);
      } else if (key === "attrs" && typeof value === "object") {
        for (const [ak, av] of Object.entries(value)) node.setAttribute(ak, av === true ? "" : av);
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        try {
          node[key] = value;
        } catch (_) {
          node.setAttribute(key, value === true ? "" : value);
        }
      }
    }
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(parent, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(parent, child);
    } else if (typeof child === "string" || typeof child === "number") {
      parent.appendChild(document.createTextNode(String(child)));
    } else {
      parent.appendChild(child);
    }
  }
  return parent;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

// ---- Toast / Snackbar ----
export function toast({ type = "info", title = "", message = "", duration = 4000 } = {}) {
  const snackbar = el("mdui-snackbar", {
    class: `toast toast--${type}`,
    placement: "bottom",
    autoCloseDelay: duration,
    closeable: false,
  });

  const iconNode = icon(type === "ok" ? "ok" : type === "err" ? "err" : type === "warn" ? "warn" : "info");
  iconNode.style.marginRight = "10px";
  iconNode.style.flex = "0 0 auto";
  if (type === "err") iconNode.style.color = "rgb(var(--mdui-color-error))";
  else if (type === "warn") iconNode.style.color = "#f59e0b";
  snackbar.appendChild(iconNode);

  const body = el("span", { style: { flex: "1 1 auto", minWidth: "0" } });
  if (title) {
    const t = el("strong", { text: title, style: { marginRight: "8px" } });
    body.appendChild(t);
  }
  if (message) body.appendChild(document.createTextNode(message));
  snackbar.appendChild(body);
  document.body.appendChild(snackbar);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    snackbar.open = false;
  };
  snackbar.addEventListener("closed", () => snackbar.remove(), { once: true });
  requestAnimationFrame(() => {
    if (!dismissed) snackbar.open = true;
  });
  return dismiss;
}

export function toastOk(title, message) {
  return toast({ type: "ok", title, message });
}
export function toastErr(title, message) {
  return toast({ type: "err", title, message, duration: 6000 });
}
export function toastInfo(title, message) {
  return toast({ type: "info", title, message });
}

// ---- Status Badge ----
export function badge(status) {
  const label =
    status === "approved" ? "已通过"
    : status === "pending" ? "待审核"
    : status === "spam" ? "垃圾"
    : status || "未知";
  const cls = ["approved", "pending", "spam"].includes(status) ? status : "neutral";
  return el("span", {
    class: `status-chip status-chip--${cls}`,
    text: label,
  });
}

// ---- Avatar ----
export function avatar(item) {
  const wrap = el("mdui-avatar", { class: "avatar" });
  // avatar 字段由服务端用真 MD5 推导（qq_avatar 优先），客户端不再对邮箱自行哈希；
  // d=404 让未注册 gravatar 的邮箱落到 onerror 首字母兜底
  const src =
    (item && item.qq_avatar) ||
    (item && item.avatar ? `${item.avatar}?d=404&s=64` : "");
  const fallback = () => {
    wrap.replaceChildren();
    wrap.textContent = initial(item && item.nick);
  };
  if (src) {
    const img = el("img", {
      src,
      alt: "",
      referrerPolicy: "no-referrer",
      decoding: "async",
      onError: fallback,
    });
    wrap.appendChild(img);
  } else {
    fallback();
  }
  return wrap;
}

function initial(nick) {
  if (!nick) return "?";
  const ch = String(nick).trim().charAt(0);
  return ch || "?";
}

// ---- 空状态 ----
export function emptyState({ title = "暂无数据", hint = "", icon: iconName = "empty" } = {}) {
  const wrap = el("div", { class: "empty" });
  const ico = el("div", { class: "empty__icon" }, icon(iconName));
  const t = el("div", { class: "empty__title", text: title });
  wrap.appendChild(ico);
  wrap.appendChild(t);
  if (hint) wrap.appendChild(el("div", { class: "empty__hint", text: hint }));
  return wrap;
}

// ---- 加载占位 ----
export function loadingScreen(text = "加载中…") {
  return el(
    "div",
    { class: "loading-screen" },
    el("mdui-circular-progress"),
    el("div", { text })
  );
}

export function tableSkeleton(rows = 6, cols = 5) {
  const wrap = el("div", { class: "mdui-table skeleton-table page-card__body" });
  const table = el("table");
  const tbody = el("tbody");
  for (let i = 0; i < rows; i++) {
    const tr = el("tr");
    for (let j = 0; j < cols; j++) {
      const td = el("td");
      const sk = el("div", {
        class: "skeleton",
        style: { width: `${30 + Math.floor(Math.random() * 60)}%` },
      });
      td.appendChild(sk);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ---- 分页条 ----
export function pagination({ page, page_size, total, onChange }) {
  const wrap = el("div", { class: "pagination" });
  const totalPages = Math.max(1, Math.ceil(total / page_size));
  const cur = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (cur - 1) * page_size + 1;
  const to = Math.min(total, cur * page_size);

  wrap.appendChild(el("span", { class: "pagination__info", text: total === 0 ? "无记录" : `${from}–${to} / 共 ${total} 条` }));

  const prev = el("mdui-button-icon", {
    disabled: cur === 1,
    attrs: { "aria-label": "上一页" },
    onClick: () => onChange(cur - 1),
  }, icon("chevron-left"));
  wrap.appendChild(prev);

  for (const p of pageList(cur, totalPages)) {
    if (p === "...") {
      wrap.appendChild(el("mdui-button", { class: "page-btn page-btn--ellipsis", variant: "text", text: "…" }));
    } else {
      wrap.appendChild(
        el("mdui-button", {
          class: "page-btn",
          variant: p === cur ? "filled" : "text",
          text: String(p),
          onClick: () => onChange(p),
        })
      );
    }
  }

  const next = el("mdui-button-icon", {
    disabled: cur === totalPages,
    attrs: { "aria-label": "下一页" },
    onClick: () => onChange(cur + 1),
  }, icon("chevron-right"));
  wrap.appendChild(next);
  return wrap;
}

function pageList(cur, total) {
  const out = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) out.push(i);
    return out;
  }
  out.push(1);
  if (cur > 3) out.push("...");
  const start = Math.max(2, cur - 1);
  const end = Math.min(total - 1, cur + 1);
  for (let i = start; i <= end; i++) out.push(i);
  if (cur < total - 2) out.push("...");
  out.push(total);
  return out;
}

// ---- 确认对话框 ----
export function confirmDialog({
  title = "确认操作",
  bodyText = "",
  bodyNode = null,
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const dialog = el("mdui-dialog", {
      headline: title,
      closeOnEsc: true,
      closeOnOverlayClick: true,
      stackedActions: true,
    });

    if (bodyNode) {
      dialog.appendChild(bodyNode);
    } else if (bodyText) {
      dialog.appendChild(el("div", { text: bodyText }));
    }

    let result = null;
    const cancel = el("mdui-button", {
      slot: "action",
      variant: "text",
      text: cancelText,
      onClick: () => {
        result = null;
        dialog.open = false;
      },
    });
    const confirm = el("mdui-button", {
      slot: "action",
      variant: "filled",
      class: danger ? "btn-danger" : "",
      text: confirmText,
      onClick: () => {
        result = "confirm";
        dialog.open = false;
      },
    });
    dialog.append(cancel, confirm);

    dialog.addEventListener("closed", () => {
      dialog.remove();
      resolve(result);
    }, { once: true });

    document.body.appendChild(dialog);
    requestAnimationFrame(() => {
      dialog.open = true;
    });
  });
}

// ---- 详情对话框 ----
export function openDetailDialog({ title = "详情", renderBody }) {
  const dialog = el("mdui-dialog", {
    class: "detail",
    headline: title,
    closeOnEsc: true,
    closeOnOverlayClick: true,
  });
  const body = el("div", { class: "detail__body" });
  body.appendChild(renderBody());
  dialog.appendChild(body);

  dialog.addEventListener("closed", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  requestAnimationFrame(() => {
    dialog.open = true;
  });
  return {
    close: () => {
      dialog.open = false;
    },
    body,
  };
}

// ---- 详情行 ----
export function detailRow(label, valueNode, mono = false) {
  const wrap = el("div", { class: "detail__row" });
  wrap.appendChild(el("div", { class: "detail__label", text: label }));
  const val = el("div", { class: `detail__value${mono ? " detail__value--mono" : ""}` });
  if (typeof valueNode === "string" || typeof valueNode === "number") {
    val.textContent = valueNode;
  } else if (valueNode instanceof Node) {
    val.appendChild(valueNode);
  }
  wrap.appendChild(val);
  return wrap;
}

// ---- 时间格式化 ----
function parseServerTime(input) {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(input)) {
    return new Date(input + "Z");
  }
  return typeof input === "string" ? new Date(input) : input;
}

export function formatTime(input) {
  if (!input) return "—";
  try {
    const d = parseServerTime(input);
    if (isNaN(d.getTime())) return String(input);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) {
    return String(input);
  }
}

export function formatRelative(input) {
  if (!input) return "";
  const d = parseServerTime(input);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  if (sec < 2592000) return `${Math.floor(sec / 86400)} 天前`;
  return formatTime(input);
}
