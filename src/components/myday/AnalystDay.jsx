import { useMemo } from "react"
import { ClipboardList, Clock, Inbox, Ban, Siren } from "lucide-react"
import { T } from "../../lib/theme.js"
import { fmtDuration, priorityColor, ageDays, msUntil } from "../../lib/format.js"
import { CopyableNumber } from "../CopyableNumber.jsx"
import { StuckCasesList } from "../StuckCasesList.jsx"
import { EscalationRiskTable } from "../charts/sentiment-shared.jsx"
import { useQuery } from "../../lib/useQuery.js"
import { getUpdateQueue } from "../../lib/queries.js"
import { stuckCases } from "../../lib/stats.js"
import { escalationWatch, slaPressure, RISK_HIGH, RISK_ELEVATED } from "../../lib/myday.js"
import { StatTile, ListCard, MoreRow } from "./shared.jsx"
import { TH, TD, TD_DESC, CAP } from "./table-styles.js"

/* ============================================================================
 * My Day — the ANALYST view: one person's live open work.
 *
 * A focused recomposition of data that already exists elsewhere:
 *   - overdue customer updates  → getUpdateQueue() (DuckDB, snapshot-anchored)
 *   - escalation watch          → escalationWatch() over the baked sentiment
 *   - SLA at risk               → slaPressure() over the analyst's open cases
 *   - stuck cases (30d+)        → StuckCasesList (reused)
 *   - Jira-blocked open cases   → rows with active parsed Jira tickets
 *
 * Deliberately IGNORES the global date-range filter — "my day" is about live
 * open work, not a historical window — so it reads `enrichedAnalyst` (analyst-
 * filtered, all dates) rather than the date-filtered `enriched`.
 * ========================================================================== */

