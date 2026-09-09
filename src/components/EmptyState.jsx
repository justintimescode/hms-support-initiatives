import { FilterLink } from "./FilterLink.jsx"
import { Database } from "lucide-react"
import { T } from "../lib/theme.js"
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
        // Type is always left-aligned. This is the empty state for every
        // analytical page, so it is also the widest-reach alignment fix.
        alignItems: "flex-start",
        padding: "64px 32px",
        gap: 14,
        borderStyle: "dashed",
        borderColor: T.border,
        background: T.surface,
        boxShadow: "none",
      }}
    >
      {/* Standalone icon, no medallion: the brand's boxed "UI box" colorway is
          for creative/marketing use, and web/app icons sit unboxed. That also
          removes the ad-hoc alpha() border the box needed. */}
      <div style={{ color: T.accent, display: "flex", marginBottom: 2 }}>
        <Database size={28} strokeWidth={1.75} />
      </div>
      <div className="display" style={{ fontSize: "var(--fs-h2-dense)", color: T.ink, letterSpacing: "-0.01em" }}>
        {title}
      </div>
      <div style={{ color: T.sub, fontSize: 14, maxWidth: 520, lineHeight: 1.6 }}>
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
          borderRadius: T.radiusSm,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          // No shadow on a resting control, and no colored glow — the brand
          // permits shadow only, never a glow, and the previous value was a
          // 12px red halo at 25%. Hover moves the fill, not the elevation.
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = T.accentDeep
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = T.accent
        }}
      >
        {cta}
      </FilterLink>
    </Card>
  )
}
