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
  INITIAL_RESPONSE_MS,
  SOLUTION_PROPOSED_AUTOCLOSE_MS,
} from './sop-thresholds.js'
// Deterministic, on-device sentiment grader. Pure ESM (no React/DOM) so it is
// safe to call from both enrichment pipelines and the DuckDB worker.
import { gradeFromRow } from './sentiment.js'

// Bump when enrichForSql / SQL_COLUMNS change. Each persisted import records the
// version it was built with; on boot, imports older than this are flagged in the
// file manager with a "Rebuild needed" badge (re-parses the stored source blob).
// Single source of truth — imported by the DuckDB worker.
// v5: SLA compliance re-based on the Infor SOP response cadence (computeSlaSop)
// instead of ServiceNow's first-response-only `Made SLA` flag — adds the
// `sla_breached` / `sla_due_sop` columns and redefines `sla_eligible`.
// v6: Jira link detection now matches the "has been created and linked" System
// note variant and scans every journal field (system_log, work_notes,
// additional_comments) — changes baked `jira_keys` / `jira_first_linked` values.
// v7: free-text HMS-XXXXX mentions in the journals also attach the ticket to
// the case — display/live-join only: no link date (Days linked still requires
// the System note) and never counted in `jira_active_keys` (mentions are not
// blocker assertions). System linked/closed notes now drive ticket status even
// when the journal header is missing. Changes baked `jira_keys` /
// `jira_active_keys` values.
// v8: "closed" no longer includes State="Resolved". A case is CLOSED only when
// State="Closed" (the sole state carrying a populated `closed_at`); State=
// "Resolved" / Status="Solution Proposed" is its own lifecycle bucket
// (`solution_proposed`) — a solution was proposed and the case awaits customer
// confirmation, NOT closed. Redefines `is_closed` for the 247 Resolved rows and
// adds the `lifecycle` column ('closed' | 'solution_proposed' | 'open'). Fixes
// the SLA cadence under-judging of Resolved cases (their end-time is now the
// snapshot, not null). See [[closed-vs-resolved]].
// v9: Customer sentiment graded on device from the customer-visible comment
// stream (work_notes, falling back to additional_comments) by the deterministic
// lexicon engine in sentiment.js. Adds the `sentiment_*` columns:
// `sentiment_scoreable` (had an attributable customer message), `sentiment_valence`
// (-5..+5), `sentiment_label`, `sentiment_start`/`sentiment_end` (opening/closing
// valence), `sentiment_arc`, `sentiment_emotions`, `sentiment_target`,
// `sentiment_quote`, `sentiment_coaching`, plus hygiene flags `sentiment_pii`
// (pasted credential / remote-access tool) and `sentiment_dup` (analyst
// double-post ≤60s). Silent cases bake `sentiment_scoreable=false` with null
// scalars but still count in coverage. Same attribution as `customer_turns`
// (parseInteractions over work_notes), so the two never disagree. Older imports
// show "Rebuild needed" and re-grade from source on rebuild.
// v10: Solution Proposed (State="Resolved") cases no longer owe a recurring SOP
// cadence update (current policy). In computeSlaSop their cadence trailing-gap
// clock STOPS at the last *Infor* update (`ts[last]`) instead of running to the
// snapshot, so a resolved case idling stops accruing a trailing-gap cadence breach
// and drops out of at-risk/overdue/forecast — while a real gap BETWEEN pre-resolution
// Infor updates, and a missed initial response (judged to the snapshot), still breach.
// `sla_due_sop` is now NULL for them (was set). SLA % generally rises.
//   Adds the `resolved_at_ms` column = when the resolution notes were saved (the
// header timestamp of the `<b>Resolution notes</b>` journal entry), which is the
// START of the new /solution-proposed 90-day auto-close countdown. ServiceNow's
// "Case Resolved - Reminder N" auto-close WARNING notes do NOT move this anchor
// (they carry no resolution marker); marker-less resolved rows fall back to the last
// Infor note, then created. (auto_close_at = anchor + 90d, derived at query time.)
//   Also EXCLUDES System auto-resolution / auto-close-reminder notes (authored
// "System  Automatic Reminders (Infor)") from Infor-update detection (parseInforUpdates)
// and interaction turns (parseInteractions) — they were wrongly counted as analyst
// activity because of the "(Infor)" tag, skewing cadence + turn counts on ~141
// auto-resolved cases. Older imports show "Rebuild needed" and re-grade on rebuild.
export const SCHEMA_VERSION = '10'

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
    contact:             r['Contact']             ?? r['Contact name'] ?? r['Caller'] ?? null,
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
// ServiceNow's automated actor posts auto-resolution + "Case Resolved - Reminder N"
// (auto-close warning) notes under the author "System" / "System  Automatic
// Reminders" — and confusingly tags the latter with "(Infor)". Those are NOT analyst
// work: they must not count as Infor cadence updates, interaction turns, or (for the
// auto-close countdown) the resolution moment. Detect by the author leading with
// "System"; `isInforAnalyst` is the genuine-analyst test used everywhere we mean "an
// Infor person touched the case".
const SYSTEM_AUTHOR = /^\s*System\b/i
const isInforAnalyst = (author) => ANALYST_AUTHOR.test(author) && !SYSTEM_AUTHOR.test(author)
// The bold label ServiceNow wraps saved resolution notes in (in the Additional
// comments journal). The header timestamp of the entry carrying this marker is when
// the resolution notes were saved — the start of the 90-day auto-close clock.
const RESOLUTION_MARKER = /<b>\s*Resolution notes\s*<\/b>/i

