import { Database } from "lucide-react";
import { FilterNavLink } from "../FilterLink.jsx";
import { T } from "../../lib/theme.js";

/* SECURITY #4 — persistent reminder that case data is stored locally in the
 * browser (OPFS). Hidden entirely when no imports exist. */

const fmtBytes = (n) => {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};

export function DataRetentionNotice({ importCount = 0, storageBytes = 0 }) {
  if (!importCount) return null;

  return (
    <div
      style={{
        margin: "10px 12px 0",
        padding: "12px 14px",
        borderRadius: T.radiusMd,
        background: T.surfaceAlt,
        border: `1px solid ${T.borderSoft}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: T.ink,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        <Database size={12} style={{ color: T.accent }} />
        <span>Data stored locally</span>
      </div>
      <div style={{ color: T.sub, fontSize: 11, marginTop: 6 }}>
        <span className="mono" style={{ color: T.ink, fontWeight: 600 }}>
          {importCount}
        </span>{" "}
        {importCount === 1 ? "import" : "imports"} ·{" "}
        <span className="mono" style={{ color: T.ink, fontWeight: 600 }}>
          {fmtBytes(storageBytes)}
        </span>
      </div>
      <FilterNavLink
        to="/connections"
        style={{
          display: "block",
          marginTop: 10,
          textAlign: "center",
          padding: "6px 10px",
          background: T.surface,
          color: T.ink,
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          fontFamily: "Geist, DM Sans, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          textDecoration: "none",
          transition: "background 0.15s ease, border-color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = T.accent;
          e.currentTarget.style.color = T.accent;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = T.border;
          e.currentTarget.style.color = T.ink;
        }}
      >
        Manage imports
      </FilterNavLink>
    </div>
  );
}
