import { login, setSession } from "../api.js";
import { el } from "../components.js";
import { t } from "../i18n.js";

export async function render(container) {
  container.appendChild(buildLoginScreen());
}

function buildLoginScreen() {
  const screen = el("div", { class: "login-screen" });
  const card = el("mdui-card", { class: "login-card" });
  const body = el("div", { class: "login-card__body" });

  const brand = el("div", { class: "login-brand" });
  const mark = el("span", { class: "login-brand__mark", attrs: { "aria-hidden": "true" } });
  mark.innerHTML = `<svg viewBox="0 0 32 32" width="20" height="20"><path d="M9 11h14M9 16h10M9 21h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  brand.appendChild(mark);
  brand.appendChild(el("div", { class: "login-brand__name", text: "rustaline" }));
  body.appendChild(brand);
  body.appendChild(el("div", { class: "login-title", text: t("auth.loginTitle") }));

  const form = el("form", { class: "login-form", onsubmit: (e) => e.preventDefault() });
  const usernameField = el("mdui-text-field", {
    label: t("auth.username"),
    name: "username",
    variant: "filled",
    autocomplete: "username",
    required: true,
  });
  const passwordField = el("mdui-text-field", {
    label: t("auth.password"),
    name: "password",
    type: "password",
    variant: "filled",
    autocomplete: "current-password",
    required: true,
    togglePassword: true,
  });
  form.appendChild(usernameField);
  form.appendChild(passwordField);

  const errBox = el("div", { class: "login-error", role: "alert", hidden: true });
  form.appendChild(errBox);

  const submitBtn = el("mdui-button", {
    type: "submit",
    variant: "filled",
    fullWidth: true,
    text: t("auth.login"),
    style: { marginTop: "8px" },
  });
  form.appendChild(submitBtn);
  body.appendChild(form);

  const hint = el("div", {
    class: "login-hint",
    text: t("auth.initialHint"),
  });
  body.appendChild(hint);
  card.appendChild(body);
  screen.appendChild(card);

  submitBtn.addEventListener("click", async () => {
    const username = usernameField.value.trim();
    const password = passwordField.value;

    errBox.hidden = true;
    if (!username || !password) {
      showError(errBox, t("auth.requiredFields"));
      return;
    }

    submitBtn.loading = true;
    submitBtn.disabled = true;
    try {
      const session = await login(username, password);
      setSession(session, username);
      location.hash = "#/dashboard";
    } catch (err) {
      showError(errBox, err.message || String(err));
      submitBtn.loading = false;
      submitBtn.disabled = false;
    }
  });

  return screen;
}

function showError(errBox, msg) {
  errBox.textContent = msg;
  errBox.hidden = false;
}

export function cleanup() {}
