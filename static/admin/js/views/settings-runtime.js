import { fetchConfig, saveConfig, testMail, fetchMailStatus } from "../api.js";
import { el, icon, formatTime } from "../components.js";
import { t } from "../i18n.js";

const SECTIONS = [
  ["comment", "settings.commentConfig", "settings.commentDescription", [
    ["settings.commentBasics", "comment", [
      ["default_nick", "text", 64], ["max_length", "number", 1],
      ["rate_limit_per_minute", "number", 0], ["moderation", "switch"],
    ]],
    ["settings.commentDisplay", "comment", [
      ["avatar_cdn", "text", 2048], ["display_commenter_user_agent", "switch"],
    ]],
  ]],
  ["captcha", "settings.captchaConfig", "settings.captchaDescription", [
    ["settings.powSection", "captcha", [
      ["pow_enabled", "switch"], ["pow_difficulty", "number", 1, 8],
      ["pow_ttl_secs", "number", 0, 31536000], ["bind_ip", "switch"],
    ]],
    ["settings.imageSection", "captcha", [
      ["image_enabled", "switch"], ["image_ttl_secs", "number", 0, 31536000],
      ["image_max_attempts", "number", 0],
    ]],
  ]],
  ["smtp", "settings.smtpConnection", "settings.smtpDescription", [
    ["settings.smtpServer", "mail", [
      ["enabled", "switch"], ["host", "text", 255], ["port", "number", 1, 65535],
      ["security", "select", ["starttls", "tls", "none"]],
    ]],
    ["settings.smtpCredentials", "mail", [["username", "text", 255]]],
  ]],
  ["mail", "settings.mailNotifications", "settings.mailDescription", [
    ["settings.notificationRules", "mail", [
      ["notify_admin", "switch"], ["admin_email", "email", 254], ["notify_reply", "switch"],
    ]],
    ["settings.senderSection", "mail", [["from_email", "email", 254], ["from_name", "text", 255]]],
    ["settings.siteSection", "mail", [
      ["site_name", "text", 255], ["site_url", "url", 2048],
      ["language", "select", ["zh-CN", "en"]],
    ]],
  ]],
  ["delivery", "settings.mailTools", "settings.deliveryDescription", []],
  ["account", "settings.accountSecurity", "settings.accountDescription", []],
];

