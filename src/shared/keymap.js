export function normalizeKeyEvent(event) {
  if (!event || !event.code) {
    return "";
  }
  return event.code;
}

export function normalizeKeyCode(code) {
  if (typeof code !== "string") {
    return "";
  }
  return code.trim();
}

export function toDisplayKey(code) {
  if (!code) {
    return "Unassigned";
  }

  if (code.startsWith("Key")) {
    return code.slice(3).toUpperCase();
  }
  if (code.startsWith("Digit")) {
    return code.slice(5);
  }
  if (code.startsWith("Numpad")) {
    return `Num ${code.slice(6)}`;
  }
  return code;
}
