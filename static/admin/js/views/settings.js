import { fetchConfig } from "../api.js";
import { loadingScreen, emptyState, toastErr } from "../components.js";

export async function render(container) {
  container.appendChild(pageHead());

  const loading = loadingScreen("加载配置…");
  container.appendChild(loading);

  try {
    const cfg = await fetchConfig();
    container.removeChild(loading);
    container.appendChild(renderConfig(cfg));
  } catch (err) {
    container.removeChild(loading);
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
  const head = document.createElement("div");
  head.className = "page-head";
  const titles = document.createElement("div");
  titles.className = "page-head__titles";
  const t = document.createElement("h1");
  t.className = "page-title";
  t.textContent = "设置";
  const s = document.createElement("div");
  s.className = "page-subtitle";
  s.textContent = "评论模块当前生效配置（只读）";
  titles.appendChild(t);
  titles.appendChild(s);
  head.appendChild(titles);
  return head;
}

function renderConfig(cfg) {
  const wrap = document.createElement("div");

  const comment = (cfg && cfg.comment) || {};
  const version = cfg && cfg.version ? String(cfg.version) : "—";

  const card = document.createElement("div");
  card.className = "card";

  const header = document.createElement("div");
  header.className = "card__header";
  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = "comment 配置";
  header.appendChild(title);
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "card__body";

  const dl = document.createElement("div");
  dl.className = "kv-list";

  const rows = [
    ["moderation", comment.moderation, "新评论是否需要审核（true 时为 pending，否则直接 approved）"],
    ["max_length", comment.max_length, "评论最大字符数"],
    ["rate_limit_per_minute", comment.rate_limit_per_minute, "单 IP 每分钟最多提交数"],
    ["default_nick", comment.default_nick, "未提供昵称时的默认值"],
    ["version", version, "后端版本号"],
  ];

  for (const [k, v, hint] of rows) {
    const key = document.createElement("div");
    key.className = "kv-list__key";
    key.textContent = k;
    if (hint) key.title = hint;

    const val = document.createElement("div");
    val.className = "kv-list__val";
    const code = document.createElement("code");
    code.textContent = formatVal(v);
    val.appendChild(code);

    dl.appendChild(key);
    dl.appendChild(val);
  }

  body.appendChild(dl);

  const note = document.createElement("div");
  note.className = "mt-6";
  note.style.padding = "12px 16px";
  note.style.background = "var(--surface-2)";
  note.style.border = "1px solid var(--border)";
  note.style.borderRadius = "var(--radius)";
  note.style.color = "var(--text-muted)";
  note.style.fontSize = "13px";
  note.style.lineHeight = "1.7";
  note.appendChild(document.createTextNode("如需修改配置，请编辑 "));
  const code1 = document.createElement("code");
  code1.textContent = "config/local.toml";
  note.appendChild(code1);
  note.appendChild(document.createTextNode(" 或设置环境变量（如 "));
  const code2 = document.createElement("code");
  code2.textContent = "APP_COMMENT__MODERATION=true";
  note.appendChild(code2);
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
