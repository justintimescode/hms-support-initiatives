/* Light/dark mode state. The single source of truth is the data-theme
 * attribute on <html>: index.html sets it before first paint (same key, so
 * keep the two in sync), this module owns it afterwards, and every color in
 * the app follows via the var() tokens in src/index.css. */

const THEME_KEY = "kpi.theme"

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === "light" || v === "dark") return v
  } catch { /* storage unavailable */ }
  return null
}

export function getTheme() {
  const attr = document.documentElement.dataset.theme
  if (attr === "light" || attr === "dark") return attr
  if (getStoredTheme()) return getStoredTheme()
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function setTheme(mode) {
  document.documentElement.dataset.theme = mode
  try { localStorage.setItem(THEME_KEY, mode) } catch { /* storage unavailable */ }
}
