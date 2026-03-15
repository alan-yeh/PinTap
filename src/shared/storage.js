import { DATA_VERSION, DEFAULT_SETTINGS, STORAGE_KEY } from "./constants.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultScript() {
  return {
    loop: false,
    steps: []
  };
}

function normalizeScript(rawScript) {
  if (!rawScript || typeof rawScript !== "object") {
    return getDefaultScript();
  }
  const rawSteps = Array.isArray(rawScript.steps) ? rawScript.steps : [];
  const steps = rawSteps
    .map((step, index) => {
      if (!step || typeof step !== "object") {
        return null;
      }
      const key = typeof step.key === "string" ? step.key.trim() : "";
      if (!key) {
        return null;
      }
      const waitMs = Math.max(0, Math.round(Number(step.waitMs) || 0));
      const waitOffsetMs = Math.max(0, Math.round(Number(step.waitOffsetMs) || 0));
      const fallbackId = `step-${index + 1}`;
      return {
        id: typeof step.id === "string" && step.id ? step.id : fallbackId,
        key,
        waitMs,
        waitOffsetMs
      };
    })
    .filter(Boolean);

  return {
    loop: Boolean(rawScript.loop),
    steps
  };
}

function normalizeProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== "object") {
    return {
      markers: [],
      script: getDefaultScript()
    };
  }
  const markers = Array.isArray(rawProfile.markers) ? rawProfile.markers : [];
  return {
    ...rawProfile,
    markers,
    script: normalizeScript(rawProfile.script)
  };
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

  const rawProfilesByOrigin =
    raw.profilesByOrigin && typeof raw.profilesByOrigin === "object" ? raw.profilesByOrigin : {};
  const profilesByOrigin = {};
  Object.entries(rawProfilesByOrigin).forEach(([origin, profile]) => {
    profilesByOrigin[origin] = normalizeProfile(profile);
  });

  const data = {
    version: DATA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(raw.settings || {})
    },
    profilesByOrigin
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
  return normalizeProfile(data.profilesByOrigin[origin]);
}
