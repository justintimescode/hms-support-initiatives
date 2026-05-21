import { User, ListFilter, Printer } from "lucide-react"
import { T } from "../../lib/theme.js"
import { FilterBar } from "../FilterBar.jsx"

/* Persistent top bar for every routed page: analyst dropdown + filter
 * controls + print menu. AppLayout passes app state in as a prop since
 * TopBar renders ABOVE the Outlet (not inside it, so useOutletContext
 * would return nothing here). */
export function TopBar({ ctx }) {
  if (!ctx) return null
  const {
    rows,
    analyst, setAnalyst, analysts,
    dateRange, setDateRange,
    compareOn, setCompareOn,
    compareWindow,
    view,
    teamMembers, kpis,
    printMenuOpen, setPrintMenuOpen, triggerPrint,
  } = ctx

  // No data yet → keep the bar invisible. Pages render their own empty
  // states; a control bar with no usable options would just be noise.
  if (!rows) return null

  const canPrintIndividual = analyst !== "__all__"
  const sliceCount = view === "team"
    ? (teamMembers || []).reduce((s, m) => s + m.kpis.total, 0)
    : (kpis?.total ?? 0)

  return (
    <div
      className="no-print"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <FilterBar
          range={dateRange}
          onRangeChange={setDateRange}
          compareOn={compareOn}
          onCompareChange={setCompareOn}
          compareWindow={compareWindow}
          sliceCount={sliceCount}
        />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <User size={14} style={{ position: "absolute", left: 12, top: 10, color: T.muted }} />
          <select
            value={analyst}
            onChange={(e) => setAnalyst(e.target.value)}
            style={{
              appearance: "none",
              padding: "8px 32px 8px 32px",
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 13,
              color: T.ink,
              cursor: "pointer",
              minWidth: 220,
            }}
          >
            <option value="__all__">All analysts ({(analysts || []).reduce((s, [, c]) => s + c, 0)})</option>
            {(analysts || []).map(([name, count]) => (
              <option key={name} value={name}>{name} ({count})</option>
            ))}
          </select>
          <ListFilter size={14} style={{ position: "absolute", right: 10, top: 10, color: T.muted, pointerEvents: "none" }} />
        </div>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setPrintMenuOpen(!printMenuOpen)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 13,
              color: T.ink,
              cursor: "pointer",
            }}
          >
            <Printer size={13} /> Print <span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>
          </button>
          {printMenuOpen && (
            <>
              <div onClick={() => setPrintMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, minWidth: 260, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 11, overflow: "hidden" }}>
                <button
                  onClick={() => triggerPrint("team")}
                  style={menuItemStyle()}
                  onMouseEnter={(e) => (e.currentTarget.style.background = T.surfaceAlt)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Print team analysis
                  <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>All team-wide sections</div>
                </button>
                <button
                  onClick={() => canPrintIndividual && triggerPrint("individual")}
                  disabled={!canPrintIndividual}
                  style={{ ...menuItemStyle(), color: canPrintIndividual ? T.ink : T.muted, cursor: canPrintIndividual ? "pointer" : "not-allowed", borderBottom: "none" }}
                  onMouseEnter={(e) => canPrintIndividual && (e.currentTarget.style.background = T.surfaceAlt)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {canPrintIndividual ? `Print ${analyst}'s analysis` : "Print individual analysis"}
                  <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>
                    {canPrintIndividual ? "Sections filtered to this analyst" : "Select an analyst first"}
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function menuItemStyle() {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 14px",
    background: "transparent",
    border: "none",
    fontFamily: "DM Sans, sans-serif",
    fontSize: 13,
    cursor: "pointer",
    borderBottom: `1px solid ${T.borderSoft}`,
  }
}
