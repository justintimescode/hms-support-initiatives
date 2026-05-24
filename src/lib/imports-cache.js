// Server-side disk mirror for ServiceNow imports, served by the Vite dev
// middleware `snFileCachePlugin` (see vite.config.js). Mirrors the OPFS layout
// per-uuid; on cold boot (different browser / cleared profile) the app reads
// these blobs back and reconstructs imports into OPFS + DuckDB.
//
// SECURITY note: the disk cache stores customer case data on disk in the
// working directory. .servicenow-cache/ is gitignored; do not relocate this
// dir outside the project root without ensuring whatever path you pick is
// also kept out of source control and backups.
//
// Dev-only: when `npm run dev` isn't running (e.g. a static `vite build`
// preview) the /api/cache/sn endpoint doesn't exist. Every function here
// soft-fails (returns null/false and warns) so the OPFS path stays the
// source of truth without the UI ever throwing.

const BASE = '/api/cache/sn'

/** @returns {Promise<object[]>} array of stored meta objects (empty on failure) */
export async function listDiskMetas() {
  try {
    const res = await fetch(BASE, { cache: 'no-store' })
    if (res.status === 404) return []
    if (!res.ok) throw new Error(`list → ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch (err) {
    console.warn('[sn-cache] list failed —', err?.message || err)
    return []
  }
}

/** Stream the raw uploaded file to disk. Returns true on success. */
export async function writeDiskBlob(uuid, file, ext) {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(uuid)}/source?ext=${encodeURIComponent(ext)}`, {
      method: 'PUT',
      body: file,
    })
    if (!res.ok) throw new Error(`PUT source → ${res.status}`)
    return true
  } catch (err) {
    console.warn(`[sn-cache] write blob failed for ${uuid} —`, err?.message || err)
    return false
  }
}

export async function writeDiskMeta(uuid, meta) {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(uuid)}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    })
    if (!res.ok) throw new Error(`PUT meta → ${res.status}`)
    return true
  } catch (err) {
    console.warn(`[sn-cache] write meta failed for ${uuid} —`, err?.message || err)
    return false
  }
}

/** Read the stored source blob back as a File. null if missing / dev offline. */
export async function readDiskBlob(uuid, filename) {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(uuid)}/source`, { cache: 'no-store' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GET source → ${res.status}`)
    const blob = await res.blob()
    // Wrap as a File so downstream code sees a normal File (incl. .name).
    return new File([blob], filename || 'source', { type: blob.type })
  } catch (err) {
    console.warn(`[sn-cache] read blob failed for ${uuid} —`, err?.message || err)
    return null
  }
}

export async function deleteDiskImport(uuid) {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(uuid)}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`DELETE → ${res.status}`)
    return true
  } catch (err) {
    console.warn(`[sn-cache] delete failed for ${uuid} —`, err?.message || err)
    return false
  }
}

export async function clearDiskCache() {
  try {
    const res = await fetch(BASE, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`DELETE all → ${res.status}`)
    return true
  } catch (err) {
    console.warn('[sn-cache] clear-all failed —', err?.message || err)
    return false
  }
}
