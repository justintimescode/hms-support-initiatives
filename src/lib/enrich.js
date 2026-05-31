// Shared enrichment logic. Used by:
//   - the in-memory pipeline behind the UI (useAppData)
//   - the DuckDB worker (writes columns into the cases table)
// Both must produce identical values for any given raw row, so this is the
// single source of truth.
//
// SECURITY #10: free-text ServiceNow fields (work_notes, close_notes,
// short_description, etc.) flow through here and are rendered as TEXT in the
// UI today, which is safe. If any future change renders them via
// `dangerouslySetInnerHTML` (rich text), the HTML MUST be sanitized through
// DOMPurify first (see src/components/jira/JiraAnalysisBlock.jsx for the
// pattern). Do not introduce raw HTML rendering of these fields without it.

import {
  DEV_STATUS_MARKERS,
  DEV_HARD_RULE_MS,
  SUPPORT_THRESHOLDS_MS,
} from './sop-thresholds.js'

// Bump when enrichForSql / SQL_COLUMNS change. Each persisted import records the
// version it was built with; on boot, imports older than this are flagged in the
// file manager with a "Rebuild needed" badge (re-parses the stored source blob).
// Single source of truth — imported by the DuckDB worker.
export const SCHEMA_VERSION = '4'

// Topical case categories for the HMS hospitality-PMS domain. Keywords are
// matched as lowercase substrings. Ordered roughly specific → generic: on a
// score tie the earlier entry wins, so the broad catch-alls (Performance,
// System Outage) sit last and only claim a case when nothing more specific did.
export const CATEGORIES = [
  { name: "Night Audit", kws: ["night audit", "nightaudit", "end of day", "eod ", "audit ran"] },
  { name: "Ledger & Accounting", kws: ["hotel ledger", "city ledger", "guest ledger", "general ledger", "posting journal", "ledger", "accounts receivable", "trial balance", "accounting"] },
  { name: "Billing & Folio", kws: ["folio", "invoice", "billing", "charge", "credit card", "cc auth", "payment", "refund", "post ", "deposit", "advance deposit", "sundry", "auto transfer", "auto-transfer"] },
  { name: "Rates & Pricing", kws: ["rate", "rateplan", "rate plan", "rate code", "map rate", "pricing", "discount", "package", "yield", "market segment"] },
  { name: "Groups & Blocks", kws: ["group", "room block", "allotment", "group account", "commission group", "group master", "block "] },
  { name: "Reservations & Availability", kws: ["reservation", "booking", "availability", "out of balance", "rooms avail", "stay date", "no-show", "overbook", "cancel"] },
  { name: "Front Desk & Stay 360", kws: ["stay 360", "day 360", "front desk", "desk deck", "check in", "check-in", "checkout", "check out", "walk in", "walk-in", "guest stay", "in house", "in-house", "split stay", "room move"] },
  { name: "Housekeeping & Room Status", kws: ["housekeeping", "out of order", "ooo ", "room status", "discrepant", "vacant", "occupied", "room plan", "dirty", "turndown", "room assignment"] },
  { name: "Guest Profiles & Data", kws: ["guest profile", "profile", "passport", "loyalty", "membership", "lost and found", "guest record", "guest contact"] },
  { name: "Reports & Data", kws: ["report", "export", "query", "data missing", "extract", "kpi", "statistics", "occupancy stat"] },
  { name: "Email & Notifications", kws: ["email", "e-mail", "confirmation", "receipt", "smtp", "not sending", "not receiving", "notification"] },
  { name: "Login & Access", kws: ["login", "log in", "signin", "sign in", "password", "credentials", "unable to log", "cannot log", "locked out", "access denied"] },
  { name: "Integrations & Interfaces", kws: ["integration", "interface", "crs", "sync", "connector", "api ", "hms core", "pms sync", "profitsword", "duetto", "synxis", "ideas", "delphi", "channel", "ota "] },
  { name: "User & Permissions", kws: ["user", "permission", "role", "security group", "privilege"] },
  { name: "Printing & Hardware", kws: ["print", "printer", "receipt printer", "key encoder", "key card", "door lock", "encoder", "terminal"] },
  { name: "Performance & Errors", kws: ["slow", "crash", "frozen", "stuck", "error", "timeout", "hang", "unresponsive", "not responding", "uncaught", "typeerror", "exception"] },
  { name: "System Outage & Availability", kws: ["is down", "system down", "outage", "server down", "unable to access", "cannot access", "non operational", "unavailable", "not working", "won't load", "down for", "completely down"] },
]

