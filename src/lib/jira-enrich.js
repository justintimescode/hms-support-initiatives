// Jira issue enrichment — the single source of truth for issue shape and
// derived engineering metrics. Mirrors the role of enrich.js (which does the
// same for ServiceNow cases). Pure functions, no React, no network.
//
// `enrichIssue` output deliberately carries underscore-prefixed ServiceNow-
// style aliases (`_created`, `_closed`, `_isClosed`, `number`, `assigned_to`,
// `short_description`) so the existing Recharts blocks in KpiAnalyzer.jsx
// (TrajectoryBlock, AssigneeAgingBlock, WorkloadDistributionBlock, CaseDrilldown)
// can be reused as-is against Jira data.

import { parseDate, categorize } from './enrich.js'

const DAY = 864e5
const JIRA_BROWSE_URL = 'https://infor.atlassian.net/browse/'
const STALE_DAYS = 30

// Mirrors AGING_BUCKETS in KpiAnalyzer.jsx — keep the thresholds identical so
// the standalone aging chart and the reused AssigneeAgingBlock agree.
export const JIRA_AGING_BUCKETS = [
  { name: '0–7d', min: 0, max: 7 },
  { name: '8–30d', min: 8, max: 30 },
  { name: '31–90d', min: 31, max: 90 },
  { name: '90d+', min: 91, max: Infinity },
]

/* --------------------------- status categories --------------------------- */

/** Resolve a workflow status name to its category. Prefers the live status map
 *  pulled from Jira (`getStatusMap`); falls back to a name heuristic so the
 *  enrich layer still degrades sensibly if the map is unavailable. */
export function categoryOf(statusName, statusMap) {
  if (statusMap && statusMap[statusName]) return statusMap[statusName]
  const n = String(statusName || '').toLowerCase()
  if (/done|closed|resolved|complete|cancel|won.?t fix|released|shipped/.test(n)) return 'Done'
  if (/progress|review|develop|testing|^qa| qa|doing|implement|verif/.test(n)) return 'In Progress'
  return 'To Do'
}

/* ----------------------------- normalization ----------------------------- */

/** Flatten a raw Jira REST issue into a stable, predictable shape. */
export function normalizeIssue(issue, fieldMap) {
  const f = issue.fields || {}

  const spId = fieldMap?.storyPoints
  const spRaw = spId ? f[spId] : null
  const storyPoints = typeof spRaw === 'number' ? spRaw : null

  // The sprint custom field is an array of sprint objects (recent Jira) or
  // "...name=Sprint 5,..." strings (older instances). Take the latest.
  let sprint = null
  const sprintRaw = fieldMap?.sprint ? f[fieldMap.sprint] : null
  if (Array.isArray(sprintRaw) && sprintRaw.length) {
    const last = sprintRaw[sprintRaw.length - 1]
    sprint = typeof last === 'string'
      ? (last.match(/name=([^,]+)/)?.[1] || null)
      : (last?.name || null)
  }

  return {
    key: issue.key,
    url: JIRA_BROWSE_URL + issue.key,
    summary: f.summary || '',
    issueType: f.issuetype?.name || 'Unknown',
    status: f.status?.name || 'Unknown',
    statusCategory: f.status?.statusCategory?.name || 'To Do',
    priority: f.priority?.name || null,
    assignee: f.assignee?.displayName || 'Unassigned',
    components: (f.components || []).map((c) => c.name).filter(Boolean),
    labels: f.labels || [],
    fixVersions: (f.fixVersions || []).map((v) => v.name).filter(Boolean),
    parent: f.parent?.key || null,
    created: parseDate(f.created),
    updated: parseDate(f.updated),
    resolved: parseDate(f.resolutiondate),
    storyPoints,
    sprint,
    changelog: issue.changelog?.histories || [],
  }
}

/* ---------------------------- status history ----------------------------- */

/**
 * Walk the changelog to reconstruct the issue's status timeline.
 * @returns {{
 *   transitions: {from, to, at: Date}[],
 *   timeInStatus: Record<string, number>,   // status name → total ms
 *   firstInProgressAt: Date|null,
 *   doneAt: Date|null,
 * }}
 */
