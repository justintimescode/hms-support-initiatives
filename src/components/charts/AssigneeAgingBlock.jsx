import { Fragment, useMemo, useState } from "react";
import { T } from "../../lib/theme.js";
import { AGING_BUCKETS } from "../../lib/constants.js";
import { openByAssigneeAge } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ================= Open Backlog · By Assignee (team view) =================
 *
 * A heatmap, not a stacked bar: with more than a handful of analysts, comparing
 * segment LENGTHS across a dozen+ horizontal bars is slow — the eye has to
 * measure, not just look. A grid lets you scan straight down the 31-90d/90d+
 * columns and see who the stale backlog concentrates on at a glance.
 *
 * The grid is ONE hue (the ordinal ramp's top step) with intensity as the only
 * variable, scaled against the BUSIEST ROW IN THAT COLUMN, not the grid's global
 * max — a bucket where every analyst carries 1-2 cases would otherwise wash out
 * to nothing next to a busy 0-7d column. Bucket identity rides on the column
 * label, not on a hue. Rows stay sorted stale-first (same order
 * `openByAssigneeAge` has always returned). */
const MIN_FRAC = 0.12;
const MAX_FRAC = 0.62;

export function AssigneeAgingBlock({ members }) {
  const data = useMemo(() => openByAssigneeAge(members), [members]);
  const [selected, setSelected] = useState(null); // { name, bucketIdx }

  const colMax = useMemo(
    () => AGING_BUCKETS.map((b) => data.reduce((mx, row) => Math.max(mx, row[b.name] || 0), 0)),
    [data],
  );

  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const m = members.find((x) => x.name === selected.name);
    if (!m) return [];
    const now = Date.now();
    const bucket = AGING_BUCKETS[selected.bucketIdx];
    return m.rows
      .filter((r) => r._isOpen && r._created)
      .filter((r) => {
        const days = Math.floor((now - r._created.getTime()) / 864e5);
        return days >= bucket.min && days <= bucket.max;
      })
      .sort((a, b) => a._created - b._created);
  }, [members, selected]);

  if (!data.length) {
    return (
      <Card>
        <div className="eyebrow">Open cases by assignee · stacked by age</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>No open cases on the team.</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="eyebrow">Open cases by assignee · by age</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 720 }}>
        Each analyst's open queue by age. Color intensity is relative to the busiest analyst IN THAT COLUMN, so a
        thinly-spread 31-90d/90d+ problem still stands out. Click any tile to drill into those cases.
      </div>
      <div style={{ marginTop: 14, overflowX: "auto" }} className="scrollbar">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(140px, 220px) repeat(${AGING_BUCKETS.length}, minmax(78px, 1fr)) 64px`,
            gap: 2,
            minWidth: "100%",
          }}
        >
          <div />
          {AGING_BUCKETS.map((b) => (
            <div
              key={b.name}
              className="mono"
              style={{
                fontSize: 11,
                fontWeight: 700,
                textAlign: "center",
                padding: "4px 0",
                borderRadius: T.radiusSm,
                color: T.vizCat,
                background: T.vizWell,
              }}
            >
              {b.name}
            </div>
          ))}
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: T.vizCat, textAlign: "center", alignSelf: "center" }}>
            Total
          </div>

          {data.map((row) => (
            <Fragment key={row.name}>
              <div
                style={{ fontSize: 12, fontWeight: 600, color: T.ink, alignSelf: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={row.name}
              >
                {row.name}
              </div>
              {AGING_BUCKETS.map((b, i) => {
                const v = row[b.name] || 0;
                const max = colMax[i];
                const intensity = max ? Math.sqrt(v / max) : 0;
                // Data-driven intensity channel: one hue, mixed toward the plot
                // ground by the same MIN_FRAC/MAX_FRAC/sqrt math as before.
                const pct = Math.round((MIN_FRAC + intensity * (MAX_FRAC - MIN_FRAC)) * 100);
                const bg = v === 0
                  ? T.surfaceAlt
                  : `color-mix(in srgb, var(--t-viz-r4) ${pct}%, var(--t-viz-well))`;
                const isSelected = selected && selected.name === row.name && selected.bucketIdx === i;
                return (
                  <div
                    key={`${row.name}-${b.name}`}
                    onClick={() => {
                      if (v === 0) return;
                      setSelected((prev) => (prev && prev.name === row.name && prev.bucketIdx === i ? null : { name: row.name, bucketIdx: i }));
                    }}
                    title={`${row.name} · ${b.name}: ${v} open case${v === 1 ? "" : "s"}`}
                    className="mono"
                    style={{
                      height: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 600,
                      color: v === 0 ? T.muted : T.ink,
                      background: bg,
                      border: `1px solid ${T.borderSoft}`,
                      outline: isSelected ? `2px solid ${T.vizAccent}` : "none",
                      outlineOffset: -1,
                      borderRadius: T.radiusSm,
                      cursor: v === 0 ? "default" : "pointer",
                    }}
                  >
                    {v === 0 ? <span style={{ color: T.muted }}>·</span> : v}
                  </div>
                );
              })}
              <div
                className="mono"
                style={{
                  height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, color: T.ink, background: T.surfaceSunk, borderRadius: T.radiusSm,
                }}
              >
                {row.total}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
      {selected && (
        <CaseDrilldown
          title={`${selected.name} · ${AGING_BUCKETS[selected.bucketIdx].name}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}
