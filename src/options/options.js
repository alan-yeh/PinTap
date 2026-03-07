import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { loadData, saveData } from "../shared/storage.js";
import { normalizeKeyCode, toDisplayKey } from "../shared/keymap.js";

const enabledEl = document.querySelector("#enabled");
const triggerModeEl = document.querySelector("#triggerMode");
const repeatIntervalEl = document.querySelector("#repeatIntervalMs");
const saveSettingsEl = document.querySelector("#saveSettings");
const originSelectEl = document.querySelector("#originSelect");
const newOriginEl = document.querySelector("#newOrigin");
const markersBodyEl = document.querySelector("#markersBody");
const addMarkerEl = document.querySelector("#addMarker");
const saveMarkersEl = document.querySelector("#saveMarkers");
const exportJsonEl = document.querySelector("#exportJson");
const importJsonEl = document.querySelector("#importJson");
const jsonAreaEl = document.querySelector("#jsonArea");
const statusEl = document.querySelector("#status");

let dataCache = null;
let editingMarkers = [];

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

function ensureOriginOptions() {
  const origins = Object.keys(dataCache.profilesByOrigin);
  if (!origins.length) {
    dataCache.profilesByOrigin["https://example.com"] = { markers: [] };
  }
  originSelectEl.innerHTML = "";
  Object.keys(dataCache.profilesByOrigin).forEach((origin) => {
    const option = document.createElement("option");
    option.value = origin;
    option.textContent = origin;
    originSelectEl.appendChild(option);
  });
}

function selectedOrigin() {
  return originSelectEl.value;
}

function validateNoConflicts(markers) {
  const seen = new Set();
  for (const marker of markers) {
    if (!marker.key) {
      continue;
    }
    if (seen.has(marker.key)) {
      return marker.key;
    }
    seen.add(marker.key);
  }
  return "";
}

function renderMarkersTable() {
  markersBodyEl.innerHTML = "";
  editingMarkers.forEach((marker) => {
    const row = document.createElement("tr");
    row.dataset.id = marker.id;

    row.innerHTML = `
      <td><input data-field="key" value="${marker.key || ""}" /></td>
      <td><input data-field="xRatio" type="number" min="0" max="1" step="0.01" value="${marker.xRatio}" /></td>
      <td><input data-field="yRatio" type="number" min="0" max="1" step="0.01" value="${marker.yRatio}" /></td>
      <td><input data-field="radius" type="number" min="8" max="80" step="1" value="${marker.radius}" /></td>
      <td><input data-field="opacity" type="number" min="0.1" max="1" step="0.05" value="${marker.opacity}" /></td>
      <td><button data-action="delete">删除</button></td>
    `;

    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      editingMarkers = editingMarkers.filter((item) => item.id !== marker.id);
      renderMarkersTable();
    });

    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        const field = input.dataset.field;
        if (field === "key") {
          marker.key = normalizeKeyCode(input.value);
          return;
        }
        if (field === "xRatio" || field === "yRatio") {
          marker[field] = clamp01(input.value);
          input.value = String(marker[field]);
          return;
        }
        if (field === "radius") {
          marker.radius = Math.max(8, Math.min(80, Number(input.value) || 24));
          input.value = String(marker.radius);
          return;
        }
        if (field === "opacity") {
          marker.opacity = Math.max(0.1, Math.min(1, Number(input.value) || 0.8));
          input.value = String(marker.opacity);
        }
      });
    });

    markersBodyEl.appendChild(row);
  });
}

function hydrateGlobalSettings() {
  const settings = { ...DEFAULT_SETTINGS, ...(dataCache.settings || {}) };
  enabledEl.checked = Boolean(settings.enabled);
  triggerModeEl.value = settings.triggerMode;
  repeatIntervalEl.value = String(settings.repeatIntervalMs);
}

function hydrateOriginMarkers() {
  const origin = selectedOrigin();
  const profile = dataCache.profilesByOrigin[origin] || { markers: [] };
  editingMarkers = (profile.markers || []).map((item) => ({ ...item }));
  renderMarkersTable();
}

async function saveGlobalSettings() {
  dataCache.settings = {
    enabled: enabledEl.checked,
    triggerMode: triggerModeEl.value === "repeat" ? "repeat" : "single",
    repeatIntervalMs: Math.max(50, Math.min(1000, Number(repeatIntervalEl.value) || 120))
  };
  await saveData(dataCache);
  setStatus("全局设置已保存");
}

async function saveCurrentOriginMarkers() {
  const conflictKey = validateNoConflicts(editingMarkers);
  if (conflictKey) {
    setStatus(`键位冲突: ${toDisplayKey(conflictKey)}`);
    return;
  }
  const origin = selectedOrigin();
  dataCache.profilesByOrigin[origin] = {
    markers: editingMarkers.map((item) => ({
      ...item,
      key: normalizeKeyCode(item.key)
    }))
  };
  await saveData(dataCache);
  setStatus("站点标识已保存");
}

function addMarker() {
  editingMarkers.push({
    id: String(Date.now()) + Math.random().toString(16).slice(2, 8),
    key: "",
    xRatio: 0.5,
    yRatio: 0.5,
    radius: 24,
    opacity: 0.8
  });
  renderMarkersTable();
}

function addOrigin() {
  const value = window.prompt("输入新的 Origin，例如 https://example.com");
  if (!value) {
    return;
  }
  try {
    const url = new URL(value);
    const origin = url.origin;
    if (!dataCache.profilesByOrigin[origin]) {
      dataCache.profilesByOrigin[origin] = { markers: [] };
    }
    ensureOriginOptions();
    originSelectEl.value = origin;
    hydrateOriginMarkers();
    setStatus("已新增站点");
  } catch (_error) {
    setStatus("Origin 格式无效");
  }
}

function exportJson() {
  jsonAreaEl.value = JSON.stringify(dataCache, null, 2);
  setStatus("已导出到文本框");
}

async function importJson() {
  const text = jsonAreaEl.value.trim();
  if (!text) {
    setStatus("请先粘贴 JSON");
    return;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid");
    }
    dataCache = {
      version: 1,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      profilesByOrigin: parsed.profilesByOrigin || {}
    };
    await saveData(dataCache);
    ensureOriginOptions();
    hydrateGlobalSettings();
    hydrateOriginMarkers();
    setStatus("导入成功");
  } catch (_error) {
    setStatus("导入失败，JSON 格式错误");
  }
}

async function bootstrap() {
  dataCache = await loadData();
  hydrateGlobalSettings();
  ensureOriginOptions();
  hydrateOriginMarkers();

  saveSettingsEl.addEventListener("click", () => {
    void saveGlobalSettings();
  });
  originSelectEl.addEventListener("change", () => {
    hydrateOriginMarkers();
  });
  newOriginEl.addEventListener("click", addOrigin);
  addMarkerEl.addEventListener("click", addMarker);
  saveMarkersEl.addEventListener("click", () => {
    void saveCurrentOriginMarkers();
  });
  exportJsonEl.addEventListener("click", exportJson);
  importJsonEl.addEventListener("click", () => {
    void importJson();
  });
}

void bootstrap();