// ServiceNow's System user posts the link event in two phrasings:
//   "Jira Reference ID HMS-12345 has been linked to this case."
//   "Jira Reference ID HMS-12345 has been created and linked to this case."
const JIRA_LINKED = /Jira Reference ID\s+([A-Z]+-\d+)\s+has been (?:created and )?linked/i
const JIRA_CLOSED = /Jira Reference ID\s+([A-Z]+-\d+)\s+linked to this case has been closed/i
const JIRA_ID_ANY = /[A-Z]+-\d+/g
// Free-text ticket mentions in the journals. Deliberately restricted to the
// real Jira project key(s): journals are prose, and the broad [A-Z]+-\d+ class
// used on the curated `cause` field would turn tokens like "UTF-8" or
// "COVID-19" into phantom tickets. Add prefixes here as new projects appear.
const JIRA_MENTION = /\bHMS-\d+\b/gi
// ServiceNow internal "Resolution Notes" references use the RN- prefix and do
// NOT correspond to Jira tickets — they have no working atlassian.net URL.
// Everything else (HMS-, INF-, etc.) is treated as a real Jira ticket.
const SN_INTERNAL_PREFIX = /^RN-/i

/** Every journal field that can carry the System "Jira Reference ID … linked"
 *  note, deduped (XLSX maps both `work_notes` and `additional_comments` from
 *  the same column). Returned as separate segments — parseJiraRefs scans each
 *  journal independently, because scanning only one field missed link events
 *  recorded in the others. */
export function jiraJournals(r) {
  return [...new Set([r.system_log, r.work_notes, r.additional_comments].filter(Boolean))]
}

