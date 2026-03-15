import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { loadData, saveData } from "../shared/storage.js";
import { toDisplayKey } from "../shared/keymap.js";

const markerSizeEl = document.querySelector("#markerSizePx");
const markerSizeValueEl = document.querySelector("#markerSizeValue");
const markerBackgroundColorEl = document.querySelector("#markerBackgroundColor");
const markerBackgroundColorTextEl = document.querySelector("#markerBackgroundColorText");
const markerTextColorEl = document.querySelector("#markerTextColor");
const markerTextColorTextEl = document.querySelector("#markerTextColorText");
const markerOpacityEl = document.querySelector("#markerOpacity");
const markerOpacityValueEl = document.querySelector("#markerOpacityValue");
const previewMarkerEl = document.querySelector("#previewMarker");
const saveSettingsEl = document.querySelector("#saveSettings");
const originSelectEl = document.querySelector("#originSelect");
const deleteOriginEl = document.querySelector("#deleteOrigin");
const markersBodyEl = document.querySelector("#markersBody");
const scriptLoopEl = document.querySelector("#scriptLoop");
const scriptStepsBodyEl = document.querySelector("#scriptStepsBody");
const addScriptStepEl = document.querySelector("#addScriptStep");
const saveScriptEl = document.querySelector("#saveScript");
const statusEl = document.querySelector("#status");

let dataCache = null;
let markerPulseTimer = 0;

function setStatus(text) {
  statusEl.textContent = text;
  window.setTimeout(() => {
    if (statusEl.textContent === text) {
      statusEl.textContent = "";
    }
  }, 1200);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clampMarkerSize(value) {
  return Math.max(15, Math.min(40, Number(value) || DEFAULT_SETTINGS.markerSizePx));
}

function clampMarkerOpacity(value) {
  return Math.max(0.3, Math.min(0.9, Number(value) || DEFAULT_SETTINGS.markerOpacity));
}

function normalizeHexColor(value, fallback) {
  const source = typeof value === "string" ? value.trim() : "";
  const hex = source.startsWith("#") ? source.slice(1) : source;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return (
      "#" +
      hex
        .split("")
        .map((ch) => ch + ch)
        .join("")
        .toUpperCase()
    );
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return `#${hex.toUpperCase()}`;
  }
  return fallback;
}

