// Aggregation helpers for the Jira Statistics page. Pure functions, no React,
// no network. Complements jira-enrich.js (issue shape + the single-issue
// metrics) with page-level rollups, including the cross-source "blast radius"
// join that counts ServiceNow cases per Jira key.
//
// The SN->Jira link is NOT a queryable DuckDB column — it's parsed in JS by
// enrich.js (parseJiraRefs) into row._jiraTickets[{ id, ... }]. So the join
// here iterates enriched SN rows in memory rather than running SQL.

const DAY = 864e5
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const startOfDay = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const startOfMonday = (d) => {
  const x = startOfDay(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Mon=0 … Sun=6
  return x
}

const percentile = (sorted, p) => {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

/* ------------------------------- volume ---------------------------------- */

/** Issues whose `field` date falls within the last `days` days. */
export function createdWithin(issues, days, field = "created") {
  const cutoff = Date.now() - days * DAY
  return issues.filter((i) => i[field] && i[field].getTime() >= cutoff)
}

/**
 * Daily creation counts for the last `days` days (oldest → newest), each with a
 * trailing 7-day rolling average so the bar chart can carry a smoothing line.
 * Always returns exactly `days` entries so empty days render as zero bars.
 */
export function dailyCreation(issues, days = 90) {
  const today = startOfDay(new Date()).getTime()
  const first = today - (days - 1) * DAY
  const buckets = []
  for (let i = 0; i < days; i++) buckets.push({ date: first + i * DAY, created: 0 })
  for (const it of issues) {
    if (!it.created) continue
    const d = startOfDay(it.created).getTime()
    if (d < first || d > today) continue
    buckets[Math.round((d - first) / DAY)].created++
  }
  // trailing 7-day rolling average
  for (let i = 0; i < buckets.length; i++) {
    let sum = 0, n = 0
    for (let j = Math.max(0, i - 6); j <= i; j++) { sum += buckets[j].created; n++ }
    buckets[i].rolling7 = Math.round((sum / n) * 10) / 10
  }
  return buckets
}

/**
 * Weekly created vs resolved for the last `weeks` Monday-anchored weeks, with a
 * per-week net (created − resolved). Exactly `weeks` entries, oldest → newest.
 */
export function weeklyCreatedResolved(issues, weeks = 12) {
  const thisMonday = startOfMonday(new Date())
  const buckets = []
  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(thisMonday)
    w.setDate(w.getDate() - i * 7)
    buckets.push({ week: w.getTime(), created: 0, resolved: 0, net: 0 })
  }
  const first = buckets[0].week
  const idxFor = (date) => {
    const wk = startOfMonday(date).getTime()
    if (wk < first) return -1
    const idx = Math.round((wk - first) / (7 * DAY))
    return idx < buckets.length ? idx : -1
  }
  for (const it of issues) {
    if (it.created) { const i = idxFor(it.created); if (i >= 0) buckets[i].created++ }
    if (it.resolved) { const i = idxFor(it.resolved); if (i >= 0) buckets[i].resolved++ }
  }
  for (const b of buckets) b.net = b.created - b.resolved
  return buckets
}

/** Count of issues created on each weekday (Mon → Sun). */
export function weekdayCounts(issues, field = "created") {
  const counts = WEEKDAY_LABELS.map((name) => ({ name, count: 0 }))
  for (const it of issues) {
    if (!it[field]) continue
    const idx = (it[field].getDay() + 6) % 7 // Mon=0
    counts[idx].count++
  }
  return counts
}

/* ----------------------------- lifecycle --------------------------------- */

/**
 * Resolution-time (lead time, ms) percentiles per priority for issues resolved
 * within the last `days` days. → [{ priority, p50, p90, max, n }] sorted by n.
 */
export function resolutionStatsByPriority(issues, days = 90) {
  const cutoff = Date.now() - days * DAY
  const byPriority = new Map()
  for (const it of issues) {
    if (!it.resolved || it.resolved.getTime() < cutoff || it._leadMs == null) continue
    const p = it.priority || "None"
    if (!byPriority.has(p)) byPriority.set(p, [])
    byPriority.get(p).push(it._leadMs)
  }
  return [...byPriority.entries()]
    .map(([priority, vals]) => {
      const sorted = vals.sort((a, b) => a - b)
      return { priority, p50: percentile(sorted, 50), p90: percentile(sorted, 90), max: sorted[sorted.length - 1], n: sorted.length }
    })
    .sort((a, b) => b.n - a.n)
}

/* --------------------------- cross-source join --------------------------- */

/**
 * Blast radius: for every Jira key referenced by a ServiceNow case, count how
 * many cases reference it and how many of those are still open. Merges live
 * Jira display fields by key when available.
 *
 * @param {object[]} rows  enriched SN rows (enrichedAll / enrichedAllJoined)
 * @param {Map<string,object>} jiraIssueMap  key → enrichIssue() output
 * @returns rows sorted by open count desc → [{
 *   key, openCount, totalCount, issue, summary, issueType, priority, status,
 *   statusCategory, fixVersions, url, updated, daysSinceUpdate, hasLive }]
 */
export function blastRadius(rows, jiraIssueMap) {
  const now = Date.now()
  const counts = new Map()
  for (const r of rows || []) {
    const seen = new Set() // a case counts once per distinct key
    for (const t of r._jiraTickets || []) {
      // Free-text mentions are not blockers — a prose name-drop must not count
      // the case as "blocked by" the ticket in the impact rankings.
      if (t.source === 'mention') continue
      if (!t.id || seen.has(t.id)) continue
      seen.add(t.id)
      const e = counts.get(t.id) || { total: 0, open: 0, cases: [] }
      e.total++
      if (!r._isClosed) e.open++
      e.cases.push({
        number: r.number || "",
        isClosed: !!r._isClosed,
        account: r.account || "",
        shortDescription: r.short_description || "",
        daysOpen: r._created ? Math.floor((now - r._created.getTime()) / DAY) : null,
      })
      counts.set(t.id, e)
    }
  }
  return [...counts.entries()]
    .map(([key, c]) => {
      const issue = jiraIssueMap?.get(key) || null
      const updated = issue?.updated || null
      // Open cases first (the actionable ones), then by case number.
      const cases = c.cases.sort((a, b) =>
        a.isClosed !== b.isClosed ? (a.isClosed ? 1 : -1) : String(a.number).localeCompare(String(b.number)),
      )
      return {
        key,
        openCount: c.open,
        totalCount: c.total,
        cases,
        issue,
        summary: issue?.summary || "",
        issueType: issue?.issueType || "—",
        priority: issue?.priority || null,
        status: issue?.status || "—",
        statusCategory: issue?.statusCategory || null,
        fixVersions: issue?.fixVersions || [],
        url: issue?.url || null,
        updated,
        daysSinceUpdate: updated ? Math.floor((now - updated.getTime()) / DAY) : null,
        hasLive: !!issue,
      }
    })
    .sort((a, b) => b.openCount - a.openCount || b.totalCount - a.totalCount)
}

/** Headline numbers for the blast-radius summary band. `staleDays` flags
 *  high-impact tickets that have also gone quiet. */
export function blastRadiusSummary(blast, staleDays = 30) {
  let openCases = 0
  let jiraWithOpen = 0
  let staleImpact = 0
  for (const b of blast) {
    if (b.openCount > 0) {
      openCases += b.openCount
      jiraWithOpen++
      if (b.daysSinceUpdate != null && b.daysSinceUpdate >= staleDays) staleImpact++
    }
  }
  return { openCases, jiraWithOpen, staleImpact }
}

/** Histogram of open-cases-per-Jira so users see whether pain is concentrated
 *  or spread. Buckets: 1, 2, 3, 4, 5+. Only tickets with ≥1 open case. */
export function openCasesHistogram(blast) {
  const buckets = [
    { name: "1", min: 1, max: 1, count: 0 },
    { name: "2", min: 2, max: 2, count: 0 },
    { name: "3", min: 3, max: 3, count: 0 },
    { name: "4", min: 4, max: 4, count: 0 },
    { name: "5+", min: 5, max: Infinity, count: 0 },
  ]
  for (const b of blast) {
    if (b.openCount < 1) continue
    const bucket = buckets.find((x) => b.openCount >= x.min && b.openCount <= x.max)
    if (bucket) bucket.count++
  }
  return buckets.map(({ name, count }) => ({ name, count }))
}

/**
 * Stale Jiras that still have open SN cases — the actionable subset of blast
 * radius (trigger is staleness, not raw volume). Oldest-updated first.
 */
export function staleWithImpact(blast, staleDays = 30, limit = 10) {
  return blast
    .filter((b) => b.openCount > 0 && b.daysSinceUpdate != null && b.daysSinceUpdate >= staleDays)
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, limit)
}

