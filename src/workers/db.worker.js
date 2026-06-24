// DuckDB-WASM worker — multi-import model.
//
// Each ServiceNow upload becomes a persistent "import": one base table
// `cases_import_{uuid}` holding its enriched rows, plus a row in `imports_index`.
// `cases` is a VIEW pointing at the active import's table, so every query in
// queries.js (FROM cases) reads the active import without modification.
// Activation = redefine the view + flip is_active. Persisted to OPFS so all
// imports survive reloads.

import * as duckdb from '@duckdb/duckdb-wasm-blocking-browser'
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import Papa from 'papaparse'
import * as arrow from 'apache-arrow'
import { enrichForSql, SQL_COLUMNS, SCHEMA_VERSION } from '../lib/enrich.js'

const BUNDLES = {
  eh: { mainModule: duckdb_wasm_eh, mainWorker: '' },
}

const OPFS_PATH = 'opfs://cases.duckdb'
const CHUNK_SIZE = 10000

// Column DDL shared by every per-import table and the empty fallback table.
const CASES_COLUMNS = `
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
    jira_first_linked       TIMESTAMP,
    sla_breached            BOOLEAN,
    sla_due_sop             TIMESTAMP,
    lifecycle               VARCHAR,
    sentiment_scoreable     BOOLEAN,
    sentiment_valence       BIGINT,
    sentiment_label         VARCHAR,
    sentiment_start         BIGINT,
    sentiment_end           BIGINT,
    sentiment_arc           VARCHAR,
    sentiment_emotions      VARCHAR,
    sentiment_target        VARCHAR,
    sentiment_quote         VARCHAR,
    sentiment_coaching      VARCHAR,
    sentiment_pii           BOOLEAN,
    sentiment_dup           BOOLEAN,
    resolved_at_ms          BIGINT
`
const EMPTY_TABLE = 'cases_empty'
const CREATE_INDEX_SQL = `
  CREATE TABLE IF NOT EXISTS imports_index (
    uuid           VARCHAR,
    filename       VARCHAR,
    display_name   VARCHAR,
    uploaded_at    BIGINT,
    row_count      BIGINT,
    file_size      BIGINT,
    file_type      VARCHAR,
    schema_version VARCHAR,
    is_active      BOOLEAN
  )
`

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

// uuid -> a safe SQL identifier for its per-import table.
const tableNameFor = (uuid) => `cases_import_${String(uuid).replace(/[^a-zA-Z0-9]/g, '_')}`

function createCasesTable(name) {
  conn.query(`CREATE TABLE IF NOT EXISTS ${name} (${CASES_COLUMNS})`)
}

function ensureSchema() {
  conn.query(CREATE_INDEX_SQL)
  createCasesTable(EMPTY_TABLE)
}

function rowsToPlain(table) {
  return table.toArray().map((r) => (typeof r?.toJSON === 'function' ? r.toJSON() : { ...r }))
}

/* ------------------------------ imports index --------------------------- */

function readIndex() {
  let rows = []
  try {
    rows = rowsToPlain(conn.query('SELECT * FROM imports_index ORDER BY uploaded_at DESC'))
  } catch {
    return []
  }
  return rows.map((r) => ({
    uuid: r.uuid,
    filename: r.filename,
    displayName: r.display_name,
    uploadedAt: r.uploaded_at != null ? Number(r.uploaded_at) : null,
    rowCount: r.row_count != null ? Number(r.row_count) : 0,
    fileSize: r.file_size != null ? Number(r.file_size) : 0,
    fileType: r.file_type,
    schemaVersion: r.schema_version,
    isActive: !!r.is_active,
  }))
}

function activeUuid() {
  try {
    const rows = rowsToPlain(conn.query('SELECT uuid FROM imports_index WHERE is_active = TRUE LIMIT 1'))
    return rows[0]?.uuid ?? null
  } catch {
    return null
  }
}

function objectType(name) {
  // 'BASE TABLE' | 'VIEW' | null
  const stmt = conn.prepare("SELECT table_type FROM information_schema.tables WHERE table_name = ?")
  try {
    const rows = rowsToPlain(stmt.query(name))
    return rows[0]?.table_type ?? null
  } catch {
    return null
  } finally {
    stmt.close()
  }
}

