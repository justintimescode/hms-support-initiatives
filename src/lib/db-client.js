// Phase 1 — main-thread client for the DuckDB worker.
// Promise-based wrapper over postMessage. Lazily constructs the worker on
// first init(). Messages outside the request/response lane (worker logs,
// progress events) are surfaced via the `progressHandler` channel.

let worker = null
let nextId = 1
let initPromise = null
const pending = new Map()
let progressHandler = null

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../workers/db.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const { id, type } = e.data || {}
    if (type === 'log') {
      const fn = console[e.data.level] || console.log
      fn('[db.worker]', e.data.msg)
      return
    }
    if (type === 'progress') {
      if (progressHandler) progressHandler(e.data)
      return
    }
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (e.data.ok) p.resolve(e.data.result)
    else            p.reject(new Error(e.data.error || 'unknown worker error'))
  }
  worker.onerror = (e) => {
    console.error('[db.worker] error', e)
  }
  return worker
}

function call(type, payload = {}) {
  const w = ensureWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, type, ...payload })
  })
}

export const dbClient = {
  /** Boot the worker + DuckDB. Memoized; safe to call repeatedly. */
  init() {
    if (!initPromise) initPromise = call('init')
    return initPromise
  },

  /** Generic SQL escape hatch. Phase 3 will wrap typed query helpers around it. */
  async query(sql, params = []) {
    return call('query', { sql, params })
  },

  /** Latest worker-side status snapshot. */
  async getStatus() {
    return call('getStatus')
  },

  /** Stream the file through the worker into the DuckDB `cases` table.
   *  Resolves with a fresh status snapshot. Progress events flow via the
   *  `onProgress` callback (rowsProcessed, bytesRead, totalBytes, phase). */
  async loadCsv(file, { onProgress } = {}) {
    progressHandler = onProgress || null
    try {
      // File objects are structured-cloneable, so postMessage transfers the
      // bytes to the worker without main-thread parsing.
      return await call('loadCsv', { file })
    } finally {
      progressHandler = null
    }
  },

  /** Load pre-parsed row objects (e.g. from an XLSX file) into DuckDB.
   *  Rows must already be normalized with the same field names as CSV rows. */
  async loadRows(rows, { filename, onProgress } = {}) {
    progressHandler = onProgress || null
    try {
      return await call('loadRows', { rows, filename })
    } finally {
      progressHandler = null
    }
  },

  /** Drop and recreate the `cases` + `meta` tables. Flushes OPFS. */
  async clearDatabase() {
    return call('clearDatabase')
  },

  /* ---------- multi-import ---------- */

  /** List all imports + the active uuid. → { imports, activeUuid } */
  async listImports() {
    return call('listImports')
  },

  /** Create a new import from already-normalized rows. Atomic on the worker
   *  side (rolls back on failure). → { imports, activeUuid }. Progress events
   *  flow via onProgress. */
  async createImport({ uuid, filename, displayName, fileSize, fileType, rows, uploadedAt }, { onProgress } = {}) {
    progressHandler = onProgress || null
    try {
      return await call('createImport', { uuid, filename, displayName, fileSize, fileType, rows, uploadedAt })
    } finally {
      progressHandler = null
    }
  },

  /** Make `uuid` the active import (redefines the `cases` view). → { activeUuid } */
  async activateImport(uuid) {
    return call('activateImport', { uuid })
  },

  /** Rename an import's display name. → { ok } */
  async renameImport(uuid, displayName) {
    return call('renameImport', { uuid, displayName })
  },

  /** Delete an import's table + index row. → { imports, activeUuid } */
  async deleteImport(uuid) {
    return call('deleteImport', { uuid })
  },

  /** Re-create an import's table from freshly re-parsed rows, bump schema
   *  version. → { imports } */
  async rebuildImport({ uuid, rows }, { onProgress } = {}) {
    progressHandler = onProgress || null
    try {
      return await call('rebuildImport', { uuid, rows })
    } finally {
      progressHandler = null
    }
  },

  /** Drop every import table + clear the index. → { imports, activeUuid } */
  async clearAllImports() {
    return call('clearAllImports')
  },
}

// SECURITY (#2): the DuckDB client is intentionally NOT exposed on `window`.
// A previous `window.__db = dbClient` dev hook meant anyone who could open
// DevTools on a misconfigured dev/preview build could dump all loaded
// customer data via `window.__db.query(...)`. Do not reintroduce it.