function hexToRgb(hexColor) {
  const hex = normalizeHexColor(hexColor, "#000000").slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function rgbToHex(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function mixColor(colorA, colorB, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  return {
    r: colorA.r + (colorB.r - colorA.r) * t,
    g: colorA.g + (colorB.g - colorA.g) * t,
    b: colorA.b + (colorB.b - colorA.b) * t
  };
}

function getLuminance(rgb) {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

function getMarkerColorProfile(backgroundHex, opacity) {
  const background = hexToRgb(backgroundHex);
  const baseLuminance = getLuminance(background);
  const borderTarget = baseLuminance >= 0.55 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const triggerTarget = baseLuminance >= 0.55 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const border = mixColor(background, borderTarget, 0.32);
  const trigger = mixColor(background, triggerTarget, 0.22);
  return {
    markerBackground: `rgba(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)}, ${opacity.toFixed(3)})`,
    markerBorder: rgbToHex(border),
    markerBorderAlpha: 0.92,
    triggerRgb: `${Math.round(trigger.r)}, ${Math.round(trigger.g)}, ${Math.round(trigger.b)}`
  };
}

function createStepId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `step-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function getDefaultScript() {
  return {
    loop: false,
    steps: []
  };
}

function normalizeScriptStep(rawStep, index) {
  if (!rawStep || typeof rawStep !== "object") {
    return null;
  }
  const key = typeof rawStep.key === "string" ? rawStep.key.trim() : "";
  if (!key) {
    return null;
  }
  const waitMs = Math.max(0, Math.round(Number(rawStep.waitMs) || 0));
  const waitOffsetMs = Math.max(0, Math.round(Number(rawStep.waitOffsetMs) || 0));
  return {
    id: typeof rawStep.id === "string" && rawStep.id ? rawStep.id : `step-${index + 1}`,
    key,
    waitMs,
    waitOffsetMs
  };
}

function normalizeScript(rawScript) {
  if (!rawScript || typeof rawScript !== "object") {
    return getDefaultScript();
  }
  const rawSteps = Array.isArray(rawScript.steps) ? rawScript.steps : [];
  const steps = rawSteps.map(normalizeScriptStep).filter(Boolean);
  return {
    loop: Boolean(rawScript.loop),
    steps
  };
}

function ensureProfile(origin) {
  if (!origin) {
    return null;
  }
  if (!dataCache.profilesByOrigin[origin] || typeof dataCache.profilesByOrigin[origin] !== "object") {
    dataCache.profilesByOrigin[origin] = {};
  }
  const profile = dataCache.profilesByOrigin[origin];
  if (!Array.isArray(profile.markers)) {
    profile.markers = [];
  }
  profile.script = normalizeScript(profile.script);
  return profile;
}

function formatWaitSeconds(waitMs) {
  const seconds = Math.max(0, Number(waitMs) || 0) / 1000;
  return Number.isInteger(seconds) ? String(seconds) : String(seconds.toFixed(3)).replace(/0+$/, "").replace(/\.$/, "");
}

function setScriptEditorDisabled(disabled) {
  scriptLoopEl.disabled = disabled;
  addScriptStepEl.disabled = disabled;
  saveScriptEl.disabled = disabled;
}

function renderScriptStepRow(step, index) {
  const row = document.createElement("tr");
  row.dataset.id = step.id;
  row.innerHTML = `
      <td>${index + 1}</td>
      <td><input type="text" data-field="key" placeholder="例如 A / Enter" /></td>
      <td><input type="number" min="0" step="0.1" data-field="waitSeconds" /></td>
      <td><input type="number" min="0" step="0.1" data-field="waitOffsetSeconds" placeholder="默认 0" /></td>
      <td><button class="btn-danger" data-action="delete-step">删除</button></td>
    `;
  const keyInput = row.querySelector('[data-field="key"]');
  if (keyInput instanceof HTMLInputElement) {
    keyInput.value = step.key;
  }
  const waitInput = row.querySelector('[data-field="waitSeconds"]');
  if (waitInput instanceof HTMLInputElement) {
    waitInput.value = formatWaitSeconds(step.waitMs);
  }
  const waitOffsetInput = row.querySelector('[data-field="waitOffsetSeconds"]');
  if (waitOffsetInput instanceof HTMLInputElement) {
    waitOffsetInput.value = formatWaitSeconds(step.waitOffsetMs);
  }
  row.querySelector('[data-action="delete-step"]').addEventListener("click", () => {
    row.remove();
    refreshScriptStepIndexes();
  });
  return row;
}

function refreshScriptStepIndexes() {
  const rows = scriptStepsBodyEl.querySelectorAll("tr[data-id]");
  rows.forEach((row, index) => {
    const cell = row.querySelector("td");
    if (cell) {
      cell.textContent = String(index + 1);
    }
  });
}

function renderScriptEditor() {
  scriptStepsBodyEl.innerHTML = "";
  const origin = selectedOrigin();
  const profile = ensureProfile(origin);
  if (!origin || !profile) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="5">请选择一个站点后编辑脚本</td>`;
    scriptStepsBodyEl.appendChild(emptyRow);
    scriptLoopEl.checked = false;
    setScriptEditorDisabled(true);
    return;
  }
  setScriptEditorDisabled(false);
  scriptLoopEl.checked = Boolean(profile.script.loop);
  const steps = Array.isArray(profile.script.steps) ? profile.script.steps : [];
  if (!steps.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="5">当前站点暂无脚本步骤</td>`;
    scriptStepsBodyEl.appendChild(emptyRow);
    return;
  }
  steps.forEach((step, index) => {
    const row = renderScriptStepRow(step, index);
    scriptStepsBodyEl.appendChild(row);
  });
}

function ensureOriginOptions() {
  const origins = Object.keys(dataCache.profilesByOrigin);
  originSelectEl.innerHTML = "";
  if (!origins.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无站点数据";
    originSelectEl.appendChild(option);
    deleteOriginEl.disabled = true;
    setScriptEditorDisabled(true);
    return;
  }
  deleteOriginEl.disabled = false;
  origins.forEach((origin) => {
    const option = document.createElement("option");
    option.value = origin;
    option.textContent = origin;
    originSelectEl.appendChild(option);
  });
  setScriptEditorDisabled(false);
}

function selectedOrigin() {
  return originSelectEl.value;
}

function renderMarkersTable() {
  markersBodyEl.innerHTML = "";
  const origin = selectedOrigin();
  const profile = dataCache.profilesByOrigin[origin] || { markers: [] };
  const markers = Array.isArray(profile.markers) ? profile.markers : [];

  if (!markers.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="4">当前站点暂无标识</td>`;
    markersBodyEl.appendChild(emptyRow);
    return;
  }

  markers.forEach((marker) => {
    const row = document.createElement("tr");
    row.dataset.id = String(marker.id || "");

    row.innerHTML = `
      <td>${toDisplayKey(marker.key || "")}</td>
      <td>${clamp01(marker.xRatio).toFixed(3)}</td>
      <td>${clamp01(marker.yRatio).toFixed(3)}</td>
      <td><button class="btn-danger" data-action="delete">删除</button></td>
    `;

    row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      const nextMarkers = markers.filter((item) => item.id !== marker.id);
      dataCache.profilesByOrigin[origin] = {
        ...profile,
        markers: nextMarkers
      };
      await saveData(dataCache);
      renderMarkersTable();
      setStatus("已删除当前标识");
    });

    markersBodyEl.appendChild(row);
  });
}

