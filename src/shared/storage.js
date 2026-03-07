import { DATA_VERSION, DEFAULT_SETTINGS, STORAGE_KEY } from "./constants.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getDefaultData() {
  return {
    version: DATA_VERSION,
    settings: deepClone(DEFAULT_SETTINGS),
    profilesByOrigin: {}
  };
}

export async function loadData() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  if (!raw || typeof raw !== "object") {
    return getDefaultData();
  }

  const data = {
    version: DATA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(raw.settings || {})
    },
    profilesByOrigin: raw.profilesByOrigin || {}
  };

  return data;
}

export async function saveData(data) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: data
  });
}

export async function updateData(mutator) {
  const data = await loadData();
  const nextData = mutator(data) || data;
  await saveData(nextData);
  return nextData;
}

export function getProfileForOrigin(data, origin) {
  return data.profilesByOrigin[origin] || { markers: [] };
}
