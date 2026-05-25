import { User, ListFilter, Printer } from "lucide-react"
import { T } from "../../lib/theme.js"
import { FilterBar } from "../FilterBar.jsx"
import { FreshnessIndicator } from "./FreshnessIndicator.jsx"

/* Persistent top bar for every routed page. */
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
    activeImport, jiraState,
  } = ctx

  if (!rows) {
    return (
      <div
        className="no-print"
        style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}
      >
        <FreshnessIndicator activeImport={activeImport} jiraState={jiraState} />
      </div>
    )
  }

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
        gap: 14,
        marginBottom: 20,
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

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <div style={{ position: "relative" }}>
          <User size={14} style={{ position: "absolute", left: 12, top: 11, color: T.muted }} />
          <select
            value={analyst}
            onChange={(e) => setAnalyst(e.target.value)}
            style={{
              appearance: "none",
              padding: "8px 34px 8px 34px",
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              fontFamily: "Geist, DM Sans, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: T.ink,
              cursor: "pointer",
              minWidth: 220,
              boxShadow: T.shadowSm,
              transition: "border-color 0.15s ease",
            }}
          >
            <option value="__all__">All analysts ({(analysts || []).reduce((s, [, c]) => s + c, 0)})</option>
            {(analysts || []).map(([name, count]) => (
              <option key={name} value={name}>{name} ({count})</option>
            ))}
          </select>
          <ListFilter size={14} style={{ position: "absolute", right: 12, top: 11, color: T.muted, pointerEvents: "none" }} />
        </div>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setPrintMenuOpen(!printMenuOpen)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              fontFamily: "Geist, DM Sans, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: T.ink,
              cursor: "pointer",
              boxShadow: T.shadowSm,
              transition: "background 0.15s ease, border-color 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = T.muted)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = T.border)}
          >
            <Printer size={13} /> Print <span style={{ fontSize: 10, marginLeft: 2, color: T.muted }}>▾</span>
          </button>
          {printMenuOpen && (
            <>
              <div onClick={() => setPrintMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 6,
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.radiusMd,
                  minWidth: 280,
                  boxShadow: T.shadowLg,
                  zIndex: 11,
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => triggerPrint("team")}
                  style={menuItemStyle()}
                  onMouseEnter={(e) => (e.currentTarget.style.background = T.surfaceAlt)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Print team analysis
                  <div style={{ fontSize: 11.5, color: T.sub, marginTop: 3 }}>All team-wide sections</div>
                </button>
                <button
                  onClick={() => canPrintIndividual && triggerPrint("individual")}
                  disabled={!canPrintIndividual}
                  style={{
                    ...menuItemStyle(),
                    color: canPrintIndividual ? T.ink : T.muted,
                    cursor: canPrintIndividual ? "pointer" : "not-allowed",
                    borderBottom: "none",
                  }}
                  onMouseEnter={(e) => canPrintIndividual && (e.currentTarget.style.background = T.surfaceAlt)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {canPrintIndividual ? `Print ${analyst}'s analysis` : "Print individual analysis"}
                  <div style={{ fontSize: 11.5, color: T.sub, marginTop: 3 }}>
                    {canPrintIndividual ? "Sections filtered to this analyst" : "Select an analyst first"}
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        <FreshnessIndicator activeImport={activeImport} jiraState={jiraState} />
      </div>
    </div>
  )
}

function menuItemStyle() {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "12px 16px",
    background: "transparent",
    border: "none",
    fontFamily: "Geist, DM Sans, sans-serif",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    borderBottom: `1px solid ${T.borderSoft}`,
    transition: "background 0.12s ease",
  }
}
