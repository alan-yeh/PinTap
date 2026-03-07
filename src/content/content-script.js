(function initPinTap() {
  const STORAGE_KEY = "pintapData";
  const DEFAULT_SETTINGS = {
    enabled: true,
    triggerMode: "single",
    repeatIntervalMs: 120,
    toolbarPosX: 24,
    toolbarPosY: 24
  };
  const MESSAGE_TYPES = {
    GET_ACTIVE_STATUS: "PINTAP_GET_ACTIVE_STATUS",
    ACTIVE_STATUS: "PINTAP_ACTIVE_STATUS"
  };
  const FRAME_KEYDOWN_MESSAGE = "PINTAP_FRAME_KEYDOWN";
  const FRAME_KEYUP_MESSAGE = "PINTAP_FRAME_KEYUP";
  const FRAME_CLICK_MESSAGE = "PINTAP_FRAME_CLICK";
  const UI_GET_STATE_MESSAGE = "PINTAP_UI_GET_STATE";
  const UI_TOGGLE_EDIT_MESSAGE = "PINTAP_UI_TOGGLE_EDIT";
  const UI_TOGGLE_ADD_MESSAGE = "PINTAP_UI_TOGGLE_ADD";
  const UI_CLEAR_ALL_MESSAGE = "PINTAP_UI_CLEAR_ALL";
  const UI_TOGGLE_CALIBRATION_MESSAGE = "PINTAP_UI_TOGGLE_CALIBRATION";
  const OPEN_OPTIONS_PAGE_MESSAGE = "PINTAP_OPEN_OPTIONS_PAGE";
  const MAX_FRAME_DEPTH = 8;

  if (window.__pintapInitialized) {
    return;
  }
  window.__pintapInitialized = true;

  const origin = window.location.origin;
  let settings = { ...DEFAULT_SETTINGS };
  let markers = [];
  let isActiveTab = true;
  const isTopWindow = window.top === window;
  let editMode = false;
  let addingMode = false;
  let calibrationMode = false;
  let draggingMarkerId = null;
  let selectedMarkerId = null;
  let clickOffsetX = 0;
  let clickOffsetY = 0;
  let toastTimer = null;
  let clickTraceSeq = 0;
  let toolbarPosX = 24;
  let toolbarPosY = 24;
  let isDraggingToolbar = false;
  let toolbarDragOffsetX = 0;
  let toolbarDragOffsetY = 0;
  let toolbarDarkMode = false;
  let themeRefreshTimer = 0;
  const repeatTimers = new Map();
  const handledKeyEvents = new WeakSet();

  const root = document.createElement("div");
  root.id = "pintap-root";
  const markerLayer = document.createElement("div");
  markerLayer.id = "pintap-marker-layer";
  const toast = document.createElement("div");
  toast.id = "pintap-toast";
  const clickProbe = document.createElement("div");
  clickProbe.id = "pintap-click-probe";
  const clickProbeLabel = document.createElement("div");
  clickProbeLabel.id = "pintap-click-probe-label";
  clickProbe.appendChild(clickProbeLabel);
  const toolbar = document.createElement("div");
  toolbar.id = "pintap-toolbar";
  const toolbarDragArea = document.createElement("div");
  toolbarDragArea.id = "pintap-toolbar-drag-area";
  const toolbarTitle = document.createElement("div");
  toolbarTitle.id = "pintap-toolbar-title";
  toolbarTitle.textContent = "PinTap";
  const toolbarControls = document.createElement("div");
  toolbarControls.id = "pintap-toolbar-controls";

  function isContextInvalidatedError(error) {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.message.includes("Extension context invalidated");
  }

  function normalizeCode(code) {
    return typeof code === "string" ? code.trim() : "";
  }

  function keyToCodeFallback(key) {
    const normalizedKey = normalizeCode(key);
    if (!normalizedKey) {
      return "";
    }
    if (/^[a-z]$/i.test(normalizedKey)) {
      return `Key${normalizedKey.toUpperCase()}`;
    }
    if (/^[0-9]$/.test(normalizedKey)) {
      return `Digit${normalizedKey}`;
    }
    const specialMap = {
      " ": "Space",
      Enter: "Enter",
      Escape: "Escape",
      Tab: "Tab",
      Backspace: "Backspace",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      Shift: "ShiftLeft",
      Control: "ControlLeft",
      Alt: "AltLeft",
      Meta: "MetaLeft"
    };
    return specialMap[normalizedKey] || normalizedKey;
  }

  function collectEventKeyCandidates(event) {
    const candidates = new Set();
    const code = normalizeCode(event.code);
    const key = normalizeCode(event.key);
    if (code) {
      candidates.add(code);
    }
    if (key) {
      candidates.add(key);
      const fallback = keyToCodeFallback(key);
      if (fallback) {
        candidates.add(fallback);
      }
    }
    return Array.from(candidates);
  }

  function formatKey(code) {
    if (!code) {
      return "?";
    }
    if (code.startsWith("Key")) {
      return code.slice(3).toUpperCase();
    }
    if (code.startsWith("Digit")) {
      return code.slice(5);
    }
    if (code.startsWith("Numpad")) {
      return `Num${code.slice(6)}`;
    }
    return code;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toast.classList.remove("visible");
    }, 1200);
  }

  function clampRatio(value) {
    return Math.max(0, Math.min(1, value));
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof HTMLElement)) {
      return false;
    }
    if (target.isContentEditable) {
      return true;
    }
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  function getDefaultData() {
    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      profilesByOrigin: {}
    };
  }

  async function loadData() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const raw = stored[STORAGE_KEY];
      if (!raw || typeof raw !== "object") {
        return getDefaultData();
      }
      return {
        version: 1,
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
        profilesByOrigin: raw.profilesByOrigin || {}
      };
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        return getDefaultData();
      }
      throw error;
    }
  }

  async function saveCurrentOriginProfile({ nextMarkers, nextOffsetX, nextOffsetY }) {
    try {
      const data = await loadData();
      const prevProfile = data.profilesByOrigin[origin] || {};
      const prevMarkers = Array.isArray(prevProfile.markers) ? prevProfile.markers : [];
      data.profilesByOrigin[origin] = {
        markers: Array.isArray(nextMarkers) ? nextMarkers : prevMarkers,
        clickOffsetX: Number.isFinite(nextOffsetX) ? nextOffsetX : Number(prevProfile.clickOffsetX) || 0,
        clickOffsetY: Number.isFinite(nextOffsetY) ? nextOffsetY : Number(prevProfile.clickOffsetY) || 0
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
      return true;
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        return false;
      }
      throw error;
    }
  }

  async function persistMarkers() {
    try {
      await saveCurrentOriginProfile({ nextMarkers: markers });
    } catch (_error) {
      // Ignore temporary extension API failures to avoid noisy unhandled promises.
    }
  }

  async function persistOffsets() {
    try {
      await saveCurrentOriginProfile({
        nextOffsetX: clickOffsetX,
        nextOffsetY: clickOffsetY
      });
    } catch (_error) {
      // Ignore temporary extension API failures to avoid noisy unhandled promises.
    }
  }

  function hasKeyConflict(key, markerId) {
    return markers.some((item) => item.key === key && item.id !== markerId);
  }

  function markerByCandidates(candidates) {
    if (!candidates.length) {
      return [];
    }
    return markers.filter((marker) => candidates.includes(marker.key));
  }

  async function captureNextKey(promptText, options = {}) {
    const { allowDeleteShortcut = false } = options;
    showToast(promptText);
    return new Promise((resolve) => {
      function onKeydown(event) {
        event.preventDefault();
        event.stopPropagation();
        document.removeEventListener("keydown", onKeydown, true);
        const candidates = collectEventKeyCandidates(event);
        if (candidates.includes("Escape")) {
          resolve("");
          return;
        }
        if (allowDeleteShortcut && (candidates.includes("Delete") || candidates.includes("Backspace"))) {
          resolve("__DELETE__");
          return;
        }
        resolve(candidates.find((item) => item.startsWith("Key") || item.startsWith("Digit")) || candidates[0] || "");
      }
      document.addEventListener("keydown", onKeydown, true);
    });
  }

  function stopRepeatForKey(code) {
    const timer = repeatTimers.get(code);
    if (timer) {
      clearInterval(timer);
      repeatTimers.delete(code);
    }
  }

  function stopAllRepeats() {
    for (const [code, timer] of repeatTimers.entries()) {
      clearInterval(timer);
      repeatTimers.delete(code);
    }
  }

  function dispatchSyntheticClickAtPoint(clientX, clientY, debugMeta = null) {
    const maxX = Math.max(0, window.innerWidth - 1);
    const maxY = Math.max(0, window.innerHeight - 1);
    const x = Math.max(0, Math.min(maxX, Math.round(clientX)));
    const y = Math.max(0, Math.min(maxY, Math.round(clientY)));

    if (debugMeta?.debugProbe) {
      const traceId = typeof debugMeta.traceId === "string" ? debugMeta.traceId : "trace";
      const depth = Number.isFinite(debugMeta.depth) ? Number(debugMeta.depth) : 0;
      showClickProbe(x, y, `${traceId} L${depth}`);
    }

    const previousVisibility = root.style.visibility;
    root.style.visibility = "hidden";
    const rawTarget = document.elementFromPoint(x, y);
    root.style.visibility = previousVisibility;

    if (rawTarget instanceof HTMLIFrameElement && rawTarget.contentWindow) {
      const frameRect = rawTarget.getBoundingClientRect();
      const safeRectWidth = Math.max(1, frameRect.width);
      const safeRectHeight = Math.max(1, frameRect.height);
      const ratioX = rawTarget.clientWidth > 0 ? rawTarget.clientWidth / safeRectWidth : 1;
      const ratioY = rawTarget.clientHeight > 0 ? rawTarget.clientHeight / safeRectHeight : 1;
      const localX = (x - frameRect.left) * ratioX;
      const localY = (y - frameRect.top) * ratioY;
      const nextDepth = Number.isFinite(debugMeta?.depth) ? Number(debugMeta.depth) + 1 : 1;
      if (nextDepth > MAX_FRAME_DEPTH) {
        return;
      }
      try {
        rawTarget.contentWindow.postMessage(
          {
            __pintap: true,
            type: FRAME_CLICK_MESSAGE,
            clientX: localX,
            clientY: localY,
            debugProbe: Boolean(debugMeta?.debugProbe),
            traceId: typeof debugMeta?.traceId === "string" ? debugMeta.traceId : "",
            depth: nextDepth
          },
          "*"
        );
      } catch (_error) {
        // Ignore frame forwarding failures.
      }
      return;
    }

    const target = resolveClickableTarget(rawTarget);
    if (!target) {
      return;
    }

    if (target instanceof HTMLElement && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }

    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
      view: window
    };

    target.dispatchEvent(new PointerEvent("pointerdown", eventInit));
    target.dispatchEvent(new MouseEvent("mousedown", eventInit));
    target.dispatchEvent(new PointerEvent("pointerup", eventInit));
    target.dispatchEvent(new MouseEvent("mouseup", eventInit));
    target.dispatchEvent(new MouseEvent("click", eventInit));
    if (target instanceof HTMLElement && typeof target.click === "function") {
      target.click();
    }
  }

  function dispatchClickAtMarker(marker) {
    const maxX = Math.max(0, window.innerWidth - 1);
    const maxY = Math.max(0, window.innerHeight - 1);
    const baseX = Math.round(clampRatio(marker.xRatio) * maxX);
    const baseY = Math.round(clampRatio(marker.yRatio) * maxY);
    const x = baseX + clickOffsetX;
    const y = baseY + clickOffsetY;
    const traceId = `t${Date.now().toString(36)}${(++clickTraceSeq).toString(36)}`;
    dispatchSyntheticClickAtPoint(x, y, {
      debugProbe: editMode,
      traceId,
      depth: 0
    });
  }

  function showClickProbe(x, y, labelText = "") {
    clickProbe.style.left = `${x}px`;
    clickProbe.style.top = `${y}px`;
    clickProbeLabel.textContent = labelText;
    clickProbe.classList.remove("visible");
    void clickProbe.offsetWidth;
    clickProbe.classList.add("visible");
  }

  function hideClickProbe() {
    clickProbeLabel.textContent = "";
    clickProbe.classList.remove("visible");
  }

  function setToolbarPosition(nextX, nextY) {
    const toolbarWidth = Math.max(1, toolbar.offsetWidth || 1);
    const toolbarHeight = Math.max(1, toolbar.offsetHeight || 1);
    const maxX = Math.max(0, window.innerWidth - toolbarWidth);
    const maxY = Math.max(0, window.innerHeight - toolbarHeight);
    toolbarPosX = Math.max(0, Math.min(maxX, Math.round(nextX)));
    toolbarPosY = Math.max(0, Math.min(maxY, Math.round(nextY)));
    toolbar.style.left = `${toolbarPosX}px`;
    toolbar.style.top = `${toolbarPosY}px`;
  }

  function parseCssColorToRgba(colorValue) {
    if (typeof colorValue !== "string") {
      return null;
    }
    const value = colorValue.trim().toLowerCase();
    if (!value || value === "transparent") {
      return null;
    }
    const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(",").map((part) => Number(part.trim()));
      const r = Number.isFinite(parts[0]) ? parts[0] : 0;
      const g = Number.isFinite(parts[1]) ? parts[1] : 0;
      const b = Number.isFinite(parts[2]) ? parts[2] : 0;
      const a = Number.isFinite(parts[3]) ? parts[3] : 1;
      if (a <= 0) {
        return null;
      }
      return { r, g, b, a };
    }
    const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
          a: 1
        };
      }
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1
      };
    }
    return null;
  }

  function getRelativeLuminance(rgb) {
    function toLinear(channel) {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    const r = toLinear(rgb.r);
    const g = toLinear(rgb.g);
    const b = toLinear(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function detectToolbarDarkModeFromPage() {
    const elements = [document.body, document.documentElement];
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const bg = parseCssColorToRgba(window.getComputedStyle(element).backgroundColor);
      if (!bg) {
        continue;
      }
      return getRelativeLuminance(bg) < 0.46;
    }

    const fallbackMedia =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : false;
    return fallbackMedia;
  }

  function getToolbarThemeSuffix() {
    return toolbarDarkMode ? "dark" : "light";
  }

  function getIconFilenameCandidates(iconName, themeSuffix) {
    if (iconName === "play") {
      return [`play-${themeSuffix}.png`, `play-circle-${themeSuffix}.png`];
    }
    if (iconName === "setting" && themeSuffix === "light") {
      return ["setting-light.png", "setting-light-dark.png"];
    }
    return [`${iconName}-${themeSuffix}.png`];
  }

  function setToolbarButtonIcon(button, iconName, fallbackText) {
    const iconImg = button.querySelector("img");
    const fallback = button.querySelector("span");
    if (!(iconImg instanceof HTMLImageElement) || !(fallback instanceof HTMLElement)) {
      return;
    }
    iconImg.style.display = "";
    fallback.style.display = "none";
    const themeSuffix = getToolbarThemeSuffix();
    const filenames = getIconFilenameCandidates(iconName, themeSuffix);
    const baseDirs = ["src/resources", "resources"];
    const candidates = [];
    filenames.forEach((filename) => {
      baseDirs.forEach((baseDir) => {
        candidates.push(chrome.runtime.getURL(`${baseDir}/${filename}`));
      });
    });
    let idx = 0;
    iconImg.onerror = () => {
      idx += 1;
      if (idx < candidates.length) {
        iconImg.src = candidates[idx];
        return;
      }
      iconImg.style.display = "none";
      fallback.style.display = "inline";
    };
    iconImg.src = candidates[0];
  }

  function applyToolbarThemeClass() {
    toolbar.classList.toggle("theme-dark", toolbarDarkMode);
    toolbar.classList.toggle("theme-light", !toolbarDarkMode);
  }

  function refreshAllToolbarIcons() {
    const buttons = toolbarControls.querySelectorAll(".pintap-toolbar-btn");
    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const iconName = button.dataset.iconName || "";
      const fallbackText = button.dataset.fallbackText || "?";
      if (!iconName) {
        return;
      }
      setToolbarButtonIcon(button, iconName, fallbackText);
    });
  }

  function refreshToolbarThemeMode() {
    const nextDark = detectToolbarDarkModeFromPage();
    if (nextDark !== toolbarDarkMode) {
      toolbarDarkMode = nextDark;
      applyToolbarThemeClass();
      refreshAllToolbarIcons();
    }
  }

  function scheduleToolbarThemeRefresh() {
    if (themeRefreshTimer) {
      return;
    }
    themeRefreshTimer = window.setTimeout(() => {
      themeRefreshTimer = 0;
      refreshToolbarThemeMode();
    }, 120);
  }

  function createToolbarButton({ action, title, iconName, fallbackText, onClick }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pintap-toolbar-btn";
    btn.dataset.action = action;
    btn.dataset.iconName = iconName;
    btn.dataset.fallbackText = fallbackText;
    btn.title = title;

    const img = document.createElement("img");
    img.alt = title;
    img.draggable = false;
    const fallback = document.createElement("span");
    fallback.textContent = fallbackText;
    fallback.style.display = "none";
    btn.append(img, fallback);
    setToolbarButtonIcon(btn, iconName, fallbackText);

    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      void onClick();
    });
    return btn;
  }

  async function persistSettings() {
    try {
      const data = await loadData();
      data.settings = {
        ...DEFAULT_SETTINGS,
        ...(data.settings || {}),
        ...settings
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (_error) {
      // Ignore temporary extension API failures.
    }
  }

  async function persistToolbarPosition() {
    settings.toolbarPosX = toolbarPosX;
    settings.toolbarPosY = toolbarPosY;
    await persistSettings();
  }

  function syncToolbarUi() {
    if (!isTopWindow) {
      return;
    }
    const pauseButton = toolbarControls.querySelector('[data-action="toggle-enabled"]');
    if (pauseButton instanceof HTMLButtonElement) {
      const enabled = Boolean(settings.enabled);
      setToolbarButtonIcon(pauseButton, enabled ? "pause" : "play", enabled ? "II" : ">");
      pauseButton.title = enabled ? "暂停 PinTap" : "启用 PinTap";
    }
    const editButton = toolbarControls.querySelector('[data-action="edit"]');
    const addButton = toolbarControls.querySelector('[data-action="add"]');
    const removeButton = toolbarControls.querySelector('[data-action="remove"]');
    const clearButton = toolbarControls.querySelector('[data-action="clear"]');
    const saveButton = toolbarControls.querySelector('[data-action="save"]');
    if (editButton instanceof HTMLElement) {
      editButton.style.display = editMode ? "none" : "inline-flex";
    }
    [addButton, removeButton, clearButton, saveButton].forEach((item) => {
      if (item instanceof HTMLElement) {
        item.style.display = editMode ? "inline-flex" : "none";
      }
    });
    refreshToolbarThemeMode();
    toolbar.classList.toggle("paused", !settings.enabled);
    setToolbarPosition(toolbarPosX, toolbarPosY);
  }

  function initToolbar() {
    if (!isTopWindow) {
      return;
    }
    toolbarControls.innerHTML = "";
    toolbarDarkMode = detectToolbarDarkModeFromPage();
    applyToolbarThemeClass();

    const toggleEnabledBtn = createToolbarButton({
      action: "toggle-enabled",
      title: "暂停 PinTap",
      iconName: "pause",
      fallbackText: "II",
      onClick: async () => {
        settings.enabled = !settings.enabled;
        if (!settings.enabled) {
          addingMode = false;
          calibrationMode = false;
          editMode = false;
          selectedMarkerId = null;
          hideClickProbe();
          stopAllRepeats();
        }
        await persistSettings();
        syncToolbarUi();
        render();
      }
    });

    const editBtn = createToolbarButton({
      action: "edit",
      title: "编辑键位",
      iconName: "edit-square",
      fallbackText: "E",
      onClick: async () => {
        if (!settings.enabled) {
          showToast("请先启用 PinTap");
          return;
        }
        editMode = true;
        addingMode = false;
        calibrationMode = false;
        render();
      }
    });

    const addBtn = createToolbarButton({
      action: "add",
      title: "新增键位",
      iconName: "plus-circle",
      fallbackText: "+",
      onClick: async () => {
        if (!settings.enabled) {
          showToast("请先启用 PinTap");
          return;
        }
        if (!editMode) {
          editMode = true;
        }
        addingMode = true;
        showToast("点击页面放置新标识");
        render();
      }
    });

    const removeBtn = createToolbarButton({
      action: "remove",
      title: "删除选中键位",
      iconName: "minus-circle",
      fallbackText: "-",
      onClick: async () => {
        if (!selectedMarkerId) {
          showToast("请先选中一个标识");
          return;
        }
        markers = markers.filter((item) => item.id !== selectedMarkerId);
        selectedMarkerId = null;
        await persistMarkers();
        render();
      }
    });

    const clearBtn = createToolbarButton({
      action: "clear",
      title: "清除全部键位",
      iconName: "clear",
      fallbackText: "C",
      onClick: async () => {
        const ok = window.confirm("确认清除当前站点的所有标识吗？");
        if (!ok) {
          return;
        }
        markers = [];
        selectedMarkerId = null;
        await persistMarkers();
        render();
      }
    });

    const saveBtn = createToolbarButton({
      action: "save",
      title: "保存当前配置",
      iconName: "save",
      fallbackText: "S",
      onClick: async () => {
        await persistMarkers();
        await persistOffsets();
        await persistSettings();
        editMode = false;
        addingMode = false;
        calibrationMode = false;
        selectedMarkerId = null;
        showToast("已保存");
        render();
      }
    });

    const settingsBtn = createToolbarButton({
      action: "settings",
      title: "打开高级设置",
      iconName: "setting",
      fallbackText: "O",
      onClick: async () => {
        await chrome.runtime.sendMessage({ type: OPEN_OPTIONS_PAGE_MESSAGE });
      }
    });

    toolbarControls.append(
      toggleEnabledBtn,
      editBtn,
      addBtn,
      removeBtn,
      clearBtn,
      saveBtn,
      settingsBtn
    );
    toolbarDragArea.appendChild(toolbarTitle);
    toolbar.append(toolbarDragArea, toolbarControls);
    refreshAllToolbarIcons();
    syncToolbarUi();
    setToolbarPosition(toolbarPosX, toolbarPosY);
    const observer = new MutationObserver(() => {
      scheduleToolbarThemeRefresh();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"]
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"]
      });
    }
    window.addEventListener("focus", scheduleToolbarThemeRefresh, true);
    window.addEventListener("load", scheduleToolbarThemeRefresh, true);
    document.addEventListener("visibilitychange", scheduleToolbarThemeRefresh, true);

    toolbarDragArea.addEventListener("mousedown", (event) => {
      event.preventDefault();
      isDraggingToolbar = true;
      toolbarDragOffsetX = event.clientX - toolbarPosX;
      toolbarDragOffsetY = event.clientY - toolbarPosY;
    });
  }

  function resolveClickableTarget(node) {
    if (!(node instanceof Element)) {
      return null;
    }

    const preferred = node.closest(
      'button, a[href], input:not([type="hidden"]), textarea, select, summary, label, [role="button"], [onclick], [tabindex]'
    );
    if (preferred) {
      return preferred;
    }
    return node;
  }

  function flashMarker(markerId) {
    const markerElement = markerLayer.querySelector(`[data-marker-id="${markerId}"]`);
    if (!(markerElement instanceof HTMLElement)) {
      return;
    }
    markerElement.classList.remove("triggered");
    // Restart animation reliably.
    void markerElement.offsetWidth;
    markerElement.classList.add("triggered");
  }

  function triggerByCandidates(candidates) {
    const matched = markerByCandidates(candidates);
    if (!matched.length) {
      return;
    }
    matched.forEach((marker) => {
      flashMarker(marker.id);
      dispatchClickAtMarker(marker);
    });
  }

  function getUiState() {
    return {
      editMode,
      addingMode,
      calibrationMode,
      clickOffsetX,
      clickOffsetY,
      markerCount: markers.length
    };
  }

  function toggleEditMode() {
    editMode = !editMode;
    addingMode = false;
    if (!editMode) {
      calibrationMode = false;
      selectedMarkerId = null;
      hideClickProbe();
    }
    render();
    syncToolbarUi();
    return getUiState();
  }

  function toggleAddMode() {
    if (!editMode) {
      editMode = true;
    }
    addingMode = !addingMode;
    showToast(addingMode ? "点击页面放置新标识" : "已取消新增");
    render();
    syncToolbarUi();
    return getUiState();
  }

  async function clearAllMarkers() {
    markers = [];
    selectedMarkerId = null;
    await persistMarkers();
    render();
    showToast("已清除全部标识");
    syncToolbarUi();
    return getUiState();
  }

  function toggleCalibrationMode() {
    if (!editMode) {
      editMode = true;
    }
    calibrationMode = !calibrationMode;
    if (calibrationMode) {
      showToast("校准模式: 方向键微调, Shift+方向键步长5, Enter退出");
    } else {
      showToast(`校准完成: X ${clickOffsetX}, Y ${clickOffsetY}`);
      hideClickProbe();
    }
    render();
    syncToolbarUi();
    return getUiState();
  }

  function renderMarkers() {
    if (!isTopWindow) {
      markerLayer.innerHTML = "";
      return;
    }
    if (!settings.enabled) {
      markerLayer.innerHTML = "";
      return;
    }
    markerLayer.innerHTML = "";
    markers.forEach((marker) => {
      const el = document.createElement("div");
      el.className = "pintap-marker";
      if (editMode) {
        el.classList.add("editable");
      }
      if (!settings.enabled || !isActiveTab) {
        el.classList.add("inactive");
      }
      el.dataset.markerId = marker.id;
      el.textContent = formatKey(marker.key);
      el.style.left = `${clampRatio(marker.xRatio) * 100}%`;
      el.style.top = `${clampRatio(marker.yRatio) * 100}%`;
      el.style.width = `${marker.radius * 2}px`;
      el.style.height = `${marker.radius * 2}px`;
      el.style.opacity = String(marker.opacity ?? 0.8);
      if (editMode && selectedMarkerId === marker.id) {
        el.classList.add("selected");
      }

      el.addEventListener("click", (event) => {
        if (!settings.enabled) {
          return;
        }
        event.stopPropagation();
        selectedMarkerId = marker.id;
        renderMarkers();
      });

      el.addEventListener("dblclick", async (event) => {
        if (!editMode) {
          return;
        }
        event.stopPropagation();
        const captured = await captureNextKey("按下新键位，Esc 取消；Delete/Backspace 删除标识", {
          allowDeleteShortcut: true
        });
        if (!captured) {
          showToast("已取消键位设置");
          return;
        }
        if (captured === "__DELETE__") {
          markers = markers.filter((item) => item.id !== marker.id);
          if (selectedMarkerId === marker.id) {
            selectedMarkerId = null;
          }
          await persistMarkers();
          render();
          showToast("标识已删除");
          return;
        }
        if (hasKeyConflict(captured, marker.id)) {
          showToast(`键位冲突: ${formatKey(captured)}`);
          return;
        }
        marker.key = captured;
        await persistMarkers();
        render();
      });

      el.addEventListener("contextmenu", async (event) => {
        if (!editMode) {
          return;
        }
        event.preventDefault();
        markers = markers.filter((item) => item.id !== marker.id);
        await persistMarkers();
        render();
        showToast("标识已删除");
      });

      el.addEventListener("mousedown", (event) => {
        if (!editMode) {
          return;
        }
        event.preventDefault();
        selectedMarkerId = marker.id;
        draggingMarkerId = marker.id;
      });

      markerLayer.appendChild(el);
    });
  }

  function render() {
    renderMarkers();
    if (!editMode) {
      hideClickProbe();
    }
    syncToolbarUi();
  }

  async function createMarkerAtPoint(clientX, clientY) {
    const xRatio = clampRatio(clientX / window.innerWidth);
    const yRatio = clampRatio(clientY / window.innerHeight);

    const code = await captureNextKey("请按一个键绑定到新标识");
    if (!code) {
      showToast("已取消新增");
      return;
    }
    if (hasKeyConflict(code, "")) {
      showToast(`键位冲突: ${formatKey(code)}`);
      return;
    }

    const marker = {
      id: String(Date.now()) + Math.random().toString(16).slice(2, 8),
      key: code,
      xRatio,
      yRatio,
      radius: 24,
      opacity: 0.8
    };
    markers.push(marker);
    await persistMarkers();
    showToast(`已添加: ${formatKey(code)}`);
    render();
  }

  function bindDomEvents() {
    document.addEventListener(
      "click",
      (event) => {
        if (!addingMode || !editMode) {
          return;
        }
        if (isTopWindow && toolbar.contains(event.target)) {
          return;
        }
        addingMode = false;
        void createMarkerAtPoint(event.clientX, event.clientY);
        render();
      },
      true
    );

    document.addEventListener(
      "mousemove",
      (event) => {
        if (isDraggingToolbar) {
          setToolbarPosition(
            event.clientX - toolbarDragOffsetX,
            event.clientY - toolbarDragOffsetY
          );
          return;
        }
        if (!draggingMarkerId || !editMode) {
          return;
        }
        const marker = markers.find((item) => item.id === draggingMarkerId);
        if (!marker) {
          return;
        }
        marker.xRatio = clampRatio(event.clientX / window.innerWidth);
        marker.yRatio = clampRatio(event.clientY / window.innerHeight);
        renderMarkers();
      },
      true
    );

    document.addEventListener(
      "mouseup",
      () => {
        if (isDraggingToolbar) {
          isDraggingToolbar = false;
          void persistToolbarPosition();
        }
        if (!draggingMarkerId) {
          return;
        }
        draggingMarkerId = null;
        void persistMarkers();
      },
      true
    );

    window.addEventListener("resize", () => {
      setToolbarPosition(toolbarPosX, toolbarPosY);
    });

    function keyboardEnabledForCurrentPage() {
      if (!settings.enabled) {
        return false;
      }
      // In iframes, key events are already scoped by browser focus rules.
      if (!isTopWindow) {
        return true;
      }
      // Fallback for occasional background sync delay in top document.
      if (isActiveTab) {
        return true;
      }
      return document.visibilityState === "visible" && document.hasFocus();
    }

    function processKeydownCandidates(candidates, isRepeatedPress, shiftPressed) {
      if (!candidates.length) {
        return;
      }

      if (calibrationMode && isTopWindow) {
        const step = shiftPressed ? 5 : 1;
        let changed = false;
        if (candidates.includes("ArrowUp")) {
          clickOffsetY -= step;
          changed = true;
        } else if (candidates.includes("ArrowDown")) {
          clickOffsetY += step;
          changed = true;
        } else if (candidates.includes("ArrowLeft")) {
          clickOffsetX -= step;
          changed = true;
        } else if (candidates.includes("ArrowRight")) {
          clickOffsetX += step;
          changed = true;
        } else if (candidates.includes("Enter")) {
          calibrationMode = false;
          showToast(`校准完成: X ${clickOffsetX}, Y ${clickOffsetY}`);
          render();
          return;
        }
        if (changed) {
          void persistOffsets();
          render();
          showToast(`校准偏移: X ${clickOffsetX}, Y ${clickOffsetY}`);
          return;
        }
      }

      if (candidates.includes("Escape") && addingMode) {
        addingMode = false;
        render();
        showToast("已取消新增");
        return;
      }

      if (editMode && (candidates.includes("Delete") || candidates.includes("Backspace"))) {
        if (!selectedMarkerId) {
          showToast("请先选中一个标识");
          return;
        }
        markers = markers.filter((item) => item.id !== selectedMarkerId);
        selectedMarkerId = null;
        void persistMarkers();
        renderMarkers();
        showToast("已删除选中标识");
        return;
      }

      const repeatKey = candidates[0];
      if (!repeatKey) {
        return;
      }

      if (settings.triggerMode === "single") {
        if (isRepeatedPress) {
          return;
        }
        triggerByCandidates(candidates);
        return;
      }

      if (settings.triggerMode === "repeat") {
        if (repeatTimers.has(repeatKey)) {
          return;
        }
        triggerByCandidates(candidates);
        const interval = Math.max(50, Number(settings.repeatIntervalMs) || 120);
        const timer = window.setInterval(() => {
          triggerByCandidates(candidates);
        }, interval);
        repeatTimers.set(repeatKey, timer);
      }
    }

    function processKeyupCandidates(candidates) {
      if (settings.triggerMode !== "repeat") {
        return;
      }
      if (!candidates.length) {
        return;
      }
      candidates.forEach((candidate) => stopRepeatForKey(candidate));
    }

    function relayToTopWindow(type, candidates, isRepeatedPress) {
      if (isTopWindow || !window.top) {
        return;
      }
      try {
        window.top.postMessage(
          {
            __pintap: true,
            type,
            candidates,
            isRepeatedPress: Boolean(isRepeatedPress)
          },
          "*"
        );
      } catch (_error) {
        // Ignore cross-context messaging failures.
      }
    }

    function onWindowMessage(event) {
      const data = event.data;
      if (
        data?.__pintap === true &&
        data?.type === FRAME_CLICK_MESSAGE &&
        typeof data.clientX === "number" &&
        typeof data.clientY === "number"
      ) {
        dispatchSyntheticClickAtPoint(data.clientX, data.clientY, {
          debugProbe: Boolean(data.debugProbe),
          traceId: typeof data.traceId === "string" ? data.traceId : "",
          depth: Number.isFinite(data.depth) ? Number(data.depth) : 0
        });
        return;
      }

      if (!isTopWindow) {
        return;
      }
      if (!data || data.__pintap !== true || !Array.isArray(data.candidates)) {
        return;
      }
      if (!settings.enabled) {
        return;
      }
      if (data.type === FRAME_KEYDOWN_MESSAGE) {
        processKeydownCandidates(data.candidates, Boolean(data.isRepeatedPress), false);
        return;
      }
      if (data.type === FRAME_KEYUP_MESSAGE) {
        processKeyupCandidates(data.candidates);
      }
    }

    function onKeydown(event) {
      if (handledKeyEvents.has(event)) {
        return;
      }
      handledKeyEvents.add(event);

      if (!keyboardEnabledForCurrentPage()) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      const candidates = collectEventKeyCandidates(event);
      if (!candidates.length) {
        return;
      }

      if (!isTopWindow) {
        relayToTopWindow(FRAME_KEYDOWN_MESSAGE, candidates, event.repeat);
        return;
      }
      processKeydownCandidates(candidates, event.repeat, event.shiftKey);
    }

    function onKeyup(event) {
      if (handledKeyEvents.has(event)) {
        return;
      }
      handledKeyEvents.add(event);

      const candidates = collectEventKeyCandidates(event);
      if (!candidates.length) {
        return;
      }
      if (!isTopWindow) {
        relayToTopWindow(FRAME_KEYUP_MESSAGE, candidates, false);
        return;
      }
      processKeyupCandidates(candidates);
    }

    window.addEventListener("keydown", onKeydown, true);
    document.addEventListener("keydown", onKeydown, true);
    if (document.documentElement) {
      document.documentElement.addEventListener("keydown", onKeydown, true);
    }
    window.addEventListener("keyup", onKeyup, true);
    document.addEventListener("keyup", onKeyup, true);
    if (document.documentElement) {
      document.documentElement.addEventListener("keyup", onKeyup, true);
    }
    window.addEventListener("message", onWindowMessage, true);

    window.addEventListener("blur", () => {
      stopAllRepeats();
    });
  }

  function mountRoot() {
    if (!document.documentElement) {
      return false;
    }
    if (document.getElementById(root.id)) {
      return true;
    }
    root.appendChild(markerLayer);
    if (isTopWindow) {
      root.appendChild(toolbar);
    }
    root.appendChild(toast);
    root.appendChild(clickProbe);
    document.documentElement.appendChild(root);
    return true;
  }

  async function ensureRootMounted() {
    if (mountRoot()) {
      return;
    }
    await new Promise((resolve) => {
      if (document.readyState === "interactive" || document.readyState === "complete") {
        resolve();
        return;
      }
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
    mountRoot();
  }

  async function hydrateFromStorage() {
    const data = await loadData();
    settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    if (Number.isFinite(settings.toolbarPosX) && Number.isFinite(settings.toolbarPosY)) {
      toolbarPosX = Number(settings.toolbarPosX);
      toolbarPosY = Number(settings.toolbarPosY);
    }
    const profile = data.profilesByOrigin[origin] || { markers: [] };
    markers = Array.isArray(profile.markers) ? profile.markers : [];
    clickOffsetX = Number(profile.clickOffsetX) || 0;
    clickOffsetY = Number(profile.clickOffsetY) || 0;
    render();
  }

  function watchStorageChanges() {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes[STORAGE_KEY]) {
          return;
        }
        void hydrateFromStorage().catch(() => {});
      });
    } catch (_error) {
      // Ignore extension context detach.
    }
  }

  function setupRuntimeMessage() {
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === MESSAGE_TYPES.ACTIVE_STATUS) {
          isActiveTab = Boolean(message.isActive);
          if (!isActiveTab) {
            stopAllRepeats();
          }
          renderMarkers();
          return false;
        }

        if (!isTopWindow) {
          return false;
        }

        if (message?.type === UI_GET_STATE_MESSAGE) {
          sendResponse(getUiState());
          return true;
        }
        if (message?.type === UI_TOGGLE_EDIT_MESSAGE) {
          sendResponse(toggleEditMode());
          return true;
        }
        if (message?.type === UI_TOGGLE_ADD_MESSAGE) {
          sendResponse(toggleAddMode());
          return true;
        }
        if (message?.type === UI_CLEAR_ALL_MESSAGE) {
          void clearAllMarkers().then((state) => sendResponse(state));
          return true;
        }
        if (message?.type === UI_TOGGLE_CALIBRATION_MESSAGE) {
          sendResponse(toggleCalibrationMode());
          return true;
        }
        return false;
      });
    } catch (_error) {
      // Ignore extension context detach.
    }
  }

  async function queryInitialActiveStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.GET_ACTIVE_STATUS
      });
      if (typeof response?.isActive === "boolean") {
        isActiveTab = response.isActive;
      } else {
        isActiveTab = true;
      }
    } catch (_error) {
      isActiveTab = true;
    }
  }

  async function bootstrap() {
    try {
      await ensureRootMounted();
      initToolbar();
      bindDomEvents();
      watchStorageChanges();
      setupRuntimeMessage();
      await queryInitialActiveStatus();
      await hydrateFromStorage();
    } catch (_error) {
      // Ignore bootstrap errors when extension is reloaded during page lifetime.
    }
  }

  void bootstrap().catch(() => {});
})();
