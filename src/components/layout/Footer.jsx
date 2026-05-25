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
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            background: T.accent,
            borderRadius: 2,
          }}
        />
        Infor · Product Support · KPI Analyzer
      </span>
      <span className="mono">data processed locally · survey module pending ServiceNow access</span>
    </div>
  );
}
