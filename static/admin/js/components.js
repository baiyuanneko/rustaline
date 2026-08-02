// 通用 UI 组件。所有用户输入字符串均通过 textContent 渲染，杜绝 innerHTML 注入。
// 静态结构模板使用 DOM API 构造，不混入变量插值。

const ICONS = {
  ok: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`,
  err: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v.5M11 12h1v5h1"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  empty: `<svg viewBox="0 0 96 96" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 28h64l-6 44a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4L16 28z"/><path d="M32 28v-6a16 16 0 0 1 32 0v6"/><circle cx="38" cy="50" r="2" fill="currentColor"/><circle cx="58" cy="50" r="2" fill="currentColor"/></svg>`,
};

function svg(icon) {
  const wrap = document.createElement("span");
  wrap.style.display = "inline-flex";
  wrap.innerHTML = ICONS[icon] || "";
  return wrap.firstElementChild || wrap;
}

// ---- Toast ----
const TOAST_STACK_ID = "toast-stack";

export function toast({ type = "info", title = "", message = "", duration = 4000 } = {}) {
  const stack = document.getElementById(TOAST_STACK_ID);
  if (!stack) return;

  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "err" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "toast__icon";
  icon.appendChild(svg(type === "ok" ? "ok" : type === "err" ? "err" : type === "warn" ? "warn" : "info"));

  const body = document.createElement("div");
  body.className = "toast__body";
  if (title) {
    const t = document.createElement("div");
    t.className = "toast__title";
    t.textContent = title;
    body.appendChild(t);
  }
  if (message) {
    const m = document.createElement("div");
    m.className = "toast__msg";
    m.textContent = message;
    body.appendChild(m);
  }

  const close = document.createElement("button");
  close.className = "toast__close";
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.appendChild(svg("close"));

  el.appendChild(icon);
  el.appendChild(body);
  el.appendChild(close);

  stack.appendChild(el);

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    el.classList.add("toast--out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  };
  close.addEventListener("click", dismiss);
  if (duration > 0) timer = setTimeout(dismiss, duration);

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
  const el = document.createElement("span");
  const label =
    status === "approved" ? "已通过"
    : status === "pending" ? "待审核"
    : status === "spam" ? "垃圾"
    : status || "未知";
  el.className = `badge ${status ? `badge--${status}` : "badge--neutral"}`;
  el.textContent = label;
  return el;
}

// ---- Avatar ----
export function avatar(item) {
  // 优先级：qq_avatar > cravatar(mail) > 首字母圆形占位
  const wrap = document.createElement("span");
  wrap.className = "avatar";
  const src =
    (item && item.qq_avatar) ||
    (item && item.mail ? `https://cravatar.cn/avatar/${md5Like(item.mail.trim().toLowerCase())}?d=404&s=64` : "");
  if (src) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = src;
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.addEventListener("error", () => {
      wrap.classList.add("avatar--placeholder");
      img.remove();
      wrap.textContent = initial(item && item.nick);
    });
    wrap.appendChild(img);
  } else {
    wrap.classList.add("avatar--placeholder");
    wrap.textContent = initial(item && item.nick);
  }
  return wrap;
}

// 前端无法引入 md5（零依赖约束），用简化 hash 作为兜底；
// cravatar 的 d=404 回退 + img onerror 兜底首字母，确保总有头像。
// 若 mail 失败回退到首字母也接受——这是后端未给 avatar 字段时的兜底。
function md5Like(str) {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h2) + hex(h1);
}

function initial(nick) {
  if (!nick) return "?";
  const ch = String(nick).trim().charAt(0);
  return ch || "?";
}

