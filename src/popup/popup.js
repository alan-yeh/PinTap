import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { loadData, saveData } from "../shared/storage.js";

const enabledEl = document.querySelector("#enabled");
const triggerModeEl = document.querySelector("#triggerMode");
const repeatIntervalEl = document.querySelector("#repeatIntervalMs");
const openOptionsEl = document.querySelector("#openOptions");
const statusEl = document.querySelector("#status");

function setStatus(text) {
  statusEl.textContent = text;
  window.setTimeout(() => {
    if (statusEl.textContent === text) {
      statusEl.textContent = "";
    }
  }, 1000);
}

async function hydrate() {
  const data = await loadData();
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  enabledEl.checked = Boolean(settings.enabled);
  triggerModeEl.value = settings.triggerMode;
  repeatIntervalEl.value = String(settings.repeatIntervalMs);
}

async function saveSettings() {
  const data = await loadData();
  data.settings = {
    enabled: enabledEl.checked,
    triggerMode: triggerModeEl.value === "repeat" ? "repeat" : "single",
    repeatIntervalMs: Math.max(50, Math.min(1000, Number(repeatIntervalEl.value) || 120))
  };
  await saveData(data);
  setStatus("已保存");
}

enabledEl.addEventListener("change", () => {
  void saveSettings();
});

triggerModeEl.addEventListener("change", () => {
  void saveSettings();
});

repeatIntervalEl.addEventListener("change", () => {
  void saveSettings();
});

openOptionsEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void hydrate();
