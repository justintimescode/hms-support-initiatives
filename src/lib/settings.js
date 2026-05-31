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

// SECURITY #14 — whether new imports are mirrored to the dev-server disk cache
// (.servicenow-cache/). That mirror holds RAW, unencrypted customer case data,
// so it is OFF by default: the secure default keeps customer data out of the
// project directory entirely. Users who want cross-browser / cleared-profile
// recovery can opt in. Governs *new* writes only (uploads + rename meta sync);
// existing on-disk backups are read for recovery and pruned by the orphan sweep
// regardless of this flag.
/** @returns {boolean} */
export function getDiskBackup() {
  try {
    const v = JSON.parse(localStorage.getItem(DISK_BACKUP_KEY) || "null")
    if (v && typeof v === "object") return !!v.enabled
  } catch { /* corrupt / unavailable */ }
  return false
}

export function setDiskBackup(enabled) {
  try {
    localStorage.setItem(DISK_BACKUP_KEY, JSON.stringify({ enabled: !!enabled }))
  } catch { /* quota / unavailable — fine */ }
}
