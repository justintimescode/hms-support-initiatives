import { useMemo } from "react"
import {
  ClipboardList, Clock, Ban, Siren, Users, ArrowRight, Inbox,
} from "lucide-react"
import { T } from "../../lib/theme.js"
import { fmtDuration, priorityColor, ageDays, msUntil } from "../../lib/format.js"
import { Card } from "../layout/Card.jsx"
import { CopyableNumber } from "../CopyableNumber.jsx"
import { StuckCasesList } from "../StuckCasesList.jsx"
import { EscalationRiskTable } from "../charts/sentiment-shared.jsx"
import { useQuery } from "../../lib/useQuery.js"
import { getUpdateQueue } from "../../lib/queries.js"
import {
  teamDay, escalationWatch, slaPressure, STUCK_DAYS, RISK_HIGH, RISK_ELEVATED,
} from "../../lib/myday.js"
import { StatTile, ListCard, MoreRow } from "./shared.jsx"
import { TH, TD, TD_DESC, CAP } from "./table-styles.js"

/* ============================================================================
 * My Day — the MANAGER view: the same live-work triage, but for everyone who
 * reports into the current manager scope.
 *
 * Scope comes from the global Manager filter, so this view and every other
 * team-flavored surface in the app agree on who "the team" is. With no manager
 * selected it spans every analyst in the import (useful for a manager of
 * managers, or an import that has no manager column).
 *
 * Like the analyst view it IGNORES the global date range — it reads
 * `enrichedManagerAll` (manager-scoped, analyst-filter-free, all dates) so
 * drilling into one report never hollows out the roster.
 *
 * The roster's "Needs attention" column is a count of DISTINCT cases, not a
 * weighted score: see the header of lib/myday.js.
 * ========================================================================== */

