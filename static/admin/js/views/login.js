import { login, setSession } from "../api.js";
import { el, icon } from "../components.js";
import { t } from "../i18n.js";

export async function render(container) {
  container.appendChild(buildLoginScreen());
}

function buildLoginScreen() {
  const screen = el("div", { class: "login-screen" });
  const card = el("mdui-card", { class: "login-card" });
  const body = el("div", { class: "login-card__body" });

  // 标题行：项目图标 + 标题 + 圆形 i（初始账号说明放在 tooltip 内，不占卡片版面）
  const head = el("div", { class: "login-head" });
  head.appendChild(el("img", {
    class: "login-head__mark",
    src: "/icon.webp",
    alt: "",
    attrs: { "aria-hidden": "true" },
  }));
  head.appendChild(el("div", { class: "login-head__title", text: t("auth.loginTitle") }));

  const hintText = t("auth.initialHint");
  const infoTip = el("mdui-tooltip", { content: hintText, placement: "top" });
  infoTip.appendChild(el("span", {
    class: "login-head__info",
    attrs: { tabindex: "0", role: "img", "aria-label": hintText },
  }, icon("info")));
  head.appendChild(infoTip);
  body.appendChild(head);

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
