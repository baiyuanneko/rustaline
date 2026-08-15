import { fetchStats } from "../api.js";
import { loadingScreen, emptyState, toastErr, icon, el } from "../components.js";
import { forceRefreshBadge } from "../app.js";

export async function render(container) {
  container.appendChild(pageHead());

  const loading = loadingScreen("加载统计数据…");
  container.appendChild(loading);

  try {
    const stats = await fetchStats();
    loading.remove();
    container.appendChild(statsGrid(stats));
    container.appendChild(urlRankCard(stats));
  } catch (err) {
    loading.remove();
    container.appendChild(
      emptyState({
        title: "统计数据加载失败",
        hint: err.message || String(err),
        icon: "warn",
      })
    );
    if (err.status !== 401) toastErr("加载失败", err.message);
  }
}

function pageHead() {
  const head = el("div", { class: "page-head" });
  const titles = el("div", { class: "page-head__titles" });
  titles.appendChild(el("h1", { class: "page-title", text: "仪表盘" }));
  titles.appendChild(el("div", { class: "page-subtitle", text: "评论系统总览与各页面热度" }));
  head.appendChild(titles);

  const refresh = el("mdui-button", { variant: "outlined" });
  const iconNode = icon("refresh");
  iconNode.slot = "icon";
  refresh.appendChild(iconNode);
  refresh.appendChild(document.createTextNode("刷新"));
  refresh.addEventListener("click", async () => {
    refresh.loading = true;
    refresh.disabled = true;
    await forceRefreshBadge();
    location.reload();
  });
  head.appendChild(refresh);
  return head;
}

function statsGrid(stats) {
  const grid = el("div", { class: "stats-grid" });

  const cards = [
    { key: "total", label: "评论总数", value: stats.total ?? 0, cls: "total", filter: "" },
    { key: "approved", label: "已通过", value: stats.approved ?? 0, cls: "approved", filter: "?status=approved" },
    { key: "pending", label: "待审核", value: stats.pending ?? 0, cls: "pending", filter: "?status=pending" },
    { key: "spam", label: "垃圾", value: stats.spam ?? 0, cls: "spam", filter: "?status=spam" },
    { key: "today", label: "今日新增", value: stats.today_new ?? 0, cls: "today", filter: "" },
  ];

  for (const c of cards) {
    const card = el("mdui-card", {
      class: `stat-card stat-card--${c.cls}${c.filter ? " stat-card--clickable" : ""}`,
    });
    card.appendChild(el("div", { class: "stat-card__accent" }));
    card.appendChild(el("div", { class: "stat-card__label", text: c.label }));
    card.appendChild(el("span", { class: "stat-card__value", text: formatNum(c.value) }));

    if (c.filter) {
      card.style.cursor = "pointer";
      card.title = "点击查看对应状态评论";
      card.addEventListener("click", () => {
        location.hash = `#/comments${c.filter}`;
      });
    }
    grid.appendChild(card);
  }
  return grid;
}

function urlRankCard(stats) {
  const card = el("mdui-card", { class: "page-card" });
  const header = el("div", { class: "page-card__header" });
  const titleBox = el("div");
  titleBox.appendChild(el("div", { class: "page-card__title", text: "URL 评论数排行" }));
  titleBox.appendChild(el("div", { class: "page-card__subtitle", text: "按文章评论数倒序，取前 100" }));
  header.appendChild(titleBox);
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  const urls = stats.urls || [];
  if (urls.length === 0) {
    body.appendChild(emptyState({ title: "暂无数据", hint: "尚无评论或未生成统计" }));
  } else {
    urls.slice(0, 100).forEach((entry, idx) => {
      const row = el("div", { class: "rank-row" });
      row.appendChild(el("span", { class: "rank-row__num", text: `#${idx + 1}` }));
      const url = el("span", {
        class: "rank-row__url",
        text: entry.url || "(空 URL)",
        title: entry.url || "",
      });
      url.addEventListener("click", () => {
        const target = entry.url ? `#/comments?url=${encodeURIComponent(entry.url)}` : "#/comments";
        location.hash = target;
      });
      row.appendChild(url);
      row.appendChild(el("span", { class: "rank-row__count", text: `${entry.count} 条` }));
      body.appendChild(row);
    });
  }
  card.appendChild(body);
  return card;
}

function formatNum(n) {
  if (typeof n !== "number") n = Number(n) || 0;
  return n.toLocaleString("zh-CN");
}

export function cleanup() {}
