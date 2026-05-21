import React, { useState, useMemo } from "react";
import { T } from "../../lib/theme.js";
import { WEEKDAY_NAMES, WEEKDAY_ORDER } from "../../lib/constants.js";
import { hourHeatmap } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ================= Intake Heatmap ================= */
export function IntakeHeatmap({ rows }) {
  const { grid, max } = useMemo(() => hourHeatmap(rows), [rows]);
  const [selected, setSelected] = useState(null); // { rowIdx, hourIdx }
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const dow = WEEKDAY_ORDER[selected.rowIdx];
    return rows
      .filter((r) => r._created && r._created.getDay() === dow && r._created.getHours() === selected.hourIdx)
      .sort((a, b) => b._created - a._created);
  }, [rows, selected]);
  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted, textAlign: "left" }}>Intake heatmap · weekday × hour</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, textAlign: "left" }}>When new cases come in. Darker = more cases created in that slot. Click a tile to drill in.</div>
      <div style={{ marginTop: 16, overflowX: "auto", textAlign: "left" }} className="scrollbar">
        <div style={{ display: "grid", gridTemplateColumns: `36px repeat(24, minmax(20px, 1fr))`, gap: 2, minWidth: "100%" }}>
          <div />
          {hours.map((h) => (
            <div key={h} className="mono" style={{ fontSize: 9, color: T.muted, textAlign: "center" }}>
              {String(h).padStart(2, "0")}
            </div>
          ))}
          {grid.map((row, ri) => (
            <React.Fragment key={ri}>
              <div className="mono" style={{ fontSize: 10, color: T.sub, alignSelf: "center" }}>{WEEKDAY_NAMES[ri]}</div>
              {row.map((v, hi) => {
                const intensity = max ? v / max : 0;
                const bg = v === 0
                  ? T.surfaceAlt
                  : `rgba(184, 69, 44, ${0.12 + intensity * 0.78})`;
                const isSelected = selected && selected.rowIdx === ri && selected.hourIdx === hi;
                return (
                  <div
                    key={hi}
                    onClick={() => {
                      if (v === 0) return;
                      setSelected((prev) => (prev && prev.rowIdx === ri && prev.hourIdx === hi ? null : { rowIdx: ri, hourIdx: hi }));
                    }}
                    title={`${WEEKDAY_NAMES[ri]} ${hi}:00 — ${v} case${v === 1 ? "" : "s"}`}
                    style={{
                      height: 22,
                      background: bg,
                      border: isSelected ? `2px solid ${T.ink}` : `1px solid ${T.borderSoft}`,
                      boxShadow: isSelected ? `0 0 0 1px ${T.surface}` : "none",
                      borderRadius: 2,
                      cursor: v === 0 ? "default" : "pointer",
                    }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 10, fontSize: 11, color: T.muted }}>
        <span className="mono">0</span>
        <div style={{ display: "flex", gap: 2 }}>
          {[0.12, 0.3, 0.5, 0.7, 0.9].map((a) => (
            <div key={a} style={{ width: 18, height: 10, background: `rgba(184, 69, 44, ${a})`, borderRadius: 2 }} />
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
