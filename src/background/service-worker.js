import { MESSAGE_TYPES } from "../shared/constants.js";
import { getDefaultData, loadData, saveData } from "../shared/storage.js";

let activeTabId = null;
let persistentPopupWindowId = null;
const POPUP_STATUS_MESSAGE = "PINTAP_POPUP_STATUS";
const OPEN_PERSISTENT_POPUP_MESSAGE = "PINTAP_OPEN_PERSISTENT_POPUP";
const CLOSE_PERSISTENT_POPUP_MESSAGE = "PINTAP_CLOSE_PERSISTENT_POPUP";
const GET_ACTIVE_TAB_ID_MESSAGE = "PINTAP_GET_ACTIVE_TAB_ID";
const OPEN_OPTIONS_PAGE_MESSAGE = "PINTAP_OPEN_OPTIONS_PAGE";
let iconCache = null;

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createIconImageData(size, backgroundColor, textColor) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, size, size);
  drawRoundedRect(ctx, 0, 0, size, size, Math.round(size * 0.22));
  ctx.fillStyle = backgroundColor;
  ctx.fill();

  ctx.fillStyle = textColor;
  ctx.font = `700 ${Math.round(size * 0.5)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("P", size / 2, size / 2 + Math.round(size * 0.02));

  return ctx.getImageData(0, 0, size, size);
}

function getActionIconPayload(enabled) {
  if (!iconCache) {
    iconCache = {
      enabled: {
        16: createIconImageData(16, "#1A3263", "#E8E2DB"),
        32: createIconImageData(32, "#1A3263", "#E8E2DB"),
        48: createIconImageData(48, "#1A3263", "#E8E2DB"),
        128: createIconImageData(128, "#1A3263", "#E8E2DB")
      },
      disabled: {
        16: createIconImageData(16, "#797979", "#D7D7D7"),
        32: createIconImageData(32, "#797979", "#D7D7D7"),
        48: createIconImageData(48, "#797979", "#D7D7D7"),
        128: createIconImageData(128, "#797979", "#D7D7D7")
      }
    };
  }
  return enabled ? iconCache.enabled : iconCache.disabled;
}

async function setActionAppearance(enabled) {
  await chrome.action.setIcon({
    imageData: getActionIconPayload(enabled)
  });
  await chrome.action.setTitle({
    title: enabled ? "PinTap（已启用）" : "PinTap（已禁用）"
  });
}

async function getExtensionEnabledState() {
  const data = await loadData();
  return Boolean(data.settings?.extensionEnabled ?? true);
}

async function broadcastExtensionStatus(enabled) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: MESSAGE_TYPES.EXTENSION_STATUS,
          extensionEnabled: enabled
        });
      } catch (_error) {
        // Ignore tabs without active content script.
      }
    })
  );
}

async function setExtensionEnabledState(enabled) {
  const data = await loadData();
  data.settings = {
    ...getDefaultData().settings,
    ...(data.settings || {}),
    extensionEnabled: enabled
  };
  await saveData(data);
  await setActionAppearance(enabled);
  await broadcastExtensionStatus(enabled);
}

async function getPersistentPopupState() {
  if (typeof persistentPopupWindowId !== "number") {
    return { enabled: false };
  }
  try {
    const win = await chrome.windows.get(persistentPopupWindowId);
    return {
      enabled: true,
      windowId: win.id
    };
  } catch (_error) {
    persistentPopupWindowId = null;
    return { enabled: false };
  }
}

async function openPersistentPopupWindow() {
  const current = await getPersistentPopupState();
  if (current.enabled && typeof current.windowId === "number") {
    await chrome.windows.update(current.windowId, { focused: true });
    return current;
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("src/popup/popup.html?persistent=1"),
    type: "popup",
    width: 360,
    height: 640,
    focused: true
  });
  persistentPopupWindowId = win.id ?? null;
  return {
    enabled: typeof win.id === "number",
    windowId: win.id
  };
}

async function closePersistentPopupWindow() {
  const current = await getPersistentPopupState();
  if (current.enabled && typeof current.windowId === "number") {
    await chrome.windows.remove(current.windowId);
  }
  persistentPopupWindowId = null;
  return { enabled: false };
}

async function ensureStorageInitialized() {
  const data = await loadData();
  await saveData({
    ...getDefaultData(),
    ...data,
    settings: {
      ...getDefaultData().settings,
      ...data.settings
    }
  });
  const enabled = Boolean(data.settings?.extensionEnabled ?? true);
  await setActionAppearance(enabled);
}

async function sendActiveStatus(tabId, isActive) {
  if (typeof tabId !== "number") {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.ACTIVE_STATUS,
      isActive
    });
  } catch (_error) {
    // Ignore tabs where content script is unavailable.
  }
}

async function syncActiveTabForWindow(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (typeof activeTabId === "number") {
      await sendActiveStatus(activeTabId, false);
      activeTabId = null;
    }
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, windowId });
  const nextTab = tabs[0];
  const nextTabId = nextTab?.id;

  if (typeof activeTabId === "number" && activeTabId !== nextTabId) {
    await sendActiveStatus(activeTabId, false);
  }
  if (typeof nextTabId === "number") {
    await sendActiveStatus(nextTabId, true);
  }

  activeTabId = typeof nextTabId === "number" ? nextTabId : null;
}

async function syncActiveTabFromLastFocusedWindow() {
  try {
    const windowInfo = await chrome.windows.getLastFocused();
    await syncActiveTabForWindow(windowInfo.id);
  } catch (_error) {
    activeTabId = null;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureStorageInitialized().then(async () => {
    const data = await loadData();
    if (data.settings?.persistentPopupEnabled) {
      await openPersistentPopupWindow();
    }
  });
  void syncActiveTabFromLastFocusedWindow();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureStorageInitialized().then(async () => {
    const data = await loadData();
    if (data.settings?.persistentPopupEnabled) {
      await openPersistentPopupWindow();
    }
  });
  void syncActiveTabFromLastFocusedWindow();
});

chrome.action.onClicked.addListener(() => {
  void getExtensionEnabledState().then(async (enabled) => {
    await setExtensionEnabledState(!enabled);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void syncActiveTabForWindow(activeInfo.windowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void syncActiveTabForWindow(windowId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (persistentPopupWindowId === windowId) {
    persistentPopupWindowId = null;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.GET_ACTIVE_STATUS) {
    const senderTabId = sender.tab?.id;
    const fallbackActive =
      activeTabId === null && typeof sender.tab?.active === "boolean" ? sender.tab.active : false;
    sendResponse({
      isActive:
        (typeof senderTabId === "number" && senderTabId === activeTabId) || Boolean(fallbackActive)
    });
    return true;
  }

  if (message?.type === POPUP_STATUS_MESSAGE) {
    void getPersistentPopupState().then((state) => sendResponse(state));
    return true;
  }

  if (message?.type === OPEN_PERSISTENT_POPUP_MESSAGE) {
    void openPersistentPopupWindow().then((state) => sendResponse(state));
    return true;
  }

  if (message?.type === CLOSE_PERSISTENT_POPUP_MESSAGE) {
    void closePersistentPopupWindow().then((state) => sendResponse(state));
    return true;
  }

  if (message?.type === GET_ACTIVE_TAB_ID_MESSAGE) {
    sendResponse({
      activeTabId: typeof activeTabId === "number" ? activeTabId : null,
      senderTabId: typeof sender.tab?.id === "number" ? sender.tab.id : null
    });
    return true;
  }

  if (message?.type === OPEN_OPTIONS_PAGE_MESSAGE) {
    void chrome.runtime.openOptionsPage().then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

void syncActiveTabFromLastFocusedWindow();
