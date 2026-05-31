import { useMemo } from "react"
import { useOutletContext, Link } from "react-router-dom"
import {
  Sun, ClipboardList, Clock, Inbox, Ban, ArrowRight, UserRound,
} from "lucide-react"
import { T } from "../lib/theme.js"
import { fmtDuration, fmtFullDate, priorityColor, ageDays, msUntil } from "../lib/format.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { Pill } from "../components/Pill.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { CopyableNumber } from "../components/CopyableNumber.jsx"
import { StuckCasesList } from "../components/StuckCasesList.jsx"
import { useQuery } from "../lib/useQuery.js"
import { getUpdateQueue } from "../lib/queries.js"
import { slaRiskOf, stuckCases } from "../lib/stats.js"

/* ============================================================================
 * My Day — a personal triage landing page for one analyst.
 *
 * A focused recomposition of data that already exists elsewhere:
 *   - overdue customer updates  → getUpdateQueue() (DuckDB, snapshot-anchored)
 *   - SLA at risk               → slaRiskOf() over the analyst's open cases
 *   - stuck cases (30d+)        → StuckCasesList (reused)
 *   - Jira-blocked open cases   → rows with active parsed Jira tickets
 *
 * Deliberately IGNORES the global date-range filter — "my day" is about live
 * open work, not a historical window — so it reads `enrichedAnalyst` (analyst-
 * filtered, all dates) rather than the date-filtered `enriched`.
 * ========================================================================== */

