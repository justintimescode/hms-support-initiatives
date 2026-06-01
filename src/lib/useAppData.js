// All app-wide state, derived memos, and ingest/sync handlers live here so
// AppLayout can own them once and expose to every route via Outlet context.
// Lifted verbatim from KpiAnalyzer.jsx during the navigation refactor — no
// behavior change to the data or chart pipelines.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import Papa from "papaparse"
import { enrichRow, priorityRank, normalizeXlsxRow } from "./enrich.js"
import { dbClient } from "./db-client.js"
import {
  pingJira, fetchHmsProject, loadCache, saveCache, mergeIssues,
  JiraError, PROJECT_KEY,
} from "./jira-client.js"
import { enrichIssue, mergeJiraIntoRows } from "./jira-enrich.js"
import { priorityColor } from "./format.js"
import {
  computeKpis, computeInteractionStats, topCounts, priorityMix,
  filterRowsByDate, previousWindow, qualityMetrics,
} from "./stats.js"
import { useFilters } from "./useFilters.js"
import { aiClient, AiNotConfiguredError } from "./ai-client.js"
import { scrubForAi } from "./ai-scrub.js"
import {
  storeImportBlob, storeImportMeta, readImportBlob, deleteImportFiles,
  getTotalStorageBytes,
} from "./imports-store.js"
import {
  listDiskMetas, writeDiskBlob, writeDiskMeta, readDiskBlob,
  deleteDiskImport, clearDiskCache,
} from "./imports-cache.js"
import { SCHEMA_VERSION } from "./enrich.js"
import { getAutoDelete, getDiskBackup } from "./settings.js"

// On boot, optionally prune imports older than the user's retention setting.
// The active import is never auto-deleted (don't silently lose the working set).
// SECURITY #14: deletes ALL three persistence layers — DuckDB table, OPFS source
// blob, AND the on-disk mirror. The disk delete was previously omitted, leaving
// orphaned plaintext copies on disk after a prune.
async function enforceAutoDelete(list, activeUuid) {
  const { enabled, days } = getAutoDelete()
  if (!enabled || !list?.length) return list
  const cutoff = Date.now() - days * 864e5
  const stale = list.filter((i) => i.uuid !== activeUuid && (i.uploadedAt ?? Infinity) < cutoff)
  if (!stale.length) return list
  let result = list
  for (const imp of stale) {
    try {
      const res = await dbClient.deleteImport(imp.uuid)
      await Promise.all([
        deleteImportFiles(imp.uuid).catch(() => {}),
        deleteDiskImport(imp.uuid).catch(() => {}),
      ])
      result = res.imports
    } catch (e) { console.error("[imports] auto-delete failed", e) }
  }
  return result
}

// SECURITY #14: delete disk-mirror entries that no longer correspond to a live
// import. Cleans up historical orphans (older auto-delete runs left the disk
// copy behind) and keeps the plaintext mirror in lockstep with the index.
// Best-effort: never blocks boot, soft-fails when the dev endpoint is absent.
async function sweepDiskOrphans(liveUuids) {
  try {
    const metas = await listDiskMetas()
    if (!metas.length) return
    const live = new Set(liveUuids)
    for (const m of metas) {
      if (m?.uuid && !live.has(m.uuid)) await deleteDiskImport(m.uuid).catch(() => {})
    }
  } catch { /* dev endpoint absent / list failed — fine */ }
}

void PROJECT_KEY // kept in scope; used downstream by Jira sync error paths

// SECURITY #6 — validate uploads by content, not just extension. A file named
// `report.csv` could be a crafted binary, and an XLSX parser should never be
// handed arbitrary bytes. We check magic numbers and a size ceiling before any
// parser touches the data.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const BAD_FILE_MSG =
  "File doesn't look like a valid CSV/Excel export. Re-export from ServiceNow and try again."

