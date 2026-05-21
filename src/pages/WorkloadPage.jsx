import { useOutletContext } from "react-router-dom"
import { T } from "../lib/theme.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { WorkloadDistributionBlock } from "../components/charts/WorkloadDistributionBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function WorkloadPage() {
  const { rows, teamMembers, analyst } = useOutletContext()
  if (!rows) return <Section title="Workload Distribution"><EmptyState /></Section>
  return (
    <>
      {analyst !== "__all__" && <TeamOnlyNote />}
      <Section
        title="Workload Distribution"
        subtitle="How work is spread across the team — the Lorenz curve and Gini score show fairness and bus-factor risk that the leaderboard alone does not."
      >
        <WorkloadDistributionBlock members={teamMembers || []} />
      </Section>
    </>
  )
}

function TeamOnlyNote() {
  return (
    <Card style={{ marginBottom: 12, borderLeft: `3px solid ${T.warn}` }}>
      <div className="eyebrow" style={{ color: T.warn }}>Team-wide view</div>
      <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}>
        Workload distribution is inherently team-scoped. The analyst filter has no effect on this page.
      </div>
    </Card>
  )
}
