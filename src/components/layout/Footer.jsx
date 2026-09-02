import { T } from "../../lib/theme.js";

/* ================= Footer ================= */
export function Footer() {
  return (
    <div
      className="no-print"
      style={{
        marginTop: 72,
        paddingTop: 22,
        borderTop: `1px solid ${T.borderSoft}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: T.muted,
        fontSize: 11,
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {/* Identity lockup: no improvised bullet-mark, and the only accent is
            the company name itself. */}
        <span>
          <span style={{ color: T.accent }}>Infor</span>
          <span style={{ color: T.muted }}> · Product Support · KPI Analyzer</span>
        </span>
      </span>
      <span className="mono">data processed locally · survey module pending ServiceNow access</span>
    </div>
  );
}
