import { fetchConfig, saveConfig, testMail, fetchMailStatus } from "../api.js";
import { el, formatTime } from "../components.js";
import { t } from "../i18n.js";

// Every editable setting is explicitly listed; no response-only field enters PATCH.
const GROUPS = [
  ["comment", "settings.commentConfig", [
    ["moderation", "switch"], ["max_length", "number", 1],
    ["rate_limit_per_minute", "number", 0], ["default_nick", "text", 64],
    ["avatar_cdn", "text", 2048], ["display_commenter_user_agent", "switch"],
  ]],
  ["captcha", "settings.captchaConfig", [
    ["pow_enabled", "switch"], ["pow_difficulty", "number", 1, 8],
    ["pow_ttl_secs", "number", 0, 31536000], ["image_enabled", "switch"],
    ["image_ttl_secs", "number", 0, 31536000], ["image_max_attempts", "number", 0],
    ["bind_ip", "switch"],
  ]],
  ["mail", "settings.mailConfig", [
    ["enabled", "switch"], ["host", "text", 255], ["port", "number", 1, 65535],
    ["security", "select", ["starttls", "tls", "none"]],
    ["username", "text", 255], ["from_email", "email", 254],
    ["from_name", "text", 255], ["admin_email", "email", 254],
    ["notify_admin", "switch"], ["notify_reply", "switch"],
    ["site_name", "text", 255], ["site_url", "url", 2048],
    ["language", "select", ["zh-CN", "en"]],
  ]],
];

function makeCard(title) {
  const card = el("mdui-card", { class: "page-card" });
  const header = el("div", { class: "page-card__header" });
  header.appendChild(el("div", { class: "page-card__title", text: t(title) }));
  const body = el("div", { class: "page-card__body" });
  card.append(header, body);
  return { card, body };
}

export function renderRuntimeSettings(initial) {
  const wrap = el("div", { class: "settings-runtime" });
  let cfg = initial;
  let busy = false;
  let dirty = false;
  const fields = {};
  const form = el("form", { class: "settings-form", onsubmit: (event) => event.preventDefault() });
  const state = el("div", { class: "settings-state", role: "status" });
  const error = el("div", { class: "password-form__error", role: "alert", hidden: true });
  const save = el("mdui-button", { variant: "filled", text: t("settings.save") });
  const reload = el("mdui-button", { variant: "text", text: t("settings.reload") });

  function markDirty() {
    dirty = true;
    state.textContent = t("settings.unsaved");
  }

  for (const [group, title, descriptors] of GROUPS) {
    const { card, body } = makeCard(title);
    const grid = el("div", { class: "settings-grid" });
    fields[group] = {};
    for (const [key, type, limit, max] of descriptors) {
      const label = t(`settings.field.${key}`);
      let control;
      if (type === "switch") {
        control = el("mdui-switch");
        control.className = "settings-switch";
        control.setAttribute("aria-label", label);
      } else if (type === "select") {
        control = el("mdui-select", { label, variant: "filled" });
        for (const option of limit) {
          control.appendChild(el("mdui-menu-item", { value: option, text: t(`settings.option.${option}`) }));
        }
      } else {
        control = el("mdui-text-field", { label, type, variant: "filled" });
        if (type === "number") {
          control.min = limit;
          if (max != null) control.max = max;
          control.step = 1;
          control.required = true;
        } else control.maxLength = limit;
      }
      control.dataset.setting = `${group}.${key}`;
      control.addEventListener("input", markDirty);
      control.addEventListener("change", markDirty);
      fields[group][key] = { control, type, min: limit, max };
      const slot = el("div", { class: "settings-field" });
      if (type === "switch") slot.appendChild(el("label", { class: "settings-switch-row" }, el("span", { text: label }), control));
      else slot.appendChild(control);
      const hintKey = key === "rate_limit_per_minute" ? "settings.rateHint"
        : key === "avatar_cdn" ? "settings.hintAvatarCdn" : null;
      if (hintKey) slot.appendChild(el("div", { class: "settings-hint", text: t(hintKey) }));
      grid.appendChild(slot);
    }
    body.appendChild(grid);
    if (group === "captcha") body.appendChild(el("p", { class: "settings-hint", text: t("settings.captchaHint") }));
    form.appendChild(card);
  }

  const password = el("mdui-text-field", {
    label: t("settings.smtpPassword"), type: "password", variant: "filled",
    togglePassword: true, autocomplete: "new-password", maxLength: 4096,
    supportingText: t("settings.smtpPasswordHint"),
  });
  const clearPassword = el("mdui-checkbox", { text: t("settings.clearSmtpPassword") });
  const passwordState = el("div", { class: "settings-hint" });
  password.addEventListener("input", () => {
    clearPassword.disabled = busy || password.value !== "";
    markDirty();
  });
  clearPassword.addEventListener("change", () => {
    password.disabled = busy || clearPassword.checked;
    markDirty();
  });
  form.lastChild.querySelector(".page-card__body").append(
    el("div", { class: "settings-password" }, password, passwordState, clearPassword)
  );

  const actions = el("div", { class: "settings-actions" }, save, reload, state);
  form.append(error, actions);
  wrap.appendChild(form);
  const controls = () => [...Object.values(fields).flatMap(group => Object.values(group).map(field => field.control)), password, clearPassword];

  function setBusy(value) {
    busy = value;
    controls().forEach(control => { control.disabled = value; });
    password.disabled = value || clearPassword.checked;
    clearPassword.disabled = value || password.value !== "";
    save.disabled = value;
    save.loading = value;
    reload.disabled = value;
  }

  function populate(next) {
    cfg = next;
    for (const [group, descriptors] of Object.entries(fields)) {
      const source = group === "captcha" ? cfg.comment.captcha : cfg[group];
      for (const [key, { control, type }] of Object.entries(descriptors)) {
        if (type === "switch") control.checked = !!source[key];
        else control.value = String(source[key] ?? "");
      }
    }
    password.value = "";
    clearPassword.checked = false;
    passwordState.textContent = t(cfg.mail.password_needs_reset ? "settings.passwordResetRequired"
      : cfg.mail.password_configured ? "settings.passwordConfigured" : "settings.passwordNotConfigured");
    dirty = false;
    state.textContent = t("settings.savedRevision", { revision: cfg.revision });
    error.hidden = true;
    setBusy(false);
  }

  function readGroup(group) {
    const result = {};
    const source = group === "captcha" ? cfg.comment.captcha : cfg[group];
    for (const [key, { control, type, min, max }] of Object.entries(fields[group])) {
      const current = type === "switch" ? !!control.checked : String(control.value ?? "");
      const previous = type === "switch" ? !!source[key] : String(source[key] ?? "");
      if (current === previous) continue;
      if (type === "switch") result[key] = !!control.checked;
      else if (type === "number") {
        const raw = String(control.value).trim();
        const value = Number(raw);
        if (!raw || !Number.isSafeInteger(value) || value < min || (max != null && value > max)) {
          throw new Error(t("settings.invalidNumber", { field: t(`settings.field.${key}`) }));
        }
        result[key] = value;
      } else result[key] = String(control.value ?? "").trim();
      if (control.reportValidity && !control.reportValidity()) throw new Error(t("settings.invalidField", { field: t(`settings.field.${key}`) }));
    }
    return result;
  }

  save.addEventListener("click", async () => {
    if (busy) return;
    error.hidden = true;
    try {
      const comment = readGroup("comment");
      const captcha = readGroup("captcha");
      if (Object.keys(captcha).length) comment.captcha = captcha;
      const mail = readGroup("mail");
      if (clearPassword.checked) mail.clear_password = true;
      else if (password.value !== "") mail.password = password.value; // Password whitespace is significant.
      setBusy(true);
      state.textContent = t("settings.saving");
      const patch = { revision: cfg.revision };
      if (Object.keys(comment).length) patch.comment = comment;
      if (Object.keys(mail).length) patch.mail = mail;
      if (!patch.comment && !patch.mail) { populate(cfg); return; }
      const saved = await saveConfig(patch);
      populate(saved);
    } catch (err) {
      error.textContent = err.status === 409 ? t("settings.conflict") : err.message || String(err);
      error.hidden = false;
      state.textContent = dirty ? t("settings.unsaved") : "";
    } finally { setBusy(false); }
  });
  reload.addEventListener("click", async () => {
    if (busy) return;
    if (dirty && !window.confirm(t("settings.discardConfirm"))) return;
    setBusy(true);
    try { populate(await fetchConfig()); }
    catch (err) { error.textContent = err.message || String(err); error.hidden = false; }
    finally { setBusy(false); }
  });
  populate(cfg);
  wrap.appendChild(renderMailTools());
  wrap.appendChild(el("p", { class: "settings-hint", text: t("settings.runtimeNote", { version: cfg.version || "—" }) }));
  return wrap;
}

