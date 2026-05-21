import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";

/* ================= Accounts / Products ================= */
export function AccountProductBlock({ accountData, productData }) {
  const max = Math.max(...accountData.map((c) => c.count), 1);
  const COLORS = [T.accent, "#6B7A8F", T.ok, T.warn, "#8A5C9E", "#7A8F6B", "#B88A4C", "#8F6B7A"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Top accounts by case volume</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Customers driving the most cases. A heavily concentrated list can signal an unstable customer or one ripe for a deeper review.</div>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {accountData.map((a) => (
            <div key={a.name} style={{ display: "grid", gridTemplateColumns: "1fr 60px", alignItems: "center", gap: 12, fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 0 180px" }}>{a.name}</span>
                <div style={{ flex: 1, height: 6, background: T.surfaceAlt, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(a.count / max) * 100}%`, background: T.ink, transition: "width 0.4s" }} />
                </div>
              </div>
              <span className="mono" style={{ color: T.sub, textAlign: "right" }}>{a.count}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Product line mix</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Share of cases per product line — shows which products generate the most support load.</div>
        <div style={{ height: 240, marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={productData} dataKey="count" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                {productData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip content={<ProductTip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
          {productData.map((p, i) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, background: COLORS[i % COLORS.length], borderRadius: 2 }} />
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="mono" style={{ color: T.sub }}>{p.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ProductTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} cases</div>
    </div>
  );
}
