import { MESSAGE_TYPES } from "../shared/constants.js";
import { getDefaultData, loadData, saveData } from "../shared/storage.js";

let activeTabId = null;
let persistentPopupWindowId = null;
const POPUP_STATUS_MESSAGE = "PINTAP_POPUP_STATUS";
const OPEN_PERSISTENT_POPUP_MESSAGE = "PINTAP_OPEN_PERSISTENT_POPUP";
const CLOSE_PERSISTENT_POPUP_MESSAGE = "PINTAP_CLOSE_PERSISTENT_POPUP";
const GET_ACTIVE_TAB_ID_MESSAGE = "PINTAP_GET_ACTIVE_TAB_ID";
const OPEN_OPTIONS_PAGE_MESSAGE = "PINTAP_OPEN_OPTIONS_PAGE";

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
