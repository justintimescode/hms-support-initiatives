import { useState, useMemo } from "react";
import { T } from "../../lib/theme.js";
import { fmtDuration, fmtDate, priorityColor } from "../../lib/format.js";
import { priorityRank } from "../../lib/enrich.js";
import { Card } from "../layout/Card.jsx";
import { CopyableNumber } from "../CopyableNumber.jsx";

/* ================= Jira Dashboard ================= */
const JIRA_BROWSE_URL = "https://infor.atlassian.net/browse/"

// A ticket's effective status: real Jira status (from the live join) when
// available, otherwise the status inferred from ServiceNow work notes.
const jiraTicketStatusOf = (t) =>
  t.jira ? (t.jira.statusCategory === "Done" ? "jira_closed" : "active") : t.status
const jiraRowIsActive = (r) =>
  (r._jiraTickets || []).some((t) => jiraTicketStatusOf(t) === "active")

function JiraLiveStatusBadge({ jira }) {
  if (!jira) return null
  const cat = jira.statusCategory
  const color = cat === "Done" ? T.ok : cat === "In Progress" ? T.warn : T.muted
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, background: color + "22", color, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {jira.status}
    </span>
  )
}

const JIRA_CASE_HEADERS = [
  { key: "number",      label: "Case",       align: "left"  },
  { key: "tickets",     label: "Jira",       align: "left"  },
  { key: "status",      label: "Status",     align: "left"  },
  { key: "priority",    label: "Priority",   align: "left"  },
  { key: "account",     label: "Account",    align: "left"  },
  { key: "assignedTo",  label: "Analyst",    align: "left"  },
  { key: "category",    label: "Category",   align: "left"  },
  { key: "daysLinked",  label: "Days linked", align: "right" },
  { key: "daysOpen",    label: "Days open",  align: "right" },
]

function JiraStatusBadge({ status }) {
  const color = status === "active" ? T.warn : T.ok
  const label = status === "active" ? "Active" : "Jira resolved"
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, background: color + "22", color, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {label}
    </span>
  )
}

