import { User, Users, Printer, Package, Globe, Flag } from "lucide-react"
import { T } from "../../lib/theme.js"
import { FilterBar } from "../FilterBar.jsx"
import { MultiSelect } from "../MultiSelect.jsx"
import { FreshnessIndicator } from "./FreshnessIndicator.jsx"
import { useFilterNavigate } from "../../lib/nav.js"

/* Persistent top bar for every routed page. */
export function TopBar({ ctx }) {
  const navigate = useFilterNavigate()
  if (!ctx) return null
  const {
    rows,
    analyst, analysts,
    managers,
    // multi-select state (source of truth) + toggles/clears
    analystSel, toggleAnalyst, setAnalysts,
    managerSel, toggleManager, setManagers,
    productSel, toggleProduct, setProducts, productsOptions,
    regionSel, toggleRegion, setRegions, regionsOptions,
    prioritySel, togglePriority, setPriorities, prioritiesOptions,
    clearEntityFilters,
    dateRange, setDateRange,
    compareOn, setCompareOn,
    compareWindow,
    view,
    teamMembers, kpis,
    printMenuOpen, setPrintMenuOpen, triggerPrint,
    activeImport, jiraState, jiraAutoSyncing,
  } = ctx

  if (!rows) {
    return (
      <div
        className="no-print"
        style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}
      >
        <FreshnessIndicator activeImport={activeImport} jiraState={jiraState} jiraAutoSyncing={jiraAutoSyncing} />
      </div>
    )
  }

  const canPrintIndividual = analyst !== "__all__"
  const sliceCount = view === "team"
    ? (teamMembers || []).reduce((s, m) => s + m.kpis.total, 0)
    : (kpis?.total ?? 0)

  // Only offer an entity filter when the export actually carries that data —
  // an import without the column would render a lone "Unknown …" option that
  // filters nothing. The single "Unknown …"/"No manager" sentinel is the tell.
  const hasData = (opts, sentinel) => (opts || []).some(([name]) => name !== sentinel)
  const hasManagerData = hasData(managers, "No manager")
  const hasProductData = hasData(productsOptions, "Unknown product")
  const hasRegionData = hasData(regionsOptions, "Unknown region")
  const hasPriorityData = hasData(prioritiesOptions, "Unknown priority")

  const activeFilterCount =
    (managerSel?.length || 0) + (analystSel?.length || 0) +
    (productSel?.length || 0) + (regionSel?.length || 0) + (prioritySel?.length || 0)

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
        {hasManagerData && (
          <MultiSelect
            icon={Users}
            label="manager"
            title="Scope every tab to one or more managers' teams"
            options={managers || []}
            selected={managerSel || []}
            onToggle={toggleManager}
            onClear={() => setManagers([])}
            minWidth={200}
          />
        )}

        <MultiSelect
          icon={User}
          label="analyst"
          title="Scope to one or more analysts"
          options={analysts || []}
          selected={analystSel || []}
          onToggle={toggleAnalyst}
          onClear={() => setAnalysts([])}
          minWidth={200}
        />

        {hasProductData && (
          <MultiSelect
            icon={Package}
            label="product"
            title="Filter to one or more product lines"
            options={productsOptions || []}
            selected={productSel || []}
            onToggle={toggleProduct}
            onClear={() => setProducts([])}
            minWidth={180}
          />
        )}

        {hasRegionData && (
          <MultiSelect
            icon={Globe}
            label="region"
            title="Filter to one or more regions"
            options={regionsOptions || []}
            selected={regionSel || []}
            onToggle={toggleRegion}
            onClear={() => setRegions([])}
            minWidth={170}
          />
        )}

        {hasPriorityData && (
          <MultiSelect
            icon={Flag}
            label="priority"
            labelPlural="priorities"
            title="Filter to one or more priorities"
            options={prioritiesOptions || []}
            selected={prioritySel || []}
            onToggle={togglePriority}
            onClear={() => setPriorities([])}
            minWidth={170}
          />
        )}

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearEntityFilters}
            title="Clear all entity filters"
            style={{
              padding: "8px 12px",
              background: "none",
              border: "none",
              color: T.accent,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Clear filters ({activeFilterCount})
          </button>
        )}

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
              borderRadius: T.radiusSm,
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
            <Printer size={14} strokeWidth={2.25} /> Print <span style={{ fontSize: 10, marginLeft: 2, color: T.muted }}>▾</span>
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
                  <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>All team-wide sections</div>
                </button>
                <button
                  onClick={() => canPrintIndividual && triggerPrint("individual")}
                  disabled={!canPrintIndividual}
                  style={{
                    ...menuItemStyle(),
                    color: canPrintIndividual ? T.ink : T.muted,
                    cursor: canPrintIndividual ? "pointer" : "not-allowed",
                  }}
                  onMouseEnter={(e) => canPrintIndividual && (e.currentTarget.style.background = T.surfaceAlt)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {canPrintIndividual ? `Print ${analyst}'s analysis` : "Print individual analysis"}
                  <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>
                    {canPrintIndividual ? "Sections filtered to this analyst" : "Select an analyst first"}
                  </div>
                </button>
                <button
                  onClick={() => { setPrintMenuOpen(false); navigate("/report") }}
                  style={{ ...menuItemStyle(), borderBottom: "none" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = T.surfaceAlt)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Monthly summary report
                  <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>Period-over-period KPIs with deltas · print-ready</div>
                </button>
              </div>
            </>
          )}
        </div>

        <FreshnessIndicator activeImport={activeImport} jiraState={jiraState} jiraAutoSyncing={jiraAutoSyncing} />
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
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    borderBottom: `1px solid ${T.borderSoft}`,
    transition: "background 0.12s ease",
  }
}
