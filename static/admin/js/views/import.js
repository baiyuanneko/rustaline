import { importValineBatch } from "../api.js";
import { toastOk, toastErr, toastInfo, confirmDialog, icon, el } from "../components.js";

const BATCH_SIZE = 500;
const ACCEPT_TYPES = ["application/json", "text/plain", "text/json"];

const taskState = {
  abort: null,
  running: false,
};

export async function render(container) {
  container.appendChild(pageHead());
  container.appendChild(buildDropzoneCard());
  container.appendChild(buildPasteCard());
  container.appendChild(buildProgressCard());
  container.appendChild(buildReportCard());
}

function pageHead() {
  const head = el("div", { class: "page-head" });
  const titles = el("div", { class: "page-head__titles" });
  titles.appendChild(el("h1", { class: "page-title", text: "Valine 数据导入" }));
  titles.appendChild(el("div", { class: "page-subtitle", text: "支持 LeanCloud 导出 JSON：分批上传、实时进度、汇总报告" }));
  head.appendChild(titles);
  return head;
}

function buildDropzoneCard() {
  const card = el("mdui-card", { class: "page-card" });
  const body = el("div", { class: "page-card__body" });

  const dz = el("div", { class: "dropzone", tabIndex: 0, role: "button", attrs: { "aria-label": "选择或拖入 JSON 文件" } });
  dz.appendChild(el("div", { class: "dropzone__icon" }, icon("upload")));
  dz.appendChild(el("div", { class: "dropzone__title", text: "点击选择 JSON 文件，或拖入此处" }));
  dz.appendChild(el("div", { class: "dropzone__hint", text: `支持 .json；每批 ${BATCH_SIZE} 条顺序上传，可处理十万级数据` }));

  const fileInput = el("input", { type: "file", accept: ".json,application/json,text/json,text/plain", style: { display: "none" } });
  body.appendChild(fileInput);

  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add("is-dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("is-dragover");
    })
  );
  dz.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
    fileInput.value = "";
  });
  body.appendChild(dz);

  const status = el("div", { id: "dropzone-status", style: { marginTop: "12px", fontSize: "13px", color: "rgb(var(--mdui-color-on-surface-variant))" } });
  body.appendChild(status);
  card.appendChild(body);
  return card;
}

function buildPasteCard() {
  const card = el("mdui-card", { class: "page-card" });
  const header = el("div", { class: "page-card__header" });
  header.appendChild(el("div", { class: "page-card__title", text: "或粘贴 JSON 内容" }));
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  const ta = el("mdui-text-field", {
    id: "paste-textarea",
    variant: "filled",
    label: "JSON 内容",
    placeholder: '[\n  { "objectId": "...", "comment": "...", "nick": "..." }\n]\n或\n{ "results": [ ... ] }',
    rows: 6,
    autosize: true,
    minRows: 6,
    maxRows: 16,
  });
  body.appendChild(ta);

  const actions = el("div", { style: { marginTop: "14px", display: "flex", gap: "8px", flexWrap: "wrap" } });
  const parseBtn = el("mdui-button", { variant: "tonal", text: "解析粘贴内容" });
  parseBtn.addEventListener("click", () => {
    const text = String(ta.value || "").trim();
    if (!text) {
      toastErr("无内容", "请粘贴 JSON 文本");
      return;
    }
    try {
      const data = JSON.parse(text);
      const items = normalizeResults(data);
      if (items.length === 0) {
        toastErr("无有效数据", "解析结果为空数组");
        return;
      }
      stageImport(items, "粘贴内容");
    } catch (err) {
      const pos = locateJsonError(text, err);
      toastErr("JSON 解析失败", pos ? `位置 ${pos}：${err.message}` : err.message);
    }
  });
  actions.appendChild(parseBtn);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function buildProgressCard() {
  const card = el("mdui-card", { class: "page-card", id: "progress-card", hidden: true });

  const header = el("div", { class: "page-card__header" });
  const titleBox = el("div");
  titleBox.appendChild(el("div", { class: "page-card__title", text: "导入进度" }));
  header.appendChild(titleBox);

  const cancelBtn = el("mdui-button", { variant: "outlined", id: "cancel-import", text: "取消" });
  cancelBtn.addEventListener("click", async () => {
    if (!taskState.running) return;
    const result = await confirmDialog({
      title: "确认取消剩余批次导入？",
      bodyText: "已完成批次不会回滚。",
      confirmText: "取消导入",
      cancelText: "继续导入",
      danger: true,
    });
    if (result !== "confirm") return;
    if (taskState.abort) taskState.abort.abort();
  });
  header.appendChild(cancelBtn);
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  const bar = el("mdui-linear-progress", { id: "progress-bar", max: 100, value: 0 });
  body.appendChild(bar);

  const meta = el("div", { class: "progress-meta" });
  meta.appendChild(el("span", { id: "progress-meta-left", text: "准备中…" }));
  meta.appendChild(el("span", { id: "progress-meta-right", text: "0 / 0" }));
  body.appendChild(meta);

  body.appendChild(el("div", { class: "page-card__subtitle", style: { marginTop: "16px" }, text: "批次日志" }));
  const log = el("div", { class: "log", id: "import-log" });
  body.appendChild(log);
  card.appendChild(body);
  return card;
}

function buildReportCard() {
  const card = el("mdui-card", { class: "page-card", id: "report-card", hidden: true });

  const header = el("div", { class: "page-card__header" });
  const titleBox = el("div");
  titleBox.appendChild(el("div", { class: "page-card__title", text: "导入汇总报告" }));
  header.appendChild(titleBox);

  const closeBtn = el("mdui-button", { variant: "outlined", text: "清除" });
  closeBtn.addEventListener("click", () => {
    card.hidden = true;
  });
  header.appendChild(closeBtn);
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  body.appendChild(el("div", { class: "report-grid", id: "report-grid" }));

  const details = el("details", { class: "details" });
  details.appendChild(el("summary", { class: "details__summary", text: "错误明细（前 20 条）" }));
  const detailBody = el("div", { class: "details__body", id: "report-errors" });
  details.appendChild(detailBody);
  body.appendChild(details);
  card.appendChild(body);
  return card;
}

// ---- 文件处理 ----
function handleFile(file) {
  if (!ACCEPT_TYPES.includes(file.type) && !/\.(json|txt)$/i.test(file.name)) {
    const msg = `文件类型 ${file.type || "未知"} 不被支持，请选择 JSON 文件`;
    setStatus(msg, true);
    toastErr("文件类型不支持", msg);
    return;
  }

  setStatus(`正在读取 ${file.name}（${formatSize(file.size)}）…`);
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const items = normalizeResults(data);
      if (items.length === 0) {
        setStatus("解析结果为空数组", true);
        toastErr("无可导入数据", "JSON 中未找到 results 数组或顶层并非数组");
        return;
      }
      setStatus(`已解析 ${items.length} 条记录，准备导入…`);
      stageImport(items, file.name);
    } catch (err) {
      setStatus(`解析失败：${err.message}`, true);
      toastErr("JSON 解析失败", err.message);
    }
  };
  reader.onerror = () => {
    setStatus("文件读取失败", true);
    toastErr("读取失败", "FileReader 错误");
  };
  reader.readAsText(file, "utf-8");
}

