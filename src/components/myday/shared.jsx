import { ArrowRight } from "lucide-react";
import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { FilterLink } from "../FilterLink.jsx";

/* Presentation primitives shared by My Day's analyst and manager views: the
 * summary tile, the titled list card with its own empty/loading/error states,
 * and the table cell styles. Nothing here computes a metric. */

export function StatTile({ to, icon: Icon, label, value, tone, hint, onClick }) {
  const card = (
    <Card className="hoverlift" style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 6, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: T.sub }}>
        <Icon size={14} strokeWidth={2.25} style={{ color: tone }} />
        <span className="eyebrow">{label}</span>
      </div>
      <div className="mono" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, color: tone }}>{value}</div>
      <div style={{ color: T.sub, fontSize: 12 }}>{hint}</div>
    </Card>
  )
  // An in-page tile (jump to a section on this screen) gets a button; a tile
  // that leaves the page keeps the filter-preserving link.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{ appearance: "none", background: "none", border: "none", padding: 0, margin: 0, font: "inherit", textAlign: "left", color: T.ink, cursor: "pointer" }}>
        {card}
      </button>
    )
  }
  return <FilterLink to={to} style={{ textDecoration: "none", color: T.ink }}>{card}</FilterLink>
}

export function ListCard({ id, icon: Icon, title, count, to, linkLabel, loading, error, emptyMsg, children, note }) {
  const showBody = !loading && !error && count > 0
  return (
    <Card id={id}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Icon size={14} strokeWidth={2.25} style={{ color: T.accent }} />
          {title}
          <span className="mono" style={{ color: count ? T.ink : T.muted, fontWeight: 600, letterSpacing: 0 }}>· {count}</span>
        </div>
        {to && (
          <FilterLink to={to} style={{ color: T.accentDeep, fontSize: 12, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
            {linkLabel} <ArrowRight size={14} strokeWidth={2.25} />
          </FilterLink>
        )}
      </div>
      {note && <div style={{ color: T.sub, fontSize: 12, lineHeight: 1.5, marginTop: 6, maxWidth: 720 }}>{note}</div>}
      {loading ? (
        <div style={{ color: T.sub, fontSize: 13, marginTop: 12 }}>Loading…</div>
      ) : error ? (
        <div style={{ color: T.danger, fontSize: 13, marginTop: 12 }}>Couldn't load this section.</div>
      ) : !showBody ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>{emptyMsg}</div>
      ) : (
        <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">{children}</div>
      )}
    </Card>
  )
}

export function MoreRow({ n, to }) {
  return (
    <div style={{ marginTop: 10 }}>
      <FilterLink to={to} style={{ color: T.sub, fontSize: 12, textDecoration: "none" }}>
        + {n} more — view all <ArrowRight size={14} strokeWidth={2.25} style={{ verticalAlign: "middle" }} />
      </FilterLink>
    </div>
  )
}
