import {
  fetchComments,
  fetchStats,
  patchComment,
  deleteComment,
} from "../api.js";
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

const PAGE_SIZE = 20;
const STATUSES = [
  { value: "", label: "全部状态" },
  { value: "approved", label: "已通过" },
  { value: "pending", label: "待审核" },
  { value: "spam", label: "垃圾" },
];

const state = {
  status: "",
  url: "",
  keyword: "",
  page: 1,
  urlOptions: [],
};

let tableHost = null;

export async function render(container) {
  applyHashQuery();

  container.appendChild(pageHead());
  container.appendChild(buildFilters());

  const card = el("mdui-card", { class: "page-card" });
  tableHost = el("div");
  card.appendChild(tableHost);
  container.appendChild(card);

  loadUrlOptions().then((opts) => {
    state.urlOptions = opts;
    refreshUrlSelect();
  });

  await loadList(tableHost);
}

function pageHead() {
  const head = el("div", { class: "page-head" });
  const titles = el("div", { class: "page-head__titles" });
  titles.appendChild(el("h1", { class: "page-title", text: "评论管理" }));
  titles.appendChild(el("div", { class: "page-subtitle", text: "审核、删除、按状态/文章/关键词筛选" }));
  head.appendChild(titles);
  return head;
}

function applyHashQuery() {
  const m = (location.hash || "").match(/\?(.+)$/);
  if (!m) return;
  const params = new URLSearchParams(m[1]);
  if (params.has("status")) state.status = params.get("status") || "";
  if (params.has("url")) state.url = params.get("url") || "";
  if (params.has("keyword")) state.keyword = params.get("keyword") || "";
  if (params.has("page")) state.page = Number(params.get("page")) || 1;
  history.replaceState(null, "", "#/comments");
}

function buildFilters() {
  const wrap = el("div", { class: "filters" });

  const statusSel = el("mdui-select", { id: "filter-status", label: "状态", variant: "filled" });
  STATUSES.forEach((s) => {
    statusSel.appendChild(menuItem(s.value, s.label));
  });
  statusSel.value = state.status;
  statusSel.addEventListener("change", () => {
    state.status = statusSel.value;
    state.page = 1;
    reload();
  });
  wrap.appendChild(statusSel);

  const urlSel = el("mdui-select", { id: "filter-url", label: "URL", variant: "filled" });
  urlSel.appendChild(menuItem("", "全部 URL"));
  urlSel.value = state.url;
  urlSel.addEventListener("change", () => {
    state.url = urlSel.value;
    state.page = 1;
    reload();
  });
  state._urlSel = urlSel;
  wrap.appendChild(urlSel);

  const kwInput = el("mdui-text-field", {
    id: "filter-keyword",
    label: "关键词",
    variant: "filled",
    type: "search",
    placeholder: "搜索昵称 / 邮箱 / 评论内容",
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

  const searchBtn = el("mdui-button", { variant: "filled", text: "查询" });
  searchBtn.addEventListener("click", () => {
    state.keyword = String(kwInput.value || "").trim();
    state.page = 1;
    reload();
  });
  wrap.appendChild(searchBtn);

  const resetBtn = el("mdui-button", { variant: "outlined", text: "重置" });
  resetBtn.addEventListener("click", () => {
    state.status = "";
    state.url = "";
    state.keyword = "";
    state.page = 1;
    statusSel.value = "";
    urlSel.value = "";
    kwInput.value = "";
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

function refreshUrlSelect() {
  const sel = state._urlSel;
  if (!sel) return;
  sel.replaceChildren();
  sel.appendChild(menuItem("", "全部 URL"));

  for (const opt of state.urlOptions) {
    const o = el("mdui-menu-item", { value: opt });
    o.textContent = opt.length > 60 ? opt.slice(0, 60) + "…" : opt;
    sel.appendChild(o);
  }
  sel.value = state.url;
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
      page: state.page,
      page_size: PAGE_SIZE,
    });
    host.replaceChildren();
    renderTable(host, data);
  } catch (err) {
    host.replaceChildren();
    host.appendChild(
      emptyState({
        title: "加载评论失败",
        hint: err.message || String(err),
        icon: "warn",
      })
    );
    if (err.status !== 401) toastErr("加载失败", err.message);
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
        title: "没有匹配的评论",
        hint: "尝试调整筛选条件，或前往导入页导入历史数据",
      })
    );
    return;
  }

  const wrap = el("div", { class: "mdui-table table-wrap" });
  const table = el("table");

  const thead = el("thead");
  const tr = el("tr");
  ["作者", "评论内容", "URL", "状态", "时间", "操作"].forEach((text) => {
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
  meta.appendChild(el("div", { class: "author-cell__nick", text: item.nick || "Anonymous" }));
  const mail = el("div", { class: "author-cell__mail", text: item.mail || item.ip || "" });
  mail.title = item.mail ? `邮箱：${item.mail}` : "";
  meta.appendChild(mail);
  authorWrap.appendChild(meta);
  authorTd.appendChild(authorWrap);
  tr.appendChild(authorTd);

  const contentTd = el("td");
  const contentWrap = el("div", { class: "comment-cell" });
  const text = el("div", { class: "comment-cell__text", text: item.comment || "", title: "点击查看完整内容" });
  text.addEventListener("click", () => openDetail(item));
  contentWrap.appendChild(text);

  if (item.pid) {
    const reply = el("div", { class: "comment-cell__reply" });
    reply.appendChild(el("span", { text: "回复 → " }));
    const replyId = el("span", {
      text: String(item.pid).slice(0, 12),
      title: `父评论 ID：${item.pid}`,
      style: { fontFamily: "var(--mdui-typescale-body-small-font, ui-monospace), monospace" },
    });
    reply.appendChild(replyId);
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
      toastOk("操作成功", `已更新状态为「${statusLabel(status)}」`);
      forceRefreshBadge();
      reload();
    } catch (err) {
      restore(btn);
      toastErr("操作失败", err.message);
    }
  };

  if (item.status === "pending") {
    btns.push(mk("通过", "filled", (b) => onStatus(b, "approved")));
    btns.push(mk("标垃圾", "tonal", (b) => onStatus(b, "spam")));
  } else if (item.status === "approved") {
    btns.push(mk("标垃圾", "tonal", (b) => onStatus(b, "spam")));
  } else if (item.status === "spam") {
    btns.push(mk("恢复", "filled", (b) => onStatus(b, "approved")));
  } else {
    btns.push(mk("通过", "filled", (b) => onStatus(b, "approved")));
  }

  btns.push(mk("详情", "text", () => openDetail(item)));

  const delBtn = mk("删除", "outlined", async (b) => {
    const result = await confirmDialog({
      title: "确认删除该评论？",
      bodyText: "删除后不可恢复。子评论会自动降级为根评论（不连坐整楼）。",
      confirmText: "删除",
      cancelText: "取消",
      danger: true,
    });
    if (result !== "confirm") return;
    setLoading(b);
    try {
      await deleteComment(item.id);
      toastOk("已删除", "评论已移除");
      forceRefreshBadge();
      reload();
    } catch (err) {
      restore(b);
      toastErr("删除失败", err.message);
    }
  });
  btns.push(delBtn);

  return btns;
}

