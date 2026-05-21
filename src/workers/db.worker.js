// Phase 2 — DuckDB-WASM worker with real CSV ingestion.
// Streams Papa.parse rows through `enrichForSql`, buffers ~10k-row chunks,
// and bulk-inserts each chunk via apache-arrow. Persists to OPFS so a
// reload doesn't require re-upload.

// The package's `./blocking` subpath resolves to the *node* build, and the
// browser-blocking dist file is intentionally missing from the package's
// exports map. We alias it through Vite (see vite.config.js).
import * as duckdb from '@duckdb/duckdb-wasm-blocking-browser'
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import Papa from 'papaparse'
import * as arrow from 'apache-arrow'
import { enrichForSql, SQL_COLUMNS } from '../lib/enrich.js'

const BUNDLES = {
  eh: { mainModule: duckdb_wasm_eh, mainWorker: '' },
}

const OPFS_PATH = 'opfs://cases.duckdb'
const CHUNK_SIZE = 10000
// SECURITY #4: customer data persisted in OPFS is auto-cleared on init once it
// is older than this. Without a TTL the DuckDB file survives indefinitely on a
// shared workstation; anyone with the browser profile could read it. 24 hours.
const MAX_AGE_MS = 24 * 60 * 60 * 1000
// Bump when the `cases` schema changes. A persisted OPFS table from an older
// version lacks the new columns, so on mismatch we rebuild empty and the app
// prompts a re-import (the table is just a cache of the uploaded file).
const SCHEMA_VERSION = '2'

const CREATE_CASES_SQL = `
  CREATE TABLE IF NOT EXISTS cases (
    number                  VARCHAR,
    short_description       VARCHAR,
    state                   VARCHAR,
    status                  VARCHAR,
    priority                VARCHAR,
    account                 VARCHAR,
    product_line            VARCHAR,
    assigned_to             VARCHAR,
    close_notes             VARCHAR,
    work_notes              VARCHAR,
    case_action_summary     VARCHAR,
    made_sla_raw            VARCHAR,
    first_response_time_raw VARCHAR,
    created_at              TIMESTAMP,
    closed_at               TIMESTAMP,
    sla_due                 TIMESTAMP,
    resolved_ms             BIGINT,
    frt_ms                  BIGINT,
    is_closed               BOOLEAN,
    made_sla                BOOLEAN,
    sla_eligible            BOOLEAN,
    category                VARCHAR,
    priority_rank           BIGINT,
    additional_comments     VARCHAR,
    last_infor_update       TIMESTAMP,
    infor_update_count      BIGINT,
    case_type               VARCHAR,
    update_threshold_ms     BIGINT,
    interaction_count       BIGINT,
    customer_turns          BIGINT,
    analyst_turns           BIGINT,
    jira_keys               VARCHAR,
    jira_active_keys        VARCHAR,
    jira_first_linked       TIMESTAMP
  )
`
const CREATE_META_SQL = `CREATE TABLE IF NOT EXISTS meta (key VARCHAR, value VARCHAR)`

let db = null
let conn = null
let opfsAvailable = false
let usingOpfs = false

function log(msg, level = 'info') {
  postMessage({ type: 'log', level, msg })
}

async function detectOpfs() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return false
    await navigator.storage.getDirectory()
    return true
  } catch {
    return false
  }
}

function ensureSchema() {
  conn.query(CREATE_CASES_SQL)
  conn.query(CREATE_META_SQL)
}

function readSchemaVersion() {
  try {
    const rows = rowsToPlain(conn.query("SELECT value FROM meta WHERE key = 'schema_version'"))
    return rows[0]?.value ?? null
  } catch {
    return null
  }
}

// Rebuild the cases table if the persisted schema predates the current
// version. Drops cached data (a re-import repopulates it with the new columns).
function migrateSchemaIfNeeded() {
  if (readSchemaVersion() === SCHEMA_VERSION) return
  dropTables()
  ensureSchema()
  conn.query('DELETE FROM meta')
  const stmt = conn.prepare('INSERT INTO meta VALUES (?, ?)')
  try { stmt.query('schema_version', SCHEMA_VERSION) } finally { stmt.close() }
  try { db.flushFiles() } catch (e) { log(`flushFiles failed: ${e?.message || e}`, 'warn') }
  log(`schema rebuilt to v${SCHEMA_VERSION}; existing data cleared — re-import required`, 'warn')
}