// Count how many of a category's keywords appear in `text` (distinct keyword
// hits, not total occurrences — so one repeated word can't dominate).
function keywordHits(text, kws) {
  if (!text) return 0
  let n = 0
  for (const k of kws) if (text.includes(k)) n++
  return n
}

// Pick the highest-scoring category. `scoreOf(category)` returns its score;
// best-score-wins (ties broken by CATEGORIES order). Returns "Other" when
// nothing matched.
function bestCategory(scoreOf) {
  let best = null
  let bestScore = 0
  for (const c of CATEGORIES) {
    const s = scoreOf(c)
    if (s > bestScore) {
      bestScore = s
      best = c.name
    }
  }
  return best || "Other"
}

// Single-text categorization (best-score). Used where the input is already a
// clean, compact string — e.g. a Jira summary + labels (see jira-enrich.js).
export function categorize(text) {
  if (!text) return "Uncategorized"
  const t = String(text).toLowerCase()
  return bestCategory((c) => keywordHits(t, c.kws))
}

// Strip ServiceNow journal chrome so keyword matching sees topical content
// rather than entry headers ("2026-05-31 10:30:29 - Jane Doe (Infor) ..."),
// [code]..[/code] wrappers, or stray HTML tags.
function stripJournalChrome(s) {
  if (!s) return ""
  return String(s)
    .replace(/\[code\][\s\S]*?\[\/code\]/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2}\s*-\s*.*\(Additional comments\)\s*$/gim, " ")
    .replace(/^\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2}\s*-\s*/gim, " ")
}

// Topical categorization for a ServiceNow case, driven by the Short Description
// (the case title) plus the Additional comments journal. The title is the
// highest-signal field, so its keyword hits are weighted above the noisier
// journal; best-score-wins (not first-match) so a single incidental keyword
// deep in a long journal can't hijack the bucket. Returns "Uncategorized" when
// there is no text at all, "Other" when text exists but matches no category.
const CAT_WEIGHT_TITLE = 3
const CAT_WEIGHT_JOURNAL = 1
export function categorizeCase(shortDescription, additionalComments) {
  const title = String(shortDescription || "").toLowerCase()
  const journal = stripJournalChrome(additionalComments).toLowerCase()
  if (!title && !journal) return "Uncategorized"
  return bestCategory(
    (c) =>
      keywordHits(title, c.kws) * CAT_WEIGHT_TITLE +
      keywordHits(journal, c.kws) * CAT_WEIGHT_JOURNAL,
  )
}

export const parseDate = (v) => {
  if (!v) return null
  const d = new Date(String(v).replace(" ", "T"))
  return isNaN(d.getTime()) ? null : d
}

export const parseFirstResponse = (v) => {
  if (v == null || v === "") return null
  if (typeof v === "number") return v * 1000
  const s = String(v).trim()
  const n = Number(s)
  if (!isNaN(n) && n > 0) return n > 10000 ? n : n * 1000
  const m = s.match(/(\d+)[:\s](\d+)[:\s](\d+)/)
  if (m) return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000
  return null
}

export const priorityRank = (p) => {
  if (!p) return 99
  const n = parseInt(String(p))
  return isNaN(n) ? 99 : n
}

/** Map ServiceNow XLSX display-label columns to the internal field names the
 *  enrichment pipeline expects. Also converts the XLSX `First Response Time`
 *  (an absolute timestamp) into a millisecond duration relative to creation,
 *  formatted as a numeric string that `parseFirstResponse` will recognize. */
