import { fetchConfig, changePassword, clearSession } from "../api.js";
import { loadingScreen, emptyState, toastErr, toastOk, el } from "../components.js";
import { t } from "../i18n.js";

export async function render(container) {
  container.appendChild(pageHead());

  const loading = loadingScreen(t("settings.loading"));
  container.appendChild(loading);

  try {
    const cfg = await fetchConfig();
    loading.remove();
    container.appendChild(renderConfig(cfg));
  } catch (err) {
    loading.remove();
    container.appendChild(
      emptyState({
        title: t("settings.loadFailed"),
        hint: err.message || String(err),
        icon: "warn",
      })
    );
    if (err.status !== 401) toastErr(t("common.loadFailed"), err.message);
  }

  // 改密卡片与配置加载解耦：配置加载失败也应能改密码
  container.appendChild(renderPasswordCard());
}

function pageHead() {
  const head = el("div", { class: "page-head" });
  const titles = el("div", { class: "page-head__titles" });
  titles.appendChild(el("h1", { class: "page-title", text: t("settings.title") }));
  titles.appendChild(el("div", { class: "page-subtitle", text: t("settings.subtitle") }));
  head.appendChild(titles);
  return head;
}

function renderConfig(cfg) {
  const wrap = el("div");
  const comment = (cfg && cfg.comment) || {};
  const version = cfg && cfg.version ? String(cfg.version) : "—";

  const card = el("mdui-card", { class: "page-card" });
  const header = el("div", { class: "page-card__header" });
  header.appendChild(el("div", { class: "page-card__title", text: t("settings.commentConfig") }));
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  const dl = el("div", { class: "kv-list" });

  const rows = [
    ["moderation", comment.moderation, t("settings.hintModeration")],
    ["max_length", comment.max_length, t("settings.hintMaxLength")],
    ["rate_limit_per_minute", comment.rate_limit_per_minute, t("settings.hintRateLimit")],
    ["default_nick", comment.default_nick, t("settings.hintDefaultNick")],
    ["avatar_cdn", comment.avatar_cdn || t("settings.emptyValue"), t("settings.hintAvatarCdn")],
    ["version", version, t("settings.hintVersion")],
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
  note.appendChild(document.createTextNode(t("settings.configNotePre")));
  note.appendChild(el("code", { text: "config/local.toml" }));
  note.appendChild(document.createTextNode(t("settings.configNoteMid")));
  note.appendChild(el("code", { text: "APP_COMMENT__MODERATION=true" }));
  note.appendChild(document.createTextNode(t("settings.configNotePost")));
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

function renderPasswordCard() {
  const card = el("mdui-card", { class: "page-card" });
  const header = el("div", { class: "page-card__header" });
  header.appendChild(el("div", { class: "page-card__title", text: t("settings.accountSecurity") }));
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  body.appendChild(el("div", {
    class: "page-subtitle",
    style: { lineHeight: "1.8", marginBottom: "16px" },
    text: t("settings.passwordNote"),
  }));
  body.appendChild(el("mdui-button", {
    variant: "tonal",
    text: t("settings.changePassword"),
    onClick: openPasswordDialog,
  }));
  card.appendChild(body);
  return card;
}

function openPasswordDialog() {
  const dialog = el("mdui-dialog", {
    headline: t("settings.changePassword"),
    closeOnEsc: true,
    closeOnOverlayClick: true,
  });

  const form = el("form", {
    class: "password-form",
    autocomplete: "off",
    onsubmit: (e) => e.preventDefault(),
  });

  const currentField = el("mdui-text-field", {
    label: t("settings.currentPassword"),
    type: "password",
    variant: "filled",
    autocomplete: "current-password",
    togglePassword: true,
    required: true,
  });
  const newField = el("mdui-text-field", {
    label: t("settings.newPassword"),
    type: "password",
    variant: "filled",
    autocomplete: "new-password",
    togglePassword: true,
    required: true,
  });
  const confirmField = el("mdui-text-field", {
    label: t("settings.confirmPassword"),
    type: "password",
    variant: "filled",
    autocomplete: "new-password",
    togglePassword: true,
    required: true,
  });

  const errBox = el("div", { class: "password-form__error", role: "alert", hidden: true });
  const showErr = (msg) => {
    errBox.textContent = msg;
    errBox.hidden = false;
  };

  form.appendChild(currentField);
  form.appendChild(newField);
  form.appendChild(confirmField);
  form.appendChild(errBox);
  dialog.appendChild(form);

  const cancelBtn = el("mdui-button", {
    slot: "action",
    variant: "text",
    text: t("common.cancel"),
    onClick: () => {
      dialog.open = false;
    },
  });
  const submitBtn = el("mdui-button", {
    slot: "action",
    variant: "filled",
    text: t("settings.updatePassword"),
  });
  dialog.append(cancelBtn, submitBtn);

  dialog.addEventListener("closed", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  requestAnimationFrame(() => {
    dialog.open = true;
  });

  submitBtn.addEventListener("click", async () => {
    const current = currentField.value;
    const next = newField.value;
    const confirm = confirmField.value;
    errBox.hidden = true;

    if (!current || !next || !confirm) return showErr(t("settings.fillAll"));
    if (next.length < 8) return showErr(t("settings.tooShort"));
    if (next !== confirm) return showErr(t("settings.mismatch"));

    submitBtn.loading = true;
    submitBtn.disabled = true;
    try {
      await changePassword(current, next);
      dialog.open = false;
      toastOk(t("settings.updated"), t("settings.updatedMsg"));
      // 服务端已自增 token_version，本地会话同步清除后跳登录页
      clearSession();
      setTimeout(() => {
        location.hash = "#/login";
      }, 600);
    } catch (err) {
      showErr(err.message || String(err));
      submitBtn.loading = false;
      submitBtn.disabled = false;
    }
  });
}

export function cleanup() {}
