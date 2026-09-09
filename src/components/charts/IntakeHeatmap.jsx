import React, { useMemo, useState } from "react";
import { T, neutralHeat as heat } from "../../lib/theme.js";
import { WEEKDAY_NAMES, WEEKDAY_ORDER } from "../../lib/constants.js";
import { hourHeatmap } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

const MIN_FRAC = 0.14;
const MAX_FRAC = 0.8;
const QUARTER_HOURS = new Set([0, 6, 12, 18]);

/* Legend steps. The brand forbids gradient fills, so the scale bar is five
 * DISCRETE solid swatches sampled from neutralHeat() at the same
 * MIN_FRAC → MAX_FRAC span the cells use — the legend still maps to the grid. */
const LEGEND_STEPS = [0, 1, 2, 3, 4].map((i) => MIN_FRAC + (i / 4) * (MAX_FRAC - MIN_FRAC));

export function IntakeHeatmap({ rows }) {
  const { grid, max } = useMemo(() => hourHeatmap(rows), [rows]);
  const [selected, setSelected] = useState(null); // { rowIdx, hourIdx }
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const rowTotals = useMemo(() => grid.map((row) => row.reduce((s, v) => s + v, 0)), [grid]);
  const colTotals = useMemo(
    () => hours.map((hi) => grid.reduce((s, row) => s + row[hi], 0)),
    [grid, hours],
  );
  const grandTotal = useMemo(() => rowTotals.reduce((s, v) => s + v, 0), [rowTotals]);

  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const dow = WEEKDAY_ORDER[selected.rowIdx];
    return rows
      .filter((r) => r._created && r._created.getDay() === dow && r._created.getHours() === selected.hourIdx)
      .sort((a, b) => b._created - a._created);
  }, [rows, selected]);

  const TOTAL_CELL = { background: T.surfaceSunk, color: T.ink, fontWeight: 700 };

  return (
    <Card>
      <div className="eyebrow" style={{ textAlign: "left" }}>Intake heatmap · weekday × hour</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>
        When new cases come in. Darker = more cases created in that slot. Click a tile to drill in.
      </div>
      <div style={{ marginTop: 16, overflowX: "auto", textAlign: "left" }} className="scrollbar">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `48px repeat(24, minmax(28px, 1fr)) 58px`,
            gap: 2,
            minWidth: "100%",
          }}
        >
          <div />
          {hours.map((h) => (
            <div
              key={h}
              className="mono"
              style={{
                fontSize: 10,
                fontWeight: QUARTER_HOURS.has(h) ? 700 : 400,
                color: QUARTER_HOURS.has(h) ? T.sub : T.muted,
                textAlign: "center",
              }}
            >
              {String(h).padStart(2, "0")}
            </div>
          ))}
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: T.sub, textAlign: "center" }}>
            Total
          </div>

          {grid.map((row, ri) => (
            <React.Fragment key={ri}>
              <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: T.sub, alignSelf: "center" }}>
                {WEEKDAY_NAMES[ri]}
              </div>
              {row.map((v, hi) => {
                const intensity = max ? Math.sqrt(v / max) : 0;
                const frac = v === 0 ? 0 : MIN_FRAC + intensity * (MAX_FRAC - MIN_FRAC);
                const bg = v === 0 ? T.surfaceAlt : heat(frac);
                // The heat ramp is bounded short of full Infor Purple, so T.ink
                // clears AA on every step — no conditional light-text flip.
                const textColor = v === 0 ? T.muted : T.ink;
                const isSelected = selected && selected.rowIdx === ri && selected.hourIdx === hi;
                return (
                  <div
                    key={hi}
                    onClick={() => {
                      if (v === 0) return;
                      setSelected((prev) => (prev && prev.rowIdx === ri && prev.hourIdx === hi ? null : { rowIdx: ri, hourIdx: hi }));
                    }}
                    title={`${WEEKDAY_NAMES[ri]} ${String(hi).padStart(2, "0")}:00 — ${v} case${v === 1 ? "" : "s"}`}
                    className="mono"
                    style={{
                      height: 30,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 600,
                      color: textColor,
                      background: bg,
                      border: `1px solid ${T.borderSoft}`,
                      borderLeft: QUARTER_HOURS.has(hi) && hi !== 0 ? `2px solid ${T.border}` : `1px solid ${T.borderSoft}`,
                      outline: isSelected ? `2px solid ${T.accent}` : "none",
                      outlineOffset: -1,
                      borderRadius: T.radiusSm,
                      cursor: v === 0 ? "default" : "pointer",
                    }}
                  >
                    {v === 0 ? <span style={{ color: T.muted }}>·</span> : v}
                  </div>
                );
              })}
              <div className="mono" style={{ ...TOTAL_CELL, height: 30, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, borderRadius: T.radiusSm }}>
                {rowTotals[ri]}
              </div>
            </React.Fragment>
          ))}

          {/* Column-total footer row */}
          <div className="mono" style={{ ...TOTAL_CELL, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: T.radiusSm }}>
            Total
          </div>
          {colTotals.map((v, hi) => (
            <div
              key={hi}
              className="mono"
              style={{
                ...TOTAL_CELL,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                borderRadius: T.radiusSm,
                borderLeft: QUARTER_HOURS.has(hi) && hi !== 0 ? `2px solid ${T.border}` : "none",
              }}
            >
              {v}
            </div>
          ))}
          <div className="mono" style={{ ...TOTAL_CELL, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, borderRadius: T.radiusSm }}>
            {grandTotal}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 10, fontSize: 11, color: T.muted }}>
        <span className="mono">0</span>
        <div
          style={{
            display: "flex",
            width: 140,
            height: 10,
            borderRadius: T.radiusSm,
            border: `1px solid ${T.borderSoft}`,
            overflow: "hidden",
          }}
        >
          {LEGEND_STEPS.map((f) => (
            <span key={f} style={{ flex: 1, background: heat(f) }} />
          ))}
        </div>
        <span className="mono">{max}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: T.muted, fontStyle: "italic", lineHeight: 1.4 }}>
        Note: hour values reflect whatever timezone the case timestamps are stored in. ServiceNow exports do not specify a timezone — the times are typically rendered in the local timezone of whoever clicked Export, so interpret these slots accordingly.
      </div>
      {selected && (
        <CaseDrilldown
          title={`Created · ${WEEKDAY_NAMES[selected.rowIdx]} ${String(selected.hourIdx).padStart(2, "0")}:00–${String(selected.hourIdx).padStart(2, "0")}:59`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}