const NUM = { ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums" }
const TH_NUM = { ...TH, textAlign: "right" }

/** A roster count: colored only when it is non-zero, so a calm row reads calm. */
function Count({ n, tone, title }) {
  return (
    <td className="mono" style={{ ...NUM, color: n ? (tone || T.ink) : T.muted, fontWeight: n ? 600 : 400 }} title={title}>
      {n || "—"}
    </td>
  )
}

export function TeamDay({
  managerSel, managers, toggleManager, setManagers,
  enrichedManagerAll, snapshotMs, hasRows, onOpenAnalyst,
}) {
  // The queue is snapshot-anchored in SQL; pass the whole manager multi-select
  // so it covers exactly the people the in-memory rollup covers.
  const uq = useQuery(
    () => getUpdateQueue({ manager: managerSel, snapshotMs }),
    [managerSel, snapshotMs],
    { enabled: hasRows && snapshotMs != null },
  )

  const rows = useMemo(() => enrichedManagerAll || [], [enrichedManagerAll])
  const open = useMemo(() => rows.filter((r) => r._isOpen), [rows])
  const queue = uq.data || null

  // One rollup drives the tiles, the roster and the totals row.
  const day = useMemo(() => teamDay(rows, queue), [rows, queue])
  const esc = useMemo(() => escalationWatch(rows), [rows])
  const sla = useMemo(() => slaPressure(open), [open])

  const overdue = queue?.overdue || []
  const jiraBlocked = useMemo(
    () =>
      open
        .filter((r) => (r._jiraActiveTickets?.length || 0) > 0)
        .sort((a, b) => (ageDays(b._created) || 0) - (ageDays(a._created) || 0)),
    [open],
  )

  const t = day.totals
  const teamLabel =
    managerSel.length === 0 ? "all teams" : managerSel.length === 1 ? managerSel[0] : `${managerSel.length} teams`

  return (
    <>
      {/* team scope — the global Manager filter, reachable without leaving the page */}
      <Card style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Users size={14} strokeWidth={2.25} style={{ color: T.accent }} />
          Whose team? · {teamLabel} · {day.memberCount} analyst{day.memberCount === 1 ? "" : "s"} with live work
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <ScopeChip active={managerSel.length === 0} onClick={() => setManagers([])} label="All teams" />
          {(managers || []).map(([name, count]) => (
            <ScopeChip
              key={name}
              active={managerSel.includes(name)}
              onClick={() => toggleManager(name)}
              label={name}
              count={count}
            />
          ))}
        </div>
      </Card>

      {/* team summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 12 }}>
        <StatTile
          to="/workload" icon={Users} label="Open across team"
          value={t.open}
          tone={T.accent}
          hint={`${t.flagged} case${t.flagged === 1 ? "" : "s"} need attention`}
        />
        <StatTile
          to="/update-queue" icon={ClipboardList} label="Overdue updates"
          value={uq.loading ? "…" : t.overdue}
          tone={t.overdue ? T.danger : T.ok}
          hint={uq.loading ? "loading…" : t.dueSoon ? `${t.dueSoon} due soon` : t.overdue ? "past their SOP cadence" : "all current"}
        />
        <StatTile
          to="/sentiment" icon={Siren} label="Escalation watch"
          value={esc.counts.total}
          tone={esc.counts.escalated || esc.counts.high ? T.danger : esc.counts.elevated ? T.warn : T.ok}
          hint={
            esc.counts.escalated
              ? `${esc.counts.escalated} already escalated`
              : esc.counts.high
                ? `${esc.counts.high} at high risk`
                : esc.counts.elevated
                  ? `${esc.counts.elevated} elevated`
                  : esc.counts.pushback
                    ? `${esc.counts.pushback} pushed back on a fix`
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
          to="/backlog" icon={Inbox} label={`Stuck ${STUCK_DAYS}+ days`}
          value={t.stuck}
          tone={t.stuck ? T.warn : T.ok}
          hint={t.stuck ? `open over ${STUCK_DAYS} days` : "nothing stuck"}
        />
        <StatTile
          to="/jira-blockers" icon={Ban} label="Jira-blocked"
          value={t.jiraBlocked}
          tone={t.jiraBlocked ? T.accent : T.ok}
          hint={t.jiraBlocked ? "waiting on engineering" : "none blocked"}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 1 — the roster: who needs help today */}
        <Card>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Users size={14} strokeWidth={2.25} style={{ color: T.accent }} />
              Team roster · most pressure first
            </div>
            <span style={{ color: T.sub, fontSize: 12 }}>activate a row to open that analyst's day</span>
          </div>
          <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.5, marginTop: 6, maxWidth: 760 }}>
            <strong>Needs attention</strong> counts distinct open cases tripping at least one signal — an overdue
            customer update, a breached or same-day SLA, stuck past {STUCK_DAYS} days, or an escalation signal from the
            customer. A case shouting through four signals still counts once.
          </div>
          {day.members.length === 0 ? (
            <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
              No live work in this scope. Either the team is clear, or this import has no open cases for it.
            </div>
          ) : (
            <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }} aria-label="Team roster by pressure">
                <thead>
                  <tr style={{ background: T.surfaceAlt }}>
                    <th style={TH}>Analyst</th>
                    <th style={TH_NUM}>Open</th>
                    <th style={TH_NUM}>Needs attention</th>
                    <th style={TH_NUM}>Overdue</th>
                    <th style={TH_NUM}>Due soon</th>
                    <th style={TH_NUM}>SLA breached</th>
                    <th style={TH_NUM}>Escalation</th>
                    <th style={TH_NUM}>Stuck</th>
                    <th style={TH_NUM}>Jira-blocked</th>
                    <th style={TH} />
                  </tr>
                </thead>
                <tbody>
                  {day.members.map((m) => (
                    <tr
                      key={m.name}
                      className="sentiment-row"
                      onClick={() => onOpenAnalyst(m.name)}
                      style={{ borderBottom: `1px solid ${T.borderSoft}` }}
                    >
                      <td style={{ ...TD, fontWeight: 600 }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onOpenAnalyst(m.name) }}
                          style={{ appearance: "none", background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: T.accentDeep, cursor: "pointer" }}
                        >
                          {m.name}
                        </button>
                      </td>
                      <Count n={m.open} tone={T.ink} />
                      <Count n={m.flagged} tone={m.flagged ? T.danger : T.ink} />
                      <Count n={m.overdue} tone={T.danger} />
                      <Count n={m.dueSoon} tone={T.warn} />
                      <Count n={m.slaBreached} tone={T.danger} title={`${m.slaDue24} due within 24h`} />
                      <Count
                        n={m.escalationWatch}
                        tone={m.escalated || m.highRisk ? T.danger : T.warn}
                        title={`${m.escalated} escalated · ${m.highRisk} high · ${m.elevatedRisk} elevated`}
                      />
                      <Count n={m.stuck} tone={T.warn} />
                      <Count n={m.jiraBlocked} tone={T.accentDeep} />
                      <td style={{ ...TD, textAlign: "right", color: T.muted }}>
                        <ArrowRight size={14} strokeWidth={2.25} aria-hidden />
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: T.surfaceAlt, fontWeight: 600 }}>
                    <td style={{ ...TD, color: T.sub }}>Team total</td>
                    <Count n={t.open} tone={T.ink} />
                    <Count n={t.flagged} tone={t.flagged ? T.danger : T.ink} />
                    <Count n={t.overdue} tone={T.danger} />
                    <Count n={t.dueSoon} tone={T.warn} />
                    <Count n={t.slaBreached} tone={T.danger} />
                    <Count n={t.escalationWatch} tone={T.danger} />
                    <Count n={t.stuck} tone={T.warn} />
                    <Count n={t.jiraBlocked} tone={T.accentDeep} />
                    <td style={TD} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* 2 — escalation watch across the team */}
        <ListCard
          id="escalation-watch"
          icon={Siren} title="At risk of escalation" count={esc.counts.total}
          to="/sentiment" linkLabel="Case Sentiment"
          note={
            <>
              Read from what customers actually wrote — unanswered messages, repeated chasing, a recurring issue,
              souring tone, urgency and business impact. Cases they have <strong>already escalated</strong> come first;
              then <span style={{ color: T.danger }}>high risk ≥ {RISK_HIGH}</span> and{" "}
              <span style={{ color: T.warn }}>elevated ≥ {RISK_ELEVATED}</span>. A Solution Proposed case only appears
              if the customer escalated or pushed back on the fix. This is the list to work through before a 1:1.
            </>
          }
          emptyMsg="No open or proposed case in this team is showing escalation signals."
        >
          <EscalationRiskTable rows={esc.watch} showStage bare cap={CAP + 4} ariaLabel="Team cases at risk of escalation" />
        </ListCard>

        {/* 3 — overdue customer updates across the team */}
        <ListCard
          icon={ClipboardList} title="Overdue customer updates" count={overdue.length}
          to="/update-queue" linkLabel="Full Update Queue"
          loading={uq.loading} error={uq.error}
          emptyMsg="No overdue updates in this team — every open case is within its SOP cadence."
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Case</th>
                <th style={TH}>Analyst</th>
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
                  <td style={{ ...TD, color: T.sub }}>{r.assignedTo || "Unassigned"}</td>
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

        {/* 4 — SLA pressure across the team */}
        <ListCard
          icon={Clock} title="SLA at risk" count={sla.atRisk.length}
          to="/sla" linkLabel="SLA Performance"
          emptyMsg="No open case in this team is breached or due within the week."
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Case</th>
                <th style={TH}>Analyst</th>
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
                    <td style={{ ...TD, color: T.sub }}>{r.assigned_to || "Unassigned"}</td>
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

        {/* 5 — stuck cases, with the owner shown (the 1:1 list) */}
        <StuckCasesList rows={rows} showAssignee />

        {/* 6 — Jira-blocked across the team */}
        <ListCard
          icon={Ban} title="Jira-blocked open cases" count={jiraBlocked.length}
          to="/jira-blockers" linkLabel="Cases w/ Jira Blockers"
          emptyMsg="No open case in this team is waiting on an active Jira ticket."
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Case</th>
                <th style={TH}>Analyst</th>
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
                    <td style={{ ...TD, color: T.sub }}>{r.assigned_to || "Unassigned"}</td>
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

function ScopeChip({ active, onClick, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="hoverlift"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "7px 12px", borderRadius: T.radiusSm, cursor: "pointer",
        background: active ? T.vizAccentSoft : T.surface,
        border: `1px solid ${active ? T.vizAccent : T.border}`,
        color: active ? T.vizAccentDeep : T.ink,
        fontSize: 13, fontWeight: active ? 600 : 400,
      }}
    >
      {label}
      {count != null && <span className="mono" style={{ color: active ? T.vizAccentDeep : T.muted, fontSize: 11 }}>{count}</span>}
    </button>
  )
}
