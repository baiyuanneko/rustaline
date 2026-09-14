// 应用入口：hash 路由、auth guard、mdui 外壳联动、待审角标。

import {
  isAuthenticated,
  getUsername,
  clearSession,
  logout as apiLogout,
  setUnauthorizedHandler,
  fetchStats,
  fetchConfig,
} from "./api.js";
import { toastErr, el, icon, attachRipple, openDetailDialog } from "./components.js";
import { applyStaticTexts, getLang, setLang, t } from "./i18n.js";
import * as loginView from "./views/login.js";
import * as dashboardView from "./views/dashboard.js";
import * as commentsView from "./views/comments.js";
import * as importView from "./views/import.js";
import * as settingsView from "./views/settings.js";

const ROUTES = {
  "#/login": { view: loginView, public: true, nav: null },
  "#/dashboard": { view: dashboardView, public: false, nav: "dashboard" },
  "#/comments": { view: commentsView, public: false, nav: "comments" },
  "#/import": { view: importView, public: false, nav: "import" },
  "#/settings": { view: settingsView, public: false, nav: "settings" },
};

const DEFAULT_ROUTE = "#/dashboard";
const LOGIN_ROUTE = "#/login";
const DESKTOP_QUERY = "(min-width: 840px)";

const appEl = () => document.getElementById("app");
const drawerEl = () => document.getElementById("sidebar");

function currentHash() {
  const h = window.location.hash || "";
  if (!h || h === "#" || h === "#/") return DEFAULT_ROUTE;
  return h;
}

// hash 可能携带查询串（如 #/comments?status=pending，由仪表盘卡片/URL 排行跳入），
// 路由表只按裸路径匹配；查询串留给 view 的 applyHashQuery 自行解析
function routeKey(hash) {
  const q = hash.indexOf("?");
  return q === -1 ? hash : hash.slice(0, q);
}

async function renderRoute() {
  const hash = currentHash();
  const route = ROUTES[routeKey(hash)];

  if (!route) {
    location.hash = DEFAULT_ROUTE;
    return;
  }

  if (route.public) {
    if (isAuthenticated()) {
      location.hash = DEFAULT_ROUTE;
      return;
    }
    updateShell({ username: "" });
    await mountView(route.view);
    return;
  }

  if (!isAuthenticated()) {
    location.hash = LOGIN_ROUTE;
    return;
  }

  updateShell({ username: getUsername() });
  await mountView(route.view);
  setActiveNav(route.nav);
  closeDrawerOnMobile();
  refreshPendingBadge();
}

// 视图渲染代际标记：view 渲染内含异步 await，期间路由可能已切换；
// 渲染到离屏容器、完成后校验代际再挂载，避免过期视图内容串到当前页
let renderSeq = 0;

async function mountView(viewModule) {
  const app = appEl();
  if (!app) return;
  const seq = ++renderSeq;
  if (viewModule.cleanup) {
    try {
      viewModule.cleanup();
    } catch (_) { /* noop */ }
  }
  const host = document.createElement("div");
  try {
    await viewModule.render(host);
  } catch (err) {
    host.replaceChildren();
    const errBox = document.createElement("div");
    errBox.className = "page-card mdui-card page-card__body";
    errBox.style.color = "rgb(var(--mdui-color-error))";
    errBox.textContent = `${t("common.loadFailed")}: ${err && err.message ? err.message : err}`;
    host.appendChild(errBox);
  }
  if (seq !== renderSeq) return;
  app.replaceChildren(host);
}

function setActiveNav(navKey) {
  document.querySelectorAll(".nav__item").forEach((el) => {
    const active = el.dataset.route === navKey;
    el.classList.toggle("is-active", active);
    el.active = active;
  });
}

function closeDrawerOnMobile() {
  const drawer = drawerEl();
  if (drawer && !window.matchMedia(DESKTOP_QUERY).matches) {
    drawer.open = false;
  }
}

function updateShell({ username }) {
  const userBox = document.getElementById("topbar-user");
  const usernameEl = document.getElementById("topbar-username");
  if (userBox) {
    if (username) {
      userBox.hidden = false;
      if (usernameEl) usernameEl.textContent = username;
    } else {
      userBox.hidden = true;
    }
  }
}

let badgeTimer = null;
async function refreshPendingBadge() {
  if (!isAuthenticated()) {
    setPendingBadge(0);
    return;
  }
  try {
    const stats = await fetchStats();
    setPendingBadge(stats.pending || 0);
  } catch (_) {
    // 401 由全局拦截器处理；其他错误静默，避免打扰用户
  }
}

