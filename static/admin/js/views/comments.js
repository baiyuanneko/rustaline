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
  closeDialog,
  openDrawer,
  detailRow,
  formatTime,
  formatRelative,
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

export async function render(container) {
  applyHashQuery();

  container.appendChild(pageHead());

  const filtersEl = buildFilters();
  container.appendChild(filtersEl);

  const card = document.createElement("div");
  card.className = "card";
  container.appendChild(card);

  const tableHost = document.createElement("div");
  card.appendChild(tableHost);

  loadUrlOptions().then((opts) => {
    state.urlOptions = opts;
    refreshUrlSelect();
  });

  await loadList(tableHost);
}

function pageHead() {
  const head = document.createElement("div");
  head.className = "page-head";
  const titles = document.createElement("div");
  titles.className = "page-head__titles";
  const t = document.createElement("h1");
  t.className = "page-title";
  t.textContent = "评论管理";
  const s = document.createElement("div");
  s.className = "page-subtitle";
  s.textContent = "审核、删除、按状态/文章/关键词筛选";
  titles.appendChild(t);
  titles.appendChild(s);
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
  const wrap = document.createElement("div");
  wrap.className = "filters";

  const statusField = document.createElement("div");
  statusField.className = "filters__field";
  const statusLab = document.createElement("label");
  statusLab.className = "field__label";
  statusLab.textContent = "状态";
  statusLab.htmlFor = "filter-status";
  const statusSel = document.createElement("select");
  statusSel.id = "filter-status";
  statusSel.className = "select";
  STATUSES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.value;
    opt.textContent = s.label;
    if (s.value === state.status) opt.selected = true;
    statusSel.appendChild(opt);
  });
  statusSel.addEventListener("change", () => {
    state.status = statusSel.value;
    state.page = 1;
    reload();
  });
  statusField.appendChild(statusLab);
  statusField.appendChild(statusSel);

  const urlField = document.createElement("div");
  urlField.className = "filters__field";
  const urlLab = document.createElement("label");
  urlLab.className = "field__label";
  urlLab.textContent = "URL";
  urlLab.htmlFor = "filter-url";
  const urlSel = document.createElement("select");
  urlSel.id = "filter-url";
  urlSel.className = "select";
  urlField.appendChild(urlLab);
  urlField.appendChild(urlSel);
  urlSel.addEventListener("change", () => {
    state.url = urlSel.value;
    state.page = 1;
    reload();
  });
  state._urlSel = urlSel;

  const kwField = document.createElement("div");
  kwField.className = "filters__field filters__field--grow";
  const kwLab = document.createElement("label");
  kwLab.className = "field__label";
  kwLab.textContent = "关键词";
  kwLab.htmlFor = "filter-keyword";
  const kwInput = document.createElement("input");
  kwInput.id = "filter-keyword";
  kwInput.className = "input";
  kwInput.type = "search";
  kwInput.placeholder = "搜索昵称 / 邮箱 / 评论内容";
  kwInput.value = state.keyword;
  kwInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.keyword = kwInput.value.trim();
      state.page = 1;
      reload();
    }
  });
  kwField.appendChild(kwLab);
  kwField.appendChild(kwInput);

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "btn btn--primary";
  searchBtn.textContent = "查询";
  searchBtn.addEventListener("click", () => {
    state.keyword = kwInput.value.trim();
    state.page = 1;
    reload();
  });

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn btn--ghost";
  resetBtn.textContent = "重置";
  resetBtn.addEventListener("click", () => {
    state.status = "";
    state.url = "";
    state.keyword = "";
    state.page = 1;
    statusSel.value = "";
    kwInput.value = "";
    reload();
  });

  wrap.appendChild(statusField);
  wrap.appendChild(urlField);
  wrap.appendChild(kwField);
  wrap.appendChild(searchBtn);
  wrap.appendChild(resetBtn);
  return wrap;
}

function refreshUrlSelect() {
  const sel = state._urlSel;
  if (!sel) return;
  sel.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "全部 URL";
  sel.appendChild(allOpt);

  for (const opt of state.urlOptions) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt.length > 60 ? opt.slice(0, 60) + "…" : opt;
    if (opt === state.url) o.selected = true;
    sel.appendChild(o);
  }
  sel.value = state.url;
}

async function loadUrlOptions() {
  try {
    const stats = await fetchStats();
    return (stats.urls || []).map((u) => u.url).filter(Boolean);
  } catch (err) {
    return [];
  }
}

