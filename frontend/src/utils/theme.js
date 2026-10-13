import { useSyncExternalStore } from "react";

export const THEME_KEY = "eduliteTheme";
export const THEMES = ["light", "dark", "amoled", "ocean", "forest", "lavender", "rose", "sunset"];
const normalizeTheme = (value) => THEMES.includes(value) ? value : "light";

export function getTheme() {
  try { return normalizeTheme(localStorage.getItem(THEME_KEY)); } catch { return normalizeTheme(document.documentElement.dataset.theme); }
}

export function applyTheme(theme) {
  const selected = normalizeTheme(theme);
  document.documentElement.dataset.theme = selected;
  document.documentElement.style.colorScheme = ["dark", "amoled"].includes(selected) ? "dark" : "light";
}

export function setTheme(theme) {
  const selected = normalizeTheme(theme);
  applyTheme(selected);
  try { localStorage.setItem(THEME_KEY, selected); } catch { /* Keep the selection active when storage is unavailable. */ }
  window.dispatchEvent(new window.Event("edulite-theme-change"));
}

export function initializeTheme() {
  applyTheme(getTheme());
}

function subscribe(onChange) {
  const handleStorage = (event) => {
    if (event.key === THEME_KEY || event.key === null) { initializeTheme(); onChange(); }
  };
  window.addEventListener("edulite-theme-change", onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener("edulite-theme-change", onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useTheme() {
  return [useSyncExternalStore(subscribe, getTheme, () => "light"), setTheme];
}
