import { useMemo, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { Printer } from "lucide-react"
import { T } from "../lib/theme.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { DeltaLine } from "../components/KpiRow.jsx"
import {
  computeKpis, qualityMetrics, backlogForecast, accountChurnRisk,
  previousWindow, filterRowsByDate,
} from "../lib/stats.js"
import {
  fmtDuration, fmtFullDate, deltaColor, fmtDeltaCount, fmtDeltaPct, fmtDeltaDuration, SLA_COLOR,
} from "../lib/format.js"

/* ============================================================================
 * Monthly Summary — a manager-ready, print-first period-over-period report.
 *
 * Computes a current window (default 30d, anchored to the data snapshot) vs the
 * immediately-preceding equal window across the FULL dataset, independent of the
 * global analyst/date filters. Headline KPIs carry deltas; backlog outlook,
 * accounts to watch, and a per-analyst snapshot round it out. The control strip
 * and Print button are `.no-print`, and the app chrome (sidebar/top bar) is
 * already `.no-print`, so "Print / Save as PDF" yields a clean one-pager.
 * ========================================================================== */

const WINDOWS = [30, 60, 90]
const pct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`)

export default function MonthlySummaryReport() {
  const { rows, enrichedAllJoined, snapshotMs, filename } = useOutletContext()
  const [win, setWin] = useState(30)
  const all = useMemo(() => enrichedAllJoined || [], [enrichedAllJoined])

  // Anchor "now" to the snapshot; fall back to the latest created date so the
  // report still works if snapshotMs is somehow absent (keeps Date.now() out of
  // render — react-hooks/purity).
  const refNow = useMemo(() => {
    if (snapshotMs) return snapshotMs
    let mx = 0
    for (const r of all) { const t = r._created ? r._created.getTime() : 0; if (t > mx) mx = t }
    return mx || null
  }, [snapshotMs, all])

  const report = useMemo(() => {
    if (!refNow) return null
    const to = refNow
    const from = to - win * 864e5
    const prev = previousWindow(from, to)
    const cur = filterRowsByDate(all, from, to, "_created")
    const prv = filterRowsByDate(all, prev.from, prev.to, "_created")
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
      backlog: backlogForecast(all, refNow),
      watch: accountChurnRisk(all, refNow, win).slice(0, 5),
      analysts,
    }
  }, [all, refNow, win])

  if (!rows) return <Section title="Monthly Summary"><EmptyState /></Section>
  if (!report) return <Section title="Monthly Summary"><Card><div style={{ color: T.sub, fontSize: 13 }}>No dated cases to summarize.</div></Card></Section>

  const { k, kp, q, qp, backlog } = report
  const metrics = [
    { label: `Cases created (${win}d)`, value: k.total.toLocaleString(),
      delta: { text: fmtDeltaCount(k.total, kp.total), color: T.sub } },
    { label: "SLA compliance", value: pct(k.slaRate), accent: SLA_COLOR(k.slaRate),
      delta: { text: fmtDeltaPct(k.slaRate, kp.slaRate), color: deltaColor((k.slaRate ?? 0) - (kp.slaRate ?? 0), "up") } },
    { label: "Median resolution", value: fmtDuration(k.resP50),
      delta: { text: fmtDeltaDuration(k.resP50, kp.resP50), color: deltaColor((k.resP50 ?? 0) - (kp.resP50 ?? 0), "down") } },
    { label: "Avg first response", value: fmtDuration(k.avgFrt),
      delta: { text: fmtDeltaDuration(k.avgFrt, kp.avgFrt), color: deltaColor((k.avgFrt ?? 0) - (kp.avgFrt ?? 0), "down") } },
    { label: "First-contact resolution", value: pct(q.fcrRate),
      delta: { text: fmtDeltaPct(q.fcrRate, qp.fcrRate), color: deltaColor((q.fcrRate ?? 0) - (qp.fcrRate ?? 0), "up") } },
    { label: "Reopen rate", value: pct(q.reopenRate),
      delta: { text: fmtDeltaPct(q.reopenRate, qp.reopenRate), color: deltaColor((q.reopenRate ?? 0) - (qp.reopenRate ?? 0), "down") } },
  ]

  return (
    <Section title="Monthly Summary">
      {/* Control strip — hidden when printed */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: T.sub }}>Window</span>
        <div style={{ display: "flex", gap: 4 }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              style={{
                padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
                border: `1px solid ${w === win ? T.accent : T.border}`,
                background: w === win ? T.accentTint : T.surface,
                color: w === win ? T.accentDeep : T.sub,
              }}
            >{w}d</button>
          ))}
        </div>
        <button
          onClick={() => window.print()}
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, background: T.accent, color: "#fff", border: `1px solid ${T.accentDeep}` }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      {/* Report header */}
      <div style={{ marginBottom: 16 }}>
        <div className="display" style={{ fontSize: 26, color: T.ink, letterSpacing: "-0.015em" }}>
          Support Operations — {win}-Day Summary
        </div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 6 }}>
          {fmtFullDate(report.from)} – {fmtFullDate(report.to)} <span style={{ color: T.muted }}>vs. prior {win} days</span>
          {filename ? <span style={{ color: T.muted }}> · source: {filename}</span> : null}
        </div>
        <div style={{ color: T.muted, fontSize: 11.5, marginTop: 3 }}>
          All metrics cover cases <strong>created</strong> in the window, across all analysts. Snapshot {fmtFullDate(report.to)}.
        </div>
      </div>

      {/* KPI deltas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        {metrics.map((m) => (
          <Card key={m.label} style={{ position: "relative", overflow: "hidden", padding: "16px 18px 18px" }}>
            <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: m.accent || T.ink, opacity: 0.8 }} />
            <div className="eyebrow" style={{ color: T.muted }}>{m.label}</div>
            <div className="display" style={{ fontSize: 34, lineHeight: 1.05, marginTop: 8, color: m.accent || T.ink, letterSpacing: "-0.02em", fontFeatureSettings: '"tnum"' }}>{m.value}</div>
            <DeltaLine text={m.delta.text} color={m.delta.color} />
          </Card>
        ))}
      </div>

      {/* Backlog outlook */}
      <Card style={{ marginTop: 12 }}>
        <div className="eyebrow" style={{ color: T.muted }}>Backlog outlook</div>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 12 }}>
          <Mini label="Open now" value={backlog.currentOpen.toLocaleString()} color={T.ink} />
          <Mini
            label="Net / week (4-wk avg)"
            value={`${backlog.weeklyNet > 0 ? "+" : ""}${backlog.weeklyNet.toFixed(1)}`}
            color={backlog.weeklyNet < 0 ? T.ok : backlog.weeklyNet > 0 ? T.danger : T.muted}
          />
          <Mini
            label="Projected to clear"
            value={backlog.shrinking ? `~${Math.ceil(backlog.weeksToClear)} wk${Math.ceil(backlog.weeksToClear) === 1 ? "" : "s"}` : "Not clearing"}
            color={backlog.shrinking ? T.ok : T.danger}
            hint={backlog.shrinking && backlog.clearDate ? `around ${fmtFullDate(backlog.clearDate)}` : "intake ≥ resolution at current pace"}
          />
        </div>
      </Card>

      {/* Accounts to watch */}
      {report.watch.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ color: T.muted }}>Accounts to watch</div>
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

      {/* Per-analyst snapshot */}
      <Card style={{ marginTop: 12 }}>
        <div className="eyebrow" style={{ color: T.muted }}>By analyst ({win}d)</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
          <thead>
            <tr style={{ background: T.surfaceAlt }}>
              <th style={TH}>Analyst</th>
              <th style={{ ...TH, textAlign: "right" }}>Cases</th>
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
                <td className="mono" style={{ ...TD, textAlign: "right", color: SLA_COLOR(a.k.slaRate), fontWeight: 600 }}>{pct(a.k.slaRate)}</td>
                <td className="mono" style={{ ...TD, textAlign: "right" }}>{fmtDuration(a.k.resP50)}</td>
                <td className="mono" style={{ ...TD, textAlign: "right" }}>{pct(a.q.fcrRate)}</td>
                <td className="mono" style={{ ...TD, textAlign: "right", color: a.q.reopenRate > 12 ? T.danger : T.sub }}>{pct(a.q.reopenRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  )
}

const TH = { textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap" }
const TD = { padding: "8px 12px", whiteSpace: "nowrap" }

function Mini({ label, value, color, hint }) {
  return (
    <div>
      <div className="eyebrow" style={{ color: T.muted }}>{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 600, color, lineHeight: 1, marginTop: 6 }}>{value}</div>
      {hint && <div style={{ color: T.sub, fontSize: 11.5, marginTop: 5 }}>{hint}</div>}
    </div>
  )
}