async function validateUpload(file, ext) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large (${(file.size / 1048576).toFixed(0)} MB). The limit is 50 MB.`)
  }
  if (ext === "xlsx" || ext === "xls") {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 // PK\x03\x04 (xlsx)
    const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0 // legacy .xls compound doc
    if (!isZip && !isOle) throw new Error(BAD_FILE_MSG)
  } else if (ext === "csv") {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
    if (head.includes(0x00)) throw new Error(BAD_FILE_MSG) // NUL byte ⇒ binary, not text
  }
}

// SECURITY #5 — XLSX parsing via exceljs (replaces the unmaintained `xlsx`
// package, which carried a ReDoS advisory). exceljs returns native cell types,
// so each cell is re-emitted as the same primitive the old `xlsx` raw:false
// path produced — date cells as "YYYY-MM-DD HH:MM:SS" wall-clock strings (built
// from the Date's UTC components) and booleans as "TRUE"/"FALSE". That keeps
// normalizeXlsxRow / enrichForSql byte-identical; validated row-for-row (574/574)
// against a real ServiceNow export.
const _pad2 = (n) => String(n).padStart(2, "0")
function xlsxCellValue(v) {
  if (v == null) return null
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${_pad2(v.getUTCMonth() + 1)}-${_pad2(v.getUTCDate())} ` +
      `${_pad2(v.getUTCHours())}:${_pad2(v.getUTCMinutes())}:${_pad2(v.getUTCSeconds())}`
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("") // rich text
    if ("text" in v) return v.text     // hyperlink cell
    if ("result" in v) return v.result // formula cell
    if ("error" in v) return null      // error cell
    return String(v)
  }
  return v
}

async function readXlsxRows(arrayBuffer) {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const headers = ws.getRow(1).values // sparse, 1-indexed; [0] is empty
  const rows = []
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // header
    const obj = {}
    for (let i = 1; i < headers.length; i++) {
      const key = headers[i]
      if (key == null) continue
      obj[key] = xlsxCellValue(row.getCell(i).value)
    }
    rows.push(obj)
  })
  return rows
}

// Parse a CSV/XLSX File into normalized raw rows usable by BOTH the in-memory
// pipeline (enrichRow) and the worker (createImport → enrichForSql). CSV headers
// are already system field names; XLSX display labels are mapped via
// normalizeXlsxRow. Keys are trimmed. Shared by upload and rebuild.
async function parseFileToRows(file, ext) {
  let data = []
  if (ext === "csv") {
    const text = await file.text()
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false })
    data = parsed.data
  } else {
    const raw = await readXlsxRows(await file.arrayBuffer())
    data = raw.map(normalizeXlsxRow)
  }
  return data.map((r) => {
    const o = {}
    for (const k of Object.keys(r)) o[String(k).trim()] = r[k]
    return o
  })
}

