// All app-wide state, derived memos, and ingest/sync handlers live here so
// AppLayout can own them once and expose to every route via Outlet context.
// Lifted verbatim from KpiAnalyzer.jsx during the navigation refactor — no
// behavior change to the data or chart pipelines.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import Papa from "papaparse"
import { enrichRow, priorityRank, normalizeXlsxRow } from "./enrich.js"
import { safeRandomUUID } from "./uuid.js"
import { dbClient } from "./db-client.js"
import {
  pingJira, fetchHmsProject, loadCache, saveCache, mergeIssues, pruneIssues,
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
  storeImportBlob, storeImportMeta, readImportBlob, readImportMeta,
  deleteImportFiles, listImportDirectories, getTotalStorageBytes,
  ensurePersistentStorage,
} from "./imports-store.js"
import {
  listDiskMetas, writeDiskBlob, writeDiskMeta, readDiskBlob,
  deleteDiskImport, clearDiskCache,
} from "./imports-cache.js"
import { SCHEMA_VERSION } from "./enrich.js"
import { getAutoDelete, getDiskBackup, getJiraAutoSync, setJiraAutoSync } from "./settings.js"
import { getJiraCredsStatus } from "./jira-creds.js"

// Background Jira refresh tuning (see the scheduler effect in useAppData below).
const JIRA_OVERLAP_MIN = 5                        // widen each delta window for clock skew
const JIRA_FOCUS_MIN_AGE_MS = 2 * 60_000          // skip focus refetches this fresh
const JIRA_RECONCILE_AGE_MS = 24 * 60 * 60_000    // once a day stale, do a full reconcile

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

  const { analyst, setAnalyst, dateRange, setDateRange, compareOn, setCompareOn, buildFilterSearch } =
    useFilters({ analystNames })
  const navigate = useNavigate()

  // team flavor when no analyst selected.
  const view = analyst === "__all__" ? "team" : "individual"

  const [dbReady, setDbReady] = useState(false)
  // Whether imports actually survive a reload. null until the worker reports.
  const [persistence, setPersistence] = useState(null)
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
  // Separate autoSyncing flag so background sync updates don't cascade through
  // data-dependent pages (just UI feedback in FreshnessIndicator).
  const [jiraAutoSyncing, setJiraAutoSyncing] = useState(false)
  // Background-sync plumbing: a lock so manual + scheduled syncs never overlap,
  // a ref mirror of jiraState the scheduler reads without re-arming its timer,
  // and the auto-sync preference as live state (so the toggle re-wires the
  // interval without a reload).
  const syncLockRef = useRef(false)
  const jiraStateRef = useRef(jiraState)
  const [jiraAutoSync, setJiraAutoSyncState] = useState(getJiraAutoSync)
  // Whether Jira credentials exist at all (Jira is optional — see
  // jira-creds.js). `null` until the first probe resolves.
  const [jiraCreds, setJiraCreds] = useState(null)
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
  //
  // Source-agnostic: `readBlob(meta)` supplies the raw file, so the same loop
  // rebuilds the index from the on-disk mirror OR from the OPFS blobs. The two
  // differ only in where the bytes come from and whether OPFS needs writing.
  const restoreImports = useCallback(async (metas, { readBlob, tag, mirrorToOpfs }, isCancelled) => {
    setRestoringCount(metas.length)
    const sorted = [...metas].sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0))
    let remaining = sorted.length
    let lastActiveUuid = null
    for (const meta of sorted) {
      if (isCancelled()) break
      try {
        const file = await readBlob(meta)
        if (!file) { console.warn(`[${tag}] no blob for ${meta.uuid} — skipping`); continue }
        const ext = (meta.fileType || file.name.split(".").pop() || "csv").toLowerCase()
        const rows = await parseFileToRows(file, ext)
        const { activeUuid: au } = await dbClient.createImport({
          uuid: meta.uuid,
          filename: meta.filename,
          displayName: meta.displayName || meta.filename,
          fileSize: meta.fileSize || file.size,
          fileType: ext,
          rows,
          // Preserve the original upload time — otherwise the worker re-stamps
          // it with the current (reboot) time.
          uploadedAt: meta.uploadedAt,
        })
        if (mirrorToOpfs) {
          // Mirror to OPFS for fast subsequent reloads (re-parse from blob, then
          // OPFS path takes over). Best-effort; failure here doesn't abort.
          await storeImportBlob(meta.uuid, file, ext).catch(() => {})
          await storeImportMeta(meta.uuid, { ...meta, fileType: ext }).catch(() => {})
        }
        rowsCache.current.set(meta.uuid, rows)
        lastActiveUuid = au
        if (!isCancelled()) setImports(await dbClient.listImports().then((r) => r.imports))
      } catch (err) {
        console.warn(`[${tag}] restore failed for ${meta.uuid} —`, err?.message || err)
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
  }, [])

  const restoreFromDisk = useCallback((diskMetas, isCancelled) => (
    restoreImports(
      diskMetas,
      { readBlob: (m) => readDiskBlob(m.uuid, m.filename), tag: "sn-cache", mirrorToOpfs: true },
      isCancelled,
    )
  ), [restoreImports])

  // Rebuild the index straight from the OPFS blobs. This is the recovery path
  // for imports whose index row was lost while their source file survived —
  // which is what a non-persistent DuckDB leaves behind. Without it those blobs
  // are invisible in the UI yet still counted in "storage used", and the only
  // way to reclaim them is a clear-all that no longer knows they exist.
  //
  // meta.json is written next to every blob (storeImportMeta), so the display
  // name and original upload time survive; a missing/corrupt meta degrades to
  // the file's own name and an unknown upload time rather than skipping.
  const restoreFromOpfs = useCallback(async (uuids, isCancelled) => {
    const metas = []
    for (const uuid of uuids) {
      const meta = await readImportMeta(uuid)
      metas.push(meta?.uuid ? meta : { uuid, filename: null, uploadedAt: 0 })
    }
    return restoreImports(
      metas,
      {
        readBlob: async (m) => {
          const file = await readImportBlob(m.uuid)
          if (file && !m.filename) m.filename = file.name
          return file
        },
        tag: "opfs-restore",
        mirrorToOpfs: false,
      },
      isCancelled,
    )
  }, [restoreImports])

  // On mount: boot the worker, load the imports list, activate + rehydrate the
  // active import's rows (this also fixes the old reload-loses-charts bug).
  React.useEffect(() => {
    let cancelled = false
    // Request persistent storage BEFORE the worker opens OPFS. The import source
    // blobs are the only durable copy of an import, so an evictable bucket means
    // the browser can silently drop every import while the tab sits idle.
    const persistPromise = ensurePersistentStorage()
    dbClient
      .init()
      .then(async ({ imports: list, activeUuid, opfsAvailable, usingOpfs, dbDurable }) => {
        if (cancelled) return
        const storagePersisted = await persistPromise
        if (cancelled) return
        if (storagePersisted === false) {
          console.warn(
            "[storage] persistent storage denied — the browser may evict stored imports. " +
              "Enable \"Back up imports to disk\" in Settings for a second copy.",
          )
        }
        const pruned = await enforceAutoDelete(list || [], activeUuid)
        if (cancelled) return
        setDbReady(true)
        // Surface non-persistent storage instead of letting it fail silently:
        // without this the app looks completely normal until a reload wipes
        // every import (see the durability check in db.worker.js init).
        setPersistence({
          opfsAvailable: !!opfsAvailable,
          usingOpfs: !!usingOpfs,
          dbDurable: !!dbDurable,
          // true | false | null (API absent). false = the bucket is evictable.
          storagePersisted,
          diskBackup: getDiskBackup(),
        })

        // Cold boot: the DuckDB index is empty. Two recovery sources, in order
        // of fidelity — the disk mirror (full meta, survives a browser wipe),
        // then the OPFS blobs (survive anything short of clearing site data,
        // and are what's left when the index itself failed to persist).
        if (pruned.length === 0) {
          const diskMetas = await listDiskMetas()
          if (!cancelled && diskMetas.length) {
            await restoreFromDisk(diskMetas, () => cancelled)
            if (!cancelled) refreshStorage()
            return
          }
          const opfsUuids = await listImportDirectories()
          if (!cancelled && opfsUuids.length) {
            console.info(`[opfs-restore] index empty, ${opfsUuids.length} import blob(s) in OPFS — rebuilding`)
            await restoreFromOpfs(opfsUuids, () => cancelled)
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
  }, [loadActiveRows, refreshStorage, restoreFromDisk, restoreFromOpfs])

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

  // Core sync runner shared by the manual buttons and the background scheduler.
  // `since` = day window (buttons); `sinceExpr` = a relative token like "-20m"
  // (background delta). With neither it's a full-project pull. `background: true`
  // keeps the UI on cached data — no loading/error flip — and only toggles the
  // `autoSyncing` flag; a background failure just logs and retries next tick.
  const runJiraSync = useCallback(async ({ since, sinceExpr, background = false } = {}) => {
    if (syncLockRef.current) return          // a manual or scheduled sync is already in flight
    syncLockRef.current = true
    if (background) setJiraAutoSyncing(true)
    else setJiraState((s) => ({ ...s, status: "loading", error: null, progress: null }))
    try {
      const reachable = await pingJira()
      if (!reachable) {
        // A background blip shouldn't wipe the connected UI — only a foreground
        // sync downgrades to "unconfigured"; the scheduler just skips this tick.
        if (!background) setJiraState((s) => ({ ...s, status: "unconfigured", error: null }))
        return
      }
      const { issues: rawIssues, fetchedAt, fieldMap, statusMap, project } = await fetchHmsProject({
        since,
        sinceExpr,
        onProgress: background ? undefined : (info) => setJiraState((s) => ({ ...s, progress: info })),
      })
      // Any partial window (day-window OR delta expr) merges onto the cache so
      // recent issues the narrow query missed aren't dropped; a full pull
      // replaces. Either way the result is pruned to the retention window, so
      // merges can only ever add issues inside it — that's what keeps the cache
      // from creeping back to a year of data one delta at a time.
      let mergedRaw = rawIssues
      if (since != null || sinceExpr != null) {
        const cached = await loadCache({ compact: false })
        if (cached?.issues) mergedRaw = mergeIssues(cached.issues, rawIssues)
      }
      mergedRaw = pruneIssues(mergedRaw)
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
      if (background) setJiraAutoSyncing(false)
    } catch (err) {
      if (err instanceof JiraError && err.status === 401) {
        // 401 means bad/revoked creds — definitive, so surface it either way.
        setJiraState((s) => ({ ...s, status: "unconfigured", error: null }))
      } else if (background) {
        console.warn("[jira] background sync failed —", err?.message || err)
      }
      if (background) setJiraAutoSyncing(false)
    } finally {
      syncLockRef.current = false
    }
  }, [])

  const syncJira = useCallback((mode = "full") => {
    // Day-window modes pull a partial slice and merge onto the cache so older
    // issues aren't dropped. "full" (no window) pulls the whole project.
    const SYNC_WINDOWS = { "24h": 1, "5d": 5, "14d": 14, recent: 14, "30d": 30 }
    return runJiraSync({ since: SYNC_WINDOWS[mode], background: false })
  }, [runJiraSync])

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

  // Credential probe. Cheap (a local status read — never returns the token) and
  // re-run whenever Settings saves or clears, so every Jira surface can say
  // "not connected" vs "connect in Settings" accurately.
  const refreshJiraCreds = useCallback(async () => {
    const status = await getJiraCredsStatus()
    setJiraCreds(status)
    return status
  }, [])

  React.useEffect(() => { void refreshJiraCreds() }, [refreshJiraCreds])

  // Called by Settings after credentials change. Re-probes, then moves Jira out
  // of "unconfigured" so a newly-connected user can sync immediately (and back
  // into it on disconnect) without reloading the app.
  const onJiraCredsChanged = useCallback(async () => {
    const status = await refreshJiraCreds()
    setJiraState((s) => {
      if (status.configured) {
        return s.status === "unconfigured" ? { ...s, status: "idle", error: null } : s
      }
      // Disconnected: cached issues are stale-but-real, so a ready state stays.
      return s.status === "ready" ? s : { ...s, status: "unconfigured", error: null }
    })
    return status
  }, [refreshJiraCreds])

  // Persist + surface the auto-sync preference; updating state re-arms the
  // scheduler effect below without a reload.
  const setJiraAutoSyncPref = useCallback((next) => {
    setJiraAutoSyncState((prev) => {
      const merged = { ...prev, ...next }
      setJiraAutoSync(merged)
      return merged
    })
  }, [])

  // Mirror jiraState into a ref so the scheduler can read the latest status /
  // fetchedAt without listing jiraState as an effect dependency (which would
  // tear down and re-arm the interval on every sync).
  useEffect(() => { jiraStateRef.current = jiraState }, [jiraState])

  // Decide whether a background refresh is due and run the cheapest one that
  // covers the gap: a "since last sync" delta normally, or a full reconcile
  // once the cache is a day stale (to catch deletions/moves a delta can't see).
  const maybeAutoSync = useCallback(() => {
    if (syncLockRef.current) return
    const st = jiraStateRef.current
    // Baseline required: only auto-refresh once a prior sync populated the cache.
    if (st.status !== "ready" || !st.meta?.fetchedAt) return
    const age = Date.now() - st.meta.fetchedAt
    if (age < JIRA_FOCUS_MIN_AGE_MS) return          // too fresh — skip focus spam
    if (age > JIRA_RECONCILE_AGE_MS) {
      void runJiraSync({ background: true })          // full reconcile
    } else {
      const minutes = Math.ceil(age / 60_000) + JIRA_OVERLAP_MIN
      void runJiraSync({ sinceExpr: `-${minutes}m`, background: true })
    }
  }, [runJiraSync])

  // Arm the scheduler while auto-sync is enabled: a periodic delta poll plus a
  // refresh whenever the window regains focus / becomes visible. Re-runs (and
  // re-arms) when the preference changes.
  useEffect(() => {
    if (!jiraAutoSync.enabled) return undefined
    const id = setInterval(maybeAutoSync, jiraAutoSync.intervalMin * 60_000)
    const onVisible = () => { if (document.visibilityState === "visible") maybeAutoSync() }
    window.addEventListener("focus", maybeAutoSync)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener("focus", maybeAutoSync)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [jiraAutoSync, maybeAutoSync])

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

      uuid = safeRandomUUID()
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
    // Sweep every OPFS import directory, not just the ones in the index.
    // "Storage used" counts all of them (getTotalStorageBytes walks the whole
    // imports/ tree), so clearing only indexed uuids left orphans that were
    // charged to the user forever with no way to reclaim them — worst of all
    // when the index was empty, which made this button a silent no-op.
    const indexed = imports.map((i) => i.uuid)
    const onDisk = await listImportDirectories().catch(() => [])
    const all = [...new Set([...indexed, ...onDisk])]
    const orphans = all.length - indexed.length
    if (orphans > 0) console.info(`[opfs] clearing ${orphans} orphaned import dir(s) not in the index`)
    await dbClient.clearAllImports()
    await Promise.all([
      ...all.map((u) => deleteImportFiles(u).catch(() => {})),
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

  // Pass the active import's upload time as the SOP-SLA snapshot anchor so the
  // in-memory pipeline bakes the same cadence-breach verdict as the SQL worker.
  const enrichedAll = useMemo(
    () => (rows ? rows.map((r) => enrichRow(r, snapshotMs ?? undefined)) : []),
    [rows, snapshotMs],
  )

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
      if (r._slaEligible) {
        groups[p].sla_total++
        if (!r._slaBreached) groups[p].sla_met++
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

  // Uncapped variant of `accountData` (no top-30 slice) for the standalone
  // Accounts & Products page, which lists every serviced account in a scrollable
  // panel. Same analyst/date filtering as `accountData`; only the cap differs.
  const accountDataAll = useMemo(() => {
    const groups = {}
    for (const r of enriched) {
      const a = r.account || "Unknown"
      groups[a] = (groups[a] || 0) + 1
    }
    return Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
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
      // SOP-cadence SLA outcome (null when the case has no defined cadence).
      sla_met: r._slaEligible ? !r._slaBreached : null,
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
    // Set the analyst and land on the dashboard in one atomic navigation:
    // bake the analyst into the search string up front rather than calling
    // setAnalyst() then navigate() (which would race — the navigate would
    // read the pre-update search and drop the just-selected analyst).
    navigate({ pathname: "/", search: buildFilterSearch({ analyst: name }) })
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
    dbReady, snapshotMs, persistence,
    // print
    printMode, setPrintMode, printMenuOpen, setPrintMenuOpen, triggerPrint,
    // jira
    jiraState, jiraAutoSyncing, syncJira, hydrateFromCache, jiraAutoSync, setJiraAutoSyncPref,
    jiraCreds, refreshJiraCreds, onJiraCredsChanged,
    // derived data
    enriched, enrichedAnalyst, enrichedAll, enrichedAllJoined,
    compareWindow, compareEnriched,
    kpis, compareKpis,
    teamMembers, teamMembersAll, compareTeamKpis,
    priorityData, categoryData, accountData, accountDataAll, productData,
    // ai
    aiState, runAiAnalysis, memberAi, runMemberAi,
    drillIntoMember,
  }
}
