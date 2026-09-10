import { fetchStats } from "../api.js";
import { loadingScreen, emptyState, toastErr, icon, el, attachRipple } from "../components.js";
import { forceRefreshBadge } from "../app.js";
import { t } from "../i18n.js";

export async function render(container) {
  container.appendChild(pageHead());

  const loading = loadingScreen(t("dash.loading"));
  container.appendChild(loading);

  try {
    const stats = await fetchStats();
    loading.remove();
    container.appendChild(statsGrid(stats));
    container.appendChild(urlRankSection(stats));
  } catch (err) {
    loading.remove();
    container.appendChild(
      emptyState({
        title: t("dash.loadFailed"),
        hint: err.message || String(err),
        icon: "warn",
      })
    );
    if (err.status !== 401) toastErr(t("common.loadFailed"), err.message);
  }
}

function pageHead() {
  const head = el("div", { class: "page-head" });
  const titles = el("div", { class: "page-head__titles" });
  titles.appendChild(el("h1", { class: "page-title", text: t("dash.title") }));
  titles.appendChild(el("div", { class: "page-subtitle", text: t("dash.subtitle") }));
  head.appendChild(titles);

  const refresh = el("mdui-button", { variant: "outlined" });
  const iconNode = icon("refresh");
  iconNode.slot = "icon";
  refresh.appendChild(iconNode);
  refresh.appendChild(document.createTextNode(t("dash.refresh")));
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

  // 五张卡片均可点击，跳评论管理并带上对应筛选；
  // 今日新增与 stats 的 today_new 同为 UTC 口径，from 取 UTC 当天日期
  const todayUtc = new Date().toISOString().slice(0, 10);
  const cards = [
    { key: "total", label: t("dash.total"), value: stats.total ?? 0, cls: "total", hash: "#/comments" },
    { key: "approved", label: t("status.approved"), value: stats.approved ?? 0, cls: "approved", hash: "#/comments?status=approved" },
    { key: "pending", label: t("status.pending"), value: stats.pending ?? 0, cls: "pending", hash: "#/comments?status=pending" },
    { key: "spam", label: t("status.spam"), value: stats.spam ?? 0, cls: "spam", hash: "#/comments?status=spam" },
    { key: "today", label: t("dash.todayNew"), value: stats.today_new ?? 0, cls: "today", hash: `#/comments?from=${todayUtc}` },
  ];

  for (const c of cards) {
    const card = el("mdui-card", {
      class: `stat-card stat-card--${c.cls} stat-card--clickable`,
    });
    card.appendChild(el("div", { class: "stat-card__accent" }));
    card.appendChild(el("div", { class: "stat-card__label", text: c.label }));
    card.appendChild(el("span", { class: "stat-card__value", text: formatNum(c.value) }));
    attachRipple(card);

    card.style.cursor = "pointer";
    card.title = t("dash.cardHint");
    card.addEventListener("click", () => {
      location.hash = c.hash;
    });
    grid.appendChild(card);
  }
  return grid;
}

function urlRankSection(stats) {
  const section = el("div", { class: "section" });
  const header = el("div", { class: "section__header" });
  const titleBox = el("div");
  titleBox.appendChild(el("div", { class: "section__title", text: t("dash.rankTitle") }));
  titleBox.appendChild(el("div", { class: "section__subtitle", text: t("dash.rankSubtitle") }));
  header.appendChild(titleBox);
  section.appendChild(header);

  const body = el("div", { class: "section__body" });
  const urls = stats.urls || [];
  if (urls.length === 0) {
    body.appendChild(emptyState({ title: t("common.empty"), hint: t("dash.rankEmptyHint") }));
  } else {
    urls.slice(0, 10).forEach((entry, idx) => {
      const row = el("div", { class: "rank-row" });
      row.appendChild(el("span", { class: "rank-row__num", text: `#${idx + 1}` }));
      const url = el("span", {
        class: "rank-row__url",
        text: entry.url || t("dash.emptyUrl"),
        title: entry.url || "",
      });
      attachRipple(url);
      url.addEventListener("click", () => {
        const target = entry.url ? `#/comments?url=${encodeURIComponent(entry.url)}` : "#/comments";
        location.hash = target;
      });
      row.appendChild(url);
      row.appendChild(el("span", { class: "rank-row__count", text: t("dash.itemCount", entry.count) }));
      body.appendChild(row);
    });
  }
  section.appendChild(body);
  return section;
}

function formatNum(n) {
  if (typeof n !== "number") n = Number(n) || 0;
  return n.toLocaleString("zh-CN");
}

export function cleanup() {}