export function normalizeXlsxRow(r) {
  const sysCreatedOn = r['Created'] ?? null
  const frtRaw = r['First Response Time'] ?? null
  let frtValue = null
  if (sysCreatedOn && frtRaw) {
    const c = new Date(String(sysCreatedOn).replace(' ', 'T'))
    const f = new Date(String(frtRaw).replace(' ', 'T'))
    if (!isNaN(c.getTime()) && !isNaN(f.getTime()) && f >= c) {
      frtValue = String(f - c)
    }
  }
  return {
    number:              r['Number']              ?? null,
    short_description:   r['Short Description']   ?? null,
    state:               r['State']               ?? null,
    status:              r['Status']              ?? null,
    priority:            r['Priority']            ?? null,
    account:             r['Account']             ?? null,
    product_line:        r['Product line']        ?? null,
    assigned_to:         r['Assigned to']         ?? null,
    close_notes:         r['Resolution notes']    ?? null,
    additional_comments: r['Additional comments'] ?? null,
    work_notes:          r['Additional comments'] ?? r['Work notes'] ?? null,
    system_log:          r['Work notes']           ?? null,
    cause:               r['Cause']                ?? r['Caused by'] ?? null,
    case_action_summary: r['Case Action Summary'] ?? null,
    made_sla:            r['Made SLA']            ?? null,
    first_response_time: frtValue,
    sys_created_on:      sysCreatedOn,
    closed_at:           r['Closed']              ?? null,
    sla_due:             r['SLA due']             ?? null,
  }
}

const WORK_NOTE_HEADER = /^(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})\s*-\s*(.+)/gm
const ANALYST_AUTHOR = /\(Infor\)/i

const JIRA_LINKED = /Jira Reference ID\s+([A-Z]+-\d+)\s+has been linked/i
const JIRA_CLOSED = /Jira Reference ID\s+([A-Z]+-\d+)\s+linked to this case has been closed/i
const JIRA_ID_ANY = /[A-Z]+-\d+/g
// ServiceNow internal "Resolution Notes" references use the RN- prefix and do
// NOT correspond to Jira tickets — they have no working atlassian.net URL.
// Everything else (HMS-, INF-, etc.) is treated as a real Jira ticket.
const SN_INTERNAL_PREFIX = /^RN-/i

export function parseJiraRefs(text, cause) {
  const linkedTs = {}
  const closedTs = {}

  // Pass 1: walk work_notes / system log for "linked"/"closed" events with timestamps.
  if (text) {
    let currentHeaderDate = null
    for (const line of String(text).split('\n')) {
      const h = line.match(/^(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})\s*-/)
      if (h) {
        const d = new Date(h[1].replace(' ', 'T'))
        if (!isNaN(d.getTime())) currentHeaderDate = d
      }
      if (!currentHeaderDate) continue
      const linked = line.match(JIRA_LINKED)
      if (linked) {
        const id = linked[1]
        if (!linkedTs[id] || currentHeaderDate < linkedTs[id]) linkedTs[id] = currentHeaderDate
      }
      const closed = line.match(JIRA_CLOSED)
      if (closed) {
        const id = closed[1]
        if (!closedTs[id] || currentHeaderDate > closedTs[id]) closedTs[id] = currentHeaderDate
      }
    }
  }

  // Pass 2: pull every ticket-shaped ID from the Cause field. These are the
  // canonical Jira tickets the case is blocked on.
  const causeIds = new Set()
  if (cause) {
    for (const m of String(cause).matchAll(JIRA_ID_ANY)) causeIds.add(m[0])
  }

  const allIds = new Set([...Object.keys(linkedTs), ...causeIds])
  const tickets = [...allIds].map((id) => {
    const isInternal = SN_INTERNAL_PREFIX.test(id)
    const fromCause = causeIds.has(id)
    return {
      id,
      linkedAt: linkedTs[id] || null,
      closedAt: closedTs[id] || null,
      status: closedTs[id] ? 'jira_closed' : 'active',
      // clickable = points to a real Jira URL on infor.atlassian.net.
      // RN- prefixes are ServiceNow internal Resolution Notes refs, not Jira.
      clickable: !isInternal,
      // source helps the UI label where the ID came from.
      source: fromCause ? 'cause' : 'work_notes',
    }
  })

  const activeTickets = tickets.filter((t) => t.status === 'active').map((t) => t.id)
  const linkedDates = tickets.map((t) => t.linkedAt).filter(Boolean)
  const firstLinkedAt = linkedDates.length
    ? new Date(Math.min(...linkedDates.map((d) => d.getTime())))
    : null
  return { tickets, activeTickets, firstLinkedAt }
}

