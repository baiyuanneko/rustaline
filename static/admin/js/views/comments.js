import {
  fetchComments,
  fetchStats,
  patchComment,
  deleteComment,
} from "../api.js";
import { renderMarkdown } from "../markdown.js";
import {
  badge,
  avatar,
  pagination,
  emptyState,
  tableSkeleton,
  toastOk,
  toastErr,
  confirmDialog,
  openDetailDialog,
  detailRow,
  formatTime,
  formatRelative,
  el,
} from "../components.js";
import { forceRefreshBadge } from "../app.js";
import { t } from "../i18n.js";

const PAGE_SIZE = 20;
const STATUSES = [
  { value: "", labelKey: "filter.allStatus" },
  { value: "approved", labelKey: "status.approved" },
  { value: "pending", labelKey: "status.pending" },
  { value: "spam", labelKey: "status.spam" },
];

const state = {
  status: "",
  url: "",
  keyword: "",
  from: "",
  page: 1,
  urlOptions: [],
};

let tableHost = null;
let urlFilter = null;
let urlDocListener = null;

export async function render(container) {
  applyHashQuery();

  container.appendChild(pageHead());
  container.appendChild(buildFilters());

  tableHost = el("div", { class: "section" });
  container.appendChild(tableHost);

  // URL 选项在打开下拉时才渲染，这里只需缓存数据
  loadUrlOptions().then((opts) => {
    state.urlOptions = opts;
  });

  await loadList(tableHost);
}

function pageHead() {
  const head = el("div", { class: "page-head" });
  const titles = el("div", { class: "page-head__titles" });
  titles.appendChild(el("h1", { class: "page-title", text: t("comments.title") }));
  titles.appendChild(el("div", { class: "page-subtitle", text: t("comments.subtitle") }));
  head.appendChild(titles);
  return head;
}

function applyHashQuery() {
  // state 是模块级对象、跨视图挂载存活；每次从 hash 进入都先归零，
  // 避免上次访问的过滤条件（如仪表盘卡片带入的 from）残留串味
  state.status = "";
  state.url = "";
  state.keyword = "";
  state.from = "";
  state.page = 1;
  const m = (location.hash || "").match(/\?(.+)$/);
  if (!m) return;
  const params = new URLSearchParams(m[1]);
  if (params.has("status")) state.status = params.get("status") || "";
  if (params.has("url")) state.url = params.get("url") || "";
  if (params.has("keyword")) state.keyword = params.get("keyword") || "";
  if (params.has("from")) state.from = params.get("from") || "";
  if (params.has("page")) state.page = Number(params.get("page")) || 1;
  history.replaceState(null, "", "#/comments");
}

function buildFilters() {
  const wrap = el("div", { class: "filters" });

  const statusSel = el("mdui-select", { id: "filter-status", label: t("filter.status"), variant: "filled" });
  STATUSES.forEach((s) => {
    statusSel.appendChild(menuItem(s.value, t(s.labelKey)));
  });
  statusSel.value = state.status;
  statusSel.addEventListener("change", () => {
    state.status = statusSel.value;
    state.page = 1;
    reload();
  });
  wrap.appendChild(statusSel);

  const urlSel = buildUrlFilter();
  wrap.appendChild(urlSel);

  const kwInput = el("mdui-text-field", {
    id: "filter-keyword",
    label: t("filter.keyword"),
    variant: "filled",
    type: "search",
    placeholder: t("filter.keywordPlaceholder"),
    value: state.keyword,
  });
  kwInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.keyword = String(kwInput.value || "").trim();
      state.page = 1;
      reload();
    }
  });
  wrap.appendChild(kwInput);

  // 起始日期（UTC 口径，YYYY-MM-DD）：仪表盘「今日新增」卡片跳转时由 hash 带入
  const fromInput = el("mdui-text-field", {
    id: "filter-from",
    label: t("filter.from"),
    variant: "filled",
    type: "date",
    value: state.from,
  });
  fromInput.addEventListener("change", () => {
    state.from = String(fromInput.value || "");
    state.page = 1;
    reload();
  });
  wrap.appendChild(fromInput);

  const searchBtn = el("mdui-button", { variant: "filled", text: t("filter.search") });
  searchBtn.addEventListener("click", () => {
    state.keyword = String(kwInput.value || "").trim();
    state.page = 1;
    reload();
  });
  wrap.appendChild(searchBtn);

  const resetBtn = el("mdui-button", { variant: "outlined", text: t("filter.reset") });
  resetBtn.addEventListener("click", () => {
    state.status = "";
    state.url = "";
    state.keyword = "";
    state.from = "";
    state.page = 1;
    statusSel.value = "";
    if (urlFilter) urlFilter.input.value = "";
    kwInput.value = "";
    fromInput.value = "";
    reload();
  });
  wrap.appendChild(resetBtn);
  return wrap;
}

