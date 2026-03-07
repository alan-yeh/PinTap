export const STORAGE_KEY = "pintapData";
export const DATA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  markerSizePx: 28,
  markerBackgroundColor: "#3B82F6",
  markerTextColor: "#FFFFFF",
  markerOpacity: 0.8,
  markersEnabled: true,
  extensionEnabled: true,
  persistentPopupEnabled: false
};

export const MESSAGE_TYPES = {
  GET_ACTIVE_STATUS: "PINTAP_GET_ACTIVE_STATUS",
  ACTIVE_STATUS: "PINTAP_ACTIVE_STATUS",
  EXTENSION_STATUS: "PINTAP_EXTENSION_STATUS"
};
