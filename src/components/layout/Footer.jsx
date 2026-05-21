import { T } from "../../lib/theme.js";

/* ================= Footer ================= */
export function Footer() {
  return (
    <div className="no-print" style={{ marginTop: 60, paddingTop: 20, borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", color: T.muted, fontSize: 11 }}>
      <span className="eyebrow">Infor · Product Support · KPI Analyzer</span>
      <span className="mono">data processed locally · survey module pending ServiceNow access</span>
    </div>
  );
}
