import { fetchStats } from "../api.js";
import { loadingScreen, emptyState, toastErr, svg } from "../components.js";
import { forceRefreshBadge } from "../app.js";

export async function render(container) {
  container.appendChild(pageHead());

  const loading = loadingScreen("加载统计数据…");
  container.appendChild(loading);

  try {
    const stats = await fetchStats();
    container.removeChild(loading);
    container.appendChild(statsGrid(stats));
    container.appendChild(urlRankCard(stats));
  } catch (err) {
    container.removeChild(loading);
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
  const head = document.createElement("div");
  head.className = "page-head";
  const titles = document.createElement("div");
  titles.className = "page-head__titles";
  const t = document.createElement("h1");
  t.className = "page-title";
  t.textContent = "仪表盘";
  const s = document.createElement("div");
  s.className = "page-subtitle";
  s.textContent = "评论系统总览与各页面热度";
  titles.appendChild(t);
  titles.appendChild(s);
  head.appendChild(titles);

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "btn btn--ghost btn--sm";
  refresh.appendChild(svg("refresh"));
  const refreshLabel = document.createTextNode("刷新");
  refresh.appendChild(refreshLabel);
  refresh.addEventListener("click", async () => {
    refresh.setAttribute("aria-busy", "true");
    refresh.innerHTML = '<span class="spinner"></span>';
    await forceRefreshBadge();
    location.reload();
  });
  head.appendChild(refresh);

  return head;
}

function statsGrid(stats) {
  const grid = document.createElement("div");
  grid.className = "stats-grid";

  const cards = [
    { key: "total", label: "评论总数", value: stats.total ?? 0, cls: "total", filter: "" },
    { key: "approved", label: "已通过", value: stats.approved ?? 0, cls: "approved", filter: "?status=approved" },
    { key: "pending", label: "待审核", value: stats.pending ?? 0, cls: "pending", filter: "?status=pending" },
    { key: "spam", label: "垃圾", value: stats.spam ?? 0, cls: "spam", filter: "?status=spam" },
    { key: "today", label: "今日新增", value: stats.today_new ?? 0, cls: "today", filter: "" },
  ];

  for (const c of cards) {
    const card = document.createElement("div");
    card.className = `stat-card stat-card--${c.cls}`;

    const accent = document.createElement("div");
    accent.className = "stat-card__accent";

    const lab = document.createElement("div");
    lab.className = "stat-card__label";
    lab.textContent = c.label;

    const val = document.createElement("span");
    val.className = "stat-card__value";
    val.textContent = formatNum(c.value);

    card.appendChild(accent);
    card.appendChild(lab);
    card.appendChild(val);

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
  const card = document.createElement("div");
  card.className = "card";

  const header = document.createElement("div");
  header.className = "card__header";
  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = "URL 评论数排行";
  const sub = document.createElement("div");
  sub.className = "card__subtitle";
  sub.textContent = "按文章评论数倒序，取前 100";
  header.appendChild(title);
  header.appendChild(sub);
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "card__body card__body--flush";

  const urls = (stats.urls || []);
  if (urls.length === 0) {
    body.appendChild(emptyState({ title: "暂无数据", hint: "尚无评论或未生成统计" }));
  } else {
    urls.slice(0, 100).forEach((entry, idx) => {
      const row = document.createElement("div");
      row.className = "rank-row";

      const num = document.createElement("span");
      num.className = "rank-row__num";
      num.textContent = `#${idx + 1}`;

      const url = document.createElement("span");
      url.className = "rank-row__url";
      url.textContent = entry.url || "(空 URL)";
      url.title = entry.url || "";
      url.addEventListener("click", () => {
        const target = entry.url ? `#/comments?url=${encodeURIComponent(entry.url)}` : "#/comments";
        location.hash = target;
      });

      const count = document.createElement("span");
      count.className = "rank-row__count";
      count.textContent = `${entry.count} 条`;

      row.appendChild(num);
      row.appendChild(url);
      row.appendChild(count);
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