// Point the `cases` view at the active import's table, or at the empty table
// when there is no active import (queries then return zero rows gracefully).
function redefineView(uuid) {
  const target = uuid ? tableNameFor(uuid) : EMPTY_TABLE
  conn.query(`CREATE OR REPLACE VIEW cases AS SELECT * FROM ${target}`)
}

function flush() {
  try { db.flushFiles() } catch (e) { log(`flushFiles failed: ${e?.message || e}`, 'warn') }
}

/* ------------------------------- ingestion ------------------------------ */

function buildArrowTable(buffer) {
  const cols = {}
  for (const k of SQL_COLUMNS) cols[k] = new Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    const r = buffer[i]
    for (const k of SQL_COLUMNS) cols[k][i] = r[k]
  }
  return arrow.tableFromArrays(cols)
}

function flushBuffer(buffer, tableName) {
  if (!buffer.length) return
  conn.insertArrowTable(buildArrowTable(buffer), { name: tableName, create: false })
}

// Insert already-normalized raw rows into a freshly-created table, enriching
// each via enrichForSql. `snapshotMs` (the import's upload time) anchors the
// SOP-SLA cadence check so baked SLA matches the in-memory pipeline exactly.
// Returns the inserted row count.
function insertRows(tableName, rows, snapshotMs) {
  let inserted = 0
  let buffer = []
  for (const row of rows) {
    buffer.push(enrichForSql(row, snapshotMs))
    if (buffer.length >= CHUNK_SIZE) {
      flushBuffer(buffer, tableName)
      inserted += buffer.length
      postMessage({ type: 'progress', phase: 'parse', rowsProcessed: inserted, bytesRead: inserted, totalBytes: rows.length })
      buffer = []
    }
  }
  if (buffer.length) {
    flushBuffer(buffer, tableName)
    inserted += buffer.length
  }
  return inserted
}

