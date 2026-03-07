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

function ensureOriginOptions() {
  const origins = Object.keys(dataCache.profilesByOrigin);
  originSelectEl.innerHTML = "";
  if (!origins.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无站点数据";
    originSelectEl.appendChild(option);
    deleteOriginEl.disabled = true;
    return;
  }
  deleteOriginEl.disabled = false;
  origins.forEach((origin) => {
    const option = document.createElement("option");
    option.value = origin;
    option.textContent = origin;
    originSelectEl.appendChild(option);
  });
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
}

void bootstrap();
