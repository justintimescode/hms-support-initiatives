import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";

/* ================= Categories ================= */
export function CategoryBlock({ categoryData }) {
  const total = categoryData.reduce((s, c) => s + c.count, 0);
  const max = Math.max(...categoryData.map((c) => c.count), 1);
  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted }}>Category distribution</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Cases bucketed by problem area. The bar length is volume; the percentage is share of total.</div>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {categoryData.map((c) => {
          const pct = (c.count / total) * 100;
          const width = (c.count / max) * 100;
          return (
            <div key={c.name}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>{c.name}</span>
                <span className="mono" style={{ color: T.sub }}>{c.count} · {pct.toFixed(1)}%</span>
              </div>
              <div style={{ height: 8, background: T.surfaceAlt, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${width}%`, background: T.accent, transition: "width 0.4s" }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
