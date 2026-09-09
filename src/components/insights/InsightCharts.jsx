import { Fragment, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
  ScatterChart, Scatter, ReferenceLine,
} from "recharts";
import {
  T, neutralHeat, AXIS_TICK, AXIS_TICK_CAT, TOOLTIP_STYLE, LEGEND_STYLE,
  BAR_RADIUS_V, BAR_RADIUS_H,
} from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { AGING_BUCKETS } from "../../lib/constants.js";
import {
  ageComparison, escalationUrgencyMatrix, URGENCY_BANDS, openCasesPerJira,
  jiraStatusBandMatrix, accountJiraMatrix, blockerQuadrant,
} from "../../lib/insight-filters.js";
import { openCasesHistogram } from "../../lib/jira-stats.js";
import { blockersByJira } from "../../lib/insight-rank.js";
import { ESC_ESCALATED, ESC_AT_RISK, ESC_WATCH, ESC_NONE } from "../../lib/insight-thresholds.js";
import { CaseRecordList, JiraRecordList, JiraCasesRecordList } from "./ClusterRecordList.jsx";

/* Visualizations for the Operations view. Every one of them:
 *   - receives finished data (these components run selectors, never metric math);
 *   - is snapshot-anchored, because the projections it reads already are;
 *   - clicks through to a real record list. An aggregate you cannot open is a
 *     number you have to take on faith.
 *
 * Recharts note: recharts 3 alphabetizes stacked-series legends, so any chart
 * whose series order carries meaning pins an explicit `payload`. */

/* Axis chrome, spread onto every axis on this page. The single `AXIS` object
 * this replaces set the axis LINE color and left tick TEXT at recharts' own
 * default, which is why the Operations page silently differed from every other
 * chart in the app; tick text now comes from the shared AXIS_TICK/AXIS_TICK_CAT. */
const AXIS_LINE = { axisLine: { stroke: T.vizAxis }, tickLine: { stroke: T.vizAxis } };

/* The plot ground. Spread onto the EXISTING height wrapper of each chart —
 * never a nested element, or ResponsiveContainer measures 0px. */
const PLOT_WELL = { background: T.vizWell, borderRadius: T.radiusMd };

const CardHead = ({ title, subtitle }) => (
  <>
    <div className="eyebrow">{title}</div>
    {subtitle && <div style={{ color: T.sub, fontSize: 12, marginTop: 4, marginBottom: 10, maxWidth: 620 }}>{subtitle}</div>}
  </>
);

/* ===================== Jira age vs case age ===================== */

/* Duotone: Infor Purple leads and the charcoal reference mark carries the
 * second population. T.jiraBlue is a link-affordance TEXT color for Jira keys
 * and stays out of chart geometry entirely. */
const AGE_SERIES = [
  { key: "cases", label: "ServiceNow cases", color: T.vizAccent },
  { key: "jira", label: "Jira tickets", color: T.vizCat },
];

/** Both sides on ONE shared bucket axis, which is the only way the comparison
 *  means anything. Grouped (not stacked) — these are two populations, not parts
 *  of a whole. */