function upsertIndexRow({ uuid, filename, displayName, uploadedAt, rowCount, fileSize, fileType, schemaVersion }) {
  const stmt = conn.prepare(
    `INSERT INTO imports_index
     (uuid, filename, display_name, uploaded_at, row_count, file_size, file_type, schema_version, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
  )
  try {
    // duckdb-wasm serializes prepared-statement params via JSON, which can't
    // handle BigInt. Pass plain Numbers — these values (ms timestamps, counts,
    // sizes) all fit comfortably within Number.MAX_SAFE_INTEGER.
    stmt.query(uuid, filename, displayName, Number(uploadedAt), Number(rowCount), Number(fileSize || 0), fileType || '', schemaVersion || SCHEMA_VERSION)
  } finally {
    stmt.close()
  }
}

function setActive(uuid) {
  const stmt = conn.prepare('UPDATE imports_index SET is_active = (uuid = ?)')
  try { stmt.query(uuid) } finally { stmt.close() }
}

/* --------------------------------- ops ---------------------------------- */

// Create a new import atomically: table + rows + index row + activate + view.
// `uploadedAt` is preserved when supplied (cold-boot restore replays the
// original upload time from the disk mirror); fresh uploads omit it and get
// stamped with the current time.
function createImport({ uuid, filename, displayName, fileSize, fileType, rows, uploadedAt }) {
  const tableName = tableNameFor(uuid)
  // Anchor the SOP-SLA cadence bake to this import's upload time so it stays
  // deterministic and matches the in-memory pipeline (which uses the same value
  // as `snapshotMs`). Stamped once here, reused for the index row below.
  const snapshot = uploadedAt ?? Date.now()
  try {
    createCasesTable(tableName)
    const rowCount = insertRows(tableName, rows || [], snapshot)
    upsertIndexRow({
      uuid,
      filename,
      displayName: displayName || filename,
      uploadedAt: snapshot,
      rowCount,
      fileSize,
      fileType,
      schemaVersion: SCHEMA_VERSION,
    })
    setActive(uuid)
    redefineView(uuid)
    flush()
  } catch (e) {
    // Roll back fully — no half-created import.
    try { conn.query(`DROP TABLE IF EXISTS ${tableName}`) } catch { /* ignore */ }
    try { const s = conn.prepare('DELETE FROM imports_index WHERE uuid = ?'); s.query(uuid); s.close() } catch { /* ignore */ }
    throw e
  }
  return { imports: readIndex(), activeUuid: uuid }
}

function activateImport(uuid) {
  setActive(uuid)
  redefineView(uuid)
  flush()
  return { activeUuid: uuid }
}

function renameImport(uuid, displayName) {
  const stmt = conn.prepare('UPDATE imports_index SET display_name = ? WHERE uuid = ?')
  try { stmt.query(displayName, uuid) } finally { stmt.close() }
  flush()
  return { ok: true }
}

function deleteImport(uuid) {
  const wasActive = activeUuid() === uuid
  try { conn.query(`DROP TABLE IF EXISTS ${tableNameFor(uuid)}`) } catch { /* ignore */ }
  const del = conn.prepare('DELETE FROM imports_index WHERE uuid = ?')
  try { del.query(uuid) } finally { del.close() }

  let nextActive = activeUuid()
  if (wasActive) {
    const remaining = rowsToPlain(conn.query('SELECT uuid FROM imports_index ORDER BY uploaded_at DESC LIMIT 1'))
    nextActive = remaining[0]?.uuid ?? null
    if (nextActive) setActive(nextActive)
    redefineView(nextActive)
  }
  flush()
  return { imports: readIndex(), activeUuid: nextActive }
}

// Re-parse produced fresh rows; drop+recreate the table and bump schema_version.
function rebuildImport({ uuid, rows }) {
  const tableName = tableNameFor(uuid)
  // Re-bake against the import's ORIGINAL upload time (not "now") so the
  // SOP-SLA snapshot anchor is unchanged by the rebuild.
  const snapshot = readIndex().find((i) => i.uuid === uuid)?.uploadedAt ?? Date.now()
  conn.query(`DROP TABLE IF EXISTS ${tableName}`)
  createCasesTable(tableName)
  const rowCount = insertRows(tableName, rows || [], snapshot)
  const stmt = conn.prepare('UPDATE imports_index SET schema_version = ?, row_count = ? WHERE uuid = ?')
  try { stmt.query(SCHEMA_VERSION, Number(rowCount), uuid) } finally { stmt.close() }
  if (activeUuid() === uuid) redefineView(uuid)
  flush()
  return { imports: readIndex() }
}

function clearAllImports() {
  for (const imp of readIndex()) {
    try { conn.query(`DROP TABLE IF EXISTS ${tableNameFor(imp.uuid)}`) } catch { /* ignore */ }
  }
  conn.query('DELETE FROM imports_index')
  redefineView(null)
  flush()
  return { imports: [], activeUuid: null }
}

/* ----------------------------- legacy migrate --------------------------- */

// Pre-multi-import builds stored a single base TABLE `cases` (+ a `meta` table).
// Convert it to Import #1 so it shows in the manager and SQL pages keep working.
// Note: old builds never stored a source blob, so this import is blob-less —
// the in-memory chart pipeline stays empty for it until the user re-uploads.
function legacyMigrateIfNeeded() {
  const indexCount = Number(rowsToPlain(conn.query('SELECT count(*) AS c FROM imports_index'))[0]?.c ?? 0)
  if (indexCount > 0) return
  if (objectType('cases') !== 'BASE TABLE') return // already a view, or absent

  let filename = 'import-1'
  let loadedAt = Date.now()
  try {
    const meta = rowsToPlain(conn.query('SELECT key, value FROM meta'))
    for (const m of meta) {
      if (m.key === 'filename' && m.value) filename = m.value
      else if (m.key === 'loaded_at' && m.value) loadedAt = Number(m.value)
    }
  } catch { /* no meta table — fine */ }

  const uuid = crypto.randomUUID()
  const tableName = tableNameFor(uuid)
  const rowCount = Number(rowsToPlain(conn.query('SELECT count(*) AS c FROM cases'))[0]?.c ?? 0)
  conn.query(`CREATE TABLE ${tableName} AS SELECT * FROM cases`)
  // The legacy table predates current columns; add any the SQL queries now
  // reference (NULL-filled) so they don't error before the user rebuilds. The
  // "Rebuild needed" badge still prompts a full re-enrich from the source blob.
  try { conn.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN`) } catch { /* ignore */ }
  try { conn.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS sla_due_sop TIMESTAMP`) } catch { /* ignore */ }
  try { conn.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS lifecycle VARCHAR`) } catch { /* ignore */ }
  try { conn.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS resolved_at_ms BIGINT`) } catch { /* ignore */ }
  conn.query('DROP TABLE cases')
  try { conn.query('DROP TABLE IF EXISTS meta') } catch { /* ignore */ }
  upsertIndexRow({
    uuid,
    filename,
    displayName: filename,
    uploadedAt: loadedAt,
    rowCount,
    fileSize: 0,
    fileType: filename.split('.').pop()?.toLowerCase() || '',
    // NOT the current SCHEMA_VERSION: the copied columns were baked by an old
    // build, so the import must show the "rebuild needed" badge (blob-less, so
    // the menu directs the user to re-upload). Must stay truthy — falsy values
    // get replaced by upsertIndexRow's `|| SCHEMA_VERSION` fallback.
    schemaVersion: 'legacy',
  })
  setActive(uuid)
  log(`migrated legacy "cases" table to import ${uuid} (${rowCount} rows)`, 'warn')
}

/* --------------------------------- init --------------------------------- */

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
  legacyMigrateIfNeeded()
  redefineView(activeUuid())
  flush()
  return { imports: readIndex(), activeUuid: activeUuid() }
}

function getStatus() {
  const active = activeUuid()
  const imports = readIndex()
  const meta = imports.find((i) => i.uuid === active) || null
  let rowCount = 0
  if (conn) {
    try {
      rowCount = Number(rowsToPlain(conn.query('SELECT count(*) AS c FROM cases'))[0]?.c ?? 0)
    } catch { /* view missing */ }
  }
  return {
    ready: !!conn,
    hasData: rowCount > 0,
    rowCount,
    activeUuid: active,
    filename: meta?.displayName ?? null,
    loadedAt: meta?.uploadedAt ?? null,
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

/* ---------------- legacy single-dataset ops (back-compat) --------------- */
// useAppData uses these until the multi-import refactor lands. They preserve the
// old "replace on upload" UX by clearing all imports then creating one.

async function loadCsv({ file }) {
  if (!file) throw new Error('loadCsv: missing file')
  if (!conn) throw new Error('loadCsv: worker not initialized')
  const rows = await new Promise((resolve, reject) => {
    const out = []
    Papa.parse(file, {
      header: true, skipEmptyLines: true, dynamicTyping: false, worker: false,
      step: (results) => {
        const row = results.data
        const normalized = {}
        for (const k of Object.keys(row)) normalized[String(k).trim()] = row[k]
        out.push(normalized)
      },
      complete: () => resolve(out),
      error: (e) => reject(e),
    })
  })
  clearAllImports()
  createImport({ uuid: crypto.randomUUID(), filename: file.name, displayName: file.name, fileSize: file.size, fileType: 'csv', rows })
  return getStatus()
}

async function loadRowsData({ rows, filename }) {
  if (!rows?.length) throw new Error('loadRows: no rows')
  if (!conn) throw new Error('loadRows: worker not initialized')
  clearAllImports()
  const ext = (filename || 'upload.xlsx').split('.').pop()?.toLowerCase() || 'xlsx'
  createImport({ uuid: crypto.randomUUID(), filename: filename || 'upload.xlsx', displayName: filename || 'upload.xlsx', fileSize: 0, fileType: ext, rows })
  return getStatus()
}

/* ----------------------- message dispatcher ----------------------------- */

self.onmessage = async (e) => {
  const { id, type, ...rest } = e.data || {}
  try {
    let result
    switch (type) {
      case 'init':            result = await init(); break
      case 'getStatus':       result = getStatus(); break
      case 'query':           result = runQuery(rest.sql, rest.params); break
      case 'listImports':     result = { imports: readIndex(), activeUuid: activeUuid() }; break
      case 'createImport':    result = createImport(rest); break
      case 'activateImport':  result = activateImport(rest.uuid); break
      case 'renameImport':    result = renameImport(rest.uuid, rest.displayName); break
      case 'deleteImport':    result = deleteImport(rest.uuid); break
      case 'rebuildImport':   result = rebuildImport(rest); break
      case 'clearAllImports': result = clearAllImports(); break
      // legacy / back-compat
      case 'loadCsv':         result = await loadCsv(rest); break
      case 'loadRows':        result = await loadRowsData(rest); break
      case 'clearDatabase':   result = clearAllImports(); break
      default:                throw new Error(`unknown message type: ${type}`)
    }
    postMessage({ id, ok: true, result })
  } catch (err) {
    postMessage({ id, ok: false, error: err?.message || String(err) })
  }
}

postMessage({ type: 'log', level: 'info', msg: 'db worker booted' })
