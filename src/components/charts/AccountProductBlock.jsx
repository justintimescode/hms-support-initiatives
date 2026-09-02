import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { T, categoricalAt, PIE_SPEC, TOOLTIP_STYLE } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";

/* ================= Accounts / Products =================
 * The ranked account bars are a single-metric view, so they take the duotone
 * treatment (Infor Purple lead on the Gray Tint ground). The product-mix pie is
 * categorical: it indexes the ordered Infor Purple tint ladder through
 * `categoricalAt`, which clamps onto the achromatic residual slot rather than
 * wrapping — one color family however many product lines an import contains. */
export function AccountProductBlock({ accountData, productData, scrollAccounts = false }) {
  const max = Math.max(...accountData.map((c) => c.count), 1);
  // From ladder step 4 on the fills drop under 3:1 against their ground, so
  // those slices swap the slice-separating surface stroke for a perceivability
  // outline.
  const needsOutline = (i) => i >= 3;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12 }}>
      <Card>
        <div className="eyebrow">
          Top accounts by case volume{scrollAccounts ? ` · ${accountData.length}` : ""}
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Customers driving the most cases. A heavily concentrated list can signal an unstable customer or one ripe for a deeper review.</div>
        <div
          className={scrollAccounts ? "scrollbar" : undefined}
          style={{
            marginTop: 16, display: "flex", flexDirection: "column", gap: 8,
            ...(scrollAccounts ? { maxHeight: 380, overflowY: "auto", paddingRight: 6 } : null),
          }}
        >
          {accountData.map((a) => (
            <div key={a.name} style={{ display: "grid", gridTemplateColumns: "1fr 60px", alignItems: "center", gap: 12, fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 0 180px" }}>{a.name}</span>
                <div style={{ flex: 1, height: 6, background: T.vizWell, borderRadius: T.radiusChart, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(a.count / max) * 100}%`, background: T.vizAccent, transition: "width 0.4s" }} />
                </div>
              </div>
              <span className="mono" style={{ color: T.sub, textAlign: "right" }}>{a.count}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="eyebrow">Product line mix</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>Share of cases per product line — shows which products generate the most support load.</div>
        <div style={{ height: 240, marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={productData} dataKey="count" nameKey="name" innerRadius={60} outerRadius={90} {...PIE_SPEC}>
                {productData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={categoricalAt(i)}
                    stroke={needsOutline(i) ? T.vizStroke : T.surface}
                    strokeWidth={needsOutline(i) ? 1 : 2}
                  />
                ))}
              </Pie>
              <Tooltip content={<ProductTip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
          {productData.map((p, i) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span
                style={{
                  width: 10, height: 10, background: categoricalAt(i), borderRadius: T.radiusChart,
                  boxSizing: "border-box",
                  border: needsOutline(i) ? `1px solid ${T.vizStroke}` : undefined,
                }}
              />
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
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.sub }}>{d.count} cases</div>
    </div>
  );
}
