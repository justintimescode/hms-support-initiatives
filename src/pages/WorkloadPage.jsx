import { useOutletContext } from "react-router-dom"
import { T } from "../lib/theme.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { WorkloadDistributionBlock } from "../components/charts/WorkloadDistributionBlock.jsx"
import { WorkloadVolumeBlock } from "../components/charts/WorkloadVolumeBlock.jsx"
import { WorkloadResolvedBlock } from "../components/charts/WorkloadResolvedBlock.jsx"
import { AssigneeAgingBlock } from "../components/charts/AssigneeAgingBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function WorkloadPage() {
  const { rows, teamMembers, analyst } = useOutletContext()
  if (!rows) return <Section title="Workload Distribution"><EmptyState /></Section>
  const members = teamMembers || []
  return (
    <>
      {analyst !== "__all__" && <TeamOnlyNote />}
      <Section
        title="Workload Distribution"
        subtitle="How work is spread across the team — concentration, per-analyst volume, completed work, and where open work is piling up."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <WorkloadDistributionBlock members={members} />
          <WorkloadVolumeBlock members={members} />
          <WorkloadResolvedBlock members={members} />
          <AssigneeAgingBlock members={members} />
        </div>
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