export function AgeComparisonBlock({ clusters }) {
  const [pick, setPick] = useState(null);

  const data = useMemo(() => ageComparison(clusters, AGING_BUCKETS), [clusters]);
  const picked = useMemo(() => {
    if (!pick) return null;
    const cases = [];
    const jira = [];
    for (const cl of clusters) {
      for (const c of cl.cases) if (c.ageBucket === pick) cases.push(c);
      for (const j of cl.jira) if (j.ageBucket === pick) jira.push(j);
    }
    return { cases, jira };
  }, [pick, clusters]);

  const empty = data.every((d) => d.cases === 0 && d.jira === 0);

  return (
    <Card>
      <CardHead
        title="Jira age vs case age"
        subtitle="Who has been waiting longer. Bars to the right on the case series and to the left on the Jira series mean customers were queueing before engineering had a ticket. Click a bucket for the records."
      />
      {empty ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", padding: "18px 0" }}>
          No correlated records in this view.
        </div>
      ) : (
        <div style={{ height: 230, ...PLOT_WELL }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis dataKey="name" {...AXIS_LINE} tick={AXIS_TICK_CAT} />
              <YAxis allowDecimals={false} {...AXIS_LINE} tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: T.vizWell }} />
              {/* Pinned payload: recharts 3 would otherwise alphabetize. */}
              <Legend
                wrapperStyle={LEGEND_STYLE}
                iconType="square"
                payload={AGE_SERIES.map((s) => ({ value: s.label, type: "square", color: s.color, id: s.key }))}
              />
              {AGE_SERIES.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  radius={BAR_RADIUS_V}
                  cursor="pointer"
                  onClick={(d) => setPick(d?.payload?.name ?? null)}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {picked && (
        <>
          <CaseRecordList title={`Cases aged ${pick}`} cases={picked.cases} onClose={() => setPick(null)} />
          <JiraRecordList title={`Tickets aged ${pick}`} jira={picked.jira} />
        </>
      )}
    </Card>
  );
}

/* ================= impacted cases per Jira ================= */

/** Reuses the existing `openCasesHistogram` so this chart and the Jira
 *  Statistics one cannot disagree — both bucket the same per-key open counts.
 *
 *  Fed by `openCasesPerJira` rather than `blockersByJira`: this memo recomputes
 *  on every filter change, and the scoring pass `blockersByJira` also does is
 *  work the histogram has no use for (measured 139ms vs a few ms on a 20k-case
 *  import). */
export function ImpactHistogramBlock({ clusters }) {
  const [pick, setPick] = useState(null);

  const perKey = useMemo(() => openCasesPerJira(clusters), [clusters]);
  const data = useMemo(
    () => openCasesHistogram(perKey.map((b) => ({ openCount: b.openCount }))),
    [perKey],
  );

  const picked = useMemo(() => {
    if (!pick) return null;
    const lo = pick === "5+" ? 5 : Number(pick);
    const hi = pick === "5+" ? Infinity : Number(pick);
    const rows = perKey.filter((b) => b.openCount >= lo && b.openCount <= hi);
    return { jira: rows.map((b) => b.jira).filter(Boolean), cases: rows.flatMap((b) => b.cases) };
  }, [pick, perKey]);

  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <Card>
      <CardHead
        title="Open cases per Jira"
        subtitle="Is the pain concentrated in a few tickets or spread thin? Only tickets with at least one truly-open case. Click a bar to see them."
      />
      {total === 0 ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", padding: "18px 0" }}>
          No ticket in this view has an open case behind it.
        </div>
      ) : (
        <div style={{ height: 230, ...PLOT_WELL }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} vertical={false} />
              <XAxis dataKey="name" {...AXIS_LINE} tick={AXIS_TICK_CAT} />
              <YAxis allowDecimals={false} {...AXIS_LINE} tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: T.vizWell }} />
              <Bar dataKey="count" name="Jira tickets" fill={T.vizAccent} radius={BAR_RADIUS_V} cursor="pointer" onClick={(d) => setPick(d?.payload?.name ?? null)} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {picked && (
        <>
          <JiraRecordList title={`Tickets with ${pick} open case${pick === "1" ? "" : "s"}`} jira={picked.jira} onClose={() => setPick(null)} />
          <CaseRecordList title="Their cases" cases={picked.cases} />
        </>
      )}
    </Card>
  );
}

/* ============== escalation x urgency heatmap ============== */

/* FILL tones for the three escalation levels. Purple carries the base stop,
 * Infor Yellow the middle and Infor Red the terminal one — the only
 * three-stop arrangement the brand sanctions, and the reason "watch" and
 * "escalated" no longer render as the same red. Fills only: Infor Yellow is
 * 1.88:1 and can never be text. */
const ESC_TONE = {
  [ESC_ESCALATED]: T.dangerFill,
  [ESC_AT_RISK]: T.warnFill,
  [ESC_WATCH]: T.vizAccent,
};

/* TEXT positions for the same three levels, since the fills above are not
 * text-safe. Every use is paired with the level's own written label, which is
 * the second channel the palette requires. */
const ESC_TEXT = {
  [ESC_ESCALATED]: T.danger,
  [ESC_AT_RISK]: T.warn,
  [ESC_WATCH]: T.ok,
};

