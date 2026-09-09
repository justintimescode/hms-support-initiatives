// Aggregation helpers for the Jira Statistics page. Pure functions, no React,
// no network. Complements jira-enrich.js (issue shape + the single-issue
// metrics) with page-level rollups.
//
// The SN->Jira link is NOT a queryable DuckDB column — it's parsed in JS by
// enrich.js (parseJiraRefs) into row._jiraTickets[{ id, ... }], so the join runs
// over enriched SN rows in memory rather than in SQL.
//
// `blastRadius` USED TO BE that join, implemented here. It is now a thin
// PROJECTION over the shared correlation engine (correlate.js + insight-*.js) —
// see the note on the function. The impact ranking that JiraDashboard used to
// compute with its own private formula now comes from the same engine, so the
// Blockers page and the Jira Statistics page can no longer disagree.

import { percentile } from "./stats.js"
import { buildInsights, blockersByJira } from "./insight-rank.js"

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
 * Blast radius: for every Jira key referenced by a ServiceNow case, how many
 * cases reference it and how many of those are still open.
 *
 * NOW A PROJECTION, not an implementation. The per-key grouping, the
 * mention-exclusion rule, the live-issue join and the ranking all live in the
 * shared engine (`buildInsights` -> `blockersByJira`); this function reshapes one
 * `blockersByJira` row into the exact legacy field names so
 * `blastRadiusSummary`, `openCasesHistogram`, `staleWithImpact` and
 * `fixVersionPipeline` keep working untouched.
 *
 * Three deliberate changes from the hand-rolled version it replaces:
 *
 *  1. SNAPSHOT-ANCHORED. `daysOpen` and `daysSinceUpdate` are measured against
 *     the import's upload time, not the wall clock, so a given import always
 *     renders identically. Both were `Date.now()`-based before, and
 *     `daysSinceUpdate` additionally trusted `enrichIssue`'s cached age
 *     (CODEREVIEW(5-31).md P1 #5).
 *  2. NORMALIZED JOIN KEYS on both sides (P1 #2).
 *  3. A STABLE TIEBREAK. The old sort was `openCount desc, totalCount desc` with
 *     no final tiebreak, so tied rows fell back to Map insertion order — i.e.
 *     row order. Ties now break on `key`, which is what makes a screenshot or a
 *     CSV export reproducible. Tied rows may therefore appear in a different
 *     order than before; no count changes.
 *
 * @param {object[]} rows  enriched SN rows (enrichedAll / enrichedAllJoined)
 * @param {Map<string,object>|object[]} issues  enriched Jira issues, or the
 *   `jiraIssueMap` keyed by raw `issue.key` (re-keyed normalized internally)
 * @param {number|null} snapshotMs  the active import's upload time
 * @returns rows sorted by open count desc → [{
 *   key, openCount, totalCount, cases, issue, summary, issueType, priority,
 *   status, statusCategory, fixVersions, url, updated, daysSinceUpdate, hasLive,
 *   score, factors, band, clusterId, isAtlassian, aliasedFrom }]
 */
export function blastRadius(rows, issues, snapshotMs) {
  const { clusters } = buildInsights(rows, issues, snapshotMs)
  return blockersByJira(clusters, snapshotMs)
    .map((b) => {
      const j = b.jira
      return {
        key: b.key,
        openCount: b.metrics.volume.openCases,
        totalCount: b.metrics.volume.totalCases,
        // Open cases first (the actionable ones), then by case number — the
        // legacy order, preserved.
        cases: b.cases
          .map((c) => ({
            number: c.number || "",
            isClosed: c.isClosed,
            account: c.account || "",
            shortDescription: c.shortDescription || "",
            daysOpen: c.ageDays,
          }))
          .sort((x, y) =>
            x.isClosed !== y.isClosed
              ? (x.isClosed ? 1 : -1)
              : String(x.number).localeCompare(String(y.number)),
          ),
        issue: j.issue,
        summary: j.summary || "",
        issueType: j.issueType || "—",
        priority: j.priority || null,
        status: j.status || "—",
        statusCategory: j.statusCategory || null,
        fixVersions: j.fixVersions || [],
        url: j.url || null,
        updated: j.updated || null,
        daysSinceUpdate: j.daysSinceUpdate,
        hasLive: j.hasLive,
        // Additive: the shared explainable score, so this table and the Blockers
        // panel rank by the same numbers.
        score: b.score,
        factors: b.factors,
        band: b.band,
        clusterId: b.clusterId,
        isAtlassian: j.isAtlassian,
        // The `RN-` refs that resolved onto this key — display-only provenance,
        // so the ref an analyst read in the work notes is still findable now that
        // it no longer has a row of its own. See `buildAliasMap`.
        aliasedFrom: j.aliasedFrom,
      }
    })
    .sort(
      (a, b) =>
        b.openCount - a.openCount ||
        b.totalCount - a.totalCount ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
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