function setStatus(msg, isError) {
  const node = document.getElementById("dropzone-status");
  if (!node) return;
  node.textContent = msg;
  node.style.color = isError ? "rgb(var(--mdui-color-error))" : "rgb(var(--mdui-color-on-surface-variant))";
}

function normalizeResults(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function locateJsonError(text, err) {
  const m = /position\s+(\d+)/i.exec(err.message || "");
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split("\n").length;
    return `行 ${line}`;
  }
  return "";
}

// ---- 暂存与启动 ----
let staged = null;

function stageImport(items, source) {
  staged = { items, source };
  const total = items.length;
  const batches = Math.ceil(total / BATCH_SIZE);
  toastInfo("解析完成", `共 ${total} 条，将分 ${batches} 批导入（来源：${source}）`);
  setStatus(`已暂存 ${total} 条 / ${batches} 批（来源：${source}）。向下滚动点击「开始导入」`);

  const dropzone = document.querySelector(".dropzone");
  if (dropzone) {
    let startBtn = document.getElementById("start-import-btn");
    if (!startBtn) {
      const dzBody = dropzone.closest(".page-card")?.querySelector(".page-card__body");
      startBtn = el("mdui-button", {
        variant: "filled",
        id: "start-import-btn",
        style: { marginTop: "14px" },
        text: `开始导入（${total} 条）`,
      });
      startBtn.addEventListener("click", () => runImport());
      (dzBody || dropzone.parentNode).appendChild(startBtn);
    } else {
      startBtn.textContent = `开始导入（${total} 条）`;
    }
  }
}

