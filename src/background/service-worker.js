import { MESSAGE_TYPES } from "../shared/constants.js";
import { getDefaultData, loadData, saveData } from "../shared/storage.js";

let activeTabId = null;

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
  void ensureStorageInitialized();
  void syncActiveTabFromLastFocusedWindow();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureStorageInitialized();
  void syncActiveTabFromLastFocusedWindow();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void syncActiveTabForWindow(activeInfo.windowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void syncActiveTabForWindow(windowId);
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
  return false;
});

void syncActiveTabFromLastFocusedWindow();
