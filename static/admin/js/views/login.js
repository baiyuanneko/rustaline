import { login, setSession, ApiError } from "../api.js";
import { toastOk } from "../components.js";

export function render(container) {
  const screen = document.createElement("div");
  screen.className = "auth-screen";

  const card = document.createElement("div");
  card.className = "auth-card";

  const brand = document.createElement("div");
  brand.className = "auth-card__brand";

  const mark = document.createElement("span");
  mark.className = "auth-card__mark";
  mark.innerHTML = `<svg viewBox="0 0 32 32" width="22" height="22"><path d="M9 11h14M9 16h10M9 21h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  const titles = document.createElement("div");
  const t1 = document.createElement("div");
  t1.className = "auth-card__title";
  t1.textContent = "rustaline";
  const t2 = document.createElement("div");
  t2.className = "auth-card__subtitle";
  t2.textContent = "管理面板登录";
  titles.appendChild(t1);
  titles.appendChild(t2);

  brand.appendChild(mark);
  brand.appendChild(titles);

  const form = document.createElement("form");
  form.className = "auth-form";
  form.autocomplete = "on";

  const userField = field("用户名", "text", "管理员用户名", "username", "请输入用户名");
  const passField = field("密码", "password", "••••••", "current-password", "请输入密码");

  const errBox = document.createElement("div");
  errBox.className = "auth-form__error";
  errBox.hidden = true;

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn btn--primary btn--lg btn--block";
  submitBtn.textContent = "登录";

  const hint = document.createElement("div");
  hint.className = "auth-form__hint";
  hint.textContent = "首次使用请通过 Swagger UI 或 curl 调用 /api/v1/auth/register 创建管理员账号";

  form.appendChild(userField.root);
  form.appendChild(passField.root);
  form.appendChild(errBox);
  form.appendChild(submitBtn);
  form.appendChild(hint);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.innerHTML = '<span class="spinner"></span> 登录中…';

    const username = userField.input.value.trim();
    const password = passField.input.value;

    if (!username || !password) {
      showError("请输入用户名和密码");
      restoreBtn();
      return;
    }

    try {
      const resp = await login(username, password);
      if (!resp || !resp.access_token) {
        showError("登录响应缺少 access_token 字段");
        return;
      }
      setSession(resp, username);
      toastOk("登录成功", resp.expires_in ? `凭证有效期 ${Math.round(resp.expires_in / 3600)} 小时` : "");
      location.hash = "#/dashboard";
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message);
      } else {
        showError(`登录失败：${err.message || err}`);
      }
    } finally {
      restoreBtn();
    }

    function showError(msg) {
      errBox.textContent = msg;
      errBox.hidden = false;
    }
    function restoreBtn() {
      submitBtn.removeAttribute("aria-busy");
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  card.appendChild(brand);
  card.appendChild(form);
  screen.appendChild(card);
  container.appendChild(screen);

  setTimeout(() => userField.input.focus(), 50);
}

function field(labelText, type, placeholder, autocomplete, errMsg) {
  const root = document.createElement("div");
  root.className = "field";
  const lab = document.createElement("label");
  lab.className = "field__label";
  lab.textContent = labelText;
  const input = document.createElement("input");
  input.className = "input";
  input.type = type;
  input.name = labelText;
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  input.required = true;
  input.addEventListener("input", () => {
    input.setCustomValidity("");
  });
  input.addEventListener("invalid", () => {
    input.setCustomValidity(errMsg);
  });
  root.appendChild(lab);
  root.appendChild(input);
  return { root, input };
}

export function cleanup() {}
