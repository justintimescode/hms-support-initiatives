/* ================= Metric explainers =================
 * Plain-language + exact-formula descriptions of HOW each calculated stat is
 * derived, kept in one place so the same wording appears wherever a metric is
 * shown (the headline KPI strip, the Monthly Summary, Jira stats…). These feed
 * the "?" InfoTip next to a stat's label.
 *
 * The numbers here are NOT hardcoded copies — the SLA cadence / first-response
 * thresholds are imported straight from sop-thresholds.js (the single source of
 * truth that computeSlaSop also reads), so if the SOP changes in one place the
 * tooltip changes with it. Everything else mirrors the formulas in
 * src/lib/stats.js (computeKpis / qualityMetrics) and computeSlaSop in
 * src/lib/enrich.js so the explanation and the number never drift. */
import {
  SUPPORT_THRESHOLDS_MS,
  INITIAL_RESPONSE_MS,
  DEV_HARD_RULE_MS,
} from "./sop-thresholds.js";

/* Render a raw millisecond threshold as a compact human duration (30m, 1h, 3d).
 * Kept local + tiny: these are exact SOP values (whole minutes/hours/days), so
 * this doesn't need the general fmtDuration's rounding. */
const dur = (ms) => {
  const m = ms / 60000;
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 24) return `${h}h`;
  return `${h / 24}d`;
};

const PRIORITIES = [
  { rank: 1, name: "P1 Critical" },
  { rank: 2, name: "P2 Major" },
  { rank: 3, name: "P3 Medium" },
  { rank: 4, name: "P4 Standard" },
];

const devHardRuleDays = DEV_HARD_RULE_MS / (24 * 60 * 60 * 1000);

/* A small SOP threshold table shared by the SLA explainer. Priority → the
 * first-response target and the recurring update cadence, pulled live from
 * sop-thresholds.js. */
function SopThresholdTable() {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        margin: "6px 0 2px",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <thead>
        <tr style={{ textAlign: "left", opacity: 0.75 }}>
          <th style={{ fontWeight: 600, padding: "2px 8px 2px 0" }}>Priority</th>
          <th style={{ fontWeight: 600, padding: "2px 8px 2px 0" }}>First response</th>
          <th style={{ fontWeight: 600, padding: "2px 0" }}>Update cadence</th>
        </tr>
      </thead>
      <tbody>
        {PRIORITIES.map((p) => (
          <tr key={p.rank}>
            <td style={{ padding: "2px 8px 2px 0", whiteSpace: "nowrap" }}>{p.name}</td>
            <td style={{ padding: "2px 8px 2px 0" }}>
              {INITIAL_RESPONSE_MS[p.rank] != null ? `≤ ${dur(INITIAL_RESPONSE_MS[p.rank])}` : "—"}
            </td>
            <td style={{ padding: "2px 0" }}>
              {SUPPORT_THRESHOLDS_MS[p.rank] != null ? `every ${dur(SUPPORT_THRESHOLDS_MS[p.rank])}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const METRIC_EXPLAINERS = {
  slaCompliance: (
    <>
      <span>
        <strong>cases met ÷ cases eligible × 100.</strong> A case is eligible when
        it has a defined SOP cadence (support cases by priority; development
        cases by the {devHardRuleDays}-day rule). It counts as “met” only if it
        never missed its first-response target <em>and</em> never let an update
        gap exceed its cadence. Shows “—” when nothing is eligible.
      </span>
      <SopThresholdTable />
      <span style={{ display: "block", marginTop: 4 }}>
        Development cases instead breach if there’s no Infor comment for{" "}
        {devHardRuleDays} days. First-response is the tighter of the two clocks;
        a miss there is attributed to “initial”, otherwise to “cadence”.
      </span>
    </>
  ),

  medianResolution:
    "Middle resolution time across closed cases (50th percentile): half resolved faster, half slower. Resolution time = closed_at − created. Median is the headline because a few very long cases skew the plain average. The sub-line adds p90 and the average.",

  p90Resolution:
    "90th-percentile resolution time across closed cases (resolution time = closed_at − created): 90% resolved at least this fast, so the slowest 10% start here. Surfaces the long tail the median hides.",

  avgFirstResponse:
    "Mean of (first Infor response − created) over every case that has a recorded first response. Targets by priority: P1 ≤ 30m, P2/P3 ≤ 2h, P4 ≤ 4h.",

  firstContactResolution:
    "closed cases resolved in ≤ 1 analyst touch ÷ all closed cases × 100. “One touch” is approximated from analyst journal entries (≤ 1 Infor-authored reply).",

  reopenRate:
    "cases that carry a close timestamp but aren’t currently closed ÷ all cases ever closed × 100. Counts cases that were resolved and then bounced back open.",

  openAtRisk:
    "Count of open cases past their SOP next-update-due time (breached) plus those due within the next 24h. Due time = last Infor update + the priority’s cadence (P1 1h · P2 1d · P3 3d · P4 7d), or before any response, created + the first-response target.",

  netChange:
    "cases created − cases closed in the selected window. Positive means the backlog grew; negative means it shrank.",

  medianResolveJira:
    "Middle time from creation to resolution for Jiras resolved in the last 30 days (50th percentile) — half resolved faster, half slower.",
};