async function reload() {
  const card = document.querySelector(".main .card");
  if (!card) return;
  const host = card.querySelector("div");
  if (!host) return;
  host.innerHTML = "";
  await loadList(host);
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
    host.innerHTML = "";
    renderTable(host, data);
  } catch (err) {
    host.innerHTML = "";
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

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";

  const table = document.createElement("table");
  table.className = "table";

  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  [
    ["作者", "col-author"],
    ["评论内容", "col-content"],
    ["URL", "col-url"],
    ["状态", "col-status"],
    ["时间", "col-time"],
    ["操作", "col-actions"],
  ].forEach(([text, cls]) => {
    const th = document.createElement("th");
    th.className = cls;
    th.textContent = text;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  items.forEach((item) => tbody.appendChild(renderRow(item)));
  table.appendChild(tbody);

  wrap.appendChild(table);
  host.appendChild(wrap);

  const pager = pagination({
    page,
    page_size: pageSize,
    total,
    onChange: (p) => {
      state.page = p;
      reload();
    },
  });
  host.appendChild(pager);
}

function renderRow(item) {
  const tr = document.createElement("tr");

  const authorTd = document.createElement("td");
  const authorWrap = document.createElement("div");
  authorWrap.className = "author-cell";
  authorWrap.appendChild(avatar(item));
  const meta = document.createElement("div");
  meta.className = "author-cell__meta";
  const nick = document.createElement("div");
  nick.className = "author-cell__nick";
  nick.textContent = item.nick || "Anonymous";
  const mail = document.createElement("div");
  mail.className = "author-cell__mail";
  mail.textContent = item.mail || item.ip || "";
  mail.title = item.mail ? `邮箱：${item.mail}` : "";
  meta.appendChild(nick);
  meta.appendChild(mail);
  authorWrap.appendChild(meta);
  authorTd.appendChild(authorWrap);
  tr.appendChild(authorTd);

  const contentTd = document.createElement("td");
  const contentWrap = document.createElement("div");
  contentWrap.className = "comment-cell";
  const text = document.createElement("div");
  text.className = "comment-cell__text";
  text.textContent = item.comment || "";
  text.title = "点击查看完整内容";
  text.addEventListener("click", () => openDetail(item));
  contentWrap.appendChild(text);

  if (item.pid) {
    const reply = document.createElement("div");
    reply.className = "comment-cell__reply";
    const replyLab = document.createElement("span");
    replyLab.textContent = "回复 → ";
    const replyId = document.createElement("span");
    replyId.textContent = String(item.pid).slice(0, 12);
    replyId.style.fontFamily = "var(--font-mono)";
    replyId.title = `父评论 ID：${item.pid}`;
    reply.appendChild(replyLab);
    reply.appendChild(replyId);
    contentWrap.appendChild(reply);
  }
  contentTd.appendChild(contentWrap);
  tr.appendChild(contentTd);

  const urlTd = document.createElement("td");
  const urlSpan = document.createElement("div");
  urlSpan.className = "url-cell";
  urlSpan.textContent = item.url || "—";
  urlSpan.title = item.url || "";
  urlTd.appendChild(urlSpan);
  tr.appendChild(urlTd);

  const statusTd = document.createElement("td");
  statusTd.appendChild(badge(item.status));
  tr.appendChild(statusTd);

  const timeTd = document.createElement("td");
  const timeWrap = document.createElement("div");
  timeWrap.className = "time-cell";
  const t = document.createElement("div");
  t.textContent = formatTime(item.inserted_at);
  const rel = document.createElement("div");
  rel.style.color = "var(--text-faint)";
  rel.textContent = formatRelative(item.inserted_at);
  timeWrap.appendChild(t);
  timeWrap.appendChild(rel);
  timeTd.appendChild(timeWrap);
  tr.appendChild(timeTd);

  const actionsTd = document.createElement("td");
  actionsTd.className = "col-actions";
  const actions = document.createElement("div");
  actions.className = "row-actions";
  for (const a of rowActions(item)) {
    actions.appendChild(a);
  }
  actionsTd.appendChild(actions);
  tr.appendChild(actionsTd);

  return tr;
}

function rowActions(item) {
  const btns = [];

  const mk = (label, variant, handler) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn-icon btn-icon--${variant}`;
    b.textContent = label;
    b.addEventListener("click", () => handler(b));
    return b;
  };

  const setLoading = (btn, text) => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    btn._prevText = text;
  };
  const restore = (btn) => {
    btn.disabled = false;
    if (btn._prevText) btn.textContent = btn._prevText;
  };

  const onStatus = async (btn, status) => {
    setLoading(btn, btn.textContent);
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
    btns.push(mk("通过", "ok", (b) => onStatus(b, "approved")));
    btns.push(mk("标垃圾", "warn", (b) => onStatus(b, "spam")));
  } else if (item.status === "approved") {
    btns.push(mk("标垃圾", "warn", (b) => onStatus(b, "spam")));
  } else if (item.status === "spam") {
    btns.push(mk("恢复", "ok", (b) => onStatus(b, "approved")));
  } else {
    btns.push(mk("通过", "ok", (b) => onStatus(b, "approved")));
  }

  btns.push(mk("详情", "", () => openDetail(item)));

  const delBtn = mk("删除", "danger", async (b) => {
    const result = await confirmDialog({
      title: "确认删除该评论？",
      bodyText: `删除后不可恢复。子评论会自动降级为根评论（不连坐整楼）。`,
      confirmText: "删除",
      cancelText: "取消",
      danger: true,
    });
    if (result !== "confirm") return;
    setLoading(b, "删除");
    try {
      await deleteComment(item.id);
      toastOk("已删除", "评论已移除");
      forceRefreshBadge();
      reload();
    } catch (err) {
      restore(b);
      toastErr("删除失败", err.message);
      closeDialog();
    }
  });
  btns.push(delBtn);

  return btns;
}

function statusLabel(s) {
  return s === "approved" ? "已通过" : s === "pending" ? "待审核" : s === "spam" ? "垃圾" : s;
}

function openDetail(item) {
  openDrawer({
    title: "评论详情",
    renderBody: () => {
      const body = document.createElement("div");

      const head = document.createElement("div");
      head.style.display = "flex";
      head.style.alignItems = "center";
      head.style.gap = "12px";
      head.style.marginBottom = "16px";
      head.appendChild(avatar(item));
      const headMeta = document.createElement("div");
      const nick = document.createElement("div");
      nick.style.fontWeight = "600";
      nick.textContent = item.nick || "Anonymous";
      const mail = document.createElement("div");
      mail.style.fontSize = "12px";
      mail.style.color = "var(--text-faint)";
      mail.textContent = item.mail || "(无邮箱)";
      headMeta.appendChild(nick);
      headMeta.appendChild(mail);
      head.appendChild(headMeta);
      const spacer = document.createElement("div");
      spacer.style.flex = "1";
      head.appendChild(spacer);
      head.appendChild(badge(item.status));
      body.appendChild(head);

      const comment = document.createElement("div");
      comment.className = "detail__comment";
      comment.textContent = item.comment || "(空评论)";
      body.appendChild(comment);

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

      const actions = document.createElement("div");
      actions.style.marginTop = "16px";
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.flexWrap = "wrap";

      const mkAction = (label, variant, status) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `btn btn--${variant} btn--sm`;
        b.textContent = label;
        b.addEventListener("click", async () => {
          b.disabled = true;
          b.innerHTML = '<span class="spinner"></span>';
          try {
            await patchComment(item.id, status);
            toastOk("操作成功", `状态已更新为「${statusLabel(status)}」`);
            forceRefreshBadge();
            const cur = document.querySelector(".detail .badge");
            // 不重新渲染抽屉，简单替换 badge
            const newBadge = badge(status);
            if (cur && cur.parentNode) {
              cur.parentNode.replaceChild(newBadge, cur);
            }
            reload();
          } catch (err) {
            toastErr("操作失败", err.message);
            b.disabled = false;
            b.textContent = label;
          }
        });
        return b;
      };

      if (item.status !== "approved") {
        actions.appendChild(mkAction("通过", "ok", "approved"));
      }
      if (item.status !== "spam") {
        actions.appendChild(mkAction("标为垃圾", "ghost", "spam"));
      }
      if (item.status !== "pending") {
        actions.appendChild(mkAction("退回待审", "ghost", "pending"));
      }
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn--danger btn--sm";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", async () => {
        const result = await confirmDialog({
          title: "确认删除该评论？",
          bodyText: "删除后不可恢复。子评论会自动降级为根评论。",
          confirmText: "删除",
          danger: true,
        });
        if (result !== "confirm") return;
        delBtn.disabled = true;
        delBtn.innerHTML = '<span class="spinner"></span>';
        try {
          await deleteComment(item.id);
          toastOk("已删除", "评论已移除");
          forceRefreshBadge();
          document.querySelector(".detail__header .btn--ghost")?.click();
          reload();
        } catch (err) {
          toastErr("删除失败", err.message);
          delBtn.disabled = false;
          delBtn.textContent = "删除";
        }
      });
      actions.appendChild(delBtn);

      body.appendChild(actions);

      return body;
    },
  });
}

export function cleanup() {}