export function parseInteractions(text) {
  if (!text) return { totalTurns: 0, customerTurns: 0, analystTurns: 0 }
  const matches = [...String(text).matchAll(WORK_NOTE_HEADER)]
  if (matches.length === 0) {
    const blocks = String(text).split(/\n\s*\n/).filter((s) => s.trim())
    return { totalTurns: blocks.length, customerTurns: 0, analystTurns: 0 }
  }
  let customerTurns = 0, analystTurns = 0
  for (const m of matches) {
    if (ANALYST_AUTHOR.test(m[2])) analystTurns++
    else customerTurns++
  }
  return { totalTurns: matches.length, customerTurns, analystTurns }
}

/** Walk a journal text and return the latest Infor-authored entry timestamp
 *  plus the total count of Infor-authored entries. Used to compute
 *  `last_infor_update` for the Update Queue. Entries without an Infor author
 *  (customer replies, system events) are ignored. */
export function parseInforUpdates(text) {
  if (!text) return { lastTs: null, count: 0 }
  let lastTs = null
  let count = 0
  for (const m of String(text).matchAll(WORK_NOTE_HEADER)) {
    if (!ANALYST_AUTHOR.test(m[2])) continue
    const d = parseDate(m[1])
    if (!d) continue
    count++
    if (!lastTs || d > lastTs) lastTs = d
  }
  return { lastTs, count }
}

/** Per-SOP classification: development cases (status-driven, 30d hard rule)
 *  vs support cases (priority-driven cadence). Pure of "now" — only the raw
 *  state string and priority rank matter, so this can be baked at ingest. */
export function classifyCase(state, priorityRankValue) {
  const s = String(state || '').toLowerCase()
  for (const marker of DEV_STATUS_MARKERS) {
    if (s.includes(marker)) {
      return { case_type: 'development', threshold_ms: DEV_HARD_RULE_MS }
    }
  }
  return {
    case_type: 'support',
    threshold_ms: SUPPORT_THRESHOLDS_MS[priorityRankValue] ?? null,
  }
}

/** Used by the UI's in-memory pipeline. Returns the original row plus the
 *  underscore-prefixed enriched fields. */
export const enrichRow = (r) => {
  const created = parseDate(r.sys_created_on)
  const closed = parseDate(r.closed_at)
  const slaDue = parseDate(r.sla_due)
  const resolvedMs = created && closed ? closed - created : null
  const frtMs = parseFirstResponse(r.first_response_time)
  const stateLc = String(r.state || "").toLowerCase()
  const isClosed = stateLc === "closed" || stateLc === "resolved"
  const madeSla =
    r.made_sla === true ||
    String(r.made_sla).toLowerCase() === "true" ||
    String(r.made_sla).toLowerCase() === "1" ||
    String(r.made_sla).toLowerCase() === "yes"
  const combinedText = [r.short_description, r.close_notes, r.work_notes, r.case_action_summary]
    .filter(Boolean)
    .join(" ")
  const ix = parseInteractions(r.work_notes)
  const inforUpdates = parseInforUpdates(r.additional_comments)
  const pr = priorityRank(r.priority)
  const cls = classifyCase(r.state, pr)
  const jira = parseJiraRefs(r.system_log || r.work_notes, r.cause)
  const jiraDaysSinceLinked = jira.firstLinkedAt
    ? Math.floor((Date.now() - jira.firstLinkedAt.getTime()) / 86400000)
    : null
  return {
    ...r,
    _created: created,
    _closed: closed,
    _slaDue: slaDue,
    _resolvedMs: resolvedMs,
    _frtMs: frtMs,
    _isClosed: isClosed,
    _madeSla: madeSla,
    _category: categorizeCase(r.short_description, r.additional_comments),
    _combinedText: combinedText,
    _interactionCount: ix.totalTurns,
    _customerTurns: ix.customerTurns,
    _analystTurns: ix.analystTurns,
    _lastInforUpdate: inforUpdates.lastTs,
    _inforUpdateCount: inforUpdates.count,
    _caseType: cls.case_type,
    _updateThresholdMs: cls.threshold_ms,
    _jiraTickets: jira.tickets,
    _jiraActiveTickets: jira.activeTickets,
    _jiraFirstLinked: jira.firstLinkedAt,
    _jiraDaysSinceLinked: jiraDaysSinceLinked,
  }
}

/** Used by the DuckDB worker. Returns column values shaped for the SQL schema
 *  (no underscore prefix; raw strings preserved alongside parsed forms). */
