import { fetchConfig, changePassword, clearSession } from "../api.js";
import { loadingScreen, emptyState, toastErr, toastOk, el } from "../components.js";
import { t } from "../i18n.js";
import { renderRuntimeSettings } from "./settings-runtime.js";

export async function render(container) {
  container.appendChild(pageHead());

  const loading = loadingScreen(t("settings.loading"));
  container.appendChild(loading);

  try {
    const cfg = await fetchConfig();
    loading.remove();
    container.appendChild(renderRuntimeSettings(cfg, renderPasswordCard()));
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
    // 配置读取失败时仍提供独立的改密入口。
    container.appendChild(renderPasswordCard());
  }
}

function pageHead() {
  const head = el("div", { class: "page-head" });
  const titles = el("div", { class: "page-head__titles" });
  titles.appendChild(el("h1", { class: "page-title", text: t("settings.title") }));
  titles.appendChild(el("div", { class: "page-subtitle", text: t("settings.subtitle") }));
  head.appendChild(titles);
  return head;
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
