import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { loadData, saveData } from "../shared/storage.js";

const persistentPopupEl = document.querySelector("#persistentPopup");
const toggleEditEl = document.querySelector("#toggleEdit");
const toggleAddEl = document.querySelector("#toggleAdd");
const clearAllEl = document.querySelector("#clearAll");
const toggleCalibrationEl = document.querySelector("#toggleCalibration");
const uiStateEl = document.querySelector("#uiState");
const openOptionsEl = document.querySelector("#openOptions");
const statusEl = document.querySelector("#status");

const UI_GET_STATE_MESSAGE = "PINTAP_UI_GET_STATE";
const UI_TOGGLE_EDIT_MESSAGE = "PINTAP_UI_TOGGLE_EDIT";
const UI_TOGGLE_ADD_MESSAGE = "PINTAP_UI_TOGGLE_ADD";
const UI_CLEAR_ALL_MESSAGE = "PINTAP_UI_CLEAR_ALL";
const UI_TOGGLE_CALIBRATION_MESSAGE = "PINTAP_UI_TOGGLE_CALIBRATION";
const POPUP_STATUS_MESSAGE = "PINTAP_POPUP_STATUS";
const OPEN_PERSISTENT_POPUP_MESSAGE = "PINTAP_OPEN_PERSISTENT_POPUP";
const CLOSE_PERSISTENT_POPUP_MESSAGE = "PINTAP_CLOSE_PERSISTENT_POPUP";
const GET_ACTIVE_TAB_ID_MESSAGE = "PINTAP_GET_ACTIVE_TAB_ID";

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
  persistentPopupEl.checked = Boolean(settings.persistentPopupEnabled);
}

async function saveSettings() {
  const data = await loadData();
  data.settings = {
    ...(data.settings || {}),
    persistentPopupEnabled: persistentPopupEl.checked
  };
  await saveData(data);
  setStatus("已保存");
}

function applyUiState(state) {
  if (!state || typeof state !== "object") {
    uiStateEl.textContent = "当前页面未注入 PinTap（尝试刷新页面）";
    return;
  }
  toggleEditEl.textContent = state.editMode ? "退出编辑" : "进入编辑";
  toggleAddEl.textContent = state.addingMode ? "取消新增" : "新增标识";
  toggleCalibrationEl.textContent = state.calibrationMode ? "退出校准" : "开启校准";
  uiStateEl.textContent = `标识 ${state.markerCount} 个 | 偏移 X:${state.clickOffsetX} Y:${state.clickOffsetY}`;
}

async function getActiveTabId() {
  const response = await chrome.runtime.sendMessage({ type: GET_ACTIVE_TAB_ID_MESSAGE });
  if (typeof response?.activeTabId === "number") {
    return response.activeTabId;
  }
  if (typeof response?.senderTabId === "number") {
    return response.senderTabId;
  }
  return null;
}

async function sendUiMessage(type) {
  const tabId = await getActiveTabId();
  if (typeof tabId !== "number") {
    setStatus("未找到当前标签页");
    return null;
  }
  try {
    const state = await chrome.tabs.sendMessage(tabId, { type });
    applyUiState(state);
    return state;
  } catch (_error) {
    setStatus("当前页面不可用，请刷新后重试");
    applyUiState(null);
    return null;
  }
}

persistentPopupEl.addEventListener("change", () => {
  void (async () => {
    await saveSettings();
    if (persistentPopupEl.checked) {
      await chrome.runtime.sendMessage({ type: OPEN_PERSISTENT_POPUP_MESSAGE });
      setStatus("已开启常驻窗口");
      if (!window.location.search.includes("persistent=1")) {
        window.close();
      }
      return;
    }
    await chrome.runtime.sendMessage({ type: CLOSE_PERSISTENT_POPUP_MESSAGE });
    setStatus("已关闭常驻窗口");
  })();
});

toggleEditEl.addEventListener("click", () => {
  void sendUiMessage(UI_TOGGLE_EDIT_MESSAGE);
});

toggleAddEl.addEventListener("click", () => {
  void sendUiMessage(UI_TOGGLE_ADD_MESSAGE);
});

clearAllEl.addEventListener("click", () => {
  const ok = window.confirm("确认清除当前页面站点下全部标识？");
  if (!ok) {
    return;
  }
  void sendUiMessage(UI_CLEAR_ALL_MESSAGE);
});

toggleCalibrationEl.addEventListener("click", () => {
  void sendUiMessage(UI_TOGGLE_CALIBRATION_MESSAGE);
});

openOptionsEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function bootstrap() {
  await hydrate();
  const popupState = await chrome.runtime.sendMessage({ type: POPUP_STATUS_MESSAGE });
  if (popupState && typeof popupState.enabled === "boolean") {
    persistentPopupEl.checked = popupState.enabled;
  }
  await sendUiMessage(UI_GET_STATE_MESSAGE);
}

void bootstrap();