function pulsePreviewMarker() {
  if (markerPulseTimer) {
    window.clearTimeout(markerPulseTimer);
    markerPulseTimer = 0;
  }
  previewMarkerEl.classList.remove("triggered");
  void previewMarkerEl.offsetWidth;
  previewMarkerEl.classList.add("triggered");
  markerPulseTimer = window.setTimeout(() => {
    previewMarkerEl.classList.remove("triggered");
    markerPulseTimer = 0;
  }, 280);
}

function readGlobalSettingsFromInputs() {
  const markerBackgroundColor = normalizeHexColor(
    markerBackgroundColorTextEl.value || markerBackgroundColorEl.value,
    DEFAULT_SETTINGS.markerBackgroundColor
  );
  const markerTextColor = normalizeHexColor(
    markerTextColorTextEl.value || markerTextColorEl.value,
    DEFAULT_SETTINGS.markerTextColor
  );
  return {
    markerSizePx: clampMarkerSize(markerSizeEl.value),
    markerBackgroundColor,
    markerTextColor,
    markerOpacity: clampMarkerOpacity(Number(markerOpacityEl.value) / 100)
  };
}

function renderGlobalPreview() {
  const settings = readGlobalSettingsFromInputs();
  const markerSize = settings.markerSizePx;
  const markerOpacity = settings.markerOpacity;
  const profile = getMarkerColorProfile(settings.markerBackgroundColor, markerOpacity);

  markerSizeValueEl.textContent = `${markerSize}px`;
  markerOpacityValueEl.textContent = `${Math.round(markerOpacity * 100)}%`;
  markerBackgroundColorEl.value = settings.markerBackgroundColor;
  markerBackgroundColorTextEl.value = settings.markerBackgroundColor;
  markerTextColorEl.value = settings.markerTextColor;
  markerTextColorTextEl.value = settings.markerTextColor;

  previewMarkerEl.style.width = `${markerSize}px`;
  previewMarkerEl.style.height = `${markerSize}px`;
  previewMarkerEl.style.background = profile.markerBackground;
  previewMarkerEl.style.borderColor = `rgba(${hexToRgb(profile.markerBorder).r}, ${hexToRgb(profile.markerBorder).g}, ${hexToRgb(profile.markerBorder).b}, ${profile.markerBorderAlpha})`;
  previewMarkerEl.style.color = settings.markerTextColor;
  previewMarkerEl.style.setProperty("--preview-trigger-rgb", profile.triggerRgb);
}

function hydrateGlobalSettings() {
  const settings = { ...DEFAULT_SETTINGS, ...(dataCache.settings || {}) };
  markerSizeEl.value = String(clampMarkerSize(settings.markerSizePx));
  markerOpacityEl.value = String(Math.round(clampMarkerOpacity(settings.markerOpacity) * 100));
  markerBackgroundColorEl.value = normalizeHexColor(
    settings.markerBackgroundColor,
    DEFAULT_SETTINGS.markerBackgroundColor
  );
  markerBackgroundColorTextEl.value = markerBackgroundColorEl.value;
  markerTextColorEl.value = normalizeHexColor(settings.markerTextColor, DEFAULT_SETTINGS.markerTextColor);
  markerTextColorTextEl.value = markerTextColorEl.value;
  renderGlobalPreview();
  pulsePreviewMarker();
}

function hydrateSiteManagement() {
  renderMarkersTable();
  renderScriptEditor();
}

function addScriptStepRow(defaults = null) {
  const rows = scriptStepsBodyEl.querySelectorAll("tr[data-id]");
  const nextIndex = rows.length;
  const step = normalizeScriptStep(
    defaults || {
      id: createStepId(),
      key: "",
      waitMs: 0,
      waitOffsetMs: 0
    },
    nextIndex
  ) || {
    id: createStepId(),
    key: "",
    waitMs: 0,
    waitOffsetMs: 0
  };

  const emptyRow = scriptStepsBodyEl.querySelector("tr");
  if (emptyRow && !emptyRow.dataset.id) {
    scriptStepsBodyEl.innerHTML = "";
  }
  scriptStepsBodyEl.appendChild(renderScriptStepRow(step, nextIndex));
  refreshScriptStepIndexes();
}