function renderMailTools() {
  const { card, body } = makeCard("settings.mailTools");
  body.appendChild(el("p", { class: "settings-hint", text: t("settings.testSavedHint") }));
  const to = el("mdui-text-field", { label: t("settings.testRecipient"), type: "email", required: true, variant: "filled", maxLength: 254 });
  const test = el("mdui-button", { variant: "tonal", text: t("settings.sendTest") });
  const refresh = el("mdui-button", { variant: "text", text: t("settings.refreshMailStatus") });
  const result = el("div", { class: "settings-state", role: "status" });
  const status = el("div", { class: "settings-mail-status", role: "status" });
  body.append(to, el("div", { class: "settings-actions" }, test, refresh), result, status);
  async function loadStatus() {
    refresh.disabled = true;
    try {
      const data = await fetchMailStatus();
      status.replaceChildren();
      for (const [label, value] of [
        ["settings.mailPending", data.pending], ["settings.mailFailed", data.failed],
        ["settings.mailLastSuccess", data.last_success_at ? formatTime(data.last_success_at) : t("settings.noMailHistory")],
        ["settings.mailLastError", data.last_error || t("settings.noMailHistory")],
      ]) status.appendChild(el("div", {}, el("span", { text: t(label) }), el("strong", { text: String(value ?? "—") })));
    } catch (err) { status.textContent = t("settings.mailStatusFailed") + " · " + (err.message || String(err)); }
    finally { refresh.disabled = false; }
  }
  test.addEventListener("click", async () => {
    if (test.disabled || !to.reportValidity()) return;
    test.disabled = true; test.loading = true; to.disabled = true;
    result.textContent = t("settings.testSending");
    try { await testMail(to.value.trim()); result.textContent = t("settings.testSent"); }
    catch (err) { result.textContent = t("settings.testFailed") + " · " + (err.message || String(err)); }
    finally { test.disabled = false; test.loading = false; to.disabled = false; await loadStatus(); }
  });
  refresh.addEventListener("click", loadStatus);
  loadStatus();
  return card;
}
