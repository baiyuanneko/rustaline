// API 客户端：fetch 封装、token 注入、401 拦截、错误归一化。
// 字段契约来源：.sisyphus/plans/valine-replacement.md §3。

import { t } from "./i18n.js";

const BASE = "/api/v1";
const TOKEN_KEY = "rustaline.admin.token";
const USERNAME_KEY = "rustaline.admin.username";
const EXPIRES_KEY = "rustaline.admin.expires_at";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUsername() {
  return localStorage.getItem(USERNAME_KEY) || "";
}

export function getExpiresAt() {
  const v = localStorage.getItem(EXPIRES_KEY);
  return v ? Number(v) : null;
}

export function setSession({ access_token, expires_in }, username) {
  localStorage.setItem(TOKEN_KEY, access_token);
  if (username) localStorage.setItem(USERNAME_KEY, username);
  const expiresAt = expires_in ? Date.now() + expires_in * 1000 : null;
  if (expiresAt) localStorage.setItem(EXPIRES_KEY, String(expiresAt));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
  localStorage.removeItem(EXPIRES_KEY);
}

export function isAuthenticated() {
  const token = getToken();
  if (!token) return false;
  const exp = getExpiresAt();
  if (exp && Date.now() > exp) return false;
  return true;
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request(path, { method = "GET", body, signal, raw = false } = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const headers = { Accept: "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let payload;
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let resp;
  try {
    resp = await fetch(url, { method, headers, body: payload, signal });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    throw new ApiError(0, 0, t("api.networkError", { msg: err.message || t("api.networkDown") }));
  }

  if (resp.status === 401) {
    clearSession();
    if (onUnauthorized) onUnauthorized();
    let errMsg = t("api.unauthorized");
    try {
      const errBody = await resp.clone().json();
      if (errBody && errBody.message) errMsg = errBody.message;
    } catch (_) { /* noop */ }
    throw new ApiError(401, 401, errMsg);
  }

  if (resp.status === 204) return null;

  if (raw) return resp;

  const text = await resp.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
  }

  if (!resp.ok) {
    const code = data && typeof data === "object" && "code" in data ? data.code : resp.status;
    const message =
      (data && typeof data === "object" && "message" in data && data.message) ||
      t("api.requestFailed", { status: resp.status });
    throw new ApiError(resp.status, code, message, data);
  }

  return data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: "GET" }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
  del: (path, opts) => request(path, { ...opts, method: "DELETE" }),
  request,
};

export function login(username, password) {
  return api.post("/auth/login", { username, password });
}

export function logout() {
  // 401 时本地 session 已被 request() 清掉，无需再抛
  return api.post("/auth/logout").catch((err) => {
    if (err.status === 401) return;
    throw err;
  });
}
export function fetchComments({ status = "", url = "", keyword = "", from = "", page = 1, page_size = 20 } = {}) {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (url) qs.set("url", url);
  if (keyword) qs.set("keyword", keyword);
  if (from) qs.set("from", from);
  qs.set("page", String(page));
  qs.set("page_size", String(page_size));
  return api.get(`/admin/comments?${qs.toString()}`);
}

export function patchComment(id, status) {
  return api.patch(`/admin/comments/${encodeURIComponent(id)}`, { status });
}

export function deleteComment(id) {
  return api.del(`/admin/comments/${encodeURIComponent(id)}`);
}

export function importValineBatch(results, signal) {
  return api.post("/admin/comments/import/valine", { results }, { signal });
}

export function fetchStats() {
  return api.get("/admin/comments/stats");
}

export function fetchConfig() {
  return api.get("/admin/config");
}

export function changePassword(currentPassword, newPassword) {
  return api.post("/admin/account/password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
