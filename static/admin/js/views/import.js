import { importValineBatch } from "../api.js";
import { toastOk, toastErr, toastInfo, confirmDialog, icon, el } from "../components.js";
import { t } from "../i18n.js";

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
  titles.appendChild(el("h1", { class: "page-title", text: t("import.title") }));
  titles.appendChild(el("div", { class: "page-subtitle", text: t("import.subtitle") }));
  head.appendChild(titles);
  return head;
}

function buildDropzoneCard() {
  const card = el("mdui-card", { class: "page-card" });
  const body = el("div", { class: "page-card__body" });

  const dz = el("div", { class: "dropzone", tabIndex: 0, role: "button", attrs: { "aria-label": t("import.dropzoneLabel") } });
  dz.appendChild(el("div", { class: "dropzone__icon" }, icon("upload")));
  dz.appendChild(el("div", { class: "dropzone__title", text: t("import.dropzoneTitle") }));
  dz.appendChild(el("div", { class: "dropzone__hint", text: t("import.dropzoneHint", { batch: BATCH_SIZE }) }));

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
  header.appendChild(el("div", { class: "page-card__title", text: t("import.pasteTitle") }));
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  const ta = el("mdui-text-field", {
    id: "paste-textarea",
    variant: "filled",
    label: t("import.jsonContent"),
    placeholder: '[\n  { "objectId": "...", "comment": "...", "nick": "..." }\n]\n或\n{ "results": [ ... ] }',
    rows: 6,
    autosize: true,
    minRows: 6,
    maxRows: 16,
  });
  body.appendChild(ta);

  const actions = el("div", { style: { marginTop: "14px", display: "flex", gap: "8px", flexWrap: "wrap" } });
  const parseBtn = el("mdui-button", { variant: "tonal", text: t("import.parse") });
  parseBtn.addEventListener("click", () => {
    const text = String(ta.value || "").trim();
    if (!text) {
      toastErr(t("import.noContent"), t("import.noContentMsg"));
      return;
    }
    try {
      const data = JSON.parse(text);
      const items = normalizeResults(data);
      if (items.length === 0) {
        toastErr(t("import.noValidData"), t("import.emptyResult"));
        return;
      }
      stageImport(items, t("import.pasteSource"));
    } catch (err) {
      const pos = locateJsonError(text, err);
      toastErr(t("import.parseFailed"), pos ? t("import.parseErrorPos", { pos, msg: err.message }) : err.message);
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
  titleBox.appendChild(el("div", { class: "page-card__title", text: t("import.progressTitle") }));
  header.appendChild(titleBox);

  const cancelBtn = el("mdui-button", { variant: "outlined", id: "cancel-import", text: t("common.cancel") });
  cancelBtn.addEventListener("click", async () => {
    if (!taskState.running) return;
    const result = await confirmDialog({
      title: t("import.cancelConfirmTitle"),
      bodyText: t("import.cancelConfirmBody"),
      confirmText: t("import.cancelConfirm"),
      cancelText: t("import.cancelAbort"),
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
  meta.appendChild(el("span", { id: "progress-meta-left", text: t("import.preparing") }));
  meta.appendChild(el("span", { id: "progress-meta-right", text: "0 / 0" }));
  body.appendChild(meta);

  body.appendChild(el("div", { class: "page-card__subtitle", style: { marginTop: "16px" }, text: t("import.batchLog") }));
  const log = el("div", { class: "log", id: "import-log" });
  body.appendChild(log);
  card.appendChild(body);
  return card;
}

function buildReportCard() {
  const card = el("mdui-card", { class: "page-card", id: "report-card", hidden: true });

  const header = el("div", { class: "page-card__header" });
  const titleBox = el("div");
  titleBox.appendChild(el("div", { class: "page-card__title", text: t("import.reportTitle") }));
  header.appendChild(titleBox);

  const closeBtn = el("mdui-button", { variant: "outlined", text: t("import.clear") });
  closeBtn.addEventListener("click", () => {
    card.hidden = true;
  });
  header.appendChild(closeBtn);
  card.appendChild(header);

  const body = el("div", { class: "page-card__body" });
  body.appendChild(el("div", { class: "report-grid", id: "report-grid" }));

  const details = el("details", { class: "details" });
  details.appendChild(el("summary", { class: "details__summary", text: t("import.errorDetails") }));
  const detailBody = el("div", { class: "details__body", id: "report-errors" });
  details.appendChild(detailBody);
  body.appendChild(details);
  card.appendChild(body);
  return card;
}

// ---- 文件处理 ----
function handleFile(file) {
  if (!ACCEPT_TYPES.includes(file.type) && !/\.(json|txt)$/i.test(file.name)) {
    const msg = t("import.unsupportedTypeMsg", { type: file.type || t("import.unknownType") });
    setStatus(msg, true);
    toastErr(t("import.unsupportedType"), msg);
    return;
  }

  setStatus(t("import.reading", { name: file.name, size: formatSize(file.size) }));
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const items = normalizeResults(data);
      if (items.length === 0) {
        setStatus(t("import.emptyResult"), true);
        toastErr(t("import.noImportable"), t("import.noResultsMsg"));
        return;
      }
      setStatus(t("import.parsed", { n: items.length }));
      stageImport(items, file.name);
    } catch (err) {
      setStatus(t("import.parseErrorMsg", { msg: err.message }), true);
      toastErr(t("import.parseFailed"), err.message);
    }
  };
  reader.onerror = () => {
    setStatus(t("import.readFailed"), true);
    toastErr(t("import.readFailed"), t("import.fileReaderError"));
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
    return t("import.errorLine", { line });
  }
  return "";
}

// ---- 暂存与启动 ----
let staged = null;

function stageImport(items, source) {
  staged = { items, source };
  const total = items.length;
  const batches = Math.ceil(total / BATCH_SIZE);
  toastInfo(t("import.parseDone"), t("import.batchPlan", { total, batches, source }));
  setStatus(t("import.stagedMsg", { total, batches, source }));

  const dropzone = document.querySelector(".dropzone");
  if (dropzone) {
    let startBtn = document.getElementById("start-import-btn");
    if (!startBtn) {
      const dzBody = dropzone.closest(".page-card")?.querySelector(".page-card__body");
      startBtn = el("mdui-button", {
        variant: "filled",
        id: "start-import-btn",
        style: { marginTop: "14px" },
        text: t("import.startImport", { total }),
      });
      startBtn.addEventListener("click", () => runImport());
      (dzBody || dropzone.parentNode).appendChild(startBtn);
    } else {
      startBtn.textContent = t("import.startImport", { total });
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
  left.textContent = t("import.importing");
  right.textContent = `0 / ${batches.length}`;
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = t("import.importing");
  }

  taskState.running = true;
  const controller = new AbortController();
  taskState.abort = controller;

  const agg = { total, imported: 0, duplicates: 0, invalid: 0, errors: [] };
  let cancelled = false;

  appendLog(log, "info", t("import.logStart", { total, batches: batches.length }));

  for (let i = 0; i < batches.length; i++) {
    if (controller.signal.aborted) {
      cancelled = true;
      appendLog(log, "warn", t("import.logCancelled", { from: i + 1, left: batches.length - i }));
      break;
    }

    const batch = batches[i];
    const batchStart = Date.now();
    appendLog(log, "info", t("import.logBatchStart", { index: i + 1, total: batches.length, size: batch.length }));
    try {
      const r = await importValineBatch(batch, controller.signal);
      const report = r || {};
      agg.imported += report.imported || 0;
      agg.duplicates += report.skipped_duplicates || 0;
      agg.invalid += report.skipped_invalid || 0;
      if (Array.isArray(report.errors)) {
        agg.errors.push(...report.errors.map((e) => `${t("import.batchTag", { index: i + 1 })} ${e}`));
      }
      appendLog(
        log,
        report.errors && report.errors.length > 0 ? "warn" : "ok",
        t("import.logBatchDone", {
          index: i + 1,
          imported: report.imported || 0,
          duplicates: report.skipped_duplicates || 0,
          invalid: report.skipped_invalid || 0,
          ms: Date.now() - batchStart,
        })
      );
    } catch (err) {
      if (err.name === "AbortError") {
        cancelled = true;
        appendLog(log, "warn", t("import.logBatchCancelled", { index: i + 1 }));
        break;
      }
      agg.errors.push(`${t("import.batchTag", { index: i + 1 })} ${err.message || err}`);
      appendLog(log, "err", t("import.logBatchFailed", { index: i + 1, msg: err.message || err }));
    }

    const done = i + 1;
    const pct = Math.round((done / batches.length) * 100);
    bar.value = pct;
    left.textContent = cancelled ? t("import.cancelled") : `${pct}%`;
    right.textContent = `${done} / ${batches.length}`;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (cancelled) {
    left.textContent = t("import.cancelled");
  } else {
    bar.value = 100;
    left.textContent = t("import.done");
  }

  taskState.running = false;
  taskState.abort = null;
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = t("import.reimport");
  }

  showReport(agg, cancelled);
  appendLog(
    log,
    cancelled ? "warn" : "ok",
    t("import.logEnd", {
      imported: agg.imported,
      duplicates: agg.duplicates,
      invalid: agg.invalid,
      errors: agg.errors.length,
    })
  );
  if (cancelled) {
    toastInfo(t("import.cancelledToast"), t("import.cancelledToastMsg", { imported: agg.imported }));
  } else {
    toastOk(t("import.doneToast"), t("import.doneToastMsg", { imported: agg.imported, duplicates: agg.duplicates }));
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
    { label: t("report.total"), value: agg.total, cls: "" },
    { label: t("report.imported"), value: agg.imported, cls: "report-cell--ok" },
    { label: t("report.duplicates"), value: agg.duplicates, cls: "report-cell--warn" },
    { label: t("report.invalid"), value: agg.invalid, cls: "report-cell--warn" },
    { label: t("report.errors"), value: agg.errors.length, cls: agg.errors.length > 0 ? "report-cell--danger" : "" },
  ];
  if (cancelled) {
    cells.push({ label: t("report.status"), value: t("import.cancelled"), cls: "report-cell--warn" });
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
    errBody.appendChild(el("p", { text: t("report.noErrors"), style: { margin: "8px 0", fontSize: "13px" } }));
  } else {
    agg.errors.slice(0, 20).forEach((e) => {
      errBody.appendChild(el("p", { text: e, style: { margin: "6px 0", fontSize: "13px" } }));
    });
    if (agg.errors.length > 20) {
      errBody.appendChild(el("p", {
        text: t("report.moreErrors", { n: agg.errors.length - 20 }),
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