export function parseStatusHistory(issue, statusMap) {
  const f = issue.fields || {}
  const created = parseDate(f.created)
  const histories = issue.changelog?.histories || []

  // Collect status-change items, sorted oldest → newest.
  const raw = []
  for (const h of histories) {
    const at = parseDate(h.created)
    if (!at) continue
    for (const item of h.items || []) {
      if (item.field === 'status') {
        raw.push({ from: item.fromString, to: item.toString, at })
      }
    }
  }
  raw.sort((a, b) => a.at - b.at)

  const currentStatus = f.status?.name || 'Unknown'
  // The status the issue was in before any recorded transition.
  const initialStatus = raw.length ? raw[0].from : currentStatus

  const timeInStatus = {}
  let firstInProgressAt = null
  let doneAt = null

  if (created) {
    // Walk intervals: [prevAt, at) was spent in `prevStatus`.
    let prevAt = created
    let prevStatus = initialStatus
    if (categoryOf(initialStatus, statusMap) === 'In Progress') firstInProgressAt = created

    for (const t of raw) {
      const span = Math.max(0, t.at - prevAt)
      timeInStatus[prevStatus] = (timeInStatus[prevStatus] || 0) + span
      const toCat = categoryOf(t.to, statusMap)
      if (toCat === 'In Progress' && !firstInProgressAt) firstInProgressAt = t.at
      if (toCat === 'Done') doneAt = t.at
      else if (toCat !== 'Done' && doneAt) doneAt = null // re-opened
      prevAt = t.at
      prevStatus = t.to
    }
    // Final open-ended interval runs to resolution (or now).
    const resolved = parseDate(f.resolutiondate)
    const end = resolved || doneAt || new Date()
    timeInStatus[prevStatus] = (timeInStatus[prevStatus] || 0) + Math.max(0, end - prevAt)
  }

  // Fall back to resolutiondate if the changelog never recorded a Done move
  // (e.g. issue closed before changelog history was retained).
  if (!doneAt) {
    const resolved = parseDate(f.resolutiondate)
    if (resolved && categoryOf(currentStatus, statusMap) === 'Done') doneAt = resolved
  }

  return { transitions: raw, timeInStatus, firstInProgressAt, doneAt }
}

/* ------------------------------ enrichment ------------------------------- */

/** Full enrichment for one issue: normalized shape + derived metrics +
 *  ServiceNow-style aliases for component reuse. */
export function enrichIssue(issue, fieldMap, statusMap) {
  const n = normalizeIssue(issue, fieldMap)
  const { transitions, timeInStatus, firstInProgressAt, doneAt } = parseStatusHistory(issue, statusMap)
  const now = Date.now()

  const isOpen = n.statusCategory !== 'Done'
  const ageDays = n.created ? Math.floor((now - n.created.getTime()) / DAY) : null
  const leadMs = n.created ? (n.resolved || new Date(now)) - n.created : null
  const cycleMs = doneAt && firstInProgressAt ? doneAt - firstInProgressAt : null
  const engQueueMs = firstInProgressAt && n.created ? firstInProgressAt - n.created : null
  const isStale = isOpen && n.updated ? (now - n.updated.getTime()) > STALE_DAYS * DAY : false

  return {
    ...n,
    // derived engineering metrics
    _isOpen: isOpen,
    _ageDays: ageDays,
    _ageBucket: ageBucketName(ageDays),
    _leadMs: leadMs,
    _cycleMs: cycleMs,
    _engQueueMs: engQueueMs,
    _isStale: isStale,
    _transitions: transitions,
    _timeInStatus: timeInStatus,
    _firstInProgressAt: firstInProgressAt,
    _doneAt: doneAt,
    _category: categorize(`${n.summary} ${n.labels.join(' ')}`),
    // ServiceNow-style aliases so KpiAnalyzer's existing blocks accept these
    // objects directly (TrajectoryBlock, AssigneeAgingBlock, CaseDrilldown…).
    number: n.key,
    short_description: n.summary,
    assigned_to: n.assignee,
    account: n.components[0] || '—',
    _created: n.created,
    _closed: n.resolved,
    _isClosed: !isOpen,
  }
}

function ageBucketName(days) {
  if (days == null) return null
  const b = JIRA_AGING_BUCKETS.find((x) => days >= x.min && days <= x.max)
  return b ? b.name : null
}

/* --------------------------- aggregate helpers --------------------------- */

