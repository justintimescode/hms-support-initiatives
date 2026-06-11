// Local, browser-only app preferences (no backend). Persisted in localStorage.

const AUTO_DELETE_KEY = "kpi.importAutoDelete"
const DISK_BACKUP_KEY = "kpi.diskBackup"

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

// SECURITY #14 — whether new imports are mirrored to the disk cache
// (.servicenow-cache/). That mirror holds RAW, unencrypted customer case data,
// so in the BROWSER it is OFF by default: the secure default keeps customer
// data out of the (shared) project directory. Users who want cross-browser /
// cleared-profile recovery can opt in. Governs *new* writes only (uploads +
// rename meta sync); existing on-disk backups are read for recovery and pruned
// by the orphan sweep regardless of this flag.
//
// In the DESKTOP (Electron) build the mirror lives in the user's own profile
// (%APPDATA%\KPI Analyzer\.servicenow-cache — same trust boundary as the Jira
// cache already stored there), and it is what makes imports survive an app
// restart. So the desktop default is ON; an explicit Settings toggle still
// wins either way.
const IS_ELECTRON = typeof window !== "undefined" && !!window.electronAPI

/** @returns {boolean} */
export function getDiskBackup() {
  try {
    const v = JSON.parse(localStorage.getItem(DISK_BACKUP_KEY) || "null")
    if (v && typeof v === "object") return !!v.enabled
  } catch { /* corrupt / unavailable */ }
  return IS_ELECTRON
}

export function setDiskBackup(enabled) {
  try {
    localStorage.setItem(DISK_BACKUP_KEY, JSON.stringify({ enabled: !!enabled }))
  } catch { /* quota / unavailable — fine */ }
}
