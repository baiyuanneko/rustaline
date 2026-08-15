import { fetchConfig } from "../api.js";
import { loadingScreen, emptyState, toastErr, el } from "../components.js";

export async function render(container) {
  container.appendChild(pageHead());

  const loading = loadingScreen("加载配置…");
  container.appendChild(loading);

  try {
    const cfg = await fetchConfig();
    loading.remove();
    container.appendChild(renderConfig(cfg));
  } catch (err) {
    loading.remove();
    container.appendChild(
      emptyState({
        title: "配置加载失败",
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
  titles.appendChild(el("h1", { class: "page-title", text: "设置" }));
  titles.appendChild(el("div", { class: "page-subtitle", text: "评论模块当前生效配置（只读）" }));
  head.appendChild(titles);
  return head;
}

function renderConfig(cfg) {
  const wrap = el("div");
  const comment = (cfg && cfg.comment) || {};
  const version = cfg && cfg.version ? String(cfg.version) : "—";

  const card = el("mdui-card", { class: "page-card" });
  const header = el("div", { class: "page-card__header" });
  header.appendChild(el("div", { class: "page-card__title", text: "comment 配置" }));
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  const dl = el("div", { class: "kv-list" });

  const rows = [
    ["moderation", comment.moderation, "新评论是否需要审核（true 时为 pending，否则直接 approved）"],
    ["max_length", comment.max_length, "评论最大字符数"],
    ["rate_limit_per_minute", comment.rate_limit_per_minute, "单 IP 每分钟最多提交数"],
    ["default_nick", comment.default_nick, "未提供昵称时的默认值"],
    ["version", version, "后端版本号"],
  ];

  for (const [k, v, hint] of rows) {
    const key = el("div", { class: "kv-list__key", text: k });
    if (hint) key.title = hint;
    const val = el("div", { class: "kv-list__val" });
    val.appendChild(el("code", { text: formatVal(v) }));
    dl.appendChild(key);
    dl.appendChild(val);
  }
  body.appendChild(dl);

  const note = el("div", { class: "page-subtitle", style: { marginTop: "20px", lineHeight: "1.8" } });
  note.appendChild(document.createTextNode("如需修改配置，请编辑 "));
  note.appendChild(el("code", { text: "config/local.toml" }));
  note.appendChild(document.createTextNode(" 或设置环境变量（如 "));
  note.appendChild(el("code", { text: "APP_COMMENT__MODERATION=true" }));
  note.appendChild(document.createTextNode("），重启服务后生效。"));
  body.appendChild(note);

  card.appendChild(body);
  wrap.appendChild(card);
  return wrap;
}

function formatVal(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function cleanup() {}