export function AnalystDay({ me, enrichedAnalyst, snapshotMs, hasRows }) {
  // Update Queue (overdue / due-soon) for this analyst, snapshot-anchored.
  const uq = useQuery(
    () => getUpdateQueue({ analyst: me, snapshotMs }),
    [me, snapshotMs],
    { enabled: hasRows && !!me && me !== "__all__" && snapshotMs != null },
  )

  const open = useMemo(
    // Truly-open only — Solution-Proposed (resolved, awaiting customer) cases
    // have their own queue and are excluded from "My Day" open work.
    () => (enrichedAnalyst || []).filter((r) => r._isOpen),
    [enrichedAnalyst],
  )

  // SLA pressure on open cases, "right now". slaPressure() reads the clock via
  // its default argument so Date.now() stays out of this render body
  // (react-hooks/purity).
  const sla = useMemo(() => slaPressure(open), [open])

  // Escalation watch spans open + Solution Proposed: a proposed fix the customer
  // pushed back on is exactly the case that becomes tomorrow's escalation.
  const esc = useMemo(() => escalationWatch(enrichedAnalyst || []), [enrichedAnalyst])

  const jiraBlocked = useMemo(
    () =>
      open
        .filter((r) => (r._jiraActiveTickets?.length || 0) > 0)
        .sort((a, b) => (ageDays(b._created) || 0) - (ageDays(a._created) || 0)),
    [open],
  )

  // Matches StuckCasesList's own filter so the tile count equals the list below.
  const stuckCount = useMemo(() => stuckCases(enrichedAnalyst || [], 30).length, [enrichedAnalyst])

  const overdue = uq.data?.overdue || []
  const dueSoon = uq.data?.dueSoon || []
  const escCounts = esc.counts

  return (
    <>
      {/* summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 12 }}>
        <StatTile
          to="/update-queue" icon={ClipboardList} label="Overdue updates"
          value={uq.loading ? "…" : overdue.length}
          tone={overdue.length ? T.danger : T.ok}
          hint={uq.loading ? "loading…" : dueSoon.length ? `${dueSoon.length} due soon` : overdue.length ? "past their SOP cadence" : "all current"}
        />
        <StatTile
          to="/sentiment" icon={Siren} label="Escalation watch"
          value={escCounts.total}
          tone={escCounts.escalated || escCounts.high ? T.danger : escCounts.elevated ? T.warn : T.ok}
          hint={
            escCounts.escalated
              ? `${escCounts.escalated} already escalated`
              : escCounts.high
                ? `${escCounts.high} at high risk`
                : escCounts.elevated
                  ? `${escCounts.elevated} elevated`
                  : escCounts.pushback
                    ? `${escCounts.pushback} pushed back on a fix`
                    : "no escalation signals"
          }
        />
        <StatTile
          to="/sla" icon={Clock} label="SLA at risk"
          value={sla.atRisk.length}
          tone={sla.breached.length ? T.danger : sla.due24.length ? T.warn : T.ok}
          hint={sla.breached.length ? `${sla.breached.length} breached` : sla.due24.length ? `${sla.due24.length} due <24h` : "comfortable"}
        />
        <StatTile
          to="/backlog" icon={Inbox} label="Stuck 30+ days"
          value={stuckCount}
          tone={stuckCount ? T.warn : T.ok}
          hint={stuckCount ? "open over 30 days" : "nothing stuck"}
        />
        <StatTile
          to="/jira-blockers" icon={Ban} label="Jira-blocked"
          value={jiraBlocked.length}
          tone={jiraBlocked.length ? T.accent : T.ok}
          hint={jiraBlocked.length ? "waiting on engineering" : "none blocked"}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 1 — Escalation watch. Above the cadence queue on purpose: an angry
             customer outranks a clock. */}
        <ListCard
          id="escalation-watch"
          icon={Siren} title="At risk of escalation" count={escCounts.total}
          to="/sentiment" linkLabel="Case Sentiment"
          note={
            <>
              Read from what the customer actually wrote — unanswered messages, repeated chasing, a recurring issue,
              souring tone, urgency and business impact. Cases they have <strong>already escalated</strong> come first;
              then <span style={{ color: T.danger }}>high risk ≥ {RISK_HIGH}</span> and{" "}
              <span style={{ color: T.warn }}>elevated ≥ {RISK_ELEVATED}</span>. A Solution Proposed case only appears
              if the customer escalated or pushed back on the fix — a quiet proposal waiting to auto-close is not an
              escalation signal.
            </>
          }
          emptyMsg="No open or proposed case is showing escalation signals. Nothing to get ahead of."
        >
          <EscalationRiskTable rows={esc.watch} hideAssignee showStage bare cap={CAP} ariaLabel="My cases at risk of escalation" />
        </ListCard>

        {/* 2 — Overdue customer updates */}
        <ListCard
          icon={ClipboardList} title="Overdue customer updates" count={overdue.length}
          to="/update-queue" linkLabel="Full Update Queue"
          loading={uq.loading} error={uq.error}
          emptyMsg="No overdue updates — every open case is within its SOP cadence."
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Case</th>
                <th style={TH}>Type / Priority</th>
                <th style={TH}>Last Infor update</th>
                <th style={TH}>Cadence</th>
                <th style={TH}>Account</th>
                <th style={TH}>Description</th>
              </tr>
            </thead>
            <tbody>
              {overdue.slice(0, CAP).map((r) => (
                <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td className="mono" style={{ ...TD, fontWeight: 600 }}><CopyableNumber value={r.number} /></td>
                  <td style={TD}>
                    <span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>
                      {r.caseType === "development" ? "dev" : (r.priority || "—")}
                    </span>
                  </td>
                  <td className="mono" style={{ ...TD, color: T.danger }}>
                    {r.noInforUpdateYet ? "no update yet" : `${fmtDuration(r.elapsedMs)} ago`}
                  </td>
                  <td className="mono" style={{ ...TD, color: T.sub }}>{r.thresholdMs == null ? "—" : fmtDuration(r.thresholdMs)}</td>
                  <td style={TD}>{r.account || "—"}</td>
                  <td style={TD_DESC}>{r.shortDescription || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {overdue.length > CAP && <MoreRow n={overdue.length - CAP} to="/update-queue" />}
        </ListCard>

        {/* 3 — Updates due soon (approaching the SOP cadence, not yet overdue) */}
        <ListCard
          icon={Clock} title="Updates due soon" count={dueSoon.length}
          to="/update-queue" linkLabel="Full Update Queue"
          loading={uq.loading} error={uq.error}
          emptyMsg="Nothing coming due — every open case is comfortably inside its cadence."
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Case</th>
                <th style={TH}>Type / Priority</th>
                <th style={TH}>Last Infor update</th>
                <th style={TH}>Due in</th>
                <th style={TH}>Account</th>
                <th style={TH}>Description</th>
              </tr>
            </thead>
            <tbody>
              {dueSoon.slice(0, CAP).map((r) => {
                const remainingMs =
                  r.thresholdMs == null || r.elapsedMs == null ? null : r.thresholdMs - r.elapsedMs
                return (
                  <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td className="mono" style={{ ...TD, fontWeight: 600 }}><CopyableNumber value={r.number} /></td>
                    <td style={TD}>
                      <span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>
                        {r.caseType === "development" ? "dev" : (r.priority || "—")}
                      </span>
                    </td>
                    <td className="mono" style={{ ...TD, color: T.warn }}>
                      {r.noInforUpdateYet ? "no update yet" : `${fmtDuration(r.elapsedMs)} ago`}
                    </td>
                    <td className="mono" style={{ ...TD, color: T.warn }}>
                      {remainingMs == null ? "—" : remainingMs <= 0 ? "now" : fmtDuration(remainingMs)}
                    </td>
                    <td style={TD}>{r.account || "—"}</td>
                    <td style={TD_DESC}>{r.shortDescription || "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {dueSoon.length > CAP && <MoreRow n={dueSoon.length - CAP} to="/update-queue" />}
        </ListCard>

        {/* 4 — SLA at risk */}
        <ListCard
          icon={Clock} title="SLA at risk" count={sla.atRisk.length}
          to="/sla" linkLabel="SLA Performance"
          emptyMsg="No open case is breached or due within the week. Comfortable."
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Case</th>
                <th style={TH}>Priority</th>
                <th style={TH}>SLA</th>
                <th style={TH}>Account</th>
                <th style={TH}>Description</th>
              </tr>
            </thead>
            <tbody>
              {sla.atRisk.slice(0, CAP).map((r) => {
                const ms = msUntil(r._slaDueSop)
                let slaText = "—", slaColor = T.muted
                if (ms != null) {
                  if (ms < 0) { slaText = `breached ${fmtDuration(-ms)}`; slaColor = T.danger }
                  else if (ms < 24 * 36e5) { slaText = `due in ${fmtDuration(ms)}`; slaColor = T.warn }
                  else { slaText = `due in ${fmtDuration(ms)}`; slaColor = T.sub }
                }
                return (
                  <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td className="mono" style={{ ...TD, fontWeight: 600 }}><CopyableNumber value={r.number} /></td>
                    <td style={TD}><span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>{r.priority || "—"}</span></td>
                    <td className="mono" style={{ ...TD, color: slaColor }}>{slaText}</td>
                    <td style={TD}>{r.account || "—"}</td>
                    <td style={TD_DESC}>{r.short_description || "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sla.atRisk.length > CAP && <MoreRow n={sla.atRisk.length - CAP} to="/sla" />}
        </ListCard>

        {/* 5 — Stuck cases (reuse the shared list, scoped to this analyst) */}
        <StuckCasesList rows={enrichedAnalyst || []} />

        {/* 6 — Jira-blocked */}
        <ListCard
          icon={Ban} title="Jira-blocked open cases" count={jiraBlocked.length}
          to="/jira-blockers" linkLabel="Cases w/ Jira Blockers"
          emptyMsg="None of your open cases are waiting on an active Jira ticket."
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Case</th>
                <th style={TH}>Active Jira</th>
                <th style={TH}>Priority</th>
                <th style={TH}>Age</th>
                <th style={TH}>Account</th>
                <th style={TH}>Description</th>
              </tr>
            </thead>
            <tbody>
              {jiraBlocked.slice(0, CAP).map((r) => {
                const age = ageDays(r._created)
                return (
                  <tr key={r.number} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td className="mono" style={{ ...TD, fontWeight: 600 }}><CopyableNumber value={r.number} /></td>
                    <td className="mono" style={{ ...TD, color: T.jiraBlue }}>{(r._jiraActiveTickets || []).join(", ") || "—"}</td>
                    <td style={TD}><span style={{ color: priorityColor(r.priority), fontWeight: 600 }}>{r.priority || "—"}</span></td>
                    <td className="mono" style={{ ...TD, color: age != null && age > 30 ? T.danger : T.sub }}>{age == null ? "—" : `${age}d`}</td>
                    <td style={TD}>{r.account || "—"}</td>
                    <td style={TD_DESC}>{r.short_description || "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {jiraBlocked.length > CAP && <MoreRow n={jiraBlocked.length - CAP} to="/jira-blockers" />}
        </ListCard>
      </div>
    </>
  )
}
