import { Fragment, useMemo, useState } from "react";
import { T, neutralHeat } from "../../lib/theme.js";
import { analystCategoryMatrix } from "../../lib/stats.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ================= Analyst × Category ================= *
 *
 * Never crossed anywhere else in the app: category breakdown lives on its own
 * page (1D, team-wide) and per-analyst profile cards show only each analyst's
 * own top 3 — there's no view of who specializes in what. With 10-30 analysts
 * this is exactly the shape a heatmap suits and a grouped bar chart doesn't.
 *
 * Intensity is normalized PER ROW (against that analyst's own busiest
 * category), not globally — a global scale would just repaint the existing
 * "who has the most cases" ranking, since one prolific analyst would light up
 * every column. Row-normalizing surfaces the actual question: where does THIS
 * analyst's caseload concentrate. The printed number is always the real count,
 * so a small caseload lighting up brightly never reads as more than it is. */
const MIN_FRAC = 0.12;
const MAX_FRAC = 0.72;

const ROLLUP = "Other categories";

export function AnalystCategoryHeatmap({ members }) {
  const { categories, rows } = useMemo(() => analystCategoryMatrix(members), [members]);
  const namedCategories = useMemo(() => categories.filter((c) => c !== ROLLUP), [categories]);
  const [selected, setSelected] = useState(null); // { name, category }

  const drilldownRows = useMemo(() => {
    if (!selected) return [];
    const m = (members || []).find((x) => x.name === selected.name);
    if (!m) return [];
    const namedSet = new Set(namedCategories);
    return m.rows
      .filter((r) => {
        const cat = r._category || "Unknown";
        return selected.category === ROLLUP ? !namedSet.has(cat) : cat === selected.category;
      })
      .sort((a, b) => (b._created?.getTime() ?? 0) - (a._created?.getTime() ?? 0));
  }, [members, selected, namedCategories]);

  if (!rows.length) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Analyst × category</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>No categorized cases in this view.</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>Analyst × category</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
        Which problem areas concentrate on which analyst. Color is relative to each analyst's OWN busiest NAMED
        category (their row) — a specialist stands out even with a light overall caseload, but the printed number is
        always the real count. Capped to the busiest {namedCategories.length} categories team-wide; the rest roll into
        the flat "Other categories" column so a catch-all bucket never outshines real specialization. Click a tile to
        drill in.
      </div>
      <div style={{ marginTop: 14, overflowX: "auto" }} className="scrollbar">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(140px, 200px) repeat(${categories.length}, minmax(74px, 1fr)) 56px`,
            gap: 2,
            minWidth: "100%",
          }}
        >
          <div />
          {namedCategories.map((c) => (
            <div
              key={c}
              className="mono"
              title={c}
              style={{ fontSize: 10, fontWeight: 700, color: T.sub, textAlign: "center", padding: "2px 2px", lineHeight: 1.25, whiteSpace: "normal", wordBreak: "break-word" }}
            >
              {c}
            </div>
          ))}
          {categories.includes(ROLLUP) && (
            <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: T.sub, textAlign: "center", padding: "2px 2px", lineHeight: 1.25, whiteSpace: "normal", wordBreak: "break-word" }}>
              {ROLLUP}
            </div>
          )}
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: T.sub, textAlign: "center", alignSelf: "center" }}>
            Total
          </div>

          {rows.map((row) => {
            const rowMax = Math.max(...namedCategories.map((c) => row[c] || 0), 1);
            return (
              <Fragment key={row.name}>
                <div
                  style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, alignSelf: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={row.name}
                >
                  {row.name}
                </div>
                {namedCategories.map((c) => {
                  const v = row[c] || 0;
                  const intensity = v ? Math.sqrt(v / rowMax) : 0;
                  const frac = v === 0 ? 0 : MIN_FRAC + intensity * (MAX_FRAC - MIN_FRAC);
                  const bg = v === 0 ? T.surfaceAlt : neutralHeat(frac);
                  const textColor = v === 0 ? T.muted : frac > 0.5 ? T.surface : T.ink;
                  const isSelected = selected && selected.name === row.name && selected.category === c;
                  return (
                    <div
                      key={c}
                      onClick={() => {
                        if (v === 0) return;
                        setSelected((prev) => (prev && prev.name === row.name && prev.category === c ? null : { name: row.name, category: c }));
                      }}
                      title={`${row.name} · ${c}: ${v} case${v === 1 ? "" : "s"}`}
                      className="mono"
                      style={{
                        height: 32,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 600,
                        color: textColor,
                        background: bg,
                        border: `1px solid ${T.borderSoft}`,
                        outline: isSelected ? `2px solid ${T.accent}` : "none",
                        outlineOffset: -1,
                        borderRadius: 2,
                        cursor: v === 0 ? "default" : "pointer",
                      }}
                    >
                      {v === 0 ? <span style={{ color: T.muted }}>·</span> : v}
                    </div>
                  );
                })}
                {categories.includes(ROLLUP) && (() => {
                  const v = row[ROLLUP] || 0;
                  const isSelected = selected && selected.name === row.name && selected.category === ROLLUP;
                  return (
                    <div
                      onClick={() => {
                        if (v === 0) return;
                        setSelected((prev) => (prev && prev.name === row.name && prev.category === ROLLUP ? null : { name: row.name, category: ROLLUP }));
                      }}
                      title={`${row.name} · ${ROLLUP}: ${v} case${v === 1 ? "" : "s"}`}
                      className="mono"
                      style={{
                        height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 600, color: v === 0 ? T.muted : T.ink, background: T.surfaceAlt,
                        border: `1px solid ${T.borderSoft}`,
                        outline: isSelected ? `2px solid ${T.accent}` : "none", outlineOffset: -1,
                        borderRadius: 2, cursor: v === 0 ? "default" : "pointer",
                      }}
                    >
                      {v === 0 ? <span style={{ color: T.muted }}>·</span> : v}
                    </div>
                  );
                })()}
                <div
                  className="mono"
                  style={{
                    height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: T.ink, background: T.surfaceSunk, borderRadius: 2,
                  }}
                >
                  {row.total}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
      {selected && (
        <CaseDrilldown
          title={`${selected.name} · ${selected.category}`}
          rows={drilldownRows}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}