async function runImport() {
  if (!staged || taskState.running) return;

  const items = staged.items;
  const total = items.length;
  const batches = chunk(items, BATCH_SIZE);

  const progressCard = document.getElementById("progress-card");
  const reportCard = document.getElementById("report-card");
  const bar = document.getElementById("progress-bar");
  const left = document.getElementById("progress-meta-left");
  const right = document.getElementById("progress-meta-right");
  const log = document.getElementById("import-log");
  const startBtn = document.getElementById("start-import-btn");

  progressCard.hidden = false;
  reportCard.hidden = true;
  log.replaceChildren();
  bar.value = 0;
  left.textContent = "导入中…";
  right.textContent = `0 / ${batches.length}`;
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = "导入中…";
  }

  taskState.running = true;
  const controller = new AbortController();
  taskState.abort = controller;

  const agg = { total, imported: 0, duplicates: 0, invalid: 0, errors: [] };
  let cancelled = false;

  appendLog(log, "info", `开始导入 ${total} 条 / ${batches.length} 批`);

  for (let i = 0; i < batches.length; i++) {
    if (controller.signal.aborted) {
      cancelled = true;
      appendLog(log, "warn", `用户取消，跳过第 ${i + 1} 批及之后 ${batches.length - i} 批`);
      break;
    }

    const batch = batches[i];
    const batchStart = Date.now();
    appendLog(log, "info", `→ 第 ${i + 1} / ${batches.length} 批（${batch.length} 条）`);
    try {
      const r = await importValineBatch(batch, controller.signal);
      const report = r || {};
      agg.imported += report.imported || 0;
      agg.duplicates += report.skipped_duplicates || 0;
      agg.invalid += report.skipped_invalid || 0;
      if (Array.isArray(report.errors)) {
        agg.errors.push(...report.errors.map((e) => `[批次 ${i + 1}] ${e}`));
      }
      appendLog(
        log,
        report.errors && report.errors.length > 0 ? "warn" : "ok",
        `✓ 第 ${i + 1} 批完成：导入 ${report.imported || 0} / 重复 ${report.skipped_duplicates || 0} / 无效 ${report.skipped_invalid || 0}（耗时 ${Date.now() - batchStart}ms）`
      );
    } catch (err) {
      if (err.name === "AbortError") {
        cancelled = true;
        appendLog(log, "warn", `第 ${i + 1} 批已取消`);
        break;
      }
      agg.errors.push(`[批次 ${i + 1}] ${err.message || err}`);
      appendLog(log, "err", `✗ 第 ${i + 1} 批失败：${err.message || err}`);
    }

    const done = i + 1;
    const pct = Math.round((done / batches.length) * 100);
    bar.value = pct;
    left.textContent = cancelled ? "已取消" : `${pct}%`;
    right.textContent = `${done} / ${batches.length}`;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (cancelled) {
    left.textContent = "已取消";
  } else {
    bar.value = 100;
    left.textContent = "完成";
  }

  taskState.running = false;
  taskState.abort = null;
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = "重新导入";
  }

  showReport(agg, cancelled);
  appendLog(
    log,
    cancelled ? "warn" : "ok",
    `导入结束：成功 ${agg.imported} / 重复 ${agg.duplicates} / 无效 ${agg.invalid} / 错误 ${agg.errors.length}`
  );
  if (cancelled) {
    toastInfo("已取消", `已停止剩余批次。本次成功导入 ${agg.imported} 条`);
  } else {
    toastOk("导入完成", `成功 ${agg.imported} 条，重复跳过 ${agg.duplicates} 条`);
  }
}

function showReport(agg, cancelled) {
  const card = document.getElementById("report-card");
  const grid = document.getElementById("report-grid");
  const errBody = document.getElementById("report-errors");
  if (!card || !grid || !errBody) return;

  grid.replaceChildren();
  errBody.replaceChildren();

  const cells = [
    { label: "总记录数", value: agg.total, cls: "" },
    { label: "成功导入", value: agg.imported, cls: "report-cell--ok" },
    { label: "重复跳过", value: agg.duplicates, cls: "report-cell--warn" },
    { label: "无效跳过", value: agg.invalid, cls: "report-cell--warn" },
    { label: "错误明细", value: agg.errors.length, cls: agg.errors.length > 0 ? "report-cell--danger" : "" },
  ];
  if (cancelled) {
    cells.push({ label: "状态", value: "已取消", cls: "report-cell--warn" });
  }

  for (const c of cells) {
    const cell = el("div", { class: `report-cell ${c.cls}`.trim() });
    cell.appendChild(el("div", { class: "report-cell__label", text: c.label }));
    cell.appendChild(el("span", {
      class: "report-cell__value",
      text: typeof c.value === "number" ? c.value.toLocaleString("zh-CN") : c.value,
    }));
    grid.appendChild(cell);
  }

  if (agg.errors.length === 0) {
    errBody.appendChild(el("p", { text: "无错误", style: { margin: "8px 0", fontSize: "13px" } }));
  } else {
    agg.errors.slice(0, 20).forEach((e) => {
      errBody.appendChild(el("p", { text: e, style: { margin: "6px 0", fontSize: "13px" } }));
    });
    if (agg.errors.length > 20) {
      errBody.appendChild(el("p", {
        text: `… 还有 ${agg.errors.length - 20} 条未显示`,
        style: { margin: "6px 0", fontSize: "13px", color: "rgb(var(--mdui-color-on-surface-variant))" },
      }));
    }
  }

  card.hidden = false;
}

function chunk(arr, size) {
  if (size <= 0) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function appendLog(host, level, msg) {
  const line = el("div", { class: `log__line log__line--${level}` });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  line.appendChild(el("span", { class: "log__time", text: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }));
  line.appendChild(el("span", { class: "log__msg", text: msg }));
  host.appendChild(line);
  host.scrollTop = host.scrollHeight;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function cleanup() {
  if (taskState.abort) taskState.abort.abort();
  taskState.running = false;
  taskState.abort = null;
  staged = null;
}