function setPendingBadge(n) {
  const el = document.getElementById("pending-badge");
  if (!el) return;
  if (n > 0) {
    el.hidden = false;
    el.textContent = n > 99 ? "99+" : String(n);
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

export function forceRefreshBadge() {
  return refreshPendingBadge();
}

function initSidebar() {
  const toggle = document.getElementById("menu-toggle");
  const drawer = drawerEl();
  if (!toggle || !drawer) return;

  const desktop = window.matchMedia(DESKTOP_QUERY);
  const syncDrawer = () => {
    drawer.open = desktop.matches;
  };
  syncDrawer();
  desktop.addEventListener("change", syncDrawer);

  toggle.addEventListener("click", () => {
    drawer.open = !drawer.open;
  });

  document.querySelectorAll(".nav__item").forEach((a) => {
    a.addEventListener("click", closeDrawerOnMobile);
  });

  // 底部外链是原生 <a>，无内置涟漪，手动接上
  document.querySelectorAll(".sidebar__link").forEach((a) => attachRipple(a));

  // 演示页入口：开关由后端 /admin/config 下发（APP_ENABLE_INTRODUCTION_INDEX）。
  // 禁用时拦截点击弹提示；启用 / 请求失败 / 未登录时保持原生新标签打开。
  const demoLink = document.querySelector('.sidebar__link[href="/"]');
  if (demoLink) {
    demoLink.addEventListener("click", async (e) => {
      if (!isAuthenticated()) return;
      e.preventDefault();
      let disabled = false;
      try {
        const cfg = await fetchConfig();
        disabled = !!cfg && cfg.introduction_index === false;
      } catch (_) {
        disabled = false;
      }
      if (!disabled) {
        window.open("/", "_blank", "noopener");
        return;
      }
      openDetailDialog({
        title: t("nav.demoDisabledTitle"),
        renderBody: () => el("p", { text: t("nav.demoDisabled") }),
      });
    });
  }
}

async function handleLogout() {
  try {
    await apiLogout();
  } catch (_) {
    // 即使后端登出失败，仍清本地
  }
  clearSession();
  toastErr(t("auth.loggedOut"), t("auth.sessionCleared"));
  location.hash = LOGIN_ROUTE;
}

// 外观设置：可选主题色（Material 500 系）+ 明暗模式，偏好由 theme.js 持久化
const THEME_COLORS = [
  ["#2196f3", "blue"],
  ["#3f51b5", "indigo"],
  ["#9c27b0", "purple"],
  ["#e91e63", "pink"],
  ["#f44336", "red"],
  ["#ff9800", "orange"],
  ["#4caf50", "green"],
  ["#009688", "teal"],
];

function openThemeDialog() {
  const theme = window.rustalineTheme;
  if (!theme) return;

  const dialog = el("mdui-dialog", {
    class: "theme-dialog",
    headline: t("prefs.title"),
    closeOnEsc: true,
    closeOnOverlayClick: true,
  });

  const body = el("div", { class: "theme-picker" });

  body.appendChild(el("div", { class: "theme-picker__label", text: t("prefs.themeColor") }));
  const swatchRow = el("div", { class: "theme-picker__colors" });
  const currentColor = theme.getColor().toLowerCase();
  const swatchEls = [];
  for (const [hex, colorKey] of THEME_COLORS) {
    const name = t(`color.${colorKey}`);
    const sw = el("button", {
      type: "button",
      class: "theme-picker__swatch",
      style: { background: hex, color: "#fff" },
      attrs: { "aria-label": t("prefs.colorLabel", { name }), title: name },
    });
    if (hex === currentColor) {
      sw.classList.add("is-active");
      sw.appendChild(icon("ok"));
    }
    sw.addEventListener("click", () => {
      theme.setColor(hex);
      for (const s of swatchEls) {
        s.classList.remove("is-active");
        s.replaceChildren();
      }
      sw.classList.add("is-active");
      sw.appendChild(icon("ok"));
    });
    swatchEls.push(sw);
    swatchRow.appendChild(sw);
  }
  body.appendChild(swatchRow);

  body.appendChild(el("div", {
    class: "theme-picker__label",
    style: { marginTop: "14px" },
    text: t("prefs.darkMode"),
  }));
  const modeGroup = el("mdui-segmented-button-group", {
    selects: "single",
    value: theme.getMode(),
  });
  for (const [value, label] of [["auto", t("prefs.modeAuto")], ["light", t("prefs.modeLight")], ["dark", t("prefs.modeDark")]]) {
    modeGroup.appendChild(el("mdui-segmented-button", { value, text: label }));
  }
  modeGroup.addEventListener("change", () => {
    theme.setMode(modeGroup.value);
  });
  body.appendChild(modeGroup);

  body.appendChild(el("div", {
    class: "theme-picker__label",
    style: { marginTop: "14px" },
    text: t("prefs.language"),
  }));
  const langGroup = el("mdui-segmented-button-group", {
    selects: "single",
    value: getLang(),
  });
  for (const [value, label] of [["zh-CN", "中文"], ["en", "English"]]) {
    langGroup.appendChild(el("mdui-segmented-button", { value, text: label }));
  }
  langGroup.addEventListener("change", () => {
    const v = langGroup.value;
    if (v && v !== getLang()) {
      setLang(v);
      // 已渲染视图不做语言响应式，直接刷新整页让全部文案按新语言重建
      location.reload();
    }
  });
  body.appendChild(langGroup);

  dialog.appendChild(body);
  dialog.appendChild(el("mdui-button", {
    slot: "action",
    variant: "text",
    text: t("common.done"),
    onClick: () => {
      dialog.open = false;
    },
  }));

  dialog.addEventListener("closed", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  requestAnimationFrame(() => {
    dialog.open = true;
  });
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.addEventListener("click", openThemeDialog);
}

function initTopbar() {
  const btn = document.getElementById("logout-btn");
  if (btn) btn.addEventListener("click", handleLogout);
  initThemeToggle();

  // 顶部品牌点击 -> 回到仪表盘首页（未登录时由路由守卫兜回登录页）
  const brand = document.querySelector(".topbar__brand");
  if (brand) {
    brand.addEventListener("click", () => {
      location.hash = DEFAULT_ROUTE;
    });
    attachRipple(brand);
  }
}

function init() {
  applyStaticTexts();

  setUnauthorizedHandler(() => {
    if (location.hash !== LOGIN_ROUTE) {
      toastErr(t("auth.sessionExpired"), t("auth.loginAgain"));
      setTimeout(() => {
        location.hash = LOGIN_ROUTE;
      }, 300);
    }
  });

  initSidebar();
  initTopbar();

  window.addEventListener("hashchange", renderRoute);

  badgeTimer = setInterval(refreshPendingBadge, 60_000);

  renderRoute();
}

init();
