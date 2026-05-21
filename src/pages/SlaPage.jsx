import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { SlaBlock } from "../components/charts/SlaBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function SlaPage() {
  const { rows, kpis, priorityData, enriched } = useOutletContext()
  if (!rows) return <Section title="SLA Performance"><EmptyState /></Section>
  return (
    <Section
      title="SLA Performance"
      subtitle="The headline accountability metric: are cases being resolved within their contractual SLA window? The radial shows the overall hit rate, the bar chart breaks it down by priority, and the list at the bottom calls out open cases approaching or already past their SLA deadline."
    >
      <SlaBlock kpis={kpis} priorityData={priorityData} enriched={enriched} />
    </Section>
  )
}