export function parseJiraRefs(text, cause) {
  const linkedTs = {}
  const closedTs = {}
  // System notes are authoritative even when their journal header is missing
  // or truncated away: the EVENT (linked/closed) is recorded in these sets
  // unconditionally; only the timestamp requires a parseable header. Without
  // this split, a header-less closed note would leave the ticket 'active'.
  const linkedSeen = new Set()
  const closedSeen = new Set()
  const mentionIds = new Set()

  // Pass 1: walk each journal for "linked"/"closed" events with timestamps.
  // `currentHeaderDate` is scoped per journal: a line may only inherit a header
  // date from its OWN journal — never from a previously scanned one, which
  // would fabricate link dates for header-less journal exports.
  const journals = Array.isArray(text) ? text : text ? [text] : []
  for (const journal of journals) {
    // Free-text HMS-XXXXX mentions anywhere in the journal attach the ticket
    // to the case. Mentions are NOT link events: they carry no linkedAt (Days
    // linked stays "Not linked") and never count as active blockers.
    for (const m of String(journal).matchAll(JIRA_MENTION)) mentionIds.add(m[0].toUpperCase())
    let currentHeaderDate = null
    for (const line of String(journal).split('\n')) {
      const h = line.match(/^(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})\s*-/)
      if (h) {
        const d = new Date(h[1].replace(' ', 'T'))
        if (!isNaN(d.getTime())) currentHeaderDate = d
      }
      const linked = line.match(JIRA_LINKED)
      if (linked) {
        // /i-matched ids are canonicalized to uppercase so they merge with the
        // case-sensitive cause-field ids.
        const id = linked[1].toUpperCase()
        linkedSeen.add(id)
        if (currentHeaderDate && (!linkedTs[id] || currentHeaderDate < linkedTs[id])) linkedTs[id] = currentHeaderDate
      }
      const closed = line.match(JIRA_CLOSED)
      if (closed) {
        const id = closed[1].toUpperCase()
        closedSeen.add(id)
        if (currentHeaderDate && (!closedTs[id] || currentHeaderDate > closedTs[id])) closedTs[id] = currentHeaderDate
      }
    }
  }

  // Pass 2: pull every ticket-shaped ID from the Cause field. These are the
  // canonical Jira tickets the case is blocked on.
  const causeIds = new Set()
  if (cause) {
    for (const m of String(cause).matchAll(JIRA_ID_ANY)) causeIds.add(m[0])
  }

  const allIds = new Set([...linkedSeen, ...causeIds, ...mentionIds])
  const tickets = [...allIds].map((id) => {
    const isInternal = SN_INTERNAL_PREFIX.test(id)
    const fromCause = causeIds.has(id)
    return {
      id,
      linkedAt: linkedTs[id] || null,
      closedAt: closedTs[id] || null,
      status: closedSeen.has(id) ? 'jira_closed' : 'active',
      // clickable = points to a real Jira URL on infor.atlassian.net.
      // RN- prefixes are ServiceNow internal Resolution Notes refs, not Jira.
      clickable: !isInternal,
      // source helps the UI label where the ID came from: the curated cause
      // field, a System linked/closed note in the journal, or a free-text
      // mention.
      source: fromCause ? 'cause' : (linkedSeen.has(id) || closedSeen.has(id)) ? 'work_notes' : 'mention',
    }
  })

  // The "blocked on engineering" signal (_jiraActiveTickets, jira_active_keys,
  // My Day triage, account-risk openBlockers). Free-text mentions are excluded:
  // a note that merely name-drops a ticket — even "not related to HMS-123" —
  // must not mark the case as blocked. Only the cause field and System notes
  // assert a real linkage.
  const activeTickets = tickets
    .filter((t) => t.status === 'active' && t.source !== 'mention')
    .map((t) => t.id)
  // RN- (SN-internal) link notes count toward firstLinkedAt BY DESIGN: the
  // System "created and linked" note marks the moment the case started waiting
  // on engineering, whether the tracked record is a real Jira ticket or an
  // internal Resolution Notes record. Only `clickable` (the Atlassian URL)
  // distinguishes them.
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
  // System-authored notes (auto-resolution, auto-close reminders) are not human
  // interactions — skip them entirely so they inflate neither analyst nor customer
  // turns. `totalTurns` is therefore the count of real (human) turns.
  let customerTurns = 0, analystTurns = 0
  for (const m of matches) {
    if (SYSTEM_AUTHOR.test(m[2])) continue
    if (ANALYST_AUTHOR.test(m[2])) analystTurns++
    else customerTurns++
  }
  return { totalTurns: customerTurns + analystTurns, customerTurns, analystTurns }
}