const TH = { textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap" }
const TD = { padding: "8px 12px", whiteSpace: "nowrap" }
const TD_DESC = { padding: "8px 12px", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }

const CAP = 8 // rows shown per section before "view all"

export default function MyDayPage() {
  const ctx = useOutletContext()
  const { rows, analyst, setAnalyst, analysts, enrichedAnalyst, snapshotMs } = ctx
  const me = analyst
  const isPicked = me && me !== "__all__"

  // Update Queue (overdue / due-soon) for this analyst, snapshot-anchored.
  const uq = useQuery(
    () => getUpdateQueue({ analyst: me, snapshotMs }),
    [me, snapshotMs],
    { enabled: !!rows && isPicked && snapshotMs != null },
  )

  const open = useMemo(
    () => (enrichedAnalyst || []).filter((r) => !r._isClosed),
    [enrichedAnalyst],
  )

  // SLA pressure on open cases, "right now". slaRiskOf() reads the clock
  // internally so Date.now() stays out of this render body (react-hooks/purity).
  const sla = useMemo(() => {
    const breached = [], due24 = [], dueWeek = []
    for (const r of open) {
      const k = slaRiskOf(r)
      if (k === "breached") breached.push(r)
      else if (k === "due24") due24.push(r)
      else if (k === "dueWeek") dueWeek.push(r)
    }
    const byDue = (a, b) => (a._slaDue?.getTime() || 0) - (b._slaDue?.getTime() || 0)
    breached.sort(byDue); due24.sort(byDue); dueWeek.sort(byDue)
    return { breached, due24, dueWeek, atRisk: [...breached, ...due24, ...dueWeek] }
  }, [open])

  const jiraBlocked = useMemo(
    () =>
      open
        .filter((r) => (r._jiraActiveTickets?.length || 0) > 0)
        .sort((a, b) => (ageDays(b._created) || 0) - (ageDays(a._created) || 0)),
    [open],
  )

  // Matches StuckCasesList's own filter so the tile count equals the list below.
  const stuckCount = useMemo(() => stuckCases(enrichedAnalyst || [], 30).length, [enrichedAnalyst])

  if (!rows) {
    return (
      <Section title="My Day">
        <EmptyState
          title="Load some data to see your day"
          message="Drop a ServiceNow case export on the Connections page, then pick who you are — this page becomes your personal triage view."
        />
      </Section>
    )
  }

  // No analyst chosen yet → let the user say who they are.
  if (!isPicked) {
    return (
      <Section
        title="My Day"
        subtitle="A personal triage view: your overdue updates, SLA pressure, stuck cases, and Jira-blocked work in one screen. Pick who you are to begin — or use the analyst selector in the top bar."
      >
        <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="eyebrow" style={{ color: T.muted }}>
            <UserRound size={12} style={{ verticalAlign: "middle", marginRight: 6, color: T.accent }} />
            Whose day?
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(analysts || []).map(([name, count]) => (
              <button
                key={name}
                onClick={() => setAnalyst(name)}
                className="hoverlift"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                  background: T.surface, border: `1px solid ${T.border}`,
                  color: T.ink, fontSize: 13, fontFamily: "Geist, DM Sans, sans-serif",
                }}
              >
                {name}
                <span className="mono" style={{ color: T.muted, fontSize: 11 }}>{count}</span>
              </button>
            ))}
          </div>
        </Card>
      </Section>
    )
  }

  const overdue = uq.data?.overdue || []
  const dueSoon = uq.data?.dueSoon || []

  return (
    <Section
      title="My Day"
      subtitle="Your live open work — independent of the global date range. The update queue is anchored to the data snapshot; SLA, stuck, and blocker views reflect right now."
    >
      {/* who + freshness */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <Pill color={T.accent}>
          <Sun size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />
          Viewing as {me}
        </Pill>
        <button
          onClick={() => setAnalyst("__all__")}
          style={{ background: "none", border: "none", color: T.sub, cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
        >
          switch
        </button>
        {snapshotMs && (
          <span style={{ color: T.muted, fontSize: 12, marginLeft: "auto" }}>
            data as of {fmtFullDate(snapshotMs)}
          </span>
        )}
      </div>

      {/* summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 12 }}>
        <StatTile
          to="/update-queue" icon={ClipboardList} label="Overdue updates"
          value={uq.loading ? "…" : overdue.length}
          tone={overdue.length ? T.danger : T.ok}
          hint={uq.loading ? "loading…" : dueSoon.length ? `${dueSoon.length} due soon` : "all current"}
        />
        <StatTile
          to="/sla" icon={Clock} label="SLA at risk"
          value={sla.atRisk.length}
          tone={sla.breached.length ? T.danger : sla.due24.length ? T.warn : T.ok}
          hint={sla.breached.length ? `${sla.breached.length} breached` : sla.due24.length ? `${sla.due24.length} due <24h` : "comfortable"}
        />
        <StatTile
          to="/backlog" icon={Inbox} label="Stuck (30d+)"
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
        {/* 1 — Overdue customer updates */}
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

        {/* 2 — SLA at risk */}
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
                const ms = msUntil(r._slaDue)
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

        {/* 3 — Stuck cases (reuse the shared list, scoped to this analyst) */}
        <StuckCasesList rows={enrichedAnalyst || []} />

        {/* 4 — Jira-blocked */}
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
                    <td className="mono" style={{ ...TD, color: T.accent }}>{(r._jiraActiveTickets || []).join(", ") || "—"}</td>
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
    </Section>
  )
}

function StatTile({ to, icon: Icon, label, value, tone, hint }) {
  return (
    <Link to={to} style={{ textDecoration: "none", color: T.ink }}>
      <Card className="hoverlift" style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: T.sub }}>
          <Icon size={14} style={{ color: tone }} />
          <span className="eyebrow" style={{ color: T.muted }}>{label}</span>
        </div>
        <div className="mono" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, color: tone }}>{value}</div>
        <div style={{ color: T.sub, fontSize: 12 }}>{hint}</div>
      </Card>
    </Link>
  )
}

function ListCard({ icon: Icon, title, count, to, linkLabel, loading, error, emptyMsg, children }) {
  const showBody = !loading && !error && count > 0
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="eyebrow" style={{ color: T.muted, display: "flex", alignItems: "center", gap: 7 }}>
          <Icon size={13} style={{ color: T.accent }} />
          {title}
          <span className="mono" style={{ color: count ? T.ink : T.muted, fontWeight: 600, letterSpacing: 0 }}>· {count}</span>
        </div>
        {to && (
          <Link to={to} style={{ color: T.accent, fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
            {linkLabel} <ArrowRight size={12} />
          </Link>
        )}
      </div>
      {loading ? (
        <div style={{ color: T.sub, fontSize: 13, marginTop: 12 }}>Loading…</div>
      ) : error ? (
        <div style={{ color: T.danger, fontSize: 13, marginTop: 12 }}>Couldn't load this section.</div>
      ) : !showBody ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>{emptyMsg}</div>
      ) : (
        <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">{children}</div>
      )}
    </Card>
  )
}

function MoreRow({ n, to }) {
  return (
    <div style={{ marginTop: 10, textAlign: "center" }}>
      <Link to={to} style={{ color: T.sub, fontSize: 12, textDecoration: "none" }}>
        + {n} more — view all <ArrowRight size={11} style={{ verticalAlign: "middle" }} />
      </Link>
    </div>
  )
}