const percentile = (sorted, p) => {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

const statOf = (values) => {
  const v = values.filter((x) => x != null && !isNaN(x)).sort((a, b) => a - b)
  if (!v.length) return { median: null, avg: null, p85: null, n: 0 }
  const sum = v.reduce((s, x) => s + x, 0)
  return {
    median: percentile(v, 50),
    avg: sum / v.length,
    p85: percentile(v, 85),
    n: v.length,
  }
}

/** Median / average / p85 for cycle time and lead time, in milliseconds. */
export function cycleLeadStats(issues) {
  return {
    cycle: statOf(issues.map((i) => i._cycleMs)),
    lead: statOf(issues.map((i) => i._leadMs)),
  }
}

/** Open-issue counts per aging bucket → [{ name, count }]. */
export function agingBuckets(issues) {
  const counts = JIRA_AGING_BUCKETS.map((b) => ({ name: b.name, count: 0 }))
  for (const i of issues) {
    if (!i._isOpen || i._ageDays == null) continue
    const idx = JIRA_AGING_BUCKETS.findIndex((b) => i._ageDays >= b.min && i._ageDays <= b.max)
    if (idx >= 0) counts[idx].count++
  }
  return counts
}

/** Group issues by assignee into the `members` shape the team-view blocks
 *  expect: [{ name, rows, kpis: { total, open } }]. Feeds both
 *  AssigneeAgingBlock (uses `rows`) and WorkloadDistributionBlock (uses
 *  `kpis.total`). */
export function assigneeMembers(issues) {
  const byName = new Map()
  for (const i of issues) {
    const name = i.assignee || 'Unassigned'
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(i)
  }
  return [...byName.entries()]
    .map(([name, rows]) => ({
      name,
      rows,
      kpis: { total: rows.length, open: rows.filter((r) => r._isOpen).length },
    }))
    .sort((a, b) => b.kpis.total - a.kpis.total)
}

/** Generic frequency breakdown → [{ name, count }] sorted desc. `pick` returns
 *  a string or an array of strings (labels, components) per issue. */
export function breakdownBy(issues, pick) {
  const counts = new Map()
  for (const i of issues) {
    const v = pick(i)
    const vals = Array.isArray(v) ? v : [v]
    for (const raw of vals) {
      const key = raw || '—'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

export const componentBreakdown = (issues) =>
  breakdownBy(issues, (i) => (i.components.length ? i.components : ['(none)']))
export const labelBreakdown = (issues) =>
  breakdownBy(issues, (i) => (i.labels.length ? i.labels : ['(none)']))
export const statusMix = (issues) => breakdownBy(issues, (i) => i.status)
export const issueTypeMix = (issues) => breakdownBy(issues, (i) => i.issueType)

/** Open issues with no activity in `thresholdDays`, oldest-updated first. */
export function staleIssues(issues, thresholdDays = STALE_DAYS) {
  const cutoff = Date.now() - thresholdDays * DAY
  return issues
    .filter((i) => i._isOpen && i.updated && i.updated.getTime() < cutoff)
    .sort((a, b) => a.updated - b.updated)
}

// Priority names that count as "high priority" for the support-analyst KPIs.
const HIGH_PRIORITY = new Set(['highest', 'high', 'critical', 'blocker', 'urgent'])
export const isHighPriority = (issue) =>
  HIGH_PRIORITY.has(String(issue.priority || '').toLowerCase())

/** Top-line counts for the Jira Analysis KPI strip. */
export function jiraSummary(issues) {
  const now = Date.now()
  const open = issues.filter((i) => i._isOpen)
  const stale = issues.filter((i) => i._isStale)
  const within = (date, days) => date && now - date.getTime() <= days * DAY
  return {
    total: issues.length,
    open: open.length,
    done: issues.length - open.length,
    stale: stale.length,
    created7d: issues.filter((i) => within(i.created, 7)).length,
    created30d: issues.filter((i) => within(i.created, 30)).length,
    resolved7d: issues.filter((i) => within(i.resolved, 7)).length,
    resolved30d: issues.filter((i) => within(i.resolved, 30)).length,
    openHighPriority: open.filter(isHighPriority).length,
    ...cycleLeadStats(issues),
  }
}

/** Most-recently-created issues first. */
export function recentlyCreated(issues, limit = Infinity) {
  return [...issues]
    .filter((i) => i.created)
    .sort((a, b) => b.created - a.created)
    .slice(0, limit)
}

/** Most-recently-resolved issues first (resolved issues only). */
export function recentlyResolved(issues, limit = Infinity) {
  return issues
    .filter((i) => i.resolved)
    .sort((a, b) => b.resolved - a.resolved)
    .slice(0, limit)
}

/** Weekly creation counts for the last `weeks` Monday-anchored weeks, oldest
 *  → newest. Always returns exactly `weeks` entries so empty weeks render as
 *  zero-height bars (gaps would be visually misleading). */
export function weeklyCreated(issues, weeks = 12) {
  const startOfMonday = (d) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Mon=0, Sun=6
    return x
  }
  const thisMonday = startOfMonday(new Date())
  const buckets = []
  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(thisMonday)
    w.setDate(w.getDate() - i * 7)
    buckets.push({ week: w.getTime(), created: 0 })
  }
  const firstWeekTs = buckets[0].week
  for (const it of issues) {
    if (!it.created) continue
    const wk = startOfMonday(it.created).getTime()
    if (wk < firstWeekTs) continue
    const idx = Math.floor((wk - firstWeekTs) / (7 * DAY))
    if (idx >= 0 && idx < buckets.length) buckets[idx].created++
  }
  return buckets
}

/* --------------------------- ServiceNow ↔ Jira --------------------------- */

/**
 * Second enrichment pass: merge live Jira issue data into a ServiceNow row
 * that was already run through `enrichRow`. Runs AFTER enrichRow so enrichRow
 * stays pure/synchronous for the CSV-only flow.
 *
 * No-op (returns the row unchanged) when there is no Jira data — so the
 * CSV-only experience is byte-for-byte unaffected.
 *
 * @param {object} row           an enrichRow() output
 * @param {Map<string,object>} jiraIssueMap  key → enrichIssue() output
 */
export function mergeJiraIntoRows(row, jiraIssueMap) {
  if (!jiraIssueMap || jiraIssueMap.size === 0) return row

  const tickets = (row._jiraTickets || []).map((t) => {
    // RN- refs are ServiceNow-internal, not real Jira tickets.
    if (!t.clickable) return { ...t, jira: null }
    const live = jiraIssueMap.get(t.id)
    if (!live) return { ...t, jira: null }
    return {
      ...t,
      jira: {
        status: live.status,
        statusCategory: live.statusCategory,
        priority: live.priority,
        assignee: live.assignee,
        fixVersions: live.fixVersions,
        resolved: live.resolved,
        cycleMs: live._cycleMs,
        queueMs: live._engQueueMs,
        url: live.url,
      },
      // Real status supersedes the work-note-inferred `status`.
      liveStatus: live.statusCategory === 'Done' ? 'jira_closed' : 'active',
    }
  })

  // Case-level signals are computed over LINKED tickets only (cause field or
  // System note). Free-text mentions keep their live join for display, but a
  // prose name-drop must neither trigger "Likely closeable" (mention of a Done
  // ticket) nor suppress it (mention of an unrelated still-open ticket), and
  // its engineering times are not this case's wait.
  const linkedLive = tickets.filter((t) => t.jira && t.source !== 'mention')
  const linkedLiveActive = linkedLive.filter((t) => t.jira.statusCategory !== 'Done')

  // SN case still open, but every linked live Jira ticket is Done → the case
  // is very likely closeable. The key new signal the join unlocks.
  const mismatch =
    !row._isClosed && linkedLive.length > 0 && linkedLiveActive.length === 0
  // SN case closed but a linked Jira ticket is still open — minor inverse flag.
  const staleBlock = row._isClosed && linkedLiveActive.length > 0

  const cycleVals = linkedLive.map((t) => t.jira.cycleMs).filter((x) => x != null)
  const queueVals = linkedLive.map((t) => t.jira.queueMs).filter((x) => x != null)

  return {
    ...row,
    _jiraTickets: tickets,
    // Linked-only: these back the mismatch panel and downstream blocker logic.
    _jiraLiveTickets: linkedLive,
    _jiraLiveActiveTickets: linkedLiveActive.map((t) => t.id),
    _jiraAnyLive: tickets.some((t) => t.jira),
    _jiraMismatch: mismatch,
    _jiraStaleBlock: staleBlock,
    _jiraEngWaitMs: cycleVals.length ? Math.max(...cycleVals) : null,
    _jiraEngQueueMs: queueVals.length ? Math.max(...queueVals) : null,
  }
}
