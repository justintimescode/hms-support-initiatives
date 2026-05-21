// All app-wide state, derived memos, and ingest/sync handlers live here so
// AppLayout can own them once and expose to every route via Outlet context.
// Lifted verbatim from KpiAnalyzer.jsx during the navigation refactor — no
// behavior change to the data or chart pipelines.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react"
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
  filterRowsByDate, previousWindow,
} from "./stats.js"
import { useFilters } from "./useFilters.js"

void PROJECT_KEY // kept in scope; used downstream by Jira sync error paths

export function useAppData() {
  const [rows, setRows] = useState(null)
  const [filename, setFilename] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState("")
  const [aiState, setAiState] = useState({ loading: false, result: null, error: null })
  const [memberAi, setMemberAi] = useState({})

  // Stable name list for the opaque-token resolver in useFilters.
  const analystNames = useMemo(() => {
    if (!rows) return []
    const set = new Set()
    for (const r of rows) set.add(r.assigned_to || "Unassigned")
    return [...set]
  }, [rows])

  const { analyst, setAnalyst, dateRange, setDateRange, compareOn, setCompareOn } =
    useFilters({ analystNames })

  // team flavor when no analyst selected.
  const view = analyst === "__all__" ? "team" : "individual"

  const [dbReady, setDbReady] = useState(false)
  const [snapshotMs, setSnapshotMs] = useState(null)
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

  // On mount: probe OPFS for prior data.
  React.useEffect(() => {
    let cancelled = false
    dbClient
      .getStatus()
      .then((s) => {
        if (cancelled) return
        if (s?.hasData) setDbReady(true)
        if (s?.loadedAt) setSnapshotMs(Number(s.loadedAt))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

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

  /* ---------- ingest ---------- */
  const handleFile = async (file) => {
    setUploading(true)
    setUploadError("")
    try {
      const ext = file.name.split(".").pop().toLowerCase()
      let data = []
      if (ext === "csv") {
        const text = await file.text()
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false })
        data = parsed.data
      } else if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx")
        const buffer = await file.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: "array" })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false })
        data = raw.map(normalizeXlsxRow)
      } else {
        throw new Error("Please upload a CSV or Excel (.xlsx) file.")
      }
      if (!data.length) throw new Error("No rows found in the file.")
      const normalized = data.map((r) => {
        const o = {}
        for (const k of Object.keys(r)) o[String(k).trim()] = r[k]
        return o
      })
      setRows(normalized)
      setFilename(file.name)
      setAnalyst("__all__")
      setDateRange({ from: null, to: null, field: "_created" })
      setCompareOn(false)
      setAiState({ loading: false, result: null, error: null })
      setMemberAi({})
      setDbReady(false)
      setSnapshotMs(null)
      const dbPromise = ext === "csv"
        ? dbClient.loadCsv(file)
        : dbClient.loadRows(normalized, { filename: file.name })
      dbPromise
        .then((status) => {
          setDbReady(true)
          if (status?.loadedAt) setSnapshotMs(Number(status.loadedAt))
        })
        .catch((err) => console.error("[db] load failed", err))
    } catch (e) {
      setUploadError(e.message || "Could not parse file.")
    } finally {
      setUploading(false)
    }
  }

  const reset = () => {
    setRows(null)
    setFilename("")
    setAnalyst("__all__")
    setDateRange({ from: null, to: null, field: "_created" })
    setCompareOn(false)
    setAiState({ loading: false, result: null, error: null })
    setMemberAi({})
    setDbReady(false)
    setSnapshotMs(null)
    dbClient.clearDatabase().catch((err) => console.error("[db] clear failed", err))
    if (inputRef.current) inputRef.current.value = ""
  }

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
    const prompt = `You are analyzing ServiceNow support cases for a Product Support Analyst working on Infor HMS and Epitome PMS for DoD lodging properties.

Scope: ${label}. Total cases in view: ${rowsIn.length}. SLA compliance in view: ${localKpis.slaRate != null ? localKpis.slaRate.toFixed(1) + "%" : "n/a"}. Categories detected: ${cats.map((c) => c.name + "(" + c.count + ")").join(", ")}.

Here is a sample of up to 50 cases as JSON:
${JSON.stringify(sample, null, 2)}

Respond ONLY with a JSON object, no markdown fences, with these keys:
{
  "themes": [ { "title": "short theme name", "description": "1-2 sentence explanation grounded in the data" } ],
  "recurring_issues": [ { "issue": "specific recurring issue", "evidence": "what in the data shows this" } ],
  "skill_opportunities": [ { "area": "skill area", "why": "why this would help based on the cases" } ],
  "kb_gaps": [ { "gap": "potential knowledge base gap", "why": "evidence from the cases" } ],
  "watch_outs": [ "short string of a risk or anti-pattern to watch" ]
}

Be specific, reference real patterns (e.g., night audit issues, CRS sync) rather than generic advice. Keep each array to 3-5 items max.`

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    })
    const data = await res.json()
    const text = (data.content || [])
      .map((i) => (i.type === "text" ? i.text : ""))
      .join("")
      .trim()
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim()
    return JSON.parse(clean)
  }

  const runAiAnalysis = async () => {
    setAiState({ loading: true, result: null, error: null })
    try {
      const label = analyst === "__all__" ? "all analysts" : analyst
      const parsed = await analyzeCases(enriched, label)
      setAiState({ loading: false, result: parsed, error: null })
    } catch (e) {
      setAiState({ loading: false, result: null, error: e.message || "AI analysis failed." })
    }
  }

  const runMemberAi = async (member) => {
    setMemberAi((s) => ({ ...s, [member.name]: { loading: true, result: null, error: null } }))
    try {
      const parsed = await analyzeCases(member.rows, member.name)
      setMemberAi((s) => ({ ...s, [member.name]: { loading: false, result: parsed, error: null } }))
    } catch (e) {
      setMemberAi((s) => ({ ...s, [member.name]: { loading: false, result: null, error: e.message || "AI analysis failed." } }))
    }
  }

  const drillIntoMember = (name) => {
    setAnalyst(name)
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return {
    // raw + ingest
    rows, filename, uploading, uploadError, inputRef,
    handleFile, reset,
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
