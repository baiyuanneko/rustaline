// 应用入口：hash 路由、auth guard、mdui 外壳联动、待审角标。

import {
  isAuthenticated,
  getUsername,
  clearSession,
  logout as apiLogout,
  setUnauthorizedHandler,
  fetchStats,
} from "./api.js";
import { toastErr } from "./components.js";
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

async function renderRoute() {
  const hash = currentHash();
  const route = ROUTES[hash];

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

async function mountView(viewModule) {
  const app = appEl();
  if (!app) return;
  app.replaceChildren();
  if (viewModule.cleanup) {
    try {
      viewModule.cleanup();
    } catch (_) { /* noop */ }
  }
  try {
    await viewModule.render(app);
  } catch (err) {
    app.replaceChildren();
    const errBox = document.createElement("div");
    errBox.className = "page-card mdui-card page-card__body";
    errBox.style.color = "rgb(var(--mdui-color-error))";
    errBox.textContent = `页面加载失败：${err && err.message ? err.message : err}`;
    app.appendChild(errBox);
  }
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
}

async function handleLogout() {
  try {
    await apiLogout();
  } catch (_) {
    // 即使后端登出失败，仍清本地
  }
  clearSession();
  toastErr("已登出", "登录状态已清除");
  location.hash = LOGIN_ROUTE;
}

function initTopbar() {
  const btn = document.getElementById("logout-btn");
  if (btn) btn.addEventListener("click", handleLogout);
}

function init() {
  setUnauthorizedHandler(() => {
    if (location.hash !== LOGIN_ROUTE) {
      toastErr("登录已失效", "请重新登录");
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
