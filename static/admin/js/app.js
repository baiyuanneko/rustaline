// 应用入口：hash 路由、auth guard、侧边栏与顶栏联动、待审角标。

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

const appEl = () => document.getElementById("app");

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
  refreshPendingBadge();
}

async function mountView(viewModule) {
  const app = appEl();
  if (!app) return;
  app.innerHTML = "";
  if (viewModule.cleanup) {
    try {
      viewModule.cleanup();
    } catch (_) { /* noop */ }
  }
  try {
    await viewModule.render(app);
  } catch (err) {
    app.innerHTML = "";
    const errBox = document.createElement("div");
    errBox.className = "card card__body";
    errBox.style.color = "var(--danger)";
    errBox.textContent = `页面加载失败：${err && err.message ? err.message : err}`;
    app.appendChild(errBox);
  }
}

function setActiveNav(navKey) {
  document.querySelectorAll(".nav__item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.route === navKey);
  });
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
  } catch (err) {
    // 401 已由全局拦截器处理；其余错误（如服务未就绪）静默，不打扰用户
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
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("sidebar-scrim");
  if (!toggle || !sidebar || !scrim) return;

  const open = () => {
    sidebar.classList.add("is-open");
    scrim.hidden = false;
    scrim.classList.add("is-open");
  };
  const close = () => {
    sidebar.classList.remove("is-open");
    scrim.classList.remove("is-open");
    scrim.hidden = true;
  };
  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("is-open")) close();
    else open();
  });
  scrim.addEventListener("click", close);
  document.querySelectorAll(".nav__item").forEach((a) => {
    a.addEventListener("click", close);
  });
}

async function handleLogout() {
  try {
    await apiLogout();
  } catch (err) {
    // 即使后端登出失败（如服务不可达），仍清本地
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
  window.addEventListener("DOMContentLoaded", () => {
    if (!location.hash) location.hash = DEFAULT_ROUTE;
  });

  badgeTimer = setInterval(refreshPendingBadge, 60_000);

  renderRoute();
}

init();
