import { FilterLink } from "./FilterLink.jsx"
import { Database } from "lucide-react"
import { T, alpha } from "../lib/theme.js"
import { Card } from "./layout/Card.jsx"

/* Shared "no data loaded" state used by every analytical page. `to` lets a page
 * point somewhere other than Connections — the Jira pages send an unconnected
 * user to Settings, where credentials are entered. */
export function EmptyState({ title = "No data loaded yet", message, cta = "Go to Connections", to = "/connections" }) {
  return (
    <Card
      className="fade-in"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "64px 32px",
        gap: 14,
        borderStyle: "dashed",
        borderColor: T.border,
        background: T.surface,
        boxShadow: "none",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: T.accentTint,
          color: T.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${alpha(T.accent, 0.13)}`,
          marginBottom: 4,
        }}
      >
        <Database size={24} strokeWidth={1.75} />
      </div>
      <div className="display" style={{ fontSize: 28, color: T.ink, letterSpacing: "-0.015em" }}>
        {title}
      </div>
      <div style={{ color: T.sub, fontSize: 13.5, maxWidth: 520, lineHeight: 1.6 }}>
        {message ||
          "Upload a ServiceNow case export to populate this page. Everything else flows from that one file."}
      </div>
      <FilterLink
        to={to}
        style={{
          marginTop: 12,
          padding: "10px 20px",
          background: T.accent,
          color: T.onAccent,
          border: `1px solid ${T.accentDeep}`,
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          boxShadow: `0 1px 0 ${T.accentDeep}, 0 4px 12px ${alpha(T.accent, 0.25)}`,
          transition: "transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
          fontFamily: "Geist, DM Sans, sans-serif",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = T.accentDeep
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = T.accent
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        {cta}
      </FilterLink>
    </Card>
  )
}
