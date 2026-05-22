// Local, browser-only app preferences (no backend). Persisted in localStorage.

const AUTO_DELETE_KEY = "kpi.importAutoDelete"

/** @returns {{ enabled: boolean, days: number }} */
export function getAutoDelete() {
  try {
    const v = JSON.parse(localStorage.getItem(AUTO_DELETE_KEY) || "null")
    if (v && typeof v === "object") {
      return { enabled: !!v.enabled, days: Math.max(1, Number(v.days) || 30) }
    }
  } catch { /* corrupt / unavailable */ }
  return { enabled: false, days: 30 }
}

export function setAutoDelete({ enabled, days }) {
  try {
    localStorage.setItem(AUTO_DELETE_KEY, JSON.stringify({ enabled: !!enabled, days: Math.max(1, Number(days) || 30) }))
  } catch { /* quota / unavailable — fine */ }
}