/** Walk a journal text and return the Infor-analyst update timeline: the sorted
 *  list of entry timestamps (ms), the latest one, and the count. Used to compute
 *  `last_infor_update` for the Update Queue AND the per-gap cadence the SOP-SLA
 *  check needs (see `computeSlaSop`). Entries that aren't a genuine Infor analyst —
 *  customer replies, AND System auto-resolution / auto-close-reminder notes (which
 *  ServiceNow confusingly tags "System  Automatic Reminders (Infor)") — are ignored
 *  via `isInforAnalyst`, so reminder spam can't fabricate Infor "updates". */
export function parseInforUpdates(text) {
  if (!text) return { lastTs: null, count: 0, times: [] }
  const times = []
  for (const m of String(text).matchAll(WORK_NOTE_HEADER)) {
    if (!isInforAnalyst(m[2])) continue
    const d = parseDate(m[1])
    if (!d) continue
    times.push(d.getTime())
  }
  times.sort((a, b) => a - b)
  const lastTs = times.length ? new Date(times[times.length - 1]) : null
  return { lastTs, count: times.length, times }
}

/** When the resolution notes were saved (the start of the 90-day auto-close clock):
 *  the header timestamp (ms) of the LATEST journal entry carrying the
 *  `<b>Resolution notes</b>` marker, or null when none is present. Scans the
 *  `additional_comments` journal (where ServiceNow writes the marker). Reuses the
 *  per-line header scan from `parseJiraRefs`: track the current entry's header date,
 *  and when a body line carries the marker, attribute it to that header. "Latest"
 *  handles a case that was resolved, reopened, and re-resolved.
 *
 *  This deliberately ignores the System "Case Resolved - Reminder N" auto-close
 *  WARNING notes (they live in work_notes and carry no marker) — only the
 *  resolution-notes save starts the timer, per current policy. Pure. */
export function parseResolutionTime(text) {
  if (!text) return null
  let currentHeaderMs = null
  let resolvedMs = null
  for (const line of String(text).split('\n')) {
    const h = line.match(/^(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})\s*-/)
    if (h) {
      const d = parseDate(h[1])
      currentHeaderMs = d ? d.getTime() : currentHeaderMs
    }
    if (RESOLUTION_MARKER.test(line) && currentHeaderMs != null) {
      if (resolvedMs == null || currentHeaderMs > resolvedMs) resolvedMs = currentHeaderMs
    }
  }
  return resolvedMs
}

/** The "real" SLA per Infor SOP — the response-cadence SLA, NOT ServiceNow's
 *  `Made SLA` flag (which only judges the first response and ignores cadence).
 *
 *  A case is SLA-eligible when it has a defined SOP cadence (`cadenceMs`):
 *  support cases get a per-priority cadence (SUPPORT_THRESHOLDS_MS); development
 *  cases get the 30-day hard rule (both via `classifyCase`). Cases with no
 *  cadence (no priority / unclassifiable) are excluded from the SLA %.
 *
 *  It BREACHES (lifetime view — judged across the whole case) if either of:
 *    (1) Initial response — the first Infor response missed the priority's
 *        first-response target (`initialMs`, INITIAL_RESPONSE_MS). Measured from
 *        the recorded FRT when present, else the first Infor journal entry, else
 *        (no response at all) the time elapsed to `baseEnd`.
 *    (2) Cadence — any gap between consecutive Infor updates, or the trailing gap
 *        from the last Infor update to `cadenceEnd`, exceeded the cadence.
 *
 *  TWO distinct clock-stops, kept separate on purpose (conflating them is wrong):
 *   - `baseEnd` (initial-response + closed/open cadence): the close time for closed
 *     cases, else the data snapshot. A Solution Proposed case Infor NEVER answered
 *     is still a missed initial response, so it is judged to the snapshot — never to
 *     its last activity (which could be an early customer post, masking the miss).
 *   - `cadenceEnd` (cadence trailing gap): for Solution Proposed (state=Resolved)
 *     cases — which NO LONGER owe a recurring update (v10) — the cadence clock STOPS
 *     at the last *Infor* update (`ts[last]`), so the trailing gap is zero (nothing
 *     owed after the last Infor touch) while a real gap BETWEEN pre-resolution Infor
 *     updates is still caught by the loop. No Infor update at all ⇒ no cadence to
 *     trail (createdMs ⇒ zero gap; the initial check owns that case). Closed/open run
 *     to `baseEnd`. Using the Infor-only `ts[last]` (not the all-author last activity)
 *     is what stops a late *customer* reply from fabricating a trailing-gap breach.
 *
 *  `breachReason` attributes a breach to its first point of failure
 *  ('initial' | 'cadence' | null) so the SLA % can be split by *why* cases miss
 *  — initial takes precedence, so the two buckets sum to the total missed.
 *
 *  `dueSop` (truly-open cases only — null for closed AND Solution Proposed) is
 *  the SOP "next update due" deadline that drives the At-Risk / Breach-Forecast /
 *  SLA-Risk surfaces: last update + cadence, or before any response, creation +
 *  the (tighter) first-response target.
 *
 *  Pure of wall-clock: callers pass `snapshotMs` (the data-as-of anchor) so the
 *  result is deterministic for a given dataset and identical across both
 *  pipelines (in-memory `enrichRow` and the DuckDB worker's `enrichForSql`). */