// Shared with the band-distribution chart and the Jira-status × band heatmap
// below, so "high" always reads the same color everywhere on this page.
const BAND_FILL = { high: T.dangerFill, medium: T.vizAccent, low: T.categorical[7] };

// Same bands in text positions; dangerFill is a chart fill, not a text color.
const BAND_TEXT = { high: T.danger, medium: T.ok, low: T.sub };

// De-emphasis for the bands a selection excludes: the next lighter step of the
// same family, never an opacity knock-back.
const BAND_FILL_DIM = { high: T.dangerSoft, medium: T.vizAccentSoft, low: T.surfaceAlt };

/** Escalation level against normalized urgency. "Unknown" urgency gets its own
 *  column rather than being folded into Low — an unknown priority is not a low
 *  one, and pretending otherwise would understate real risk. */
export function EscalationHeatmapBlock({ clusters, snapshotMs }) {
  const [pick, setPick] = useState(null);

  const matrix = useMemo(() => escalationUrgencyMatrix(clusters), [clusters]);
  const maxCount = useMemo(
    () => matrix.cells.reduce((mx, c) => (c.count > mx ? c.count : mx), 0),
    [matrix],
  );
  // Per-Jira-key rows for the picked cell, via the SAME projection the Blockers
  // page uses — a cluster with three tickets and five cases yields three rows,
  // each listing only the cases actually linked to that key.
  const pickedRows = useMemo(
    () => (pick ? blockersByJira(pick.clusters, snapshotMs) : null),
    [pick, snapshotMs],
  );

  const cellBg = (cell) => {
    if (!cell.count) return T.surface;
    const tone = ESC_TONE[cell.escalation] || T.categorical[7];
    // Linear intensity against the busiest cell — enough to read the shape
    // without implying a precision the counts do not have. Mixed INTO the plot
    // well rather than composited with alpha() so the ramp is theme-correct.
    const pct = Math.round((0.1 + 0.5 * (cell.count / (maxCount || 1))) * 100);
    return `color-mix(in srgb, ${tone} ${pct}%, ${T.vizWell})`;
  };

  const open = (cell) => {
    if (!cell.count) return;
    setPick(cell);
  };

  return (
    <Card>
      <CardHead
        title="Escalation × urgency"
        subtitle="Where the escalations actually sit. Escalation is derived (explicit escalation events, SOP-SLA breaches, sentiment risk, stale Jiras) — ServiceNow has no native escalation field. Click any cell for its clusters."
      />
      <div style={{ overflowX: "auto" }} className="scrollbar">
        {/* Full-width like the Account x hot Jira key grid: `tableLayout: fixed`
            plus one sized label column makes the urgency columns split the rest
            evenly, which is what `repeat(N, minmax(_, 1fr))` does over there.
            `minWidth` keeps the wrapper's horizontal scroll doing its job on a
            narrow viewport instead of crushing the cells. */}
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", tableLayout: "fixed", minWidth: 620 }}>
          <colgroup>
            <col style={{ width: 110 }} />
            {matrix.urgencyBands.map((b) => (
              <col key={b.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: "8px 14px" }} />
              {matrix.urgencyBands.map((b) => (
                <th key={b.id} style={{ padding: "8px 14px", color: T.sub, fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" }}>
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.escalationLevels.map((level) => (
              <tr key={level}>
                <td style={{ padding: "8px 14px", color: ESC_TEXT[level] || T.muted, fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", textTransform: "capitalize" }}>
                  {level}
                </td>
                {matrix.urgencyBands.map((b) => {
                  const cell = matrix.cell(level, b.id);
                  const active = pick && pick.escalation === level && pick.urgency === b.id;
                  return (
                    <td key={b.id} style={{ padding: 3 }}>
                      <button
                        type="button"
                        onClick={() => open(cell)}
                        disabled={!cell.count}
                        aria-label={`${level} escalation, ${b.label} urgency: ${cell.count} clusters, ${cell.openCases} open cases`}
                        title={`${cell.count} cluster${cell.count === 1 ? "" : "s"} · ${cell.openCases} open case${cell.openCases === 1 ? "" : "s"}`}
                        style={{
                          width: "100%", height: 68, borderRadius: T.radiusSm,
                          border: `1px solid ${active ? T.vizAccent : T.borderSoft}`,
                          background: cellBg(cell),
                          color: cell.count ? T.ink : T.muted,
                          cursor: cell.count ? "pointer" : "default",
                          fontVariantNumeric: "tabular-nums",
                          fontSize: 22, fontWeight: 600,
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                        }}
                      >
                        {cell.count || "·"}
                        {cell.openCases > 0 && (
                          <span style={{ fontSize: 12, fontWeight: 500, color: T.sub }}>{cell.openCases} open</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pick && pick.count > 0 && (
        <JiraCasesRecordList
          title={`${pick.escalation} escalation · ${URGENCY_BANDS.find((b) => b.id === pick.urgency)?.label} urgency`}
          rows={pickedRows}
          onClose={() => setPick(null)}
        />
      )}
    </Card>
  );
}

/* ================== band distribution ================== */

/** Cluster counts by band. Always all three rows, so an empty band reads as zero
 *  rather than disappearing. */
export function BandBreakdownBlock({ counts, onPick, active }) {
  const total = counts.reduce((s, c) => s + c.count, 0);
  return (
    <Card>
      <CardHead title="Clusters by impact band" subtitle="Bands come from named score thresholds, not from where the data happens to fall." />
      {total === 0 ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", padding: "18px 0" }}>Nothing to band.</div>
      ) : (
        <div style={{ height: 180, ...PLOT_WELL }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={counts} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
              <CartesianGrid stroke={T.vizGrid} horizontal={false} />
              <XAxis type="number" allowDecimals={false} {...AXIS_LINE} tick={AXIS_TICK} />
              <YAxis type="category" dataKey="band" width={62} {...AXIS_LINE} tick={AXIS_TICK_CAT} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: T.vizWell }} />
              <Bar dataKey="count" name="Clusters" radius={BAR_RADIUS_H} cursor="pointer" onClick={(d) => onPick?.(d?.payload?.band ?? null)}>
                {counts.map((c) => (
                  <Cell
                    key={c.band}
                    fill={(active && active !== c.band ? BAND_FILL_DIM[c.band] : BAND_FILL[c.band]) || T.categorical[7]}
                    stroke={T.vizStroke}
                    strokeWidth={1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/* ============== Jira status x impact band heatmap ============== */

/** Where the engineering side of the blockage actually sits: is the pain stuck
 *  in unstarted backlog, or in tickets that are actually being worked? A
 *  different question from the escalation x urgency heatmap above (that one is
 *  the CASE side, at cluster granularity); this one is per-Jira-key, so a
 *  cluster with three tickets in three different states contributes to three
 *  different cells rather than one. */
export function JiraStatusBandHeatmapBlock({ blockerRows }) {
  const [pick, setPick] = useState(null); // { statusCategory, band }

  const matrix = useMemo(() => jiraStatusBandMatrix(blockerRows), [blockerRows]);
  const maxCount = useMemo(
    () => matrix.cells.reduce((mx, c) => (c.count > mx ? c.count : mx), 0),
    [matrix],
  );

  const cellBg = (cell) => {
    if (!cell.count) return T.surface;
    const tone = BAND_FILL[cell.band] || T.categorical[7];
    // Same intensity channel as the escalation grid, mixed into the plot well.
    const pct = Math.round((0.1 + 0.5 * (cell.count / (maxCount || 1))) * 100);
    return `color-mix(in srgb, ${tone} ${pct}%, ${T.vizWell})`;
  };

  const open = (cell) => {
    if (!cell.count) return;
    setPick(cell);
  };

  return (
    <Card>
      <CardHead
        title="Jira status × impact band"
        subtitle="Where the engineering-side blockage sits. Rows are the ticket's real workflow status; columns are the cluster's impact band. A ticket with no live Jira record (an RN- reference, or a key outside the current sync) lands in “Not synced” rather than a guess. Click any cell for its tickets."
      />
      <div style={{ overflowX: "auto" }} className="scrollbar">
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: "6px 10px" }} />
              {matrix.bands.map((band) => (
                <th key={band} style={{ padding: "6px 10px", color: BAND_TEXT[band] || T.sub, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", textTransform: "capitalize" }}>
                  {band}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.statusCategories.map((sc) => (
              <tr key={sc.id}>
                <td style={{ padding: "6px 10px", color: T.sub, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>
                  {sc.label}
                </td>
                {matrix.bands.map((band) => {
                  const cell = matrix.cell(sc.id, band);
                  const active = pick && pick.statusCategory === sc.id && pick.band === band;
                  return (
                    <td key={band} style={{ padding: 2 }}>
                      <button
                        type="button"
                        onClick={() => open(cell)}
                        disabled={!cell.count}
                        aria-label={`${sc.label} status, ${band} band: ${cell.count} tickets, ${cell.openCases} open cases`}
                        title={`${cell.count} ticket${cell.count === 1 ? "" : "s"} · ${cell.openCases} open case${cell.openCases === 1 ? "" : "s"}`}
                        style={{
                          width: 96, height: 56, borderRadius: T.radiusSm,
                          border: `1px solid ${active ? T.vizAccent : T.borderSoft}`,
                          background: cellBg(cell),
                          color: cell.count ? T.ink : T.muted,
                          cursor: cell.count ? "pointer" : "default",
                          fontVariantNumeric: "tabular-nums",
                          fontSize: 18, fontWeight: 600,
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                        }}
                      >
                        {cell.count || "·"}
                        {cell.openCases > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 500, color: T.sub }}>{cell.openCases} open</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pick && pick.count > 0 && (
        <JiraCasesRecordList
          title={`${pick.statusCategory} · ${pick.band} band`}
          rows={pick.rows}
          onClose={() => setPick(null)}
        />
      )}
    </Card>
  );
}

/* ============== account x hot-Jira-key heatmap ============== */

/** Does a hot ticket hit many DIFFERENT customers (escalate loudly — this is
 *  everyone's problem) or the SAME account repeatedly (an account
 *  conversation and maybe a workaround, not necessarily a bigger engineering
 *  fire)? Scoped to the busiest tickets and, within that, the busiest
 *  accounts — see `accountJiraMatrix` for why the ranking is scoped rather
 *  than global. */
export function AccountJiraHeatmapBlock({ blockerRows }) {
  const [pick, setPick] = useState(null); // { account, key }

  const matrix = useMemo(() => accountJiraMatrix(blockerRows), [blockerRows]);

  const colMax = useMemo(
    () => matrix.keys.map((k) => matrix.accounts.reduce((mx, a) => Math.max(mx, matrix.cell(a, k.key).length), 0)),
    [matrix],
  );
  const rowTotals = useMemo(
    () => matrix.accounts.map((a) => matrix.keys.reduce((s, k) => s + matrix.cell(a, k.key).length, 0)),
    [matrix],
  );
  const colTotals = useMemo(
    () => matrix.keys.map((k) => matrix.accounts.reduce((s, a) => s + matrix.cell(a, k.key).length, 0)),
    [matrix],
  );

  const pickedCases = useMemo(
    () => (pick ? matrix.cell(pick.account, pick.key) : []),
    [pick, matrix],
  );

  if (!matrix.accounts.length) {
    return (
      <Card>
        <CardHead title="Account × hot Jira key" subtitle="Which customers sit behind the busiest blocking tickets." />
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", padding: "18px 0" }}>No blocking tickets in this view.</div>
      </Card>
    );
  }

  const TOTAL_CELL = { background: T.surfaceSunk, color: T.ink, fontWeight: 700 };

  return (
    <Card>
      <CardHead
        title="Account × hot Jira key"
        subtitle="Which customers sit behind the busiest blocking tickets — a column with one dark cell is a single account's problem; a column spread evenly across rows is everyone's problem. Color is relative to the busiest account ON THAT TICKET. Click a tile for its cases."
      />
      <div style={{ overflowX: "auto" }} className="scrollbar">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(140px, 200px) repeat(${matrix.keys.length}, minmax(72px, 1fr)) 56px`,
            gap: 2,
            minWidth: "100%",
          }}
        >
          <div />
          {matrix.keys.map((k) => (
            <div key={k.key} className="mono" style={{ fontSize: 11, fontWeight: 700, textAlign: "center", color: T.jiraBlue, lineHeight: 1.3 }}>
              {k.key}
              <div style={{ fontSize: 10, fontWeight: 500, color: T.sub }}>{k.openCases} open</div>
            </div>
          ))}
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: T.sub, textAlign: "center", alignSelf: "center" }}>Total</div>

          {matrix.accounts.map((account, ri) => (
            <Fragment key={account}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.ink, alignSelf: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={account}>
                {account}
              </div>
              {matrix.keys.map((k, ci) => {
                const cases = matrix.cell(account, k.key);
                const v = cases.length;
                const max = colMax[ci];
                const intensity = v && max ? Math.sqrt(v / max) : 0;
                const frac = v === 0 ? 0 : 0.12 + intensity * 0.6;
                const bg = v === 0 ? T.surfaceAlt : neutralHeat(frac);
                // One text color across the whole ramp: neutralHeat() is bounded
                // short of full Infor Purple precisely so the old white-text flip
                // (which had a band where neither color cleared 4.5:1) can go.
                const textColor = v === 0 ? T.muted : T.ink;
                const isSelected = pick && pick.account === account && pick.key === k.key;
                return (
                  <div
                    key={k.key}
                    onClick={() => {
                      if (v === 0) return;
                      setPick((prev) => (prev && prev.account === account && prev.key === k.key ? null : { account, key: k.key }));
                    }}
                    title={`${account} · ${k.key}: ${v} case${v === 1 ? "" : "s"}`}
                    className="mono"
                    style={{
                      height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 600, color: textColor, background: bg,
                      border: `1px solid ${T.borderSoft}`,
                      outline: isSelected ? `2px solid ${T.vizAccent}` : "none", outlineOffset: -1,
                      borderRadius: T.radiusSm, cursor: v === 0 ? "default" : "pointer",
                    }}
                  >
                    {v === 0 ? <span style={{ color: T.muted }}>·</span> : v}
                  </div>
                );
              })}
              <div className="mono" style={{ ...TOTAL_CELL, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, borderRadius: T.radiusSm }}>
                {rowTotals[ri]}
              </div>
            </Fragment>
          ))}

          <div className="mono" style={{ ...TOTAL_CELL, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: T.radiusSm }}>Total</div>
          {colTotals.map((v, i) => (
            <div key={matrix.keys[i].key} className="mono" style={{ ...TOTAL_CELL, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, borderRadius: T.radiusSm }}>
              {v}
            </div>
          ))}
          <div className="mono" style={{ ...TOTAL_CELL, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, borderRadius: T.radiusSm }}>
            {rowTotals.reduce((s, v) => s + v, 0)}
          </div>
        </div>
      </div>
      {pick && (
        <CaseRecordList
          title={`${pick.account} · ${pick.key}`}
          cases={pickedCases}
          onClose={() => setPick(null)}
        />
      )}
    </Card>
  );
}

/* ============== staleness x blast-radius quadrant ============== */

const QUADRANT_ESC_ORDER = [ESC_ESCALATED, ESC_AT_RISK, ESC_WATCH, ESC_NONE];
const QUADRANT_ESC_LABEL = {
  [ESC_ESCALATED]: "Escalated", [ESC_AT_RISK]: "At-risk", [ESC_WATCH]: "Watch", [ESC_NONE]: "None",
};
/* Bubble outline per escalation level; the achromatic residual carries "none". */
const QUADRANT_ESC_TONE = { ...ESC_TONE, [ESC_NONE]: T.categorical[7] };

/* Bubble interior: the next lighter step of the same family, which keeps
 * overlapping bubbles readable without the decorative alpha() the brand
 * forbids. Every one of these is under 3:1 on the well, which is exactly why
 * each Scatter also carries its 1px tone stroke. */
const QUADRANT_ESC_FILL = {
  [ESC_ESCALATED]: T.dangerSoft,
  [ESC_AT_RISK]: T.warnSoft,
  [ESC_WATCH]: T.vizAccentSoft,
  [ESC_NONE]: T.surfaceAlt,
};

/** One bubble per blocking Jira key: how long it's sat idle (x) against how
 *  many open cases it blocks (y). Bubble size is distinct accounts affected;
 *  color is the worst escalation among its cases. Deliberately unbucketed —
 *  the top-right quadrant (old AND high blast radius) is the "escalate to
 *  engineering today" list, and that only works with real values, not bands. */
export function BlockerQuadrantBlock({ blockerRows }) {
  const { points, medDaysSinceUpdate, medOpenCases } = useMemo(() => blockerQuadrant(blockerRows), [blockerRows]);

  const groups = useMemo(() => {
    const by = new Map(QUADRANT_ESC_ORDER.map((l) => [l, []]));
    for (const p of points) (by.get(p.escalation) || by.get(ESC_NONE)).push(p);
    return QUADRANT_ESC_ORDER.map((level) => ({ level, data: by.get(level) })).filter((g) => g.data.length);
  }, [points]);

  if (points.length < 2) {
    return (
      <Card>
        <CardHead title="Ticket staleness × blast radius" subtitle="Which blocking tickets are both old and hurting the most customers." />
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", padding: "18px 0" }}>
          Needs at least two synced Jira keys with an update timestamp.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        title="Ticket staleness × blast radius"
        subtitle="Each bubble is a blocking Jira key: days since its last update (right = staler) against open cases it blocks (up = more). Bubble size is distinct accounts affected; color is the worst case escalation behind it. Top-right of the dashed lines is the escalate-today list."
      />
      <div style={{ height: 320, marginTop: 8, ...PLOT_WELL }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 16, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={T.vizGrid} />
            <XAxis
              type="number" dataKey="daysSinceUpdate" name="days idle"
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }}
              label={{ value: "days since last Jira update", position: "insideBottom", offset: -2, fill: T.vizCat, fontSize: 11 }}
            />
            <YAxis
              type="number" dataKey="openCases" name="open cases blocked"
              allowDecimals={false}
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }} tickLine={{ stroke: T.vizAxis }}
              label={{ value: "open cases blocked", angle: -90, position: "insideLeft", fill: T.vizCat, fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="accounts" range={[60, 400]} name="accounts affected" />
            <Tooltip content={<QuadrantTip />} cursor={{ strokeDasharray: "3 3", stroke: T.vizAxis }} />
            {medDaysSinceUpdate != null && <ReferenceLine x={medDaysSinceUpdate} stroke={T.vizAxis} strokeDasharray="4 4" strokeWidth={1} />}
            {medOpenCases != null && <ReferenceLine y={medOpenCases} stroke={T.vizAxis} strokeDasharray="4 4" strokeWidth={1} />}
            {groups.map((g) => (
              <Scatter key={g.level} name={QUADRANT_ESC_LABEL[g.level]} data={g.data} fill={QUADRANT_ESC_FILL[g.level] || T.surfaceAlt} stroke={QUADRANT_ESC_TONE[g.level] || T.categorical[7]} strokeWidth={1} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
        {QUADRANT_ESC_ORDER.filter((l) => groups.some((g) => g.level === l)).map((l) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: QUADRANT_ESC_FILL[l], border: `1px solid ${QUADRANT_ESC_TONE[l]}` }} />
            {QUADRANT_ESC_LABEL[l]}
          </span>
        ))}
      </div>
      <div style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>
        Dashed lines: median idle time ({medDaysSinceUpdate != null ? Math.round(medDaysSinceUpdate) : "—"}d) and median open cases
        blocked ({medOpenCases != null ? medOpenCases.toFixed(1) : "—"}) across tickets with a live Jira record.
      </div>
    </Card>
  );
}

function QuadrantTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ ...TOOLTIP_STYLE, maxWidth: 260 }}>
      <div className="mono" style={{ fontWeight: 600, color: T.jiraBlue }}>{d.key}</div>
      {d.summary && <div style={{ color: T.sub, marginTop: 2 }}>{d.summary}</div>}
      <div className="mono" style={{ color: T.sub, marginTop: 4 }}>
        {d.status} · idle {d.daysSinceUpdate}d{d.isStale ? " (stale)" : ""}
      </div>
      <div className="mono" style={{ color: T.muted }}>{d.openCases} open case{d.openCases === 1 ? "" : "s"} · {d.accounts} account{d.accounts === 1 ? "" : "s"}</div>
    </div>
  );
}
