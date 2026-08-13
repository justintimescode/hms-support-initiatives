import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { ParentAccountBlock } from "../components/charts/ParentAccountBlock.jsx"
import { ParentAccountTrendBlock } from "../components/charts/ParentAccountTrendBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

/* Every Department of Defense view in one place: the point-in-time branch
 * breakdown that used to live on Accounts, plus the weekly / cumulative branch
 * series that used to live on Trends. All blocks count ONLY the four DoD branch
 * parent accounts (see lib/dod.js) — other / no parent-account cases are
 * excluded by design. */
export default function DodPage() {
  const { rows, view, enriched, enrichedAnalyst, teamMembersAll, dateRange, snapshotMs } = useOutletContext()
  if (!rows) return <Section title="Department of Defense"><EmptyState /></Section>
  // Trend blocks match TrendsPage: team view uses the unfiltered all-members
  // slice so the longitudinal arc stays complete.
  const trendRows = view === "team"
    ? (teamMembersAll ? teamMembersAll.flatMap((m) => m.rows) : enrichedAnalyst)
    : enrichedAnalyst
  const range = dateRange?.from != null ? dateRange : null

  return (
    <Section
      title="Department of Defense"
      subtitle={
        view === "team"
          ? "Team-wide case load across the four armed-forces branch HQs — current volume and lifecycle split, then how each branch's intake has moved week to week. Charts zoom to the active date filter; switch either card to All time for the full arc."
          : "Case load across the four armed-forces branch HQs (Air Force, Army, Navy, Navy Lodges). The first row is the current picture: total volume per branch and how those cases split across the lifecycle. The charts below track movement over time — weekly intake stacked by branch, and each branch's cumulative book of cases. Cases with any other parent account, or none, are not counted. Charts zoom to the active date filter; switch either card to All time for the full arc."
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ParentAccountBlock rows={enriched} />
        <ParentAccountTrendBlock rows={trendRows} dateRange={range} snapshotMs={snapshotMs} />
      </div>
    </Section>
  )
}
