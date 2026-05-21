// Enrichment logic — identical to the KPI analyzer's enrich.js.
// Kept as a separate copy so this project has no dependency on the other workspace.

export const CATEGORIES = [
  { name: "Night Audit",               kws: ["night audit", "nightaudit", "end of day", "eod ", "audit ran"] },
  { name: "Login & Access",            kws: ["login", "log in", "signin", "sign in", "password", "credentials", "unable to log", "cannot log", "locked out", "access denied"] },
  { name: "Email & Notifications",     kws: ["email", "e-mail", "confirmation", "receipt", "smtp", "not sending", "not receiving", "notification"] },
  { name: "Reservations & Availability", kws: ["reservation", "booking", "availability", "out of balance", "rooms avail", "stay date", "departure", "arrival", "cancel", "no-show", "block"] },
  { name: "Rates & Pricing",           kws: ["rate", "rateplan", "pricing", "discount", "package", "yield"] },
  { name: "Billing & Folio",           kws: ["folio", "invoice", "billing", "charge", "credit card", "cc auth", "payment", "refund", "post "] },
  { name: "Reports & Data",            kws: ["report", "export", "query", "data missing", "extract", "kpi"] },
  { name: "Integrations & Interfaces", kws: ["integration", "interface", "crs", "sync", "connector", "api ", "hms core", "pms sync"] },
  { name: "Performance & Errors",      kws: ["slow", "crash", "frozen", "stuck", "error", "timeout", "hang", "unresponsive", "not responding"] },
  { name: "User & Permissions",        kws: ["user", "permission", "role", "security group", "privilege"] },
  { name: "Printing & Hardware",       kws: ["print", "printer", "receipt printer", "key encoder", "terminal"] },
]

export function categorize(text) {
  if (!text) return "Uncategorized"
  const t = String(text).toLowerCase()
  for (const c of CATEGORIES) if (c.kws.some((k) => t.includes(k))) return c.name
  return "Other"
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

const WORK_NOTE_HEADER = /^(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})\s*-\s*(.+)/gm
const ANALYST_AUTHOR   = /\(Infor\)/i
const JIRA_LINKED      = /Jira Reference ID\s+([A-Z]+-\d+)\s+has been linked/i
const JIRA_CLOSED      = /Jira Reference ID\s+([A-Z]+-\d+)\s+linked to this case has been closed/i
const JIRA_ID_ANY      = /[A-Z]+-\d+/g
const SN_INTERNAL_PREFIX = /^RN-/i

export function parseJiraRefs(text, cause) {
  const linkedTs = {}
  const closedTs = {}
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
  const causeIds = new Set()
  if (cause) {
    for (const m of String(cause).matchAll(JIRA_ID_ANY)) causeIds.add(m[0])
  }
  const allIds = new Set([...Object.keys(linkedTs), ...causeIds])
  const tickets = [...allIds].map((id) => ({
    id,
    linkedAt: linkedTs[id] || null,
    closedAt: closedTs[id] || null,
    status: closedTs[id] ? 'jira_closed' : 'active',
    clickable: !SN_INTERNAL_PREFIX.test(id),
    source: causeIds.has(id) ? 'cause' : 'work_notes',
  }))
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

export const enrichRow = (r) => {
  const created   = parseDate(r.sys_created_on)
  const closed    = parseDate(r.closed_at)
  const slaDue    = parseDate(r.sla_due)
  const resolvedMs = created && closed ? closed - created : null
  const frtMs     = parseFirstResponse(r.first_response_time)
  const stateLc   = String(r.state || "").toLowerCase()
  const isClosed  = stateLc === "closed" || stateLc === "resolved"
  const madeSla   =
    r.made_sla === true ||
    String(r.made_sla).toLowerCase() === "true"  ||
    String(r.made_sla).toLowerCase() === "1"     ||
    String(r.made_sla).toLowerCase() === "yes"
  const ix   = parseInteractions(r.work_notes)
  const jira = parseJiraRefs(r.work_notes, r.cause)
  const jiraDaysSinceLinked = jira.firstLinkedAt
    ? Math.floor((Date.now() - jira.firstLinkedAt.getTime()) / 86400000)
    : null
  return {
    ...r,
    _created:            created,
    _closed:             closed,
    _slaDue:             slaDue,
    _resolvedMs:         resolvedMs,
    _frtMs:              frtMs,
    _isClosed:           isClosed,
    _madeSla:            madeSla,
    _category:           categorize(r.short_description + " " + (r.close_notes || "")),
    _interactionCount:   ix.totalTurns,
    _customerTurns:      ix.customerTurns,
    _analystTurns:       ix.analystTurns,
    _jiraTickets:        jira.tickets,
    _jiraActiveTickets:  jira.activeTickets,
    _jiraFirstLinked:    jira.firstLinkedAt,
    _jiraDaysSinceLinked: jiraDaysSinceLinked,
  }
}
