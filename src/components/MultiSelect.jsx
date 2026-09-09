// A compact, native-styled multi-select dropdown used by the dashboard filter
// bar (manager, analyst, product, region, priority). No dropdown library —
// it's a button that opens a checkbox popover, matching the existing hand-
// styled <select> look in the TopBar (leading icon, trailing chevron, accent
// border when active).
//
// Options are `[name, count]` tuples (the shape useAppData already produces).
// `selected` is the array of chosen names; `onToggle(name)` flips one and
// `onClear()` empties the set. The component is fully controlled — it owns no
// selection state, only the open/closed state of its popover.

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Check, X } from "lucide-react"
import { T } from "../lib/theme.js"

export function MultiSelect({
  icon: Icon,
  label,          // singular noun, e.g. "manager" — used in the summary text
  labelPlural,    // optional plural, defaults to `${label}s`
  options,        // [name, count][]
  selected,       // string[]
  onToggle,       // (name) => void
  onClear,        // () => void
  minWidth = 200,
  title,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef(null)
  const plural = labelPlural || `${label}s`
  const active = selected.length > 0
  const totalCount = options.reduce((s, [, c]) => s + c, 0)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const summary = !active
    ? `All ${plural} (${totalCount})`
    : selected.length === 1
      ? selected[0]
      : `${selected.length} ${plural} selected`

  const filtered = query.trim()
    ? options.filter(([name]) => String(name).toLowerCase().includes(query.trim().toLowerCase()))
    : options

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px 8px 34px",
          position: "relative",
          background: T.surface,
          border: `1px solid ${active ? T.accent : T.border}`,
          borderRadius: T.radiusSm,
          fontSize: 13,
          fontWeight: 500,
          color: T.ink,
          cursor: "pointer",
          minWidth,
          maxWidth: 280,
          boxShadow: T.shadowSm,
          transition: "border-color 0.15s ease",
        }}
      >
        {Icon && <Icon size={14} style={{ position: "absolute", left: 12, top: 11, color: active ? T.accent : T.muted }} />}
        <span
          style={{
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        {active ? (
          <X
            size={14}
            role="button"
            aria-label={`Clear ${plural} filter`}
            onClick={(e) => { e.stopPropagation(); onClear() }}
            style={{ color: T.muted, flexShrink: 0 }}
          />
        ) : (
          <ChevronDown size={14} style={{ color: T.muted, flexShrink: 0 }} />
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: T.radiusMd,
            minWidth: Math.max(minWidth, 240),
            maxWidth: 340,
            boxShadow: T.shadowLg,
            zIndex: 20,
            overflow: "hidden",
          }}
        >
          {/* header: search + count + clear */}
          <div style={{ padding: 8, borderBottom: `1px solid ${T.borderSoft}` }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${plural}…`}
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: `1px solid ${T.border}`,
                background: T.surface,
                color: T.ink,
                borderRadius: T.radiusSm,
                padding: "6px 10px",
                fontSize: 12,
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <span style={{ fontSize: 11, color: T.muted }}>
                {active ? `${selected.length} selected` : `${filtered.length} ${plural}`}
              </span>
              {active && (
                <button
                  type="button"
                  onClick={onClear}
                  style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* option list */}
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: T.muted }}>No matches</div>
            ) : (
              filtered.map(([name, count]) => {
                const checked = selected.includes(name)
                return (
                  <button
                    type="button"
                    key={name}
                    onClick={() => onToggle(name)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      background: checked ? T.surfaceAlt : "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      color: T.ink,
                    }}
                    onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = T.surfaceAlt }}
                    onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = "transparent" }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        flexShrink: 0,
                        borderRadius: 4,
                        border: `1px solid ${checked ? T.accent : T.border}`,
                        background: checked ? T.accent : T.surface,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {checked && <Check size={12} strokeWidth={3} style={{ color: T.onAccent }} />}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </span>
                    <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>{count}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