export function renderRuntimeSettings(initial, accountCard) {
  let cfg = initial;
  let busy = false;
  let dirty = false;
  const fields = { comment: {}, captcha: {}, mail: {} };
  const panels = new Map();
  const folders = new Map();
  const wrap = el("div", { class: "settings-workspace" });
  const navigation = el("nav", { class: "settings-folders", attrs: { "aria-label": t("settings.folders") } });
  navigation.appendChild(el("div", { class: "settings-folders__title", text: t("settings.folders") }));
  const form = el("form", { class: "settings-editor", onsubmit: event => event.preventDefault() });
  const content = el("div", { class: "settings-content" });
  const state = el("div", { class: "settings-state", role: "status", text: t("settings.upToDate") });
  const error = el("div", { class: "password-form__error", role: "alert", hidden: true });
  const save = el("mdui-button", { variant: "filled", text: t("settings.save") });
  const reload = el("mdui-button", { variant: "text", text: t("settings.reload") });
  let delivery;

  function markDirty() {
    dirty = true;
    state.textContent = t("settings.unsaved");
    save.disabled = busy;
  }

  function selectFolder(id) {
    for (const [key, panel] of panels) panel.hidden = key !== id;
    for (const [key, button] of folders) {
      button.classList.toggle("is-active", key === id);
      button.setAttribute("aria-pressed", String(key === id));
    }
    if (id === "delivery") delivery.load();
  }

  function createField(group, folder, descriptor) {
    const [key, type, min, max] = descriptor;
    const label = t(`settings.field.${key}`);
    let control;
    if (type === "switch") {
      control = el("mdui-switch", { class: "settings-switch", attrs: { "aria-label": label } });
    } else if (type === "select") {
      control = el("mdui-select", { label, variant: "outlined" });
      for (const option of min) control.appendChild(el("mdui-menu-item", { value: option, text: t(`settings.option.${option}`) }));
    } else {
      control = el("mdui-text-field", { label, type, variant: "outlined" });
      if (type === "number") {
        control.min = min;
        if (max != null) control.max = max;
        control.step = 1;
        control.required = true;
      } else control.maxLength = min;
    }
    control.dataset.setting = `${group}.${key}`;
    control.addEventListener("input", markDirty);
    control.addEventListener("change", markDirty);
    fields[group][key] = { control, type, min, max, folder };
    const slot = el("div", { class: `settings-field${type === "switch" ? " settings-field--switch" : ""}` });
    if (type === "switch") slot.appendChild(el("label", { class: "settings-switch-row" }, el("span", { text: label }), control));
    else slot.appendChild(control);
    const hint = key === "rate_limit_per_minute" ? "settings.rateHint"
      : key === "avatar_cdn" ? "settings.hintAvatarCdn" : null;
    if (hint) slot.appendChild(el("div", { class: "settings-hint", text: t(hint) }));
    return slot;
  }

  for (const [id, title, description, groups] of SECTIONS) {
    const button = el("button", {
      type: "button", class: "settings-folder", dataset: { folder: id },
      attrs: { "aria-controls": `settings-panel-${id}`, "aria-pressed": "false" },
      onClick: () => selectFolder(id),
    }, icon("folder"), el("span", { text: t(title) }));
    navigation.appendChild(button);
    folders.set(id, button);
    const panel = el("section", {
      class: "settings-panel", id: `settings-panel-${id}`, hidden: true,
      attrs: { "aria-labelledby": `settings-title-${id}` },
    });
    panel.appendChild(el("header", { class: "settings-panel__header" },
      el("h2", { id: `settings-title-${id}`, text: t(title) }),
      el("p", { text: t(description) })));
    for (const [heading, group, descriptors] of groups) {
      const section = el("fieldset", { class: "settings-section" }, el("legend", { text: t(heading) }));
      const grid = el("div", { class: "settings-grid" });
      descriptors.forEach(descriptor => grid.appendChild(createField(group, id, descriptor)));
      section.appendChild(grid);
      panel.appendChild(section);
    }
    if (id === "captcha") panel.appendChild(el("p", { class: "settings-hint", text: t("settings.captchaHint") }));
    if (id === "delivery") {
      delivery = renderMailTools();
      panel.appendChild(delivery.element);
    }
    if (id === "account" && accountCard) panel.appendChild(accountCard);
    panels.set(id, panel);
    content.appendChild(panel);
  }

  const password = el("mdui-text-field", {
    label: t("settings.smtpPassword"), type: "password", variant: "outlined", dataset: { setting: "mail.password" },
    togglePassword: true, autocomplete: "new-password", maxLength: 4096,
    supportingText: t("settings.smtpPasswordHint"),
  });
  const passwordState = el("div", { class: "settings-hint settings-password-state" });
  password.addEventListener("input", markDirty);
  panels.get("smtp").querySelector(".settings-section:last-child .settings-grid").appendChild(
    el("div", { class: "settings-field settings-password" }, password, passwordState));

  const actions = el("div", { class: "settings-savebar" },
    el("div", { class: "settings-savebar__state" }, error, state),
    el("div", { class: "settings-savebar__buttons" }, reload, save));
  form.append(content, actions);
  wrap.append(navigation, form);

  const controls = () => [...Object.values(fields).flatMap(group => Object.values(group).map(field => field.control)), password];
  function setBusy(value) {
    busy = value;
    controls().forEach(control => { control.disabled = value; });
    save.disabled = value || !dirty;
    save.loading = value;
    reload.disabled = value;
  }

  function populate(next, saved = false) {
    cfg = next;
    for (const [group, descriptors] of Object.entries(fields)) {
      const source = group === "captcha" ? cfg.comment.captcha : cfg[group];
      for (const [key, { control, type }] of Object.entries(descriptors)) {
        if (type === "switch") control.checked = !!source[key];
        else control.value = String(source[key] ?? "");
      }
    }
    password.value = "";
    passwordState.textContent = t(cfg.mail.password_needs_reset ? "settings.passwordResetRequired"
      : cfg.mail.password_configured ? "settings.passwordConfigured" : "settings.passwordNotConfigured");
    dirty = false;
    state.textContent = t(saved ? "settings.saved" : "settings.upToDate");
    error.hidden = true;
    setBusy(false);
  }

  function readGroup(group) {
    const result = {};
    const source = group === "captcha" ? cfg.comment.captcha : cfg[group];
    for (const [key, { control, type, min, max, folder }] of Object.entries(fields[group])) {
      const current = type === "switch" ? !!control.checked : String(control.value ?? "");
      const previous = type === "switch" ? !!source[key] : String(source[key] ?? "");
      if (current === previous) continue;
      if (type === "switch") result[key] = !!control.checked;
      else if (type === "number") {
        const raw = String(control.value).trim();
        const value = Number(raw);
        if (!raw || !Number.isSafeInteger(value) || value < min || (max != null && value > max)) {
          selectFolder(folder);
          throw new Error(t("settings.invalidNumber", { field: t(`settings.field.${key}`) }));
        }
        result[key] = value;
      } else result[key] = String(control.value ?? "").trim();
      if (control.checkValidity && !control.checkValidity()) {
        selectFolder(folder);
        control.reportValidity();
        throw new Error(t("settings.invalidField", { field: t(`settings.field.${key}`) }));
      }
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
      if (password.value !== "") mail.password = password.value;
      const patch = { revision: cfg.revision };
      if (Object.keys(comment).length) patch.comment = comment;
      if (Object.keys(mail).length) patch.mail = mail;
      if (!patch.comment && !patch.mail) { populate(cfg); return; }
      setBusy(true);
      state.textContent = t("settings.saving");
      populate(await saveConfig(patch), true);
    } catch (err) {
      error.textContent = err.status === 409 ? t("settings.conflict") : err.message || String(err);
      error.hidden = false;
      state.textContent = dirty ? t("settings.unsaved") : "";
    } finally { setBusy(false); }
  });
  reload.addEventListener("click", async () => {
    if (busy || (dirty && !window.confirm(t("settings.discardConfirm")))) return;
    setBusy(true);
    try { populate(await fetchConfig()); }
    catch (err) { error.textContent = err.message || String(err); error.hidden = false; }
    finally { setBusy(false); }
  });
  populate(cfg);
  selectFolder("comment");
  return wrap;
}

