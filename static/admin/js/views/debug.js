// 调试页：自定义 Rustaline 构造参数（左栏）+ 实时评论实例预览（右栏），
// 与首页「在线演示」勾选「自定义配置参数」后的形态一致。任一参数变更即销毁重建实例。

import { el, toastErr, emptyState } from "../components.js";
import { t, getLang } from "../i18n.js";

// 实例挂在模块级：路由切走时由 cleanup() 销毁
let inst = null;

const PALETTE = ["#2196f3", "#3f51b5", "#9c27b0", "#e91e63", "#f44336", "#ff9800", "#4caf50", "#009688"];

/** 动态加载 SDK（管理面板默认不引入；SDK 自带防重复加载守卫） */
function loadSdk() {
  if (window.Rustaline) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/sdk/rustaline.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load /sdk/rustaline.js"));
    document.head.appendChild(s);
  });
}

/** mdui-text-field 赋值：host 属性 + 内部 input 同步（升级前后都有效） */
function setTextField(host, v) {
  if (v == null) return;
  try { host.value = v; } catch (_) { /* noop */ }
  host.setAttribute("value", v);
  const inner = host.shadowRoot && host.shadowRoot.querySelector("input");
  if (inner) inner.value = v;
}

export async function render(container) {
  const state = {
    server: "",
    url: "/debug",
    lang: getLang(),
    placeholder: "",
    gravatarCdn: "https://gravatar.loli.net/avatar/",
    colorPattern: "#2196f3",
    darkMode: "auto",
  };
  let swatchEls = [];

  // hash 查询预填（仪表盘排行「调试 SDK」入口带入 ?url=...），读后即清避免刷新残留
  const qm = (location.hash || "").match(/\?(.+)$/);
  if (qm) {
    const params = new URLSearchParams(qm[1]);
    const u = params.get("url");
    if (u) state.url = u;
    history.replaceState(null, "", "#/debug");
  }

  const head = el("div", { class: "page-head" });
  const titles = el("div", { class: "page-head__titles" });
  titles.appendChild(el("h1", { class: "page-title", text: t("debug.title") }));
  titles.appendChild(el("div", { class: "page-subtitle", text: t("debug.subtitle") }));
  head.appendChild(titles);
  container.appendChild(head);

  const layout = el("div", { class: "debug-layout" });
  const params = el("div", { class: "debug-params" });
  const preview = el("div", { class: "debug-preview" });
  const mount = el("div", { id: "debug-comments" });
  preview.appendChild(mount);
  layout.appendChild(params);
  layout.appendChild(preview);
  container.appendChild(layout);

  // ---- 右栏实例重建 ----
  function rebuild() {
    if (!window.Rustaline) return;
    if (inst) { try { inst.destroy(); } catch (_) { /* noop */ } }
    const opts = {
      el: mount, // 直接传元素节点：render 时视图尚未挂进文档，选择器查询不到
      server: state.server,
      url: state.url || "/debug",
      lang: state.lang || "auto",
      gravatarCdn: state.gravatarCdn,
      colorPattern: state.colorPattern,
      darkMode: state.darkMode,
    };
    if (state.placeholder) opts.placeholder = state.placeholder;
    inst = new window.Rustaline(opts);
    syncSwatches();
  }

  function syncSwatches() {
    const cur = String(state.colorPattern || "").toLowerCase();
    for (const s of swatchEls) s.classList.toggle("is-active", s.dataset.color === cur);
  }

  function applyColor(hex) {
    state.colorPattern = hex;
    setTextField(colorField, hex);
    rebuild();
  }

  // ---- 左栏控件 ----
  function bindText(host, key) {
    let last = state[key];
    const commit = () => {
      const v = String(host.value || "").trim();
      if (v === last) return;
      last = v;
      state[key] = v;
      rebuild();
    };
    // 与首页演示一致：change 之外补 focusout / Enter（mdui 内部 input 的 change 不冒泡）
    host.addEventListener("change", commit);
    host.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    host.addEventListener("focusout", () => setTimeout(commit, 0));
  }

  const mkField = (id, label, placeholder) => {
    const f = el("mdui-text-field", { id, label, variant: "outlined" });
    if (placeholder) f.setAttribute("placeholder", placeholder);
    return f;
  };

  const serverField = mkField("dbg-server", "server", "https://api.example.com");
  const urlField = mkField("dbg-url", "url");
  const placeholderField = mkField("dbg-placeholder", "placeholder");
  const gravatarField = mkField("dbg-gravatar", "gravatarCdn");
  const colorField = mkField("dbg-color", "colorPattern", "#2196f3");
  for (const f of [serverField, urlField, placeholderField, gravatarField, colorField]) {
    params.appendChild(f);
  }
  setTextField(urlField, state.url);
  setTextField(gravatarField, state.gravatarCdn);
  setTextField(colorField, state.colorPattern);

  const mkSegmented = (id, options) => {
    const group = el("mdui-segmented-button-group", { id, selects: "single" });
    for (const [value, label] of options) {
      group.appendChild(el("mdui-segmented-button", { value, text: label }));
    }
    return group;
  };

  const row = el("div", { class: "debug-row" });
  const langField = el("div", { class: "debug-field" });
  langField.appendChild(el("div", { class: "debug-label", text: t("debug.lang") }));
  const langGroup = mkSegmented("dbg-lang", [["auto", "Auto"], ["zh-CN", "中文"], ["en", "English"]]);
  langGroup.setAttribute("value", state.lang === "en" ? "en" : state.lang === "zh-CN" ? "zh-CN" : "auto");
  langField.appendChild(langGroup);
  const darkField = el("div", { class: "debug-field" });
  darkField.appendChild(el("div", { class: "debug-label", text: t("debug.dark") }));
  const darkGroup = mkSegmented("dbg-dark", [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]);
  darkGroup.setAttribute("value", "auto");
  darkField.appendChild(darkGroup);
  row.appendChild(langField);
  row.appendChild(darkField);
  params.appendChild(row);

  // 主题色调色板：预设色圆点 + 原生取色器（透明覆盖在彩虹按钮上）
  const colorRow = el("div", { class: "debug-row" });
  const colorBox = el("div", { class: "debug-field" });
  colorBox.appendChild(el("div", { class: "debug-label", text: t("debug.color") }));
  const picker = el("div", { class: "color-picker" });
  for (const hex of PALETTE) {
    const b = el("button", {
      type: "button",
      class: "color-swatch",
      style: { background: hex },
      title: hex,
      attrs: { "aria-label": hex },
      dataset: { color: hex },
      onClick: () => applyColor(hex),
    });
    picker.appendChild(b);
    swatchEls.push(b);
  }
  const customBtn = el("button", {
    type: "button",
    class: "color-swatch color-swatch--custom",
    text: "+",
    title: t("debug.customColor"),
    attrs: { "aria-label": t("debug.customColor"), tabindex: "-1" },
  });
  const customWrap = el("span", { class: "color-custom" });
  customWrap.appendChild(customBtn);
  const native = el("input", { type: "color", class: "color-custom__input" });
  native.setAttribute("aria-label", t("debug.customColor"));
  // change（而非 input）：取色窗关闭时才应用，避免拖动取色频繁重建实例
  native.addEventListener("change", function () { applyColor(this.value); });
  customWrap.appendChild(native);
  picker.appendChild(customWrap);
  colorBox.appendChild(picker);
  colorRow.appendChild(colorBox);
  params.appendChild(colorRow);

  // ---- 控件接线 ----
  bindText(serverField, "server");
  bindText(urlField, "url");
  bindText(placeholderField, "placeholder");
  bindText(gravatarField, "gravatarCdn");
  bindText(colorField, "colorPattern");
  langGroup.addEventListener("change", function () { state.lang = this.value; rebuild(); });
  darkGroup.addEventListener("change", function () {
    state.darkMode = this.value;
    rebuild();
  });

  // ---- 加载 SDK 并创建首个实例 ----
  try {
    await loadSdk();
    rebuild();
  } catch (err) {
    preview.replaceChildren();
    preview.appendChild(emptyState({
      title: t("debug.loadFailed"),
      hint: err.message || String(err),
      icon: "warn",
    }));
    toastErr(t("debug.loadFailed"), err.message);
  }
}

/** 路由切走时销毁实例（app.js 的 mountView 会调用） */
export function cleanup() {
  if (inst) {
    try { inst.destroy(); } catch (_) { /* noop */ }
    inst = null;
  }
}
