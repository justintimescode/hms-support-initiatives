import { Link } from "react-router-dom"
import { Database } from "lucide-react"
import { T } from "../lib/theme.js"
import { Card } from "./layout/Card.jsx"

/* Shared "no data loaded" state used by every analytical page. Single
 * source so the CTA + copy stays consistent. */
export function EmptyState({ title = "No data loaded yet", message, cta = "Go to Connections" }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "48px 24px", gap: 12, borderStyle: "dashed", background: T.surfaceAlt }}>
      <Database size={28} style={{ color: T.muted }} />
      <div className="display" style={{ fontSize: 20, fontWeight: 500 }}>{title}</div>
      <div style={{ color: T.sub, fontSize: 13, maxWidth: 520, lineHeight: 1.55 }}>
        {message || "Upload a ServiceNow case export to populate this page. Everything else flows from that one file."}
      </div>
      <Link
        to="/connections"
        style={{
          marginTop: 4,
          padding: "8px 16px",
          background: T.accent,
          color: T.surface,
          border: `1px solid ${T.accent}`,
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: "none",
        }}
      >
        {cta}
      </Link>
    </Card>
  )
}
