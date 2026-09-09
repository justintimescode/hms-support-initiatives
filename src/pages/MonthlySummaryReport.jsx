import { useMemo, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { Printer, User, Users, Globe } from "lucide-react"
import { T } from "../lib/theme.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { DeltaLine } from "../components/KpiRow.jsx"
import { InfoTip } from "../components/InfoTip.jsx"
import { METRIC_EXPLAINERS } from "../lib/metricExplainers.jsx"
import {
  computeKpis, qualityMetrics, computeInteractionStats, backlogForecast, accountChurnRisk,
  openWorkHealth, monthlyScorecard, previousWindow, filterRowsByDate, topCounts,
} from "../lib/stats.js"
import { summarizeSentiment } from "../lib/sentiment.js"
import {
  fmtDuration, fmtFullDate, fmtAxisDate, deltaColor, fmtDeltaCount, fmtDeltaPct,
  fmtDeltaDuration, SLA_COLOR,
} from "../lib/format.js"

/* ============================================================================
 * Monthly Summary — a manager-ready, print-first period-over-period report.
 *
 * SCOPE. The report follows the global Manager and Analyst filters: it reads
 * `enrichedAnalyst` (manager -> analyst scoped, pre-date-filter), so picking a
 * manager yields that team's summary and picking an analyst yields that person's.
 * It deliberately ignores the global DATE filter — its own 30/60/90 window
 * control owns the time axis, because the whole report is a
 * current-vs-previous-equal-window comparison. Both facts are stated in the
 * printed header so a saved PDF is never ambiguous about what it covers.
 *
 * The current window is anchored to the data snapshot, not the wall clock, so a
 * report printed days later still describes the import it came from.
 *
 * SECTIONS. Headline KPIs with deltas, SOP-cadence breach reasons, the open queue
 * right now, customer-escalation early warning, backlog burn-down forecast, a
 * calendar-month scorecard, where the work came from, accounts to watch, and a
 * per-analyst snapshot (team scopes only). The control strip and Print button are
 * `.no-print`, the app chrome is already `.no-print`, and every card carries
 * `msr-card` so no card is split across a page break.
 * ========================================================================== */

const WINDOWS = [30, 60, 90]
const SCORECARD_MONTHS = 6
const STUCK_DAYS = 30
const pct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`)
const signed = (n) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`

const PRINT_CSS = `
  .msr-card { break-inside: avoid; page-break-inside: avoid; }
  @media print {
    .msr-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
    .msr-split { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  }
`

/** Top-N by `getKey` over the current window, each row carrying its count in the
 *  previous window so a *rising* category is visible, not merely a large one. */
const rankWithDelta = (cur, prv, getKey, n) => {
  const prev = new Map()
  for (const r of prv) {
    const k = getKey(r) || "Unknown"
    prev.set(k, (prev.get(k) || 0) + 1)
  }
  return topCounts(cur, getKey, n).map((x) => ({ ...x, prev: prev.get(x.name) || 0 }))
}

export default function MonthlySummaryReport() {
  const { rows, enrichedAnalyst, snapshotMs, filename, analyst, manager } = useOutletContext()
  const [win, setWin] = useState(30)
  const scoped = useMemo(() => enrichedAnalyst || [], [enrichedAnalyst])

  // Which slice of the export this report covers. Analyst wins over manager
  // because it is the narrower of the two filters.
  const scope = useMemo(() => {
    if (analyst && analyst !== "__all__") return { label: analyst, kind: "analyst", icon: User }
    if (manager && manager !== "__all__") return { label: `${manager}'s team`, kind: "manager", icon: Users }
    return { label: "All analysts", kind: "all", icon: Globe }
  }, [analyst, manager])

  // Anchor "now" to the snapshot; fall back to the latest created date so the
  // report still works if snapshotMs is somehow absent (keeps Date.now() out of
  // render — react-hooks/purity).
  const refNow = useMemo(() => {
    if (snapshotMs) return snapshotMs
    let mx = 0
    for (const r of scoped) { const t = r._created ? r._created.getTime() : 0; if (t > mx) mx = t }
    return mx || null
  }, [snapshotMs, scoped])

  const report = useMemo(() => {
    if (!refNow) return null
    const to = refNow
    const from = to - win * 864e5
    const prev = previousWindow(from, to)
    const cur = filterRowsByDate(scoped, from, to, "_created")
    const prv = filterRowsByDate(scoped, prev.from, prev.to, "_created")
    // Throughput is a close-date question, not a create-date one: these hold the
    // cases actually *finished* in each window, whenever they were opened.
    const curDone = filterRowsByDate(scoped, from, to, "_closed").filter((r) => r._isClosed)
    const prvDone = filterRowsByDate(scoped, prev.from, prev.to, "_closed").filter((r) => r._isClosed)

    const byAnalyst = new Map()
    for (const r of cur) {
      const name = r.assigned_to || "Unassigned"
      if (!byAnalyst.has(name)) byAnalyst.set(name, [])
      byAnalyst.get(name).push(r)
    }
    const analysts = [...byAnalyst.entries()]
      .map(([name, list]) => ({ name, k: computeKpis(list), q: qualityMetrics(list) }))
      .sort((a, b) => b.k.total - a.k.total)
      .slice(0, 12)

    return {
      from, to,
      k: computeKpis(cur), kp: computeKpis(prv),
      q: qualityMetrics(cur), qp: qualityMetrics(prv),
      ix: computeInteractionStats(cur), ixp: computeInteractionStats(prv),
      done: curDone.length, donePrev: prvDone.length,
      health: openWorkHealth(scoped, refNow, { stuckDays: STUCK_DAYS }),
      // Point-in-time escalation risk over the whole scoped queue, not just the
      // window: an open case that has been souring for six months is exactly the
      // one a 30-day slice would miss.
      sentiment: summarizeSentiment(scoped).summary,
      scorecard: monthlyScorecard(scoped, { months: SCORECARD_MONTHS }),
      categories: rankWithDelta(cur, prv, (r) => r._category, 6),
      accounts: rankWithDelta(cur, prv, (r) => r.account, 6),
      backlog: backlogForecast(scoped, refNow),
      watch: accountChurnRisk(scoped, refNow, win).slice(0, 5),
      analysts,
      analystCount: byAnalyst.size,
    }
  }, [scoped, refNow, win])

  if (!rows) return <Section title="Monthly Summary"><EmptyState /></Section>
  if (!report || !scoped.length) {
    return (
      <Section title="Monthly Summary">
        <Card>
          <div style={{ color: T.sub, fontSize: 13 }}>
            No dated cases to summarize{scope.kind === "all" ? "" : ` for ${scope.label}`}.
          </div>
        </Card>
      </Section>
    )
  }

  const { k, kp, q, qp, ix, ixp, health, sentiment, backlog } = report
  const netNow = k.total - report.done
  const netPrev = kp.total - report.donePrev

  const metrics = [
    { label: `Cases created (${win}d)`, value: k.total.toLocaleString(),
      delta: { text: fmtDeltaCount(k.total, kp.total), color: T.sub } },
    { label: `Cases closed (${win}d)`, value: report.done.toLocaleString(),
      delta: { text: fmtDeltaCount(report.done, report.donePrev), color: deltaColor(report.done - report.donePrev, "up") } },
    { label: "Net change", value: signed(netNow), hint: "created − closed", info: METRIC_EXPLAINERS.netChange,
      accent: netNow > 0 ? T.danger : netNow < 0 ? T.ok : T.muted,
      delta: { text: fmtDeltaCount(netNow, netPrev), color: deltaColor(netNow - netPrev, "down") } },
    { label: "SLA compliance", value: pct(k.slaRate), accent: SLA_COLOR(k.slaRate), info: METRIC_EXPLAINERS.slaCompliance,
      delta: { text: fmtDeltaPct(k.slaRate, kp.slaRate), color: deltaColor((k.slaRate ?? 0) - (kp.slaRate ?? 0), "up") } },
    { label: "Median resolution", value: fmtDuration(k.resP50), info: METRIC_EXPLAINERS.medianResolution,
      delta: { text: fmtDeltaDuration(k.resP50, kp.resP50), color: deltaColor((k.resP50 ?? 0) - (kp.resP50 ?? 0), "down") } },
    { label: "p90 resolution", value: fmtDuration(k.resP90), hint: "the slowest 10% start here", info: METRIC_EXPLAINERS.p90Resolution,
      delta: { text: fmtDeltaDuration(k.resP90, kp.resP90), color: deltaColor((k.resP90 ?? 0) - (kp.resP90 ?? 0), "down") } },
    { label: "Avg first response", value: fmtDuration(k.avgFrt), info: METRIC_EXPLAINERS.avgFirstResponse,
      delta: { text: fmtDeltaDuration(k.avgFrt, kp.avgFrt), color: deltaColor((k.avgFrt ?? 0) - (kp.avgFrt ?? 0), "down") } },
    { label: "First-contact resolution", value: pct(q.fcrRate), info: METRIC_EXPLAINERS.firstContactResolution,
      delta: { text: fmtDeltaPct(q.fcrRate, qp.fcrRate), color: deltaColor((q.fcrRate ?? 0) - (qp.fcrRate ?? 0), "up") } },
    { label: "Reopen rate", value: pct(q.reopenRate), info: METRIC_EXPLAINERS.reopenRate,
      delta: { text: fmtDeltaPct(q.reopenRate, qp.reopenRate), color: deltaColor((q.reopenRate ?? 0) - (qp.reopenRate ?? 0), "down") } },
  ]

  const ScopeIcon = scope.icon
  const showAnalystTable = report.analystCount > 1
  const showSentiment = sentiment.openTotal > 0 &&
    (sentiment.escalatedOpen || sentiment.highRisk || sentiment.elevatedRisk || sentiment.unansweredTotal)

  return (
    <Section title="Monthly Summary">
      <style>{PRINT_CSS}</style>

      {/* Control strip — hidden when printed */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: T.sub }}>Window</span>
        <div style={{ display: "flex", gap: 4 }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              style={{
                padding: "6px 12px", borderRadius: T.radiusSm, cursor: "pointer", fontSize: 12, fontWeight: 600,
                border: `1px solid ${w === win ? T.accent : T.border}`,
                background: w === win ? T.accentTint : T.surface,
                color: w === win ? T.onAccentSoft : T.sub,
              }}
            >{w}d</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: T.muted }}>
          Follows the Manager / Analyst filters above; the date filter does not apply here
        </span>
        <button
          onClick={() => window.print()}
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: T.radiusSm, cursor: "pointer", fontSize: 13, fontWeight: 600, background: T.accent, color: T.onAccent, border: `1px solid ${T.accentDeep}` }}
        >
          <Printer size={14} strokeWidth={2.25} /> Print / Save as PDF
        </button>
      </div>

      {/* Report header */}
      <div style={{ marginBottom: 16 }}>
        <div className="display" style={{ fontSize: 28, color: T.ink, letterSpacing: "-0.015em" }}>
          Support Operations — {win}-Day Summary
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
              background: scope.kind === "all" ? T.surfaceAlt : T.accentTint,
              color: scope.kind === "all" ? T.sub : T.onAccentSoft,
              border: `1px solid ${scope.kind === "all" ? T.border : T.accentSoft}`,
            }}
          >
            <ScopeIcon size={14} strokeWidth={2.25} /> {scope.label}
          </span>
          <span className="mono" style={{ fontSize: 12, color: T.sub }}>
            {scoped.length.toLocaleString()} cases in scope
          </span>
        </div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 8 }}>
          {fmtFullDate(report.from)} – {fmtFullDate(report.to)} <span style={{ color: T.muted }}>vs. prior {win} days</span>
          {filename ? <span style={{ color: T.muted }}> · source: {filename}</span> : null}
        </div>
        <div style={{ color: T.muted, fontSize: 12, marginTop: 3 }}>
          Intake, SLA and response metrics cover cases <strong>created</strong> in the window; throughput and
          resolution time cover cases <strong>closed</strong> in it. Queue counts are as of the snapshot,{" "}
          {fmtFullDate(report.to)}. SLA is the Infor SOP update cadence.
        </div>
      </div>

      {/* KPI deltas */}
      <div className="msr-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        {metrics.map((m) => (
          <Card key={m.label} className="msr-card" style={{ position: "relative", overflow: "hidden", padding: "16px 18px 18px" }}>
            <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: m.accent || T.ink }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <div className="eyebrow">{m.label}</div>
              {m.info && <span className="no-print"><InfoTip label={m.label} side="left" width={m.info === METRIC_EXPLAINERS.slaCompliance ? 320 : 260}>{m.info}</InfoTip></span>}
            </div>
            <div className="display" style={{ fontSize: 34, lineHeight: 1.05, marginTop: 8, color: m.accent || T.ink, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{m.value}</div>
            {m.hint && <div style={{ color: T.muted, fontSize: 11, marginTop: 4 }}>{m.hint}</div>}
            <DeltaLine text={m.delta.text} color={m.delta.color} />
          </Card>
        ))}
      </div>

      <div className="msr-split" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
        {/* Why the SLA misses missed */}
        <Card className="msr-card">
          <div className="eyebrow">SOP cadence — where it broke ({win}d)</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
            Mutually exclusive reasons: a missed first response, or a missed follow-up update. Prior window shown beneath.
          </div>
          <MiniRow>
            <Mini label="Cadence-eligible" value={k.slaEligible.toLocaleString()} color={T.ink} hint={`${kp.slaEligible.toLocaleString()} prior`} />
            <Mini label="Met in full" value={k.slaMet.toLocaleString()} color={T.ok} hint={`${kp.slaMet.toLocaleString()} prior`} />
            <Mini label="Missed initial response" value={k.slaMissedInitial.toLocaleString()} color={k.slaMissedInitial ? T.danger : T.muted} hint={`${kp.slaMissedInitial.toLocaleString()} prior`} />
            <Mini label="Missed update cadence" value={k.slaMissedCadence.toLocaleString()} color={k.slaMissedCadence ? T.warn : T.muted} hint={`${kp.slaMissedCadence.toLocaleString()} prior`} />
          </MiniRow>
        </Card>

        {/* The queue as it stands */}
        <Card className="msr-card">
          <div className="eyebrow">Open queue at snapshot</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
            Point-in-time across the whole scope — not limited to the {win}-day window.
          </div>
          <MiniRow>
            <Mini label="Open" value={health.open.toLocaleString()} color={T.ink}
              hint={health.avgAgeMs != null ? `avg age ${fmtDuration(health.avgAgeMs)}` : null} />
            <Mini label="Solution proposed" value={health.solutionProposed.toLocaleString()} color={T.sub} hint="awaiting customer" />
            <Mini label="Breached now" value={health.breached.toLocaleString()} color={health.breached ? T.danger : T.ok} />
            <Mini label="Due ≤ 24h" value={health.due24.toLocaleString()} color={health.due24 ? T.warn : T.muted} />
            <Mini label={`Stuck > ${STUCK_DAYS}d`} value={health.stuck.toLocaleString()} color={health.stuck ? T.warn : T.muted} />
            <Mini label="Jira-blocked" value={health.jiraBlocked.toLocaleString()} color={health.jiraBlocked ? T.accent : T.muted} hint="engineering-owned" />
          </MiniRow>
        </Card>
      </div>

      {/* Escalation early warning — only when the queue has something to warn about */}
      {showSentiment ? (
        <Card className="msr-card" style={{ marginTop: 12 }}>
          <div className="eyebrow">Escalation early warning</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
            Open queue at snapshot, from the on-device sentiment engine. Risk is driven by silence — unanswered
            messages, customer chases and analyst staleness — not tone alone.
          </div>
          <MiniRow>
            <Mini label="Already escalated" value={sentiment.escalatedOpen.toLocaleString()} color={sentiment.escalatedOpen ? T.danger : T.muted} />
            <Mini label="High risk" value={sentiment.highRisk.toLocaleString()} color={sentiment.highRisk ? T.danger : T.muted} />
            <Mini label="Elevated risk" value={sentiment.elevatedRisk.toLocaleString()} color={sentiment.elevatedRisk ? T.warn : T.muted} />
            <Mini label="Unanswered messages" value={sentiment.unansweredTotal.toLocaleString()} color={sentiment.unansweredTotal ? T.warn : T.muted} />
            <Mini label="Pushback on proposal" value={sentiment.spPushback.toLocaleString()} color={sentiment.spPushback ? T.danger : T.muted} hint="reopen watch" />
          </MiniRow>
        </Card>
      ) : null}

      {/* Backlog outlook */}
      <Card className="msr-card" style={{ marginTop: 12 }}>
        <div className="eyebrow">Backlog outlook</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          Monte Carlo burn-down bootstrapped from the last {backlog.sampleWeeks} mature
          week{backlog.sampleWeeks === 1 ? "" : "s"} of intake vs resolution.
        </div>
        {backlog.insufficient ? (
          <div style={{ color: T.sub, fontSize: 13, marginTop: 12 }}>
            Not enough weekly history in this scope to forecast — {backlog.currentOpen.toLocaleString()} open now,
            running {signed(Math.round(backlog.weeklyNet * 10) / 10)} per week.
          </div>
        ) : (
          <MiniRow>
            <Mini label="Open now" value={backlog.currentOpen.toLocaleString()} color={T.ink} />
            <Mini
              label="Net / week"
              value={`${backlog.weeklyNet > 0 ? "+" : ""}${backlog.weeklyNet.toFixed(1)}`}
              color={backlog.weeklyNet < 0 ? T.ok : backlog.weeklyNet > 0 ? T.danger : T.muted}
            />
            <Mini
              label="Projected to clear"
              value={backlog.medianClearWeeks != null
                ? `~${Math.ceil(backlog.medianClearWeeks)} wk${Math.ceil(backlog.medianClearWeeks) === 1 ? "" : "s"}`
                : "Not clearing"}
              color={backlog.medianClearWeeks != null ? T.ok : T.danger}
              hint={backlog.medianClearWeeks != null && backlog.clearDate
                ? `median trial — around ${fmtFullDate(backlog.clearDate)}`
                : "intake ≥ resolution at current pace"}
            />
            <Mini
              label="Chance it clears"
              value={backlog.pClear != null ? `${Math.round(backlog.pClear * 100)}%` : "—"}
              color={backlog.pClear >= 0.5 ? T.ok : backlog.pClear > 0 ? T.warn : T.danger}
              hint={backlog.projHorizon ? `within ${backlog.projHorizon.weeks} weeks` : null}
            />
            {backlog.projHorizon && (
              <Mini
                label={`Open in ${backlog.projHorizon.weeks} wks`}
                value={backlog.projHorizon.mid.toLocaleString()}
                color={backlog.projHorizon.mid > backlog.currentOpen ? T.danger : T.ok}
                hint={`p10–p90 ${backlog.projHorizon.lo.toLocaleString()}–${backlog.projHorizon.hi.toLocaleString()}`}
              />
            )}
          </MiniRow>
        )}
      </Card>

      {/* Calendar-month scorecard */}
      {report.scorecard.length > 1 && (
        <Card className="msr-card" style={{ marginTop: 12 }}>
          <div className="eyebrow">
            Month by month — {fmtAxisDate(report.scorecard[0].month)} to {fmtAxisDate(report.scorecard[report.scorecard.length - 1].month)}
          </div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
            Intake, SLA and first response by created month; closed, resolution time and FCR by close month. Both edge
            rows can be partial — the export starts mid-month on intake, and the newest month ends at the snapshot.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Month</th>
                <th style={{ ...TH, textAlign: "right" }}>Created</th>
                <th style={{ ...TH, textAlign: "right" }}>Closed</th>
                <th style={{ ...TH, textAlign: "right" }}>Net</th>
                <th style={{ ...TH, textAlign: "right" }}>SLA</th>
                <th style={{ ...TH, textAlign: "right" }}>Miss init·cad</th>
                <th style={{ ...TH, textAlign: "right" }}>Median res</th>
                <th style={{ ...TH, textAlign: "right" }}>Median FRT</th>
                <th style={{ ...TH, textAlign: "right" }}>FCR</th>
              </tr>
            </thead>
            <tbody>
              {report.scorecard.map((m) => (
                <tr key={m.month} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td style={{ ...TD, fontWeight: 600 }}>{fmtAxisDate(m.month)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{m.created.toLocaleString()}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{m.closed.toLocaleString()}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: m.net > 0 ? T.danger : m.net < 0 ? T.ok : T.muted, fontWeight: 600 }}>{signed(m.net)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: SLA_COLOR(m.slaRate), fontWeight: 600 }}>{pct(m.slaRate)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: T.sub }}>{m.missedInitial}·{m.missedCadence}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{fmtDuration(m.resP50)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{fmtDuration(m.frtP50)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{pct(m.fcrRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Where the work came from */}
      <div className="msr-split" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
        <RankCard title={`Top categories (${win}d)`} rows={report.categories} />
        <RankCard title={`Top accounts (${win}d)`} rows={report.accounts} />
      </div>

      {/* Accounts to watch */}
      {report.watch.length > 0 && (
        <Card className="msr-card" style={{ marginTop: 12 }}>
          <div className="eyebrow">Accounts to watch</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Highest churn-risk accounts — rising volume, falling SLA, or open blockers (last {win}d vs prior).</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Account</th>
                <th style={{ ...TH, textAlign: "right" }}>Cases (now·prev)</th>
                <th style={{ ...TH, textAlign: "right" }}>SLA now</th>
                <th style={{ ...TH, textAlign: "right" }}>Open blocked</th>
                <th style={{ ...TH, textAlign: "right" }}>Open breached</th>
              </tr>
            </thead>
            <tbody>
              {report.watch.map((a) => (
                <tr key={a.account} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td style={{ ...TD, fontWeight: 600, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{a.account}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{a.casesNow}·{a.casesPrev}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: SLA_COLOR(a.slaNow) }}>{pct(a.slaNow)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: a.openBlockers ? T.accent : T.muted }}>{a.openBlockers}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: a.breachedOpen ? T.danger : T.muted }}>{a.breachedOpen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Per-analyst snapshot — replaced by conversation load when the scope is
          already a single person, where a one-row table says nothing. */}
      {showAnalystTable ? (
        <Card className="msr-card" style={{ marginTop: 12 }}>
          <div className="eyebrow">By analyst ({win}d)</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Analyst</th>
                <th style={{ ...TH, textAlign: "right" }}>Cases</th>
                <th style={{ ...TH, textAlign: "right" }}>Still open</th>
                <th style={{ ...TH, textAlign: "right" }}>SLA</th>
                <th style={{ ...TH, textAlign: "right" }}>Median res</th>
                <th style={{ ...TH, textAlign: "right" }}>FCR</th>
                <th style={{ ...TH, textAlign: "right" }}>Reopen</th>
              </tr>
            </thead>
            <tbody>
              {report.analysts.map((a) => (
                <tr key={a.name} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td style={{ ...TD, fontWeight: 600 }}>{a.name}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{a.k.total}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: a.k.open ? T.sub : T.muted }}>{a.k.open}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: SLA_COLOR(a.k.slaRate), fontWeight: 600 }}>{pct(a.k.slaRate)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{fmtDuration(a.k.resP50)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{pct(a.q.fcrRate)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: a.q.reopenRate > 12 ? T.danger : T.sub }}>{pct(a.q.reopenRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="msr-card" style={{ marginTop: 12 }}>
          <div className="eyebrow">Conversation load ({win}d)</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
            How much back-and-forth each case took. Shown in place of the per-analyst table, which has nothing to
            compare when the report already covers one person.
          </div>
          <MiniRow>
            <Mini label="Avg turns / case" value={ix.avgTurns.toFixed(1)} color={T.ink} hint={`${ixp.avgTurns.toFixed(1)} prior`} />
            <Mini label="Avg customer turns" value={ix.avgCustomer.toFixed(1)} color={T.sub} />
            <Mini label="Avg analyst turns" value={ix.avgAnalyst.toFixed(1)} color={T.sub} />
            <Mini label="Multi-touch" value={`${ix.multiTouchPct.toFixed(0)}%`} color={T.sub} hint="more than 2 turns" />
          </MiniRow>
        </Card>
      )}
    </Section>
  )
}

const TH = { textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap" }
const TD = { padding: "8px 12px", whiteSpace: "nowrap" }

function Mini({ label, value, color, hint }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 600, color, lineHeight: 1, marginTop: 6 }}>{value}</div>
      {hint && <div style={{ color: T.sub, fontSize: 12, marginTop: 5 }}>{hint}</div>}
    </div>
  )
}

/** Stat strip for the Mini cards. A grid rather than a wrapping flex row so an
 *  overflowing stat lands in a column aligned with the row above it instead of
 *  stranding itself under the widest label. */
function MiniRow({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))", gap: "18px 22px", marginTop: 14 }}>
      {children}
    </div>
  )
}

/** Top-N table with a now-vs-prior count and a signed delta per row. */
function RankCard({ title, rows }) {
  return (
    <Card className="msr-card">
      <div className="eyebrow">{title}</div>
      {rows.length === 0 ? (
        <div style={{ color: T.sub, fontSize: 12, marginTop: 10 }}>Nothing in this window.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
          <thead>
            <tr style={{ background: T.surfaceAlt }}>
              <th style={TH}>Name</th>
              <th style={{ ...TH, textAlign: "right" }}>Now</th>
              <th style={{ ...TH, textAlign: "right" }}>Prev</th>
              <th style={{ ...TH, textAlign: "right" }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = r.count - r.prev
              return (
                <tr key={r.name} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td style={{ ...TD, fontWeight: 600, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{r.count}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: T.muted }}>{r.prev}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: d > 0 ? T.danger : d < 0 ? T.ok : T.muted, fontWeight: 600 }}>{signed(d)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}