export function useAppData() {
  // Multi-import model: every upload is a persistent import; one is active.
  // `rows` holds the active import's re-parsed raw rows — the in-memory pipeline
  // below derives every chart from it. `filename`/`snapshotMs` are derived from
  // the active import so the rest of the app reads the same names as before.
  const [imports, setImports] = useState([])
  const [activeImportUuid, setActiveImportUuid] = useState(null)
  const [rows, setRows] = useState(null)
  const rowsCache = useRef(new Map()) // uuid -> parsed raw rows, for instant re-activation
  const [storageBytes, setStorageBytes] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState("")
  const [aiState, setAiState] = useState({ loading: false, result: null, error: null })
  const [memberAi, setMemberAi] = useState({})

  const activeImport = useMemo(
    () => imports.find((i) => i.uuid === activeImportUuid) || null,
    [imports, activeImportUuid],
  )
  const filename = activeImport?.displayName || ""
  const snapshotMs = activeImport?.uploadedAt ?? null

  // Stable name list for the opaque-token resolver in useFilters.
  const analystNames = useMemo(() => {
    if (!rows) return []
    const set = new Set()
    for (const r of rows) set.add(r.assigned_to || "Unassigned")
    return [...set]
  }, [rows])

  const { analyst, setAnalyst, dateRange, setDateRange, compareOn, setCompareOn } =
    useFilters({ analystNames })
  const navigate = useNavigate()

  // team flavor when no analyst selected.
  const view = analyst === "__all__" ? "team" : "individual"

  const [dbReady, setDbReady] = useState(false)
  // null = not restoring; number = imports left to pull back from the disk
  // mirror on cold boot. UI shows a transient banner while > 0.
  const [restoringCount, setRestoringCount] = useState(null)
  const [jiraState, setJiraState] = useState({
    status: "idle",
    issues: null,
    meta: null,
    error: null,
    progress: null,
  })
  const [printMode, setPrintMode] = useState(null)
  const [printMenuOpen, setPrintMenuOpen] = useState(false)
  const inputRef = useRef(null)

  const triggerPrint = (scope) => {
    setPrintMenuOpen(false)
    setPrintMode(scope)
  }

  useEffect(() => {
    if (!printMode) return
    let printTimer
    const settle = requestAnimationFrame(() => {
      printTimer = setTimeout(() => window.print(), 500)
    })
    const resetPrint = () => setPrintMode(null)
    window.addEventListener("afterprint", resetPrint, { once: true })
    return () => {
      cancelAnimationFrame(settle)
      clearTimeout(printTimer)
      window.removeEventListener("afterprint", resetPrint)
    }
  }, [printMode])

  // Load an import's raw rows into the in-memory pipeline: cache hit, else
  // re-parse its stored OPFS blob. Blob-less imports (legacy-migrated) yield
  // null — their charts stay empty until re-upload, but SQL pages still work.
  const loadActiveRows = useCallback(async (uuid, importList) => {
    if (!uuid) { setRows(null); return }
    if (rowsCache.current.has(uuid)) { setRows(rowsCache.current.get(uuid)); return }
    const meta = (importList || []).find((i) => i.uuid === uuid)
    const file = await readImportBlob(uuid)
    if (!file) { setRows(null); return }
    const ext = (meta?.fileType || file.name.split(".").pop() || "csv").toLowerCase()
    const parsed = await parseFileToRows(file, ext)
    rowsCache.current.set(uuid, parsed)
    setRows(parsed)
  }, [])

  const refreshStorage = useCallback(() => {
    getTotalStorageBytes().then(setStorageBytes).catch(() => {})
  }, [])

  // Cold-boot restore: oldest-first so the final createImport leaves the most
  // recently-uploaded import active (matches the worker's "newest-active"
  // semantic). Progressively updates `imports` so the file manager fills in
  // as the restore proceeds.
  const restoreFromDisk = useCallback(async (diskMetas, isCancelled) => {
    setRestoringCount(diskMetas.length)
    const sorted = [...diskMetas].sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0))
    let remaining = sorted.length
    let lastList = []
    let lastActiveUuid = null
    for (const meta of sorted) {
      if (isCancelled()) break
      try {
        const file = await readDiskBlob(meta.uuid, meta.filename)
        if (!file) { console.warn(`[sn-cache] no blob on disk for ${meta.uuid} — skipping`); continue }
        const ext = (meta.fileType || file.name.split(".").pop() || "csv").toLowerCase()
        const rows = await parseFileToRows(file, ext)
        const { imports: nl, activeUuid: au } = await dbClient.createImport({
          uuid: meta.uuid,
          filename: meta.filename,
          displayName: meta.displayName || meta.filename,
          fileSize: meta.fileSize || file.size,
          fileType: ext,
          rows,
          // Preserve the original upload time from the disk mirror — otherwise
          // the worker re-stamps it with the current (reboot) time.
          uploadedAt: meta.uploadedAt,
        })
        // Mirror to OPFS for fast subsequent reloads (re-parse from blob, then
        // OPFS path takes over). Best-effort; failure here doesn't abort.
        await storeImportBlob(meta.uuid, file, ext).catch(() => {})
        await storeImportMeta(meta.uuid, { ...meta, fileType: ext }).catch(() => {})
        rowsCache.current.set(meta.uuid, rows)
        lastList = nl
        lastActiveUuid = au
        if (!isCancelled()) setImports(nl)
      } catch (err) {
        console.warn(`[sn-cache] restore failed for ${meta.uuid} —`, err?.message || err)
      } finally {
        remaining--
        if (!isCancelled()) setRestoringCount(remaining > 0 ? remaining : null)
      }
    }
    if (!isCancelled() && lastActiveUuid) {
      setActiveImportUuid(lastActiveUuid)
      setRows(rowsCache.current.get(lastActiveUuid) || null)
    }
    if (!isCancelled()) setRestoringCount(null)
    void lastList
  }, [])

  // On mount: boot the worker, load the imports list, activate + rehydrate the
  // active import's rows (this also fixes the old reload-loses-charts bug).
  React.useEffect(() => {
    let cancelled = false
    dbClient
      .init()
      .then(async ({ imports: list, activeUuid }) => {
        if (cancelled) return
        const pruned = await enforceAutoDelete(list || [], activeUuid)
        if (cancelled) return
        setDbReady(true)

        // Cold boot: OPFS/DuckDB are empty but the disk mirror may have data
        // from a previous browser. Pull each import back, recreate it (same
        // uuid), and mirror into OPFS so subsequent reloads are fast.
        if (pruned.length === 0) {
          const diskMetas = await listDiskMetas()
          if (!cancelled && diskMetas.length) {
            await restoreFromDisk(diskMetas, () => cancelled)
            if (!cancelled) refreshStorage()
            return
          }
        }

        setImports(pruned)
        setActiveImportUuid(activeUuid || null)
        await loadActiveRows(activeUuid, pruned)
        refreshStorage()
        // Reconcile the disk mirror against the live index (SECURITY #14).
        // Fire-and-forget — cleanup must never delay first paint.
        sweepDiskOrphans(pruned.map((i) => i.uuid))
      })
      .catch((err) => console.error("[db] init failed", err))
    return () => { cancelled = true }
  }, [loadActiveRows, refreshStorage, restoreFromDisk])

  // On mount: hydrate Jira from cache.
  React.useEffect(() => {
    let cancelled = false
    setJiraState((s) => (s.status === "idle" ? { ...s, status: "hydrating" } : s))
    ;(async () => {
      const cached = await loadCache()
      if (cancelled) return
      if (cached?.issues?.length) {
        const { fieldMap, statusMap } = cached.meta || {}
        const issues = cached.issues.map((i) => enrichIssue(i, fieldMap, statusMap))
        if (!cancelled) {
          setJiraState({ status: "ready", issues, meta: cached.meta, error: null, progress: null })
        }
      } else {
        setJiraState((s) => (s.status === "hydrating" ? { ...s, status: "idle" } : s))
        try {
          const ok = await pingJira()
          if (!cancelled && !ok) {
            setJiraState((s) => (s.status === "idle" ? { ...s, status: "unconfigured" } : s))
          }
        } catch {
          /* leave status as idle */
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const syncJira = useCallback(async (mode = "full") => {
    setJiraState((s) => ({ ...s, status: "loading", error: null, progress: null }))
    try {
      const reachable = await pingJira()
      if (!reachable) {
        setJiraState((s) => ({ ...s, status: "unconfigured", error: null }))
        return
      }
      // Day-window modes pull a partial slice and merge onto the cache so
      // older issues aren't dropped. "full" pulls the whole project.
      const SYNC_WINDOWS = { "24h": 1, "5d": 5, "14d": 14, recent: 14, "30d": 30 }
      const since = SYNC_WINDOWS[mode]
      const { issues: rawIssues, fetchedAt, fieldMap, statusMap, project } = await fetchHmsProject({
        since,
        onProgress: (info) => setJiraState((s) => ({ ...s, progress: info })),
      })
      let mergedRaw = rawIssues
      if (since != null) {
        const cached = await loadCache()
        if (cached?.issues) mergedRaw = mergeIssues(cached.issues, rawIssues)
      }
      const meta = {
        fetchedAt,
        projectKey: project?.key || PROJECT_KEY,
        projectName: project?.name || null,
        count: mergedRaw.length,
        fieldMap,
        statusMap,
      }
      const cacheSaved = await saveCache(mergedRaw, meta)
      meta.cacheSaved = cacheSaved
      if (!cacheSaved) {
        console.warn("[jira] cache did not persist; reload will require re-sync")
      }
      const issues = mergedRaw.map((i) => enrichIssue(i, fieldMap, statusMap))
      setJiraState({ status: "ready", issues, meta, error: null, progress: null })
    } catch (err) {
      if (err instanceof JiraError && err.status === 401) {
        setJiraState((s) => ({ ...s, status: "unconfigured", error: null }))
      } else {
        setJiraState((s) => ({ ...s, status: "error", error: err?.message || "Jira sync failed." }))
      }
    }
  }, [])

  const hydrateFromCache = useCallback(async () => {
    setJiraState((s) => ({ ...s, status: "hydrating" }))
    const cached = await loadCache()
    if (cached?.issues?.length) {
      const { fieldMap, statusMap } = cached.meta || {}
      const issues = cached.issues.map((i) => enrichIssue(i, fieldMap, statusMap))
      setJiraState({ status: "ready", issues, meta: cached.meta, error: null, progress: null })
      return true
    }
    setJiraState((s) => ({ ...s, status: "idle" }))
    return false
  }, [])

  /* ---------- ingest (multi-import) ---------- */

  // Reset the analyst/date/AI working state — used whenever the active dataset
  // changes (upload or activation) so filters don't carry across datasets.
  const resetWorkingState = useCallback(() => {
    setAnalyst("__all__")
    setDateRange({ from: null, to: null, field: "_created" })
    setCompareOn(false)
    setAiState({ loading: false, result: null, error: null })
    setMemberAi({})
  }, [setAnalyst, setDateRange, setCompareOn])

  // New upload → a new persistent import, auto-activated. Atomic: on any failure
  // the OPFS blob is cleaned up and nothing half-created remains.
  const handleFile = async (file) => {
    setUploading(true)
    setUploadError("")
    let uuid = null
    try {
      const ext = file.name.split(".").pop().toLowerCase()
      if (ext !== "csv" && ext !== "xlsx" && ext !== "xls") {
        throw new Error("Please upload a CSV or Excel (.xlsx) file.")
      }
      await validateUpload(file, ext) // SECURITY #6: magic-byte + size check before parsing
      const normalized = await parseFileToRows(file, ext)
      if (!normalized.length) throw new Error("No rows found in the file.")

      uuid = crypto.randomUUID()
      // Distinct display name when the same filename was uploaded before.
      const dupes = imports.filter((i) => i.filename === file.name).length
      const displayName = dupes ? `${file.name} (${dupes + 1})` : file.name

      const meta = { uuid, filename: file.name, displayName, fileType: ext, fileSize: file.size, uploadedAt: Date.now() }
      await storeImportBlob(uuid, file, ext)
      await storeImportMeta(uuid, meta)
      const { imports: list, activeUuid } = await dbClient.createImport({
        uuid, filename: file.name, displayName, fileSize: file.size, fileType: ext, rows: normalized,
      })

      rowsCache.current.set(uuid, normalized)
      setImports(list)
      setActiveImportUuid(activeUuid)
      setRows(normalized)
      setDbReady(true)
      resetWorkingState()
      refreshStorage()
      if (inputRef.current) inputRef.current.value = ""

      // Disk mirror (best-effort, non-blocking — see imports-cache.js). The
      // active import in `list` carries the worker-known rowCount, so we copy
      // that into the on-disk meta for accurate cold-restore. SECURITY #14:
      // opt-in only — the mirror writes RAW customer data to the project dir, so
      // it is gated behind the "Back up imports to disk" setting (default OFF).
      if (getDiskBackup()) {
        const persisted = list.find((i) => i.uuid === uuid) || meta
        Promise.all([
          writeDiskBlob(uuid, file, ext),
          writeDiskMeta(uuid, { ...meta, rowCount: persisted.rowCount, schemaVersion: SCHEMA_VERSION }),
        ]).catch((err) => console.warn("[sn-cache] mirror failed —", err?.message || err))
      }
    } catch (e) {
      if (uuid) await deleteImportFiles(uuid).catch(() => {}) // roll back the blob
      setUploadError(e.message || "Could not parse file.")
    } finally {
      setUploading(false)
    }
  }

  const activateImport = useCallback(async (uuid) => {
    if (uuid === activeImportUuid) return
    const { activeUuid } = await dbClient.activateImport(uuid)
    setActiveImportUuid(activeUuid)
    setImports((list) => list.map((i) => ({ ...i, isActive: i.uuid === activeUuid })))
    resetWorkingState()
    await loadActiveRows(activeUuid, imports)
  }, [activeImportUuid, imports, loadActiveRows, resetWorkingState])

  const renameImport = useCallback(async (uuid, displayName) => {
    const name = String(displayName || "").trim()
    if (!name) return
    await dbClient.renameImport(uuid, name)
    setImports((list) => list.map((i) => (i.uuid === uuid ? { ...i, displayName: name } : i)))
    // Keep the on-disk meta in sync so a cold-restore picks up the new name.
    // Only when disk backup is enabled (SECURITY #14) — otherwise there is no
    // disk copy to update.
    const meta = imports.find((i) => i.uuid === uuid)
    if (meta && getDiskBackup()) writeDiskMeta(uuid, { ...meta, displayName: name }).catch(() => {})
  }, [imports])

  const deleteImport = useCallback(async (uuid) => {
    const { imports: list, activeUuid } = await dbClient.deleteImport(uuid)
    await Promise.all([
      deleteImportFiles(uuid).catch(() => {}),
      deleteDiskImport(uuid),
    ])
    rowsCache.current.delete(uuid)
    setImports(list)
    if (activeUuid !== activeImportUuid) {
      setActiveImportUuid(activeUuid)
      resetWorkingState()
      await loadActiveRows(activeUuid, list)
    }
    refreshStorage()
  }, [activeImportUuid, loadActiveRows, resetWorkingState, refreshStorage])

  // Re-parse the stored source blob and rebuild the import's table with current
  // enrichment logic (clears the stale schema_version flag).
  const rebuildImport = useCallback(async (uuid) => {
    const meta = imports.find((i) => i.uuid === uuid)
    const file = await readImportBlob(uuid)
    if (!file) throw new Error("No stored source file for this import — re-upload it instead.")
    const ext = (meta?.fileType || file.name.split(".").pop() || "csv").toLowerCase()
    const parsed = await parseFileToRows(file, ext)
    const { imports: list } = await dbClient.rebuildImport({ uuid, rows: parsed })
    rowsCache.current.set(uuid, parsed)
    setImports(list)
    if (uuid === activeImportUuid) setRows(parsed)
  }, [imports, activeImportUuid])

  const clearAllImports = useCallback(async () => {
    const current = imports.map((i) => i.uuid)
    await dbClient.clearAllImports()
    await Promise.all([
      ...current.map((u) => deleteImportFiles(u).catch(() => {})),
      clearDiskCache(),
    ])
    rowsCache.current.clear()
    setImports([])
    setActiveImportUuid(null)
    setRows(null)
    resetWorkingState()
    refreshStorage()
    if (inputRef.current) inputRef.current.value = ""
  }, [imports, resetWorkingState, refreshStorage])

  // Back-compat alias: the old "Clear data" button maps to clearing everything.
  const reset = clearAllImports

  /* ---------- derived ---------- */
  const analysts = useMemo(() => {
    if (!rows) return []
    const set = new Map()
    for (const r of rows) {
      const a = r.assigned_to || "Unassigned"
      set.set(a, (set.get(a) || 0) + 1)
    }
    return [...set.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const enrichedAll = useMemo(() => (rows ? rows.map(enrichRow) : []), [rows])

  const jiraIssueMap = useMemo(() => {
    const m = new Map()
    for (const it of jiraState.issues || []) m.set(it.key, it)
    return m
  }, [jiraState.issues])

  const enrichedAllJoined = useMemo(
    () => (jiraIssueMap.size ? enrichedAll.map((r) => mergeJiraIntoRows(r, jiraIssueMap)) : enrichedAll),
    [enrichedAll, jiraIssueMap],
  )

  const enrichedAnalyst = useMemo(() => {
    if (analyst === "__all__") return enrichedAllJoined
    return enrichedAllJoined.filter((r) => (r.assigned_to || "Unassigned") === analyst)
  }, [enrichedAllJoined, analyst])

  const enriched = useMemo(
    () => filterRowsByDate(enrichedAnalyst, dateRange.from, dateRange.to, dateRange.field),
    [enrichedAnalyst, dateRange],
  )

  const compareWindow = useMemo(() => {
    if (!compareOn || dateRange.from == null || dateRange.to == null) return null
    return previousWindow(dateRange.from, dateRange.to)
  }, [compareOn, dateRange])

  const compareEnriched = useMemo(() => {
    if (!compareWindow) return null
    return filterRowsByDate(enrichedAnalyst, compareWindow.from, compareWindow.to, dateRange.field)
  }, [enrichedAnalyst, compareWindow, dateRange.field])

  const kpis = useMemo(() => computeKpis(enriched), [enriched])
  const compareKpis = useMemo(
    () => (compareEnriched ? computeKpis(compareEnriched) : null),
    [compareEnriched],
  )

  const teamMembersAll = useMemo(() => {
    const groups = new Map()
    for (const r of enrichedAllJoined) {
      const name = r.assigned_to || "Unassigned"
      if (!groups.has(name)) groups.set(name, [])
      groups.get(name).push(r)
    }
    const out = []
    for (const [name, list] of groups.entries()) {
      out.push({ name, rows: list })
    }
    return out
  }, [enrichedAllJoined])

  const teamMembers = useMemo(() => {
    const out = teamMembersAll.map((m) => {
      const list = filterRowsByDate(m.rows, dateRange.from, dateRange.to, dateRange.field)
      return {
        name: m.name,
        rows: list,
        kpis: computeKpis(list),
        topCategories: topCounts(list, (r) => r._category, 3),
        topAccounts: topCounts(list, (r) => r.account, 3),
        topProducts: topCounts(list, (r) => r.product_line, 3),
        priorityMix: priorityMix(list),
        interactionStats: computeInteractionStats(list),
        quality: qualityMetrics(list),
      }
    })
    return out.sort((a, b) => b.kpis.total - a.kpis.total)
  }, [teamMembersAll, dateRange])

  const compareTeamKpis = useMemo(() => {
    if (!compareWindow) return null
    const all = teamMembersAll.flatMap((m) =>
      filterRowsByDate(m.rows, compareWindow.from, compareWindow.to, dateRange.field),
    )
    return computeKpis(all)
  }, [teamMembersAll, compareWindow, dateRange.field])

  const priorityData = useMemo(() => {
    const groups = {}
    for (const r of enriched) {
      const p = r.priority || "Unknown"
      groups[p] = groups[p] || { priority: p, total: 0, closed: 0, sla_met: 0, sla_total: 0, res_sum: 0, res_n: 0 }
      groups[p].total++
      if (r._isClosed) groups[p].closed++
      if (r.made_sla !== "" && r.made_sla != null) {
        groups[p].sla_total++
        if (r._madeSla) groups[p].sla_met++
      }
      if (r._resolvedMs != null) {
        groups[p].res_sum += r._resolvedMs
        groups[p].res_n++
      }
    }
    return Object.values(groups)
      .map((g) => ({
        ...g,
        sla_pct: g.sla_total ? (g.sla_met / g.sla_total) * 100 : null,
        avg_res_h: g.res_n ? g.res_sum / g.res_n / 36e5 : null,
        color: priorityColor(g.priority),
      }))
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
  }, [enriched])

  const categoryData = useMemo(() => {
    const groups = {}
    for (const r of enriched) {
      groups[r._category] = (groups[r._category] || 0) + 1
    }
    return Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [enriched])

  const accountData = useMemo(() => {
    const groups = {}
    for (const r of enriched) {
      const a = r.account || "Unknown"
      groups[a] = (groups[a] || 0) + 1
    }
    return Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
  }, [enriched])

  const productData = useMemo(() => {
    const groups = {}
    for (const r of enriched) {
      const p = r.product_line || "Unknown"
      groups[p] = (groups[p] || 0) + 1
    }
    return Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [enriched])

  /* ---------- AI insights ---------- */
  // Builds the structured analysis payload (same case-sample shape as before),
  // masks PII via scrubForAi, then hands it to aiClient. The client posts to a
  // first-party proxy (VITE_AI_PROXY_URL) which owns the model key and prompt;
  // with no proxy configured it throws AiNotConfiguredError. The browser never
  // talks to a model vendor directly. See ai-client.js / ai-scrub.js (#1).
  const analyzeCases = async (rowsIn, label) => {
    const sample = rowsIn.slice(0, 50).map((r) => ({
      number: r.number,
      priority: r.priority,
      state: r.state,
      product: r.product_line,
      category: r._category,
      short_description: r.short_description,
      close_notes: r.close_notes ? String(r.close_notes).slice(0, 400) : "",
      resolution_hours: r._resolvedMs != null ? +(r._resolvedMs / 36e5).toFixed(1) : null,
      made_sla: r._madeSla,
    }))
    const localKpis = computeKpis(rowsIn)
    const cats = topCounts(rowsIn, (r) => r._category, 6)
    const payload = {
      label,
      totalCases: rowsIn.length,
      slaRate: localKpis.slaRate != null ? +localKpis.slaRate.toFixed(1) : null,
      categories: cats.map((c) => ({ name: c.name, count: c.count })),
      cases: sample,
    }
    const scrubbed = scrubForAi(payload)
    return aiClient.analyzeCases(scrubbed)
  }

  const runAiAnalysis = async () => {
    setAiState({ loading: true, result: null, error: null, notConfigured: false })
    try {
      const label = analyst === "__all__" ? "all analysts" : analyst
      const parsed = await analyzeCases(enriched, label)
      setAiState({ loading: false, result: parsed, error: null, notConfigured: false })
    } catch (e) {
      if (e instanceof AiNotConfiguredError) {
        setAiState({ loading: false, result: null, error: e.message, notConfigured: true })
      } else {
        setAiState({ loading: false, result: null, error: e.message || "AI analysis failed.", notConfigured: false })
      }
    }
  }

  const runMemberAi = async (member) => {
    setMemberAi((s) => ({ ...s, [member.name]: { loading: true, result: null, error: null, notConfigured: false } }))
    try {
      const parsed = await analyzeCases(member.rows, member.name)
      setMemberAi((s) => ({ ...s, [member.name]: { loading: false, result: parsed, error: null, notConfigured: false } }))
    } catch (e) {
      const notConfigured = e instanceof AiNotConfiguredError
      setMemberAi((s) => ({ ...s, [member.name]: { loading: false, result: null, error: e.message || "AI analysis failed.", notConfigured } }))
    }
  }

  const drillIntoMember = (name) => {
    setAnalyst(name)
    navigate("/")
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return {
    // raw + ingest (rows/filename/snapshotMs derived from the active import)
    rows, filename, uploading, uploadError, inputRef,
    handleFile, reset,
    // imports (multi-import file manager)
    imports, activeImport, activeImportUuid, storageBytes, schemaVersion: SCHEMA_VERSION,
    restoringCount,
    activateImport, renameImport, deleteImport, rebuildImport, clearAllImports,
    // filters (URL-backed)
    analyst, setAnalyst, dateRange, setDateRange, compareOn, setCompareOn, view,
    analystNames, analysts,
    // db / snapshot
    dbReady, snapshotMs,
    // print
    printMode, setPrintMode, printMenuOpen, setPrintMenuOpen, triggerPrint,
    // jira
    jiraState, syncJira, hydrateFromCache,
    // derived data
    enriched, enrichedAnalyst, enrichedAll, enrichedAllJoined,
    compareWindow, compareEnriched,
    kpis, compareKpis,
    teamMembers, teamMembersAll, compareTeamKpis,
    priorityData, categoryData, accountData, productData,
    // ai
    aiState, runAiAnalysis, memberAi, runMemberAi,
    drillIntoMember,
  }
}