// ---- 空状态 ----
export function emptyState({ title = "暂无数据", hint = "", icon = "empty" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "empty";

  const ico = document.createElement("span");
  ico.className = "empty__icon";
  ico.appendChild(svg(icon));

  const t = document.createElement("div");
  t.className = "empty__title";
  t.textContent = title;

  wrap.appendChild(ico);
  wrap.appendChild(t);
  if (hint) {
    const h = document.createElement("div");
    h.className = "empty__hint";
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

// ---- 加载占位 ----
export function loadingScreen(text = "加载中…") {
  const wrap = document.createElement("div");
  wrap.className = "loading-screen";
  const sp = document.createElement("span");
  sp.className = "spinner spinner--lg";
  const t = document.createElement("div");
  t.textContent = text;
  wrap.appendChild(sp);
  wrap.appendChild(t);
  return wrap;
}

export function tableSkeleton(rows = 6, cols = 5) {
  const wrap = document.createElement("div");
  wrap.className = "card__body card__body--flush";
  const table = document.createElement("table");
  table.className = "table";
  const tbody = document.createElement("tbody");
  for (let i = 0; i < rows; i++) {
    const tr = document.createElement("tr");
    for (let j = 0; j < cols; j++) {
      const td = document.createElement("td");
      const sk = document.createElement("div");
      sk.className = "skeleton";
      sk.style.height = "16px";
      sk.style.width = `${30 + Math.floor(Math.random() * 60)}%`;
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
  const wrap = document.createElement("div");
  wrap.className = "pagination";

  const totalPages = Math.max(1, Math.ceil(total / page_size));
  const cur = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (cur - 1) * page_size + 1;
  const to = Math.min(total, cur * page_size);

  const info = document.createElement("span");
  info.className = "pagination__info";
  info.textContent = total === 0 ? "无记录" : `${from}–${to} / 共 ${total} 条`;
  wrap.appendChild(info);

  const mkBtn = (label, opts = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "page-btn";
    if (opts.ellipsis) b.classList.add("page-btn--ellipsis");
    if (opts.active) b.classList.add("is-active");
    b.innerHTML = label;
    b.disabled = !!opts.disabled || opts.active;
    if (!opts.disabled && !opts.active && !opts.ellipsis) {
      b.addEventListener("click", () => onChange(opts.target));
    }
    return b;
  };

  wrap.appendChild(
    mkBtn(`<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M15 6l-6 6 6 6'/></svg>`, {
      disabled: cur === 1,
      target: cur - 1,
    })
  );

  const pages = pageList(cur, totalPages);
  for (const p of pages) {
    if (p === "...") {
      wrap.appendChild(mkBtn("…", { ellipsis: true }));
    } else {
      wrap.appendChild(mkBtn(String(p), { active: p === cur, target: p }));
    }
  }

  wrap.appendChild(
    mkBtn(`<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M9 6l6 6-6 6'/></svg>`, {
      disabled: cur === totalPages,
      target: cur + 1,
    })
  );

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
  bodyHtml = "",
  bodyText = "",
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const portal = document.getElementById("dialog-portal");
    if (!portal) {
      resolve(window.confirm(title)); // 兜底
      return;
    }
    portal.innerHTML = "";
    portal.hidden = false;

    const backdrop = document.createElement("div");
    backdrop.className = "dialog-portal__backdrop";

    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "dialog-title");

    const header = document.createElement("div");
    header.className = "dialog__header";
    const t = document.createElement("div");
    t.id = "dialog-title";
    t.className = "dialog__title";
    t.textContent = title;
    header.appendChild(t);

    const body = document.createElement("div");
    body.className = "dialog__body";
    if (bodyText) {
      const p = document.createElement("div");
      p.textContent = bodyText;
      body.appendChild(p);
    } else if (bodyHtml) {
      // 仅允许静态结构（无用户数据），仍以 textContent 拼装子节点
      body.appendChild(bodyHtml);
    }

    const footer = document.createElement("div");
    footer.className = "dialog__footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--ghost";
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = danger ? "btn btn--danger" : "btn btn--primary";
    confirmBtn.textContent = confirmText;

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);

    portal.appendChild(backdrop);
    portal.appendChild(dialog);

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      portal.innerHTML = "";
      portal.hidden = true;
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKey);

    cancelBtn.addEventListener("click", () => close(null));
    backdrop.addEventListener("click", () => close(null));
    confirmBtn.addEventListener("click", () => close("confirm"));
  });
}

export function closeDialog() {
  const portal = document.getElementById("dialog-portal");
  if (portal) {
    portal.innerHTML = "";
    portal.hidden = true;
  }
}

// ---- 详情抽屉 ----
export function openDrawer({ title = "详情", renderBody }) {
  const existing = document.querySelector(".detail");
  if (existing) existing.remove();
  const scrim = document.querySelector(".detail-scrim");
  if (scrim) scrim.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-portal__backdrop detail-scrim";
  backdrop.style.position = "fixed";
  backdrop.style.zIndex = "79";

  const drawer = document.createElement("aside");
  drawer.className = "detail";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");

  const header = document.createElement("div");
  header.className = "detail__header";
  const t = document.createElement("div");
  t.className = "detail__title";
  t.textContent = title;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn--ghost btn--sm";
  closeBtn.textContent = "关闭";

  header.appendChild(t);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "detail__body";
  body.appendChild(renderBody());

  drawer.appendChild(header);
  drawer.appendChild(body);
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  const close = () => {
    drawer.remove();
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  return { close, body };
}

// ---- 详情行 ----
export function detailRow(label, valueNode, mono = false) {
  const wrap = document.createElement("div");
  wrap.className = "detail__row";
  const lab = document.createElement("div");
  lab.className = "detail__label";
  lab.textContent = label;
  const val = document.createElement("div");
  val.className = `detail__value${mono ? " detail__value--mono" : ""}`;
  if (typeof valueNode === "string") {
    val.textContent = valueNode;
  } else if (valueNode instanceof Node) {
    val.appendChild(valueNode);
  }
  wrap.appendChild(lab);
  wrap.appendChild(val);
  return wrap;
}

// ---- 时间格式化 ----
// 服务端返回 UTC 朴素时间（NaiveDateTime，无时区后缀），必须按 UTC 解析，
// 否则 new Date() 会当作本地时间，导致东八区下偏差 8 小时
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

export { svg };