function statusLabel(s) {
  return s === "approved" ? "已通过" : s === "pending" ? "待审核" : s === "spam" ? "垃圾" : s;
}

function openDetail(item) {
  let statusBadgeEl = null;
  const detail = openDetailDialog({
    title: "评论详情",
    renderBody: () => {
      const body = el("div");

      const head = el("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" } });
      head.appendChild(avatar(item));
      const headMeta = el("div", { style: { minWidth: "0" } });
      headMeta.appendChild(el("div", { text: item.nick || "Anonymous", style: { fontWeight: "600", color: "rgb(var(--mdui-color-on-surface))" } }));
      headMeta.appendChild(el("div", {
        text: item.mail || "(无邮箱)",
        style: { fontSize: "12px", color: "rgb(var(--mdui-color-on-surface-variant))" },
      }));
      head.appendChild(headMeta);
      const spacer = el("div", { style: { flex: "1" } });
      head.appendChild(spacer);
      statusBadgeEl = badge(item.status);
      head.appendChild(statusBadgeEl);
      body.appendChild(head);

      body.appendChild(el("div", { class: "detail__comment", text: item.comment || "(空评论)" }));

      body.appendChild(detailRow("评论 ID", item.id || "—", true));
      body.appendChild(detailRow("URL", item.url || "—", true));
      if (item.pid) body.appendChild(detailRow("父评论 pid", item.pid, true));
      if (item.rid) body.appendChild(detailRow("根评论 rid", item.rid, true));
      if (item.link) body.appendChild(detailRow("个人链接", item.link, true));
      if (item.qq_avatar) body.appendChild(detailRow("QQ 头像", item.qq_avatar, true));
      if (item.ip) body.appendChild(detailRow("IP", item.ip || "—", true));
      if (item.ua) body.appendChild(detailRow("User-Agent", item.ua, true));
      body.appendChild(detailRow("插入时间", formatTime(item.inserted_at)));
      body.appendChild(detailRow("创建时间", formatTime(item.created_at)));
      body.appendChild(detailRow("更新时间", formatTime(item.updated_at)));
      body.appendChild(detailRow("已通知", item.is_notified ? "是" : "否"));

      const actions = el("div", { class: "detail__actions" });

      const mkAction = (label, variant, status) => {
        const b = el("mdui-button", { variant, text: label });
        b.addEventListener("click", async () => {
          b.disabled = true;
          b.loading = true;
          try {
            await patchComment(item.id, status);
            toastOk("操作成功", `状态已更新为「${statusLabel(status)}」`);
            forceRefreshBadge();
            if (statusBadgeEl && statusBadgeEl.parentNode) {
              statusBadgeEl.parentNode.replaceChild(badge(status), statusBadgeEl);
            }
            reload();
          } catch (err) {
            toastErr("操作失败", err.message);
            b.disabled = false;
            b.loading = false;
          }
        });
        return b;
      };

      if (item.status !== "approved") actions.appendChild(mkAction("通过", "filled", "approved"));
      if (item.status !== "spam") actions.appendChild(mkAction("标为垃圾", "tonal", "spam"));
      if (item.status !== "pending") actions.appendChild(mkAction("退回待审", "outlined", "pending"));

      const delBtn = el("mdui-button", { variant: "outlined", text: "删除" });
      delBtn.addEventListener("click", async () => {
        const result = await confirmDialog({
          title: "确认删除该评论？",
          bodyText: "删除后不可恢复。子评论会自动降级为根评论。",
          confirmText: "删除",
          cancelText: "取消",
          danger: true,
        });
        if (result !== "confirm") return;
        delBtn.disabled = true;
        delBtn.loading = true;
        try {
          await deleteComment(item.id);
          toastOk("已删除", "评论已移除");
          forceRefreshBadge();
          detail.close();
          reload();
        } catch (err) {
          toastErr("删除失败", err.message);
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

export function cleanup() {}