function JiraCaseDetail({ row, onClose }) {
  const daysOpen = row._created ? Math.floor((Date.now() - row._created.getTime()) / 86400000) : null
  const fmtTicketDate = (d) => d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"
  const fmtRelDays = (d) => {
    if (!d) return ""
    const days = Math.floor((Date.now() - d.getTime()) / 86400000)
    if (days === 0) return "today"
    if (days === 1) return "1 day ago"
    return `${days} days ago`
  }
  const Field = ({ label, children }) => (
    <div>
      <div className="eyebrow" style={{ color: T.muted, fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{children}</div>
    </div>
  )
  return (
    <Card style={{ borderTop: `3px solid ${T.accent}`, marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <CopyableNumber value={row.number} className="mono" style={{ fontSize: 18, fontWeight: 600, color: T.accent }} />
            <span style={{ fontSize: 12, color: T.sub }}>{row._isClosed ? "Closed" : (row.state || "Open")}</span>
          </div>
          <div style={{ fontSize: 14, marginTop: 6, color: T.ink, maxWidth: 720 }}>{row.short_description || "No description"}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: `1px solid ${T.borderSoft}`, borderRadius: 4, color: T.sub, cursor: "pointer", fontSize: 13, padding: "4px 10px" }} aria-label="Close detail">✕</button>
      </div>

      {row._jiraMismatch && (
        <div style={{ background: T.warnSoft, border: `1px solid ${T.warn}`, borderRadius: 4, padding: "8px 12px", fontSize: 12, color: T.ink, marginBottom: 12 }}>
          <strong>Likely closeable.</strong> This case is still open in ServiceNow, but every linked
          Jira ticket is already Done. Confirm the fix reached the customer, then close the case.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, padding: "12px 0", borderTop: `1px solid ${T.borderSoft}`, borderBottom: `1px solid ${T.borderSoft}` }}>
        <Field label="Account">{row.account || "—"}</Field>
        <Field label="Assignee">{row.assigned_to || "Unassigned"}</Field>
        <Field label="Priority"><span style={{ color: priorityColor(row.priority), fontWeight: 600 }}>{row.priority || "—"}</span></Field>
        <Field label="Category">{row._category || "—"}</Field>
        <Field label="Created">{fmtDate(row._created)}</Field>
        <Field label="SLA due">{fmtDate(row._slaDue)}</Field>
        <Field label="Days open"><span className="mono" style={{ color: daysOpen > 30 ? T.warn : T.ink }}>{daysOpen ?? "—"}</span></Field>
        <Field label="Product line">{row.product_line || "—"}</Field>
      </div>

      <div style={{ padding: "16px 0", borderBottom: `1px solid ${T.borderSoft}` }}>
        <div className="eyebrow" style={{ color: T.muted, marginBottom: 10 }}>Jira tickets</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(row._jiraTickets || []).map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, flexWrap: "wrap" }}>
              {t.clickable ? (
                <a href={JIRA_BROWSE_URL + t.id} target="_blank" rel="noopener noreferrer" className="mono" style={{ color: T.accent, textDecoration: "none", fontWeight: 600 }}>{t.id}</a>
              ) : (
                <span className="mono" style={{ color: T.muted, fontWeight: 600 }} title="ServiceNow Resolution Notes reference — not a Jira ticket">{t.id}</span>
              )}
              {t.jira ? <JiraLiveStatusBadge jira={t.jira} /> : <JiraStatusBadge status={t.status} />}
              {!t.clickable && <span style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>ServiceNow ref</span>}
              {t.jira && (
                <span style={{ color: T.sub }}>
                  {t.jira.assignee}
                  {t.jira.priority ? ` · ${t.jira.priority}` : ""}
                  {t.jira.fixVersions?.length ? ` · fix ${t.jira.fixVersions.join(", ")}` : ""}
                  {t.jira.cycleMs != null ? ` · cycle ${fmtDuration(t.jira.cycleMs)}` : ""}
                </span>
              )}
              {!t.jira && t.linkedAt && (
                <span style={{ color: T.sub }}>linked {fmtTicketDate(t.linkedAt)} <span style={{ color: T.muted }}>({fmtRelDays(t.linkedAt)})</span></span>
              )}
              {!t.jira && t.closedAt && (
                <span style={{ color: T.sub }}>· Jira closed {fmtTicketDate(t.closedAt)} <span style={{ color: T.muted }}>({fmtRelDays(t.closedAt)})</span></span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 0", borderBottom: `1px solid ${T.borderSoft}`, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <Field label="SLA met">{row._madeSla ? <span style={{ color: T.ok, fontWeight: 600 }}>Yes</span> : <span style={{ color: T.danger, fontWeight: 600 }}>No</span>}</Field>
        <Field label="First response"><span className="mono">{fmtDuration(row._frtMs)}</span></Field>
        <Field label="Resolution time"><span className="mono">{fmtDuration(row._resolvedMs)}</span></Field>
        <Field label="Total interactions"><span className="mono">{row._interactionCount || 0} ({row._customerTurns || 0} customer / {row._analystTurns || 0} Infor)</span></Field>
        {row._jiraAnyLive && (
          <>
            <div>
              <div className="eyebrow" style={{ color: T.muted, fontSize: 10 }}>Engineering queue</div>
              <div style={{ fontSize: 13, marginTop: 2 }}>
                <span className="mono" title="Time the Jira ticket sat before work started">{fmtDuration(row._jiraEngQueueMs)}</span>
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ color: T.muted, fontSize: 10 }}>Engineering active</div>
              <div style={{ fontSize: 13, marginTop: 2 }}>
                <span className="mono" title="Time from first 'In Progress' to 'Done'">{fmtDuration(row._jiraEngWaitMs)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {row.case_action_summary && (
        <div style={{ paddingTop: 16 }}>
          <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>Case action summary</div>
          <div style={{ fontSize: 13, color: T.ink, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto", padding: "8px 12px", background: T.surfaceAlt, borderRadius: 4 }} className="scrollbar">
            {row.case_action_summary}
          </div>
        </div>
      )}
    </Card>
  )
}

export function JiraDashboard({ rows, jiraConnected = false }) {
  const [sort, setSort] = useState({ key: "daysLinked", dir: "desc" })
  const [selectedNumber, setSelectedNumber] = useState(null)

  const summary = useMemo(() => {
    let active = 0, resolved = 0, totalDays = 0, maxDays = 0, withDays = 0, mismatched = 0
    const activeTicketSet = new Set()
    for (const r of rows) {
      if (jiraRowIsActive(r)) {
        active++
        for (const t of (r._jiraTickets || [])) {
          if (jiraTicketStatusOf(t) === "active") activeTicketSet.add(t.id)
        }
      } else {
        resolved++
      }
      if (r._jiraMismatch) mismatched++
      if (r._jiraDaysSinceLinked != null) {
        totalDays += r._jiraDaysSinceLinked
        if (r._jiraDaysSinceLinked > maxDays) maxDays = r._jiraDaysSinceLinked
        withDays++
      }
    }
    return {
      total: rows.length,
      active,
      resolved,
      mismatched,
      avgDays: withDays ? totalDays / withDays : 0,
      maxDays,
      uniqueActive: activeTicketSet.size,
    }
  }, [rows])

  // SN cases still open whose every linked live Jira ticket is Done — the
  // join's headline signal: these cases are very likely closeable.
  const mismatches = useMemo(() => rows.filter((r) => r._jiraMismatch), [rows])

  const tableRows = useMemo(() => {
    return rows.map((r) => {
      const tickets = r._jiraTickets || []
      const daysOpen = r._created ? Math.floor((Date.now() - r._created.getTime()) / 86400000) : null
      const liveTicket = tickets.find((t) => t.jira) || null
      return {
        raw: r,
        number: r.number || "",
        tickets,
        status: jiraRowIsActive(r) ? "active" : "resolved",
        jiraStatus: liveTicket?.jira?.status || "",
        engWaitMs: r._jiraEngWaitMs ?? 0,
        mismatch: !!r._jiraMismatch,
        priority: r.priority || "",
        account: r.account || "",
        assignedTo: r.assigned_to || "Unassigned",
        category: r._category || "",
        daysLinked: r._jiraDaysSinceLinked ?? 0,
        daysOpen: daysOpen ?? 0,
      }
    })
  }, [rows])

  const sorted = useMemo(() => {
    return [...tableRows].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (typeof av === "number" && typeof bv === "number") return sort.dir === "asc" ? av - bv : bv - av
      const aStr = String(av || ""), bStr = String(bv || "")
      return sort.dir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
  }, [tableRows, sort])

  // Live columns are appended only when a Jira sync has populated t.jira.
  const headers = useMemo(() => {
    if (!jiraConnected) return JIRA_CASE_HEADERS
    return [
      ...JIRA_CASE_HEADERS.slice(0, 3),
      { key: "jiraStatus", label: "Jira status", align: "left" },
      ...JIRA_CASE_HEADERS.slice(3),
      { key: "engWaitMs", label: "Eng wait", align: "right" },
    ]
  }, [jiraConnected])

  const toggleSort = (key) =>
    setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: ["daysLinked", "daysOpen", "engWaitMs"].includes(key) ? "desc" : "asc" })

  // Group tickets across cases — surface blockers affecting multiple cases,
  // ranked by the aggregate open-case impact one fix would unblock.
  const ticketGroups = useMemo(() => {
    const groups = {}
    for (const r of rows) {
      for (const t of (r._jiraTickets || [])) {
        if (!groups[t.id]) {
          groups[t.id] = { id: t.id, status: jiraTicketStatusOf(t), clickable: t.clickable, jira: t.jira || null, cases: [], accounts: new Set() }
        }
        groups[t.id].cases.push(r)
        if (r.account) groups[t.id].accounts.add(r.account)
        if (jiraTicketStatusOf(t) === "active") groups[t.id].status = "active"
        if (t.jira) groups[t.id].jira = t.jira
      }
    }
    return Object.values(groups)
      .filter((g) => g.cases.length >= 2)
      .map((g) => {
        const oldestDays = Math.max(...g.cases.map((c) => c._jiraDaysSinceLinked || 0))
        // Impact = cases blocked (weighted) + priority pressure + an age factor.
        const priorityWeight = g.cases.reduce((s, c) => s + (5 - Math.min(4, priorityRank(c.priority))), 0)
        const impact = g.cases.length * 2 + priorityWeight + Math.min(20, oldestDays / 7)
        return { ...g, accountsArr: [...g.accounts], oldestDays, impact }
      })
      .sort((a, b) => b.impact - a.impact)
  }, [rows])

  if (rows.length === 0) {
    return (
      <Card>
        <div style={{ color: T.sub, fontSize: 14, fontStyle: "italic", textAlign: "center", padding: "24px 8px" }}>
          No open cases with Jira references. The team is unblocked from engineering.
        </div>
      </Card>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!jiraConnected && (
        <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>
          Showing status inferred from ServiceNow work notes. Sync Jira on the
          {" "}<strong style={{ fontStyle: "normal" }}>Jira Analysis</strong> tab to replace this with
          live ticket status, assignee, and engineering wait time.
        </div>
      )}

      {/* Mismatches: SN open but Jira Done — the highest-value join signal */}
      {jiraConnected && mismatches.length > 0 && (
        <Card style={{ borderLeft: `3px solid ${T.warn}` }}>
          <div className="eyebrow" style={{ color: T.warn }}>Likely closeable — {mismatches.length} {mismatches.length === 1 ? "case" : "cases"}</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, marginBottom: 12 }}>
            These ServiceNow cases are still open, but every Jira ticket they are linked to is already
            Done. The fix has shipped — the case can probably be closed.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {mismatches.map((r) => (
              <div key={r.number} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, flexWrap: "wrap" }}>
                <button onClick={() => setSelectedNumber(r.number)}
                  className="mono" style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontWeight: 600, padding: 0 }}>
                  {r.number}
                </button>
                <span style={{ color: T.sub, maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.short_description}</span>
                {(r._jiraLiveTickets || []).map((t) => (
                  <a key={t.id} href={JIRA_BROWSE_URL + t.id} target="_blank" rel="noopener noreferrer"
                    className="mono" style={{ color: T.muted, fontSize: 12, textDecoration: "line-through" }}>{t.id}</a>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* KPI summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: jiraConnected ? "repeat(5, 1fr)" : "repeat(4, 1fr)", gap: 12 }}>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Open cases with Jira</div>
          <div className="display" style={{ fontSize: 32, fontWeight: 500, marginTop: 4 }}>{summary.total}</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>{summary.active} active · {summary.resolved} Jira resolved</div>
        </Card>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Unique active tickets</div>
          <div className="display" style={{ fontSize: 32, fontWeight: 500, marginTop: 4 }}>{summary.uniqueActive}</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>distinct blockers</div>
        </Card>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Avg days linked</div>
          <div className="display" style={{ fontSize: 32, fontWeight: 500, marginTop: 4, color: summary.avgDays > 30 ? T.warn : T.ink }}>{summary.avgDays.toFixed(0)}</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>across open cases</div>
        </Card>
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Oldest blocker</div>
          <div className="display" style={{ fontSize: 32, fontWeight: 500, marginTop: 4, color: summary.maxDays > 60 ? T.danger : T.ink }}>{summary.maxDays}</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>days since first link</div>
        </Card>
        {jiraConnected && (
          <Card>
            <div className="eyebrow" style={{ color: T.muted }}>Likely closeable</div>
            <div className="display" style={{ fontSize: 32, fontWeight: 500, marginTop: 4, color: summary.mismatched > 0 ? T.warn : T.ink }}>{summary.mismatched}</div>
            <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>SN open · Jira done</div>
          </Card>
        )}
      </div>

      {/* Cases waiting on Jira */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${T.borderSoft}` }}>
          <div className="eyebrow" style={{ color: T.muted }}>Cases waiting on Jira</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Sorted by days since Jira was first linked. Click a row for detail, or a ticket to open it in Atlassian.</div>
        </div>
        <div style={{ overflowX: "auto" }} className="scrollbar">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                {headers.map((h) => (
                  <th key={h.key} onClick={() => toggleSort(h.key)}
                    style={{ padding: "10px 14px", textAlign: h.align, fontWeight: 600, color: T.sub, cursor: "pointer", whiteSpace: "nowrap", borderBottom: `1px solid ${T.borderSoft}` }}>
                    {h.label}
                    {sort.key === h.key && <span style={{ marginLeft: 4, color: T.accent }}>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const isSelected = selectedNumber === row.number
                return (
                  <tr key={row.number}
                    onClick={() => setSelectedNumber(isSelected ? null : row.number)}
                    style={{ borderBottom: `1px solid ${T.borderSoft}`, cursor: "pointer", background: isSelected ? T.surfaceAlt : row.mismatch ? T.warnSoft + "55" : "transparent" }}
                    className="hoverlift">
                    <td className="mono" style={{ padding: "10px 14px", color: T.accent, fontWeight: isSelected ? 600 : 400 }}><CopyableNumber value={row.number} /></td>
                    <td style={{ padding: "10px 14px" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {row.tickets.map((t) => {
                          const eff = jiraTicketStatusOf(t)
                          const color = eff === "active" ? T.accent : T.muted
                          const style = { color, fontSize: 12, textDecoration: "none", textDecorationStyle: eff === "jira_closed" ? "line-through" : "none" }
                          return t.clickable ? (
                            <a key={t.id} href={JIRA_BROWSE_URL + t.id} target="_blank" rel="noopener noreferrer"
                              className="mono" style={style}
                              title={t.jira ? `${t.jira.status} · ${t.jira.assignee}` : (eff === "jira_closed" ? "Jira closed; case may still be open" : "Open in Jira")}>
                              {t.id}
                            </a>
                          ) : (
                            <span key={t.id} className="mono" style={{ ...style, color: T.muted }}
                              title="ServiceNow Resolution Notes reference — not a Jira ticket">
                              {t.id}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px" }}><JiraStatusBadge status={row.status} /></td>
                    {jiraConnected && (
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        {row.jiraStatus
                          ? <JiraLiveStatusBadge jira={row.tickets.find((t) => t.jira)?.jira} />
                          : <span style={{ color: T.muted, fontSize: 12 }}>—</span>}
                      </td>
                    )}
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{row.priority}</td>
                    <td style={{ padding: "10px 14px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.account}>{row.account}</td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{row.assignedTo}</td>
                    <td style={{ padding: "10px 14px", color: T.sub, whiteSpace: "nowrap" }}>{row.category}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: row.daysLinked > 60 ? T.danger : row.daysLinked > 30 ? T.warn : T.ink }}>{row.daysLinked}</td>
                    <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: T.sub }}>{row.daysOpen}</td>
                    {jiraConnected && (
                      <td className="mono" style={{ padding: "10px 14px", textAlign: "right", color: T.sub }}>
                        {row.engWaitMs ? fmtDuration(row.engWaitMs) : "—"}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Selected case detail */}
      {selectedNumber && (() => {
        const selectedRow = rows.find((r) => r.number === selectedNumber)
        return selectedRow ? <JiraCaseDetail row={selectedRow} onClose={() => setSelectedNumber(null)} /> : null
      })()}

      {/* Tickets blocking multiple cases */}
      {ticketGroups.length > 0 && (
        <Card>
          <div className="eyebrow" style={{ color: T.muted }}>Tickets blocking multiple cases</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, marginBottom: 12 }}>Ranked by aggregate impact — open cases blocked, weighted by priority and age. One fix at the top unblocks the most.</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Jira</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Status</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Cases blocked</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Oldest (days)</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: T.sub, borderBottom: `1px solid ${T.borderSoft}` }}>Accounts affected</th>
              </tr>
            </thead>
            <tbody>
              {ticketGroups.map((g) => (
                <tr key={g.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td className="mono" style={{ padding: "8px 12px" }}>
                    {g.clickable ? (
                      <a href={JIRA_BROWSE_URL + g.id} target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "none" }}>{g.id}</a>
                    ) : (
                      <span style={{ color: T.muted }} title="ServiceNow Resolution Notes reference — not a Jira ticket">{g.id}</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {g.jira ? <JiraLiveStatusBadge jira={g.jira} /> : <JiraStatusBadge status={g.status} />}
                  </td>
                  <td className="mono" style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>{g.cases.length}</td>
                  <td className="mono" style={{ padding: "8px 12px", textAlign: "right", color: g.oldestDays > 60 ? T.danger : g.oldestDays > 30 ? T.warn : T.ink }}>{g.oldestDays}</td>
                  <td style={{ padding: "8px 12px", color: T.sub, fontSize: 12 }}>{g.accountsArr.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
