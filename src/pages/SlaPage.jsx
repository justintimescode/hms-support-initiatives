import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { SlaBlock } from "../components/charts/SlaBlock.jsx"
import { SlaForecastBlock } from "../components/charts/SlaForecastBlock.jsx"
import { FrtDistributionBlock } from "../components/charts/FrtDistributionBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function SlaPage() {
  const { rows, kpis, priorityData, enriched, enrichedAnalyst, snapshotMs } = useOutletContext()
  if (!rows) return <Section title="SLA Performance"><EmptyState /></Section>
  return (
    <>
      <Section
        title="SLA Performance"
        subtitle="The headline accountability metric: are cases being resolved within their contractual SLA window? The radial shows the overall hit rate, the bar chart breaks it down by priority, and the list at the bottom calls out open cases approaching or already past their SLA deadline."
      >
        <SlaBlock kpis={kpis} priorityData={priorityData} enriched={enriched} />
      </Section>
      <Section
        title="Breach Forecast"
        subtitle="Forward-looking: open cases on track to breach SLA within the next 7 days, ranked by how soon, with a read on whether each is actually getting attention. Covers all open work for the current analyst selection, independent of the date range above."
      >
        <SlaForecastBlock rows={enrichedAnalyst} snapshotMs={snapshotMs} />
      </Section>
      <Section
        title="First Response Time"
        subtitle="The full distribution of how long cases wait for their first Infor response — not just the average, which a few slow outliers can distort."
      >
        <FrtDistributionBlock rows={enriched} />
      </Section>
    </>
  )
}