function menuItem(value, text) {
  const item = el("mdui-menu-item", { value });
  item.textContent = text;
  return item;
}

// URL 筛选：mdui-select 不支持搜索且长列表体验差，
// 改为「输入框 + 向下展开的过滤面板」组合，输入即过滤，点选后应用筛选。
function buildUrlFilter() {
  const box = el("div", { class: "url-filter" });
  const input = el("mdui-text-field", {
    id: "filter-url",
    label: t("filter.url"),
    variant: "filled",
    type: "search",
    placeholder: t("filter.urlPlaceholder"),
    value: state.url,
    attrs: { autocomplete: "off" },
  });
  const panel = el("div", { class: "url-filter__panel", style: { display: "none" } });

  const close = () => {
    panel.style.display = "none";
  };
  const choose = (value) => {
    input.value = value;
    close();
    if (state.url !== value) {
      state.url = value;
      state.page = 1;
      reload();
    }
  };
  const renderOptions = (kw) => {
    const k = String(kw || "").trim().toLowerCase();
    const matched = k
      ? state.urlOptions.filter((u) => u.toLowerCase().includes(k))
      : state.urlOptions;
    panel.replaceChildren();
    const all = el("div", {
      class: `url-filter__opt${state.url ? "" : " is-active"}`,
      text: t("filter.allUrls"),
    });
    all.addEventListener("click", () => choose(""));
    panel.appendChild(all);
    if (matched.length === 0) {
      panel.appendChild(el("div", { class: "url-filter__empty", text: t("filter.noMatchedUrl") }));
    }
    // 上限 200 条防止超长列表拖慢渲染（URL 排行接口本身只给前 30）
    for (const u of matched.slice(0, 200)) {
      const opt = el("div", {
        class: `url-filter__opt${state.url === u ? " is-active" : ""}`,
        text: u,
        title: u,
      });
      opt.addEventListener("click", () => choose(u));
      panel.appendChild(opt);
    }
  };
  const open = () => {
    renderOptions("");
    panel.style.display = "";
  };

  input.addEventListener("focusin", open);
  input.addEventListener("input", () => {
    renderOptions(input.value);
    panel.style.display = "";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  box.appendChild(input);
  box.appendChild(panel);
  urlFilter = { input, box, close };

  // 点击组件外部时收起面板（全局只注册一次，组件重渲染后通过 urlFilter 引用最新实例）
  if (!urlDocListener) {
    urlDocListener = (e) => {
      if (!urlFilter) return;
      if (urlFilter.box.isConnected && !urlFilter.box.contains(e.target)) {
        urlFilter.close();
      }
    };
    document.addEventListener("click", urlDocListener);
  }
  return box;
}

async function loadUrlOptions() {
  try {
    const stats = await fetchStats();
    return (stats.urls || []).map((u) => u.url).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function reload() {
  if (!tableHost) return;
  tableHost.replaceChildren();
  await loadList(tableHost);
}

async function loadList(host) {
  host.appendChild(tableSkeleton(8, 6));
  try {
    const data = await fetchComments({
      status: state.status,
      url: state.url,
      keyword: state.keyword,
      from: state.from,
      page: state.page,
      page_size: PAGE_SIZE,
    });
    host.replaceChildren();
    renderTable(host, data);
  } catch (err) {
    host.replaceChildren();
    host.appendChild(
      emptyState({
        title: t("comments.loadFailed"),
        hint: err.message || String(err),
        icon: "warn",
      })
    );
    if (err.status !== 401) toastErr(t("common.loadFailed"), err.message);
  }
}

function renderTable(host, data) {
  const items = data.items || [];
  const total = data.total || 0;
  const page = data.page || state.page;
  const pageSize = data.page_size || PAGE_SIZE;

  if (items.length === 0) {
    host.appendChild(
      emptyState({
        title: t("comments.noMatch"),
        hint: t("comments.noMatchHint"),
      })
    );
    return;
  }

  const wrap = el("div", { class: "mdui-table table-wrap" });
  const table = el("table");

  const thead = el("thead");
  const tr = el("tr");
  [
    t("comments.colAuthor"),
    t("comments.colContent"),
    t("comments.colUrl"),
    t("comments.colStatus"),
    t("comments.colTime"),
    t("comments.colActions"),
  ].forEach((text) => {
    tr.appendChild(el("th", { text }));
  });
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = el("tbody");
  items.forEach((item) => tbody.appendChild(renderRow(item)));
  table.appendChild(tbody);
  wrap.appendChild(table);
  host.appendChild(wrap);

  host.appendChild(pagination({
    page,
    page_size: pageSize,
    total,
    onChange: (p) => {
      state.page = p;
      reload();
    },
  }));
}

function renderRow(item) {
  const tr = el("tr");

  const authorTd = el("td");
  const authorWrap = el("div", { class: "author-cell" });
  authorWrap.appendChild(avatar(item));
  const meta = el("div", { class: "author-cell__meta" });
  meta.appendChild(el("div", { class: "author-cell__nick", text: item.nick || t("common.anonymous") }));
  const mail = el("div", { class: "author-cell__mail", text: item.mail || item.ip || "" });
  mail.title = item.mail ? t("comments.mailTitle", { mail: item.mail }) : "";
  meta.appendChild(mail);
  authorWrap.appendChild(meta);
  authorTd.appendChild(authorWrap);
  tr.appendChild(authorTd);

  const contentTd = el("td");
  const contentWrap = el("div", { class: "comment-cell" });
  const text = el("div", { class: "comment-cell__text", text: item.comment || "", title: t("comments.viewFull") });
  text.addEventListener("click", () => openDetail(item));
  contentWrap.appendChild(text);

  if (item.pid) {
    const reply = el("div", { class: "comment-cell__reply" });
    if (item.parent) {
      // 直观展示「回复 @谁：内容摘要」，悬停可见父评论全文
      const full = item.parent.comment || "";
      const excerpt = full.length > 30 ? `${full.slice(0, 30)}…` : full;
      reply.appendChild(el("span", {
        class: "comment-cell__reply-nick",
        text: t("comments.replyTo", { nick: item.parent.nick || t("common.anonymous") }),
      }));
      reply.appendChild(el("span", { text: `：${excerpt}`, title: full }));
    } else {
      // 父评论已不存在（如导入数据的孤儿 pid），退化为提示 + 原始 pid
      reply.appendChild(el("span", { text: t("comments.replyToDeleted"), title: t("comments.parentIdTitle", { pid: item.pid }) }));
    }
    contentWrap.appendChild(reply);
  }
  contentTd.appendChild(contentWrap);
  tr.appendChild(contentTd);

  const urlTd = el("td");
  const urlSpan = el("div", { class: "url-cell", text: item.url || "—", title: item.url || "" });
  urlTd.appendChild(urlSpan);
  tr.appendChild(urlTd);

  const statusTd = el("td");
  statusTd.appendChild(badge(item.status));
  tr.appendChild(statusTd);

  const timeTd = el("td");
  const timeWrap = el("div", { class: "time-cell" });
  timeWrap.appendChild(el("div", { text: formatTime(item.inserted_at) }));
  timeWrap.appendChild(el("div", {
    text: formatRelative(item.inserted_at),
    style: { marginTop: "4px", fontSize: "12px", color: "rgb(var(--mdui-color-on-surface-variant))" },
  }));
  timeTd.appendChild(timeWrap);
  tr.appendChild(timeTd);

  const actionsTd = el("td");
  const actions = el("div", { class: "row-actions" });
  for (const a of rowActions(item)) actions.appendChild(a);
  actionsTd.appendChild(actions);
  tr.appendChild(actionsTd);

  return tr;
}

function rowActions(item) {
  const btns = [];

  const mk = (label, variant, handler) => {
    const b = el("mdui-button", { class: "btn-icon", variant, text: label });
    b.addEventListener("click", () => handler(b));
    return b;
  };

  const setLoading = (btn) => {
    btn.disabled = true;
    btn.loading = true;
  };
  const restore = (btn) => {
    btn.disabled = false;
    btn.loading = false;
  };

  const onStatus = async (btn, status) => {
    setLoading(btn);
    try {
      await patchComment(item.id, status);
      toastOk(t("common.opSuccess"), t("action.statusUpdated", { label: statusLabel(status) }));
      forceRefreshBadge();
      reload();
    } catch (err) {
      restore(btn);
      toastErr(t("common.opFailed"), err.message);
    }
  };

  if (item.status === "pending") {
    btns.push(mk(t("action.approve"), "filled", (b) => onStatus(b, "approved")));
    btns.push(mk(t("action.markSpam"), "tonal", (b) => onStatus(b, "spam")));
  } else if (item.status === "approved") {
    btns.push(mk(t("action.markSpam"), "tonal", (b) => onStatus(b, "spam")));
  } else if (item.status === "spam") {
    btns.push(mk(t("action.restore"), "filled", (b) => onStatus(b, "approved")));
  } else {
    btns.push(mk(t("action.approve"), "filled", (b) => onStatus(b, "approved")));
  }

  btns.push(mk(t("common.detail"), "text", () => openDetail(item)));

  const delBtn = mk(t("action.delete"), "outlined", async (b) => {
    const result = await confirmDialog({
      title: t("action.deleteConfirmTitle"),
      bodyText: t("action.deleteConfirmBody"),
      confirmText: t("action.delete"),
      cancelText: t("common.cancel"),
      danger: true,
    });
    if (result !== "confirm") return;
    setLoading(b);
    try {
      await deleteComment(item.id);
      toastOk(t("action.deleted"), t("action.deletedMsg"));
      forceRefreshBadge();
      reload();
    } catch (err) {
      restore(b);
      toastErr(t("action.deleteFailed"), err.message);
    }
  });
  btns.push(delBtn);

  return btns;
}

function statusLabel(s) {
  return s === "approved" ? t("status.approved")
    : s === "pending" ? t("status.pending")
    : s === "spam" ? t("status.spam")
    : s;
}

function openDetail(item) {
  let statusBadgeEl = null;
  const detail = openDetailDialog({
    title: t("comments.detailTitle"),
    renderBody: () => {
      const body = el("div");

      const head = el("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" } });
      head.appendChild(avatar(item));
      const headMeta = el("div", { style: { minWidth: "0" } });
      headMeta.appendChild(el("div", { text: item.nick || t("common.anonymous"), style: { fontWeight: "600", color: "rgb(var(--mdui-color-on-surface))" } }));
      headMeta.appendChild(el("div", {
        text: item.mail || t("comments.noMail"),
        style: { fontSize: "12px", color: "rgb(var(--mdui-color-on-surface-variant))" },
      }));
      head.appendChild(headMeta);
      const spacer = el("div", { style: { flex: "1" } });
      head.appendChild(spacer);
      statusBadgeEl = badge(item.status);
      head.appendChild(statusBadgeEl);
      body.appendChild(head);

      // 评论正文走极简 Markdown 渲染（纯 DOM 构建，无 XSS 面）；列表单元格保持纯文本预览
      const commentBox = el("div", { class: "detail__comment" });
      commentBox.appendChild(renderMarkdown(item.comment || t("comments.emptyComment"), {
        image: t("comments.mdImage"),
        imageError: t("comments.mdImageError"),
        close: t("common.close"),
      }));
      body.appendChild(commentBox);

      body.appendChild(detailRow(t("detail.commentId"), item.id || "—", true));
      body.appendChild(detailRow(t("detail.url"), item.url || "—", true));
      if (item.pid) body.appendChild(detailRow(t("detail.pid"), item.pid, true));
      if (item.rid) body.appendChild(detailRow(t("detail.rid"), item.rid, true));
      if (item.link) body.appendChild(detailRow(t("detail.link"), item.link, true));
      if (item.qq_avatar) body.appendChild(detailRow(t("detail.qqAvatar"), item.qq_avatar, true));
      if (item.ip) body.appendChild(detailRow(t("detail.ip"), item.ip || "—", true));
      if (item.ua) body.appendChild(detailRow(t("detail.ua"), item.ua, true));
      body.appendChild(detailRow(t("detail.insertedAt"), formatTime(item.inserted_at)));
      body.appendChild(detailRow(t("detail.createdAt"), formatTime(item.created_at)));
      body.appendChild(detailRow(t("detail.updatedAt"), formatTime(item.updated_at)));
      body.appendChild(detailRow(t("detail.notified"), item.is_notified ? t("common.yes") : t("common.no")));

      const actions = el("div", { class: "detail__actions" });

      const mkAction = (label, variant, status) => {
        const b = el("mdui-button", { variant, text: label });
        b.addEventListener("click", async () => {
          b.disabled = true;
          b.loading = true;
          try {
            await patchComment(item.id, status);
            toastOk(t("common.opSuccess"), t("action.statusUpdated", { label: statusLabel(status) }));
            forceRefreshBadge();
            if (statusBadgeEl && statusBadgeEl.parentNode) {
              statusBadgeEl.parentNode.replaceChild(badge(status), statusBadgeEl);
            }
            reload();
          } catch (err) {
            toastErr(t("common.opFailed"), err.message);
            b.disabled = false;
            b.loading = false;
          }
        });
        return b;
      };

      if (item.status !== "approved") actions.appendChild(mkAction(t("action.approve"), "filled", "approved"));
      if (item.status !== "spam") actions.appendChild(mkAction(t("action.markSpamFull"), "tonal", "spam"));
      if (item.status !== "pending") actions.appendChild(mkAction(t("action.backToPending"), "outlined", "pending"));

      const delBtn = el("mdui-button", { variant: "outlined", text: t("action.delete") });
      delBtn.addEventListener("click", async () => {
        const result = await confirmDialog({
          title: t("action.deleteConfirmTitle"),
          bodyText: t("action.deleteConfirmBody"),
          confirmText: t("action.delete"),
          cancelText: t("common.cancel"),
          danger: true,
        });
        if (result !== "confirm") return;
        delBtn.disabled = true;
        delBtn.loading = true;
        try {
          await deleteComment(item.id);
          toastOk(t("action.deleted"), t("action.deletedMsg"));
          forceRefreshBadge();
          detail.close();
          reload();
        } catch (err) {
          toastErr(t("action.deleteFailed"), err.message);
          delBtn.disabled = false;
          delBtn.loading = false;
        }
      });
      actions.appendChild(delBtn);
      body.appendChild(actions);
      return body;
    },
  });
  return detail;
}

export function cleanup() {
  if (urlDocListener) {
    document.removeEventListener("click", urlDocListener);
    urlDocListener = null;
  }
  urlFilter = null;
}