async function init() {
  if (conn) return getStatus()
  opfsAvailable = await detectOpfs()

  const logger = new duckdb.ConsoleLogger()
  db = await duckdb.createDuckDB(BUNDLES, logger, duckdb.BROWSER_RUNTIME)
  await db.instantiate()

  if (opfsAvailable) {
    try {
      db.open({ path: OPFS_PATH, accessMode: duckdb.DuckDBAccessMode.READ_WRITE })
      usingOpfs = true
      log(`Opened OPFS-backed DB at ${OPFS_PATH}`)
    } catch (e) {
      log(`OPFS open failed (${e?.message || e}); falling back to in-memory`, 'warn')
      db.open({})
      usingOpfs = false
    }
  } else {
    db.open({})
    log('OPFS unavailable; running in-memory only', 'warn')
  }

  conn = db.connect()
  ensureSchema()
  migrateSchemaIfNeeded()
  clearIfExpired()
  return getStatus()
}

// SECURITY #4: drop persisted data on init if it predates the retention
// window. Runs after schema migration so the table exists to read meta from.
function clearIfExpired() {
  const { loadedAt } = readMeta()
  if (loadedAt == null) return
  const age = Date.now() - loadedAt
  if (age <= MAX_AGE_MS) return
  dropTables()
  ensureSchema()
  try { db.flushFiles() } catch (e) { log(`flushFiles failed: ${e?.message || e}`, 'warn') }
  const hours = Math.round(age / 36e5)
  log(`auto-cleared OPFS data: ${hours}h old, exceeds ${MAX_AGE_MS / 36e5}h retention`, 'warn')
}

function rowsToPlain(table) {
  return table.toArray().map((r) => (typeof r?.toJSON === 'function' ? r.toJSON() : { ...r }))
}

function readMeta() {
  const out = { filename: null, loadedAt: null, rowCount: null }
  try {
    const rows = rowsToPlain(conn.query('SELECT key, value FROM meta'))
    for (const r of rows) {
      if (r.key === 'filename') out.filename = r.value
      else if (r.key === 'loaded_at') out.loadedAt = r.value ? Number(r.value) : null
      else if (r.key === 'row_count') out.rowCount = r.value ? Number(r.value) : null
    }
  } catch {
    // meta table missing — fine
  }
  return out
}

function getStatus() {
  let rowCount = 0
  let meta = { filename: null, loadedAt: null, rowCount: null }
  if (conn) {
    try {
      const t = conn.query('SELECT COUNT(*) AS c FROM cases')
      const rows = t.toArray()
      rowCount = Number(rows[0]?.c ?? rows[0]?.toJSON?.()?.c ?? 0)
    } catch {
      // cases missing
    }
    meta = readMeta()
  }
  return {
    ready: !!conn,
    hasData: rowCount > 0,
    filename: meta.filename,
    rowCount,
    loadedAt: meta.loadedAt,
    opfsAvailable,
    usingOpfs,
  }
}

function runQuery(sql, params) {
  if (!conn) throw new Error('worker not initialized')
  if (Array.isArray(params) && params.length) {
    const stmt = conn.prepare(sql)
    try {
      return rowsToPlain(stmt.query(...params))
    } finally {
      stmt.close()
    }
  }
  return rowsToPlain(conn.query(sql))
}

// ---------- ingestion ----------

function buildArrowTable(buffer) {
  // Column-oriented arrays in the order matching SQL_COLUMNS / the table DDL.
  // apache-arrow's tableFromArrays infers types:
  //   string|null  → Utf8
  //   Date|null    → Timestamp[ms]
  //   BigInt|null  → Int64
  //   boolean      → Bool
  const cols = {}
  for (const k of SQL_COLUMNS) cols[k] = new Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    const r = buffer[i]
    for (const k of SQL_COLUMNS) cols[k][i] = r[k]
  }
  return arrow.tableFromArrays(cols)
}

function flushBuffer(buffer) {
  if (!buffer.length) return
  const table = buildArrowTable(buffer)
  conn.insertArrowTable(table, { name: 'cases', create: false })
}