function collectScriptFromInputs() {
  const rows = Array.from(scriptStepsBodyEl.querySelectorAll("tr[data-id]"));
  const steps = [];
  for (const row of rows) {
    const id = row.dataset.id || createStepId();
    const keyInput = row.querySelector('[data-field="key"]');
    const waitInput = row.querySelector('[data-field="waitSeconds"]');
    const waitOffsetInput = row.querySelector('[data-field="waitOffsetSeconds"]');
    const key = keyInput instanceof HTMLInputElement ? keyInput.value.trim() : "";
    if (!key) {
      return { error: "按钮键值不能为空" };
    }
    const waitSecondsRaw = waitInput instanceof HTMLInputElement ? waitInput.value.trim() : "0";
    const waitSeconds = Number(waitSecondsRaw);
    if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
      return { error: "等待时间必须是大于等于 0 的数字（秒）" };
    }
    const waitOffsetSecondsRaw = waitOffsetInput instanceof HTMLInputElement ? waitOffsetInput.value.trim() : "";
    const waitOffsetSeconds = waitOffsetSecondsRaw ? Number(waitOffsetSecondsRaw) : 0;
    if (!Number.isFinite(waitOffsetSeconds) || waitOffsetSeconds < 0) {
      return { error: "等待偏差必须是大于等于 0 的数字（秒）" };
    }
    steps.push({
      id,
      key,
      waitMs: Math.round(waitSeconds * 1000),
      waitOffsetMs: Math.round(waitOffsetSeconds * 1000)
    });
  }
  return {
    script: {
      loop: Boolean(scriptLoopEl.checked),
      steps
    }
  };
}

async function saveCurrentOriginScript() {
  const origin = selectedOrigin();
  if (!origin) {
    setStatus("当前无可编辑站点");
    return;
  }
  const profile = ensureProfile(origin);
  if (!profile) {
    setStatus("当前无可编辑站点");
    return;
  }
  const collected = collectScriptFromInputs();
  if (collected.error) {
    setStatus(collected.error);
    return;
  }
  profile.script = normalizeScript(collected.script);
  await saveData(dataCache);
  renderScriptEditor();
  setStatus("站点脚本已保存");
}

async function saveGlobalSettings() {
  const nextSettings = readGlobalSettingsFromInputs();
  dataCache.settings = {
    ...DEFAULT_SETTINGS,
    ...(dataCache.settings || {}),
    ...nextSettings
  };
  await saveData(dataCache);
  renderGlobalPreview();
  pulsePreviewMarker();
  setStatus("全局设置已保存");
}

async function deleteCurrentOrigin() {
  const origin = selectedOrigin();
  if (!origin || !dataCache.profilesByOrigin[origin]) {
    setStatus("当前无可删除站点");
    return;
  }
  const ok = window.confirm(`确认删除站点 ${origin} 及其全部标识吗？`);
  if (!ok) {
    return;
  }
  delete dataCache.profilesByOrigin[origin];
  await saveData(dataCache);
  ensureOriginOptions();
  hydrateSiteManagement();
  setStatus("站点已删除");
}

async function bootstrap() {
  dataCache = await loadData();
  hydrateGlobalSettings();
  ensureOriginOptions();
  hydrateSiteManagement();

  markerSizeEl.addEventListener("input", renderGlobalPreview);
  markerOpacityEl.addEventListener("input", renderGlobalPreview);
  markerBackgroundColorEl.addEventListener("input", () => {
    markerBackgroundColorTextEl.value = markerBackgroundColorEl.value;
    renderGlobalPreview();
  });
  markerTextColorEl.addEventListener("input", () => {
    markerTextColorTextEl.value = markerTextColorEl.value;
    renderGlobalPreview();
  });
  markerBackgroundColorTextEl.addEventListener("input", renderGlobalPreview);
  markerTextColorTextEl.addEventListener("input", renderGlobalPreview);
  markerBackgroundColorTextEl.addEventListener("blur", renderGlobalPreview);
  markerTextColorTextEl.addEventListener("blur", renderGlobalPreview);

  saveSettingsEl.addEventListener("click", () => {
    void saveGlobalSettings();
  });
  originSelectEl.addEventListener("change", () => {
    hydrateSiteManagement();
  });
  deleteOriginEl.addEventListener("click", () => {
    void deleteCurrentOrigin();
  });
  addScriptStepEl.addEventListener("click", () => {
    if (!selectedOrigin()) {
      setStatus("请先选择一个站点");
      return;
    }
    addScriptStepRow();
  });
  saveScriptEl.addEventListener("click", () => {
    void saveCurrentOriginScript();
  });
}

void bootstrap();