/**
 * Upcoming fix-version pipeline: per fix version, ticket count and the summed
 * open-case impact across its tickets. Open (non-Done) tickets only.
 * → [{ version, ticketCount, openCaseImpact }] sorted by impact desc.
 */
export function fixVersionPipeline(issues, blast) {
  const openByKey = new Map(blast.map((b) => [b.key, b.openCount]))
  const byVersion = new Map()
  for (const it of issues) {
    if (it.statusCategory === "Done") continue
    for (const v of it.fixVersions || []) {
      if (!byVersion.has(v)) byVersion.set(v, { version: v, ticketCount: 0, openCaseImpact: 0, issues: [] })
      const e = byVersion.get(v)
      const openCount = openByKey.get(it.key) || 0
      e.ticketCount++
      e.openCaseImpact += openCount
      e.issues.push({
        key: it.key,
        summary: it.summary,
        status: it.status,
        priority: it.priority,
        url: it.url,
        openCount,
      })
    }
  }
  for (const e of byVersion.values()) {
    // Most customer-impactful tickets first within each release.
    e.issues.sort((a, b) => b.openCount - a.openCount || a.key.localeCompare(b.key))
  }
  return [...byVersion.values()].sort((a, b) => b.openCaseImpact - a.openCaseImpact || b.ticketCount - a.ticketCount)
}
