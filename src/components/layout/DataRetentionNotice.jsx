import { Database } from "lucide-react";
import { NavLink } from "react-router-dom";
import { T } from "../../lib/theme.js";

/* SECURITY #4 — persistent reminder that case data is stored locally in the
 * browser (OPFS). With the multi-import model the user manages data explicitly
 * on the Connections page, so this surfaces the import count + total storage
 * and links there. Hidden entirely when no imports exist. */

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
        margin: "8px 10px 0",
        padding: "10px 12px",
        borderRadius: 6,
        background: T.surfaceAlt,
        border: `1px solid ${T.borderSoft}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: T.sub, fontSize: 11 }}>
        <Database size={12} />
        <span style={{ fontWeight: 600 }}>Data stored locally</span>
      </div>
      <div style={{ color: T.muted, fontSize: 11, marginTop: 4 }}>
        <span className="mono">{importCount}</span> {importCount === 1 ? "import" : "imports"} · <span className="mono">{fmtBytes(storageBytes)}</span>
      </div>
      <NavLink
        to="/connections"
        style={{
          display: "block",
          marginTop: 8,
          textAlign: "center",
          padding: "5px 10px",
          background: "transparent",
          color: T.sub,
          border: `1px solid ${T.border}`,
          borderRadius: 4,
          fontFamily: "DM Sans, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Manage imports
      </NavLink>
    </div>
  );
}