function writeMetaRows({ filename, loadedAt, rowCount }) {
  conn.query('DELETE FROM meta')
  const stmt = conn.prepare('INSERT INTO meta VALUES (?, ?)')
  try {
    stmt.query('filename', String(filename))
    stmt.query('loaded_at', String(loadedAt))
    stmt.query('row_count', String(rowCount))
    stmt.query('schema_version', SCHEMA_VERSION)
  } finally {
    stmt.close()
  }
}

function dropTables() {
  conn.query('DROP TABLE IF EXISTS cases')
  conn.query('DROP TABLE IF EXISTS meta')
}

async function loadCsv({ file }) {
  if (!file) throw new Error('loadCsv: missing file')
  if (!conn) throw new Error('loadCsv: worker not initialized')

  dropTables()
  ensureSchema()

  let inserted = 0
  let buffer = []

  await new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      worker: false,
      step: (results, parser) => {
        try {
          const row = results.data
          const normalized = {}
          for (const k of Object.keys(row)) normalized[String(k).trim()] = row[k]
          buffer.push(enrichForSql(normalized))

          if (buffer.length >= CHUNK_SIZE) {
            flushBuffer(buffer)
            inserted += buffer.length
            postMessage({
              type: 'progress',
              phase: 'parse',
              rowsProcessed: inserted,
              bytesRead: parser?.streamer?._chunkCursor ?? 0,
              totalBytes: file.size,
            })
            buffer = []
          }
        } catch (e) {
          parser.abort()
          reject(e)
        }
      },
      complete: () => {
        try {
          if (buffer.length) {
            flushBuffer(buffer)
            inserted += buffer.length
            buffer = []
          }
          writeMetaRows({ filename: file.name, loadedAt: Date.now(), rowCount: inserted })

          // Persist to OPFS.
          postMessage({
            type: 'progress',
            phase: 'flush',
            rowsProcessed: inserted,
            bytesRead: file.size,
            totalBytes: file.size,
          })
          try { db.flushFiles() } catch (e) { log(`flushFiles failed: ${e?.message || e}`, 'warn') }

          resolve()
        } catch (e) {
          reject(e)
        }
      },
      error: (e) => reject(e),
    })
  })

  return getStatus()
}

async function loadRowsData({ rows, filename }) {
  if (!rows?.length) throw new Error('loadRows: no rows')
  if (!conn) throw new Error('loadRows: worker not initialized')

  dropTables()
  ensureSchema()

  let inserted = 0
  let buffer = []
  const total = rows.length

  for (const row of rows) {
    buffer.push(enrichForSql(row))
    if (buffer.length >= CHUNK_SIZE) {
      flushBuffer(buffer)
      inserted += buffer.length
      postMessage({ type: 'progress', phase: 'parse', rowsProcessed: inserted, bytesRead: inserted, totalBytes: total })
      buffer = []
    }
  }

  if (buffer.length) {
    flushBuffer(buffer)
    inserted += buffer.length
  }

  writeMetaRows({ filename: filename || 'upload.xlsx', loadedAt: Date.now(), rowCount: inserted })
  postMessage({ type: 'progress', phase: 'flush', rowsProcessed: inserted, bytesRead: total, totalBytes: total })
  try { db.flushFiles() } catch (e) { log(`flushFiles failed: ${e?.message || e}`, 'warn') }

  return getStatus()
}

function clearDatabase() {
  if (!conn) throw new Error('clearDatabase: worker not initialized')
  dropTables()
  ensureSchema()
  try { db.flushFiles() } catch (e) { log(`flushFiles failed: ${e?.message || e}`, 'warn') }
}

// ---------- message dispatcher ----------
self.onmessage = async (e) => {
  const { id, type, ...rest } = e.data || {}
  try {
    let result
    switch (type) {
      case 'init':          result = await init(); break
      case 'getStatus':     result = getStatus();  break
      case 'query':         result = runQuery(rest.sql, rest.params); break
      case 'loadCsv':       result = await loadCsv(rest); break
      case 'loadRows':      result = await loadRowsData(rest); break
      case 'clearDatabase': clearDatabase(); result = getStatus(); break
      default:              throw new Error(`unknown message type: ${type}`)
    }
    postMessage({ id, ok: true, result })
  } catch (err) {
    postMessage({ id, ok: false, error: err?.message || String(err) })
  }
}

postMessage({ type: 'log', level: 'info', msg: 'db worker booted' })
