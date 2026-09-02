import { useMemo, useState } from "react";
import {
  BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  T, AXIS_TICK, AXIS_TICK_CAT, BAR_RADIUS_H, TOOLTIP_STYLE,
} from "../../lib/theme.js";
import { OUTCOME_CLASSES, OUTCOME_LABEL, adoptionByAnalyst, rowOutcome, isTagged } from "../../lib/ai-tags.js";
import { OUTCOME_COLOR, UNTAGGED_COLOR } from "../../lib/ai-tag-colors.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ============== AI tagging adoption by analyst (AI Assisted? tab, team view) ==============
 * The headline manager block. One horizontal stacked bar per analyst — outcome
 * segments plus an untagged segment — sorted by tagging coverage, so the
 * compliance leaders and the analysts who have never tagged a case land at
 * opposite ends of a single axis.
 *
 * "Untagged" is IN the stack, deliberately. It means a 0%-coverage analyst renders
 * as a full-width pale bar rather than an empty row: an empty row reads as "0%
 * helpful", which is a different and much worse claim than "we don't know".
 *
 * Analysts below `minCases` are excluded and counted in a note underneath —
 * "100% of 6 cases" is not comparable to "98% of 49", and letting the tiny
 * denominators win the sort would push the real signal off the top of the chart.
 *
 * ATTRIBUTION CAVEAT, repeated in the card because this block will be used in
 * performance conversations: the tag lives on the CASE and `assigned_to` is the
 * case's CURRENT assignee, not provably whoever applied the tag. */
// 15 rather than 10: below ~15 cases a coverage percentage is mostly noise
// ("100% of 6" is not comparable to "98% of 49"), and on a real export the long
// tail of low-volume assignees otherwise doubles the chart's height for no signal.
const MIN_CASES = 15;

// Rows are 24px so a full team (40+ analysts clearing the floor) still fits on one
// screen-and-a-bit. The list is deliberately NOT truncated: this is a compliance
// chart, and cutting the bottom would hide exactly the analysts it exists to find.
const ROW_H = 24;

const STACK = [
  ...OUTCOME_CLASSES.map((o) => ({ key: o.id, label: o.label, color: OUTCOME_COLOR[o.id] })),
  { key: "untagged", label: "Untagged", color: UNTAGGED_COLOR },
];

// Segments are separated by a 1px stroke so two adjacent fills can never read as
// one. The chromatic fills take a surface-colored gap; these two achromatic ones
// sit under 3:1 against the plot ground ("untagged" IS that ground) and take the
// perceivability stroke instead, or they vanish into it.
const LOW_CONTRAST = new Set(["notApplicable", "untagged"]);

export function AiAnalystAdoptionBlock({ rows, minCases = MIN_CASES }) {
  // Memoized so the aggregations below keep a stable dependency across renders.
  const list = useMemo(() => rows || [], [rows]);
  const all = useMemo(() => adoptionByAnalyst(list), [list]);
  const data = useMemo(() => all.filter((a) => a.total >= minCases), [all, minCases]);
  const hidden = all.length - data.length;
  const [selected, setSelected] = useState(null); // { name, key }

  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    return list
      .filter((r) => (String(r.assigned_to ?? "").trim() || "Unassigned") === selected.name)
      .filter((r) => (selected.key === "untagged" ? !isTagged(r) : rowOutcome(r) === selected.key));
  }, [list, selected]);

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow">AI tagging adoption by analyst</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No analyst has {minCases} or more cases in the current view, so per-analyst adoption
          would compare denominators too small to mean anything. Widen the date filter.
        </div>
      </Card>
    );
  }

  const tagging = data.filter((a) => a.tagged > 0).length;
  const zero = data.filter((a) => a.tagged === 0);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="eyebrow">AI tagging adoption by analyst</div>
        <div className="mono" style={{ fontSize: 12, color: T.sub }}>
          {tagging} of {data.length} analysts tagging
        </div>
      </div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
        Each analyst's full case load in view, sorted by how much of it carries a tag. The pale
        segment is untagged — where we simply don't know whether AI was used. Click any segment for
        its cases. Read this as adoption of the <em>tagging habit</em>: the tag sits on the case and
        the name is the case's current assignee, so reassigned cases are attributed to whoever holds
        them now, not necessarily whoever tagged them.
      </div>
      <StackKey data={data} />
      <div style={{ height: Math.max(240, data.length * ROW_H + 40), marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: 56, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={T.vizGrid} horizontal={false} />
            <XAxis
              type="number"
              tick={AXIS_TICK}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={168}
              interval={0}
              tick={AXIS_TICK_CAT}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
            />
            <Tooltip content={<AdoptionTip />} cursor={{ fill: T.vizWell }} />
            {STACK.map((s, i) => (
              <Bar
                key={s.key}
                stackId="ai"
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                stroke={LOW_CONTRAST.has(s.key) ? T.vizStroke : T.surface}
                strokeWidth={1}
                radius={i === STACK.length - 1 ? BAR_RADIUS_H : [0, 0, 0, 0]}
                cursor="pointer"
                onClick={(d) =>
                  setSelected((prev) =>
                    prev && prev.name === d.name && prev.key === s.key ? null : { name: d.name, key: s.key },
                  )
                }
              >
                {/* Coverage % rides on the last segment so it lands at the bar's end. */}
                {i === STACK.length - 1 && (
                  <LabelList
                    dataKey="coveragePct"
                    position="right"
                    style={{ fill: T.sub, fontSize: 11, fontFamily: "var(--sans)", fontVariantNumeric: "tabular-nums" }}
                    formatter={(v) => (v == null ? "—" : `${v.toFixed(0)}%`)}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {zero.length > 0 && (
        <div style={{ color: T.warn, fontSize: 11, marginTop: 8 }}>
          Never tagged a case in this view: {zero.map((a) => `${a.name} (0/${a.total})`).join(", ")}.
        </div>
      )}
      {hidden > 0 && (
        <div style={{ color: T.muted, fontSize: 11, marginTop: 6 }}>
          {hidden} analyst{hidden === 1 ? "" : "s"} with fewer than {minCases} cases in view
          {hidden === 1 ? " is" : " are"} not shown — too few cases for a coverage rate to mean
          anything. They are still counted in the totals above.
        </div>
      )}
      {selected && (
        <CaseDrilldown
          title={`${selected.name} · ${selected.key === "untagged" ? "Untagged" : OUTCOME_LABEL[selected.key]}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

function StackKey({ data }) {
  const present = STACK.filter((s) => data.some((d) => d[s.key] > 0));
  return (
    <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
      {present.map((s) => (
        <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 10, background: s.color, border: `1px solid ${T.border}`, borderRadius: T.radiusChart }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function AdoptionTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="mono" style={{ color: T.sub }}>
        {d.tagged} of {d.total} tagged{d.coveragePct == null ? "" : ` · ${d.coveragePct.toFixed(0)}% coverage`}
      </div>
      <div className="mono" style={{ color: T.muted, marginBottom: 4 }}>
        {d.attempted} AI attempted · assist rate{" "}
        {d.assistRatePct == null ? "—" : `${d.assistRatePct.toFixed(0)}%`}
      </div>
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.dataKey} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, background: p.color, borderRadius: T.radiusChart }} />
            {p.name}: {p.value}
          </div>
        ))}
    </div>
  );
}