function renderMailTools() {
  const element = el("div", { class: "settings-delivery" });
  element.appendChild(el("p", { class: "settings-hint", text: t("settings.testSavedHint") }));
  const to = el("mdui-text-field", { label: t("settings.testRecipient"), type: "email", required: true, variant: "outlined", maxLength: 254 });
  const test = el("mdui-button", { variant: "tonal", text: t("settings.sendTest") });
  const refresh = el("mdui-button", { variant: "text", text: t("settings.refreshMailStatus") });
  const result = el("div", { class: "settings-state", role: "status" });
  const status = el("div", { class: "settings-mail-status", role: "status" });
  element.append(to, el("div", { class: "settings-actions" }, test, refresh), result, status);
  let loaded = false;
  async function loadStatus() {
    if (refresh.disabled) return;
    refresh.disabled = true;
    try {
      const data = await fetchMailStatus();
      status.replaceChildren();
      for (const [label, value] of [
        ["settings.mailPending", data.pending], ["settings.mailFailed", data.failed],
        ["settings.mailLastSuccess", data.last_success_at ? formatTime(data.last_success_at) : t("settings.noMailHistory")],
        ["settings.mailLastError", data.last_error || t("settings.noMailHistory")],
      ]) status.appendChild(el("div", {}, el("span", { text: t(label) }), el("strong", { text: String(value ?? "—") })));
      loaded = true;
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
  return { element, load: () => { if (!loaded) loadStatus(); } };
}
