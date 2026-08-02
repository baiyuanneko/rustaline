import { importValineBatch } from "../api.js";
import { toastOk, toastErr, toastInfo } from "../components.js";

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
  const head = document.createElement("div");
  head.className = "page-head";
  const titles = document.createElement("div");
  titles.className = "page-head__titles";
  const t = document.createElement("h1");
  t.className = "page-title";
  t.textContent = "Valine 数据导入";
  const s = document.createElement("div");
  s.className = "page-subtitle";
  s.textContent = "支持 LeanCloud 导出 JSON：分批上传、实时进度、汇总报告";
  titles.appendChild(t);
  titles.appendChild(s);
  head.appendChild(titles);
  return head;
}

function buildDropzoneCard() {
  const card = document.createElement("div");
  card.className = "card";
  const body = document.createElement("div");
  body.className = "card__body";

  const dz = document.createElement("div");
  dz.className = "dropzone";
  dz.tabIndex = 0;
  dz.setAttribute("role", "button");
  dz.setAttribute("aria-label", "选择或拖入 JSON 文件");

  const icon = document.createElement("span");
  icon.className = "dropzone__icon";
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>`;

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.textContent = "点击选择 JSON 文件，或拖入此处";

  const hint = document.createElement("div");
  hint.className = "dropzone__hint";
  hint.textContent = `支持 .json；每批 ${BATCH_SIZE} 条顺序上传，可处理十万级数据`;

  dz.appendChild(icon);
  dz.appendChild(title);
  dz.appendChild(hint);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json,text/json,text/plain";
  fileInput.style.display = "none";

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
    if (file) handleFile(file, dz);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file, dz);
    fileInput.value = "";
  });

  body.appendChild(dz);

  const status = document.createElement("div");
  status.id = "dropzone-status";
  status.style.marginTop = "12px";
  status.style.fontSize = "13px";
  status.style.color = "var(--text-muted)";
  body.appendChild(status);

  card.appendChild(body);
  return card;
}

function buildPasteCard() {
  const card = document.createElement("div");
  card.className = "card";
  const header = document.createElement("div");
  header.className = "card__header";
  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = "或粘贴 JSON 内容";
  header.appendChild(title);

  const body = document.createElement("div");
  body.className = "card__body";

  const ta = document.createElement("textarea");
  ta.id = "paste-textarea";
  ta.className = "textarea";
  ta.placeholder = '[\n  { "objectId": "...", "comment": "...", "nick": "..." }\n]\n或\n{ "results": [ ... ] }';
  ta.rows = 6;
  body.appendChild(ta);

  const actions = document.createElement("div");
  actions.style.marginTop = "12px";
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.flexWrap = "wrap";

  const parseBtn = document.createElement("button");
  parseBtn.type = "button";
  parseBtn.className = "btn btn--ghost";
  parseBtn.textContent = "解析粘贴内容";
  parseBtn.addEventListener("click", () => {
    const text = ta.value.trim();
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

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function buildProgressCard() {
  const card = document.createElement("div");
  card.className = "card";
  card.id = "progress-card";
  card.hidden = true;

  const header = document.createElement("div");
  header.className = "card__header";
  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = "导入进度";
  header.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "card__actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn--ghost btn--sm";
  cancelBtn.id = "cancel-import";
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", () => {
    if (!taskState.running) return;
    const result = window.confirm("确认取消剩余批次导入？已完成批次不会回滚。");
    if (!result) return;
    if (taskState.abort) taskState.abort.abort();
  });
  actions.appendChild(cancelBtn);
  header.appendChild(actions);

  const body = document.createElement("div");
  body.className = "card__body";

  const progress = document.createElement("div");
  progress.className = "progress";
  const bar = document.createElement("div");
  bar.className = "progress__bar";
  bar.id = "progress-bar";
  bar.style.width = "0%";
  progress.appendChild(bar);
  body.appendChild(progress);

  const meta = document.createElement("div");
  meta.className = "progress-meta";
  const left = document.createElement("span");
  left.id = "progress-meta-left";
  left.textContent = "准备中…";
  const right = document.createElement("span");
  right.id = "progress-meta-right";
  right.textContent = "0 / 0";
  meta.appendChild(left);
  meta.appendChild(right);
  body.appendChild(meta);

  const logTitle = document.createElement("div");
  logTitle.style.marginTop = "16px";
  logTitle.style.fontSize = "13px";
  logTitle.style.color = "var(--text-muted)";
  logTitle.textContent = "批次日志";
  body.appendChild(logTitle);

  const log = document.createElement("div");
  log.className = "log";
  log.id = "import-log";
  body.appendChild(log);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function buildReportCard() {
  const card = document.createElement("div");
  card.className = "card";
  card.id = "report-card";
  card.hidden = true;

  const header = document.createElement("div");
  header.className = "card__header";
  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = "导入汇总报告";
  header.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "card__actions";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn--ghost btn--sm";
  closeBtn.textContent = "清除";
  closeBtn.addEventListener("click", () => {
    card.hidden = true;
  });
  actions.appendChild(closeBtn);
  header.appendChild(actions);

  const body = document.createElement("div");
  body.className = "card__body";

  const grid = document.createElement("div");
  grid.className = "report-grid";
  grid.id = "report-grid";
  body.appendChild(grid);

  const details = document.createElement("details");
  details.className = "details";
  const summary = document.createElement("summary");
  summary.textContent = "错误明细（前 20 条）";
  details.appendChild(summary);
  const detailBody = document.createElement("div");
  detailBody.className = "details__body";
  detailBody.id = "report-errors";
  details.appendChild(detailBody);
  body.appendChild(details);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

// ---- 文件处理 ----
function handleFile(file, dz) {
  const status = document.getElementById("dropzone-status");
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
  const el = document.getElementById("dropzone-status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "var(--danger)" : "var(--text-muted)";
}

// 兼容 {"results":[...]} 包装与顶层数组
function normalizeResults(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

// JSON.parse 错误定位（V8 / WebKit / Firefox 均在 message 中带位置）
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
      const dzCard = dropzone.closest(".card");
      startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "btn btn--primary";
      startBtn.id = "start-import-btn";
      startBtn.style.marginTop = "12px";
      startBtn.textContent = `开始导入（${total} 条）`;
      startBtn.addEventListener("click", () => runImport());
      dzCard.appendChild(startBtn);
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
  log.innerHTML = "";
  bar.style.width = "0%";
  bar.classList.remove("is-idle");
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
      // 单批失败不阻断后续批次；用户可在报告里查看明细
    }

    const done = i + 1;
    const pct = Math.round((done / batches.length) * 100);
    bar.style.width = `${pct}%`;
    left.textContent = cancelled ? "已取消" : `${pct}%`;
    right.textContent = `${done} / ${batches.length}`;

    // 让浏览器有机会重绘进度条
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  bar.classList.add("is-idle");
  if (cancelled) {
    bar.style.background = "var(--warn)";
  } else {
    bar.style.background = "";
    bar.style.width = "100%";
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

  grid.innerHTML = "";
  errBody.innerHTML = "";

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
    const cell = document.createElement("div");
    cell.className = `report-cell ${c.cls}`.trim();
    const lab = document.createElement("div");
    lab.className = "report-cell__label";
    lab.textContent = c.label;
    const val = document.createElement("span");
    val.className = "report-cell__value";
    val.textContent = typeof c.value === "number" ? c.value.toLocaleString("zh-CN") : c.value;
    cell.appendChild(lab);
    cell.appendChild(val);
    grid.appendChild(cell);
  }

  if (agg.errors.length === 0) {
    const p = document.createElement("p");
    p.textContent = "无错误";
    errBody.appendChild(p);
  } else {
    agg.errors.slice(0, 20).forEach((e) => {
      const p = document.createElement("p");
      p.textContent = e;
      errBody.appendChild(p);
    });
    if (agg.errors.length > 20) {
      const p = document.createElement("p");
      p.style.color = "var(--text-faint)";
      p.textContent = `… 还有 ${agg.errors.length - 20} 条未显示`;
      errBody.appendChild(p);
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
  const line = document.createElement("div");
  line.className = `log__line log__line--${level}`;
  const time = document.createElement("span");
  time.className = "log__time";
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  time.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const m = document.createElement("span");
  m.className = "log__msg";
  m.textContent = msg;
  line.appendChild(time);
  line.appendChild(m);
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