export function computeSlaSop({
  createdMs,
  closedMs,
  isClosed,
  isSolutionProposed,
  frtMs,
  updateTimes,
  cadenceMs,
  initialMs,
  snapshotMs,
}) {
  if (cadenceMs == null || createdMs == null) {
    return { eligible: false, breached: false, breachReason: null, dueSop: null }
  }
  const ts = updateTimes || []
  // `baseEnd` = the case's real end for SLA judgment: close time for closed cases,
  // the data snapshot for everything still in flight (open AND Solution Proposed).
  const baseEnd = isClosed ? (closedMs ?? snapshotMs ?? Date.now()) : (snapshotMs ?? Date.now())
  // `cadenceEnd` = the trailing-gap anchor. Solution Proposed cases owe no update
  // after their last Infor touch (v10), so their clock stops at `ts[last]` (zero
  // trailing gap), with creation as the no-Infor-update floor; closed/open run to
  // `baseEnd`. See the doc block above for why this is Infor-only, not last activity.
  const cadenceEnd = isSolutionProposed
    ? (ts.length ? ts[ts.length - 1] : createdMs)
    : baseEnd
  let initialBreached = false
  let cadenceBreached = false

  // (1) Initial-response component — folds the priority's tighter first-response
  //     target into the SLA. Prefer the recorded FRT; fall back to the first
  //     Infor journal entry; if there is no response at all, judge the silence
  //     since creation against the target (to `baseEnd`).
  if (initialMs != null) {
    const firstResponseMs =
      frtMs != null ? frtMs : ts.length ? ts[0] - createdMs : null
    if (firstResponseMs != null) {
      if (firstResponseMs > initialMs) initialBreached = true
    } else if (baseEnd != null && baseEnd - createdMs > initialMs) {
      initialBreached = true
    }
  }

  // (2) Cadence component — every gap between consecutive Infor updates, plus the
  //     trailing gap to `cadenceEnd`, must stay within the cadence. With no updates
  //     at all, the whole stretch since creation is the gap.
  if (ts.length) {
    for (let i = 1; i < ts.length && !cadenceBreached; i++) {
      if (ts[i] - ts[i - 1] > cadenceMs) cadenceBreached = true
    }
    if (!cadenceBreached && cadenceEnd != null && cadenceEnd - ts[ts.length - 1] > cadenceMs) cadenceBreached = true
  } else if (cadenceEnd != null && cadenceEnd - createdMs > cadenceMs) {
    cadenceBreached = true
  }

  // Attribute a breached case to its FIRST point of failure: a slow first
  // response ('initial') takes precedence over a dropped update cadence
  // ('cadence'). Buckets are mutually exclusive so they sum to the total missed.
  const breached = initialBreached || cadenceBreached
  const breachReason = initialBreached ? 'initial' : cadenceBreached ? 'cadence' : null

  // SOP next-update-due deadline — TRULY-open cases only. Closed cases are done;
  // Solution Proposed cases no longer owe a cadence update (v10), so neither gets
  // a `dueSop` and neither appears in the At-Risk / Overdue / Forecast surfaces
  // (all of which gate on a non-null due date over open work).
  let dueSop = null
  if (!isClosed && !isSolutionProposed) {
    dueSop = ts.length
      ? ts[ts.length - 1] + cadenceMs
      : createdMs + (initialMs != null ? initialMs : cadenceMs)
  }

  return { eligible: true, breached, breachReason, dueSop }
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
 *  underscore-prefixed enriched fields. `snapshotMs` is the data-as-of anchor
 *  (the active import's upload time) used by the SOP-SLA cadence check for the
 *  trailing gap on open cases; defaults to the live clock when not supplied. */
export const enrichRow = (r, snapshotMs) => {
  const created = parseDate(r.sys_created_on)
  const closed = parseDate(r.closed_at)
  const slaDue = parseDate(r.sla_due)
  const resolvedMs = created && closed ? closed - created : null
  const frtMs = parseFirstResponse(r.first_response_time)
  const stateLc = String(r.state || "").toLowerCase()
  // CLOSED means State="Closed" ONLY — the single state that carries a close
  // timestamp. State="Resolved" (Status="Solution Proposed") is its own bucket:
  // a proposed solution awaiting customer confirmation, NOT closed. Derived from
  // the STATE string (not `closed != null`) so a reopened case — close timestamp
  // present but state moved back — counts as open, keeping reopen detection and
  // _resolvedMs (which still needs the timestamp) correct. See lifecycle below.
  const lifecycle = stateLc === "closed"
    ? "closed"
    : stateLc === "resolved"
      ? "solution_proposed"
      : "open"
  const isClosed = lifecycle === "closed"
  const isOpen = lifecycle === "open"
  const isSolutionProposed = lifecycle === "solution_proposed"
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
  // When the resolution notes were saved (the auto-close clock START). Marker-only;
  // null when the case has no saved resolution notes in the journal.
  const resolvedAtMs = parseResolutionTime(r.additional_comments)
  const pr = priorityRank(r.priority)
  const cls = classifyCase(r.state, pr)
  // SOP-cadence SLA (the real SLA): replaces ServiceNow's `made_sla` flag.
  const sop = computeSlaSop({
    createdMs: created ? created.getTime() : null,
    closedMs: closed ? closed.getTime() : null,
    isClosed,
    isSolutionProposed,
    frtMs,
    updateTimes: inforUpdates.times,
    cadenceMs: cls.threshold_ms,
    initialMs: INITIAL_RESPONSE_MS[pr] ?? null,
    snapshotMs,
  })
  // Auto-close countdown anchor for Solution Proposed: when the resolution notes were
  // saved, falling back to the last genuine Infor-analyst note (system-reminder-free,
  // via parseInforUpdates) and then to creation; clamped ≥ creation so a backdated
  // header can't start the 90-day clock before the case existed. System auto-close
  // reminder notes never move this anchor. `_autoCloseAt` is Solution-Proposed-only.
  const createdMsVal = created ? created.getTime() : null
  const lastInforMs = inforUpdates.lastTs ? inforUpdates.lastTs.getTime() : null
  const anchorRaw = resolvedAtMs ?? lastInforMs ?? createdMsVal
  const autoCloseAnchorMs =
    anchorRaw != null && createdMsVal != null ? Math.max(anchorRaw, createdMsVal) : anchorRaw
  const autoCloseAt =
    isSolutionProposed && autoCloseAnchorMs != null
      ? new Date(autoCloseAnchorMs + SOLUTION_PROPOSED_AUTOCLOSE_MS)
      : null
  const jira = parseJiraRefs(jiraJournals(r), r.cause)
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
    // Three-state case lifecycle. `_isClosed` is true ONLY for 'closed';
    // `_isOpen` is true ONLY for 'open' (truly active work). Solution-Proposed
    // cases are neither — open-work surfaces (backlog, aging, SLA-risk, stuck,
    // forecast, churn) gate on `_isOpen`, count/label surfaces split three ways.
    _lifecycle: lifecycle,
    _isOpen: isOpen,
    _madeSla: madeSla,
    // SOP-cadence SLA. `_slaEligible` = case has a defined cadence; `_slaBreached`
    // = it missed first response or a cadence update; `_slaBreachReason` = which
    // ('initial' | 'cadence' | null); `_slaDueSop` = next update due (open cases).
    // These drive every SLA metric — see computeSlaSop.
    _slaEligible: sop.eligible,
    _slaBreached: sop.breached,
    _slaBreachReason: sop.breachReason,
    _slaDueSop: sop.dueSop != null ? new Date(sop.dueSop) : null,
    _category: categorizeCase(r.short_description, r.additional_comments),
    _combinedText: combinedText,
    _interactionCount: ix.totalTurns,
    _customerTurns: ix.customerTurns,
    _analystTurns: ix.analystTurns,
    _lastInforUpdate: inforUpdates.lastTs,
    _inforUpdateCount: inforUpdates.count,
    // Resolution-notes-saved time (any in-memory consumer) and the Solution-Proposed
    // 90-day auto-close deadline derived from it (null unless solution_proposed). The
    // /solution-proposed countdown reads the SQL twin `resolved_at_ms`.
    _resolvedAt: resolvedAtMs != null ? new Date(resolvedAtMs) : null,
    _autoCloseAt: autoCloseAt,
    _caseType: cls.case_type,
    _updateThresholdMs: cls.threshold_ms,
    _jiraTickets: jira.tickets,
    _jiraActiveTickets: jira.activeTickets,
    _jiraFirstLinked: jira.firstLinkedAt,
    _jiraDaysSinceLinked: jiraDaysSinceLinked,
    // Customer sentiment (v9). Emitted under the SAME snake_case keys as
    // enrichForSql (not the `_camelCase` SLA convention) so the parity test can
    // deep-equal the two and the UI reads one key regardless of source. One
    // parse per row; `frtMs` is shared so the coaching note is identical.
    ...gradeFromRow(r, frtMs),
  }
}

/** Used by the DuckDB worker. Returns column values shaped for the SQL schema
 *  (no underscore prefix; raw strings preserved alongside parsed forms).
 *  `snapshotMs` is the import's upload time — the data-as-of anchor the SOP-SLA
 *  cadence check uses for the trailing gap on open cases. Must match the value
 *  the in-memory `enrichRow` is given so both pipelines bake identical SLA. */
export const enrichForSql = (r, snapshotMs) => {
  const created = parseDate(r.sys_created_on)
  const closed = parseDate(r.closed_at)
  const slaDue = parseDate(r.sla_due)
  const resolvedMs = created && closed ? closed.getTime() - created.getTime() : null
  const frtMs = parseFirstResponse(r.first_response_time)
  const stateLc = String(r.state || "").toLowerCase()
  // Mirror enrichRow exactly (both pipelines MUST agree). CLOSED = State="Closed"
  // only; State="Resolved" => 'solution_proposed'; everything else => 'open'.
  const lifecycle = stateLc === "closed"
    ? "closed"
    : stateLc === "resolved"
      ? "solution_proposed"
      : "open"
  const isClosed = lifecycle === "closed"
  const isSolutionProposed = lifecycle === "solution_proposed"
  const madeSlaRaw = r.made_sla
  const madeSla =
    madeSlaRaw === true ||
    String(madeSlaRaw).toLowerCase() === "true" ||
    String(madeSlaRaw).toLowerCase() === "1" ||
    String(madeSlaRaw).toLowerCase() === "yes"
  const pr = priorityRank(r.priority)
  const inforUpdates = parseInforUpdates(r.additional_comments)
  // Resolution-notes-saved time (auto-close clock START), marker-only. Mirrors
  // enrichRow exactly (same helper, same input) so parity holds. The created/last-Infor
  // fallback for the anchor is applied at query time (getSolutionProposedAutoClose).
  const resolvedAtMs = parseResolutionTime(r.additional_comments)
  const cls = classifyCase(r.state, pr)
  // SOP-cadence SLA (the real SLA). `sla_eligible` now means "has a defined SOP
  // cadence" (was "Made SLA field present"); `sla_breached` is the lifetime
  // cadence/first-response breach; `sla_due_sop` is the next-update deadline
  // (null for closed AND Solution Proposed — see computeSlaSop).
  const sop = computeSlaSop({
    createdMs: created ? created.getTime() : null,
    closedMs: closed ? closed.getTime() : null,
    isClosed,
    isSolutionProposed,
    frtMs,
    updateTimes: inforUpdates.times,
    cadenceMs: cls.threshold_ms,
    initialMs: INITIAL_RESPONSE_MS[pr] ?? null,
    snapshotMs,
  })
  const ix = parseInteractions(r.work_notes)
  // Parsed Jira ticket refs, baked so SQL can aggregate per key. Stored as
  // '|'-joined VARCHAR (not Arrow LIST) to keep the worker insert path simple;
  // queries explode via UNNEST(string_split(jira_keys, '|')). The rich
  // _jiraTickets objects are reconstructed in JS on bounded result sets.
  const jira = parseJiraRefs(jiraJournals(r), r.cause)
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
    is_closed: isClosed,            // State="Closed" ONLY (not Resolved) — see SCHEMA_VERSION v8
    lifecycle: lifecycle,           // 'closed' | 'solution_proposed' | 'open'
    made_sla: madeSla,              // ServiceNow flag — retained raw, no longer drives metrics
    sla_eligible: sop.eligible,     // SOP: has a defined cadence threshold
    sla_breached: sop.breached,     // SOP: missed first response or a cadence update
    sla_due_sop: sop.dueSop != null ? new Date(sop.dueSop) : null, // next update due (open cases)
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
    // Customer sentiment (v9). Identical values to enrichRow (same row, same
    // frtMs). Plain Number | string | boolean | null — never undefined — so the
    // worker's Arrow column build (buildArrowTable) types them cleanly.
    ...gradeFromRow(r, frtMs),
    // Resolution-notes-saved time in ms (v10) — the START of the Solution-Proposed
    // 90-day auto-close countdown (the /solution-proposed page derives auto_close_at
    // = anchor + 90d against the snapshot, where the anchor coalesces this → last
    // Infor update → created). Marker-only; null when no resolution notes are saved.
    // BigInt to match the BIGINT DDL + the other `*_ms` columns.
    resolved_at_ms: resolvedAtMs == null ? null : BigInt(resolvedAtMs),
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
  // SOP-cadence SLA (v5). Appended so the column order stays aligned with the
  // worker's CASES_COLUMNS DDL (the Arrow insert binds by position).
  "sla_breached",
  "sla_due_sop",
  // Case lifecycle (v8). Appended for the same positional-alignment reason.
  "lifecycle",
  // Customer sentiment (v9). Appended (positional alignment with CASES_COLUMNS
  // in db.worker.js). Produced by gradeFromRow; null/false for silent cases.
  "sentiment_scoreable", // BOOLEAN
  "sentiment_valence",   // BIGINT  (plain Number | null, like priority_rank)
  "sentiment_label",     // VARCHAR
  "sentiment_start",     // BIGINT  (opening valence | null)
  "sentiment_end",       // BIGINT  (closing valence | null)
  "sentiment_arc",       // VARCHAR
  "sentiment_emotions",  // VARCHAR
  "sentiment_target",    // VARCHAR
  "sentiment_quote",     // VARCHAR
  "sentiment_coaching",  // VARCHAR
  "sentiment_pii",       // BOOLEAN
  "sentiment_dup",       // BOOLEAN
  // Resolution-notes-saved time (v10) — auto-close countdown anchor. Appended
  // (positional alignment with CASES_COLUMNS in db.worker.js). BigInt | null.
  "resolved_at_ms",      // BIGINT
]