export const enrichForSql = (r) => {
  const created = parseDate(r.sys_created_on)
  const closed = parseDate(r.closed_at)
  const slaDue = parseDate(r.sla_due)
  const resolvedMs = created && closed ? closed.getTime() - created.getTime() : null
  const frtMs = parseFirstResponse(r.first_response_time)
  const stateLc = String(r.state || "").toLowerCase()
  const isClosed = stateLc === "closed" || stateLc === "resolved"
  const madeSlaRaw = r.made_sla
  const madeSla =
    madeSlaRaw === true ||
    String(madeSlaRaw).toLowerCase() === "true" ||
    String(madeSlaRaw).toLowerCase() === "1" ||
    String(madeSlaRaw).toLowerCase() === "yes"
  const slaEligible = madeSlaRaw != null && madeSlaRaw !== ""
  const pr = priorityRank(r.priority)
  const inforUpdates = parseInforUpdates(r.additional_comments)
  const cls = classifyCase(r.state, pr)
  const ix = parseInteractions(r.work_notes)
  // Parsed Jira ticket refs, baked so SQL can aggregate per key. Stored as
  // '|'-joined VARCHAR (not Arrow LIST) to keep the worker insert path simple;
  // queries explode via UNNEST(string_split(jira_keys, '|')). The rich
  // _jiraTickets objects are reconstructed in JS on bounded result sets.
  const jira = parseJiraRefs(r.system_log || r.work_notes, r.cause)
  return {
    number: r.number ?? null,
    short_description: r.short_description ?? null,
    state: r.state ?? null,
    status: r.status ?? null,
    priority: r.priority ?? null,
    account: r.account ?? null,
    product_line: r.product_line ?? null,
    assigned_to: r.assigned_to ?? null,
    close_notes: r.close_notes ?? null,
    work_notes: r.work_notes ?? null,
    case_action_summary: r.case_action_summary ?? null,
    made_sla_raw: madeSlaRaw == null ? null : String(madeSlaRaw),
    first_response_time_raw: r.first_response_time == null ? null : String(r.first_response_time),
    created_at: created,                           // Date | null
    closed_at: closed,                             // Date | null
    sla_due: slaDue,                               // Date | null
    resolved_ms: resolvedMs == null ? null : BigInt(resolvedMs),
    frt_ms: frtMs == null ? null : BigInt(Math.round(frtMs)),
    is_closed: isClosed,
    made_sla: madeSla,
    sla_eligible: slaEligible,
    category: categorizeCase(r.short_description, r.additional_comments),
    priority_rank: pr,
    // Update Queue columns. Classification is time-independent — bake at
    // ingest. The Overdue/Due-Soon bucket is computed at query time against
    // the snapshot timestamp from `meta.loaded_at`.
    additional_comments: r.additional_comments ?? null,
    last_infor_update: inforUpdates.lastTs,        // Date | null
    infor_update_count: inforUpdates.count,
    case_type: cls.case_type,                      // 'development' | 'support'
    update_threshold_ms: cls.threshold_ms == null ? null : BigInt(cls.threshold_ms),
    // Interaction turns (baked so team-wide averages can be SQL-aggregated).
    interaction_count: ix.totalTurns,
    customer_turns: ix.customerTurns,
    analyst_turns: ix.analystTurns,
    // Jira linkage (baked for the blast-radius SQL aggregation per key).
    jira_keys: jira.tickets.map((t) => t.id).join("|"),
    jira_active_keys: jira.activeTickets.join("|"),
    jira_first_linked: jira.firstLinkedAt,         // Date | null
  }
}

/** The ordered column list that matches the SQL schema and the keys produced
 *  by `enrichForSql`. The worker uses this when building Arrow column arrays. */
export const SQL_COLUMNS = [
  "number",
  "short_description",
  "state",
  "status",
  "priority",
  "account",
  "product_line",
  "assigned_to",
  "close_notes",
  "work_notes",
  "case_action_summary",
  "made_sla_raw",
  "first_response_time_raw",
  "created_at",
  "closed_at",
  "sla_due",
  "resolved_ms",
  "frt_ms",
  "is_closed",
  "made_sla",
  "sla_eligible",
  "category",
  "priority_rank",
  "additional_comments",
  "last_infor_update",
  "infor_update_count",
  "case_type",
  "update_threshold_ms",
  "interaction_count",
  "customer_turns",
  "analyst_turns",
  "jira_keys",
  "jira_active_keys",
  "jira_first_linked",
]
