import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T, AXIS_TICK, AXIS_TICK_CAT, BAR_RADIUS_H, TOOLTIP_STYLE } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ================= Resolved / Closed · By Assignee (team view) ================= */
// Stack order = bottom -> top; colors from theme tokens (never hardcode hex).
// "Resolved" = State="Resolved" (Solution Proposed, awaiting customer). "Closed" =
// State="Closed" (truly done). These are distinct lifecycle buckets, see enrich.js v8.
//
// One color family, duotone: Closed takes the Infor Purple lead and Resolved its
// Purple Tint 02 companion. Neither bucket is "bad", so no red appears here — the
// previous status-token pairing (ok, then Infor Green, against accent Infor Red)
// was exactly the good/bad pairing the brand prohibits. Purple Tint 02 measures
// 1.65:1 on the plot well, hence the 1px T.vizStroke on the bars.
const SEGMENTS = [
  { key: "Closed", color: T.vizAccent, match: (r) => r._isClosed },
  { key: "Resolved", color: T.categorical[5], match: (r) => r._lifecycle === "solution_proposed" },
];

export function WorkloadResolvedBlock({ members }) {
  const data = useMemo(
    () =>
      (members || [])
        .map((m) => ({
          name: m.name,
          Closed: m.kpis.closed,
          Resolved: m.kpis.solutionProposed,
          _total: m.kpis.closed + m.kpis.solutionProposed,
        }))
        .filter((d) => d._total > 0)
        .sort((a, b) => b._total - a._total),
    [members],
  );

  const [selected, setSelected] = useState(null); // { name, segIdx }
  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const m = (members || []).find((x) => x.name === selected.name);
    if (!m) return [];
    const seg = SEGMENTS[selected.segIdx];
    return m.rows
      .filter(seg.match)
      .sort(
        (a, b) =>
          (b._closed?.getTime?.() || b._created?.getTime?.() || 0) -
          (a._closed?.getTime?.() || a._created?.getTime?.() || 0),
      );
  }, [members, selected]);

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow">Resolved / closed cases by assignee</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No resolved or closed cases in the current date range.
        </div>
      </Card>
    );
  }

  const height = Math.max(240, data.length * 30 + 40);

  return (
    <Card>
      <div className="eyebrow">Resolved / closed cases by assignee</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Completed work per analyst — Closed (State=Closed) plus Resolved (Solution Proposed, awaiting
        customer confirmation), sorted high to low. Click a segment to drill into those cases.
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
        {SEGMENTS.map((s) => (
          <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 10, background: s.color, borderRadius: T.radiusChart, border: `1px solid ${T.vizStroke}` }} />
            {s.key}
          </span>
        ))}
      </div>
      <div style={{ height, marginTop: 12, background: T.vizWell, borderRadius: T.radiusMd }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 8, bottom: 0 }}>
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
              tick={AXIS_TICK_CAT}
              width={140}
              interval={0}
              axisLine={{ stroke: T.vizAxis }}
              tickLine={{ stroke: T.vizAxis }}
            />
            <Tooltip content={<ResolvedTip />} cursor={{ fill: T.vizWell }} />
            {SEGMENTS.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="rc"
                fill={s.color}
                stroke={T.vizStroke}
                strokeWidth={1}
                /* Rounded end only on the top-of-stack segment; interior stays square. */
                radius={i === SEGMENTS.length - 1 ? BAR_RADIUS_H : [0, 0, 0, 0]}
                cursor="pointer"
                onClick={(d) =>
                  setSelected((prev) =>
                    prev && prev.name === d.name && prev.segIdx === i ? null : { name: d.name, segIdx: i },
                  )
                }
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {selected && (
        <CaseDrilldown
          title={`${selected.name} · ${SEGMENTS[selected.segIdx].key}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

function ResolvedTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="mono" style={{ color: T.sub, marginBottom: 4 }}>{total} resolved / closed</div>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, background: p.color, borderRadius: T.radiusChart, border: `1px solid ${T.vizStroke}` }} />
          {p.dataKey}: {p.value}
        </div>
      ))}
    </div>
  );
}
