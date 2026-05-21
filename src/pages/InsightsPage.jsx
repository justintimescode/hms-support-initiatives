import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { AiBlock } from "../components/ai/AiBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function InsightsPage() {
  const { rows: loadedRows, view, enriched, teamMembers, aiState, runAiAnalysis } = useOutletContext()
  if (!loadedRows) return <Section title="Deep Pattern Analysis"><EmptyState /></Section>
  const rows = view === "team"
    ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enriched)
    : enriched
  return (
    <Section
      title="Deep Pattern Analysis"
      subtitle={
        view === "team"
          ? "An AI-powered qualitative read on the team's case data — themes, recurring issues, knowledge-base gaps, and skill-development opportunities. Samples up to 50 cases (anonymized) and sends them to Claude for analysis."
          : "An AI-powered qualitative read on the case data — themes, recurring issues, knowledge-base gaps, skill-development opportunities, and things to watch out for. Samples up to 50 cases (with sensitive data anonymized) and sends them to Claude for analysis. Click run when you want a narrative summary the charts can't give you."
      }
    >
      <AiBlock state={aiState} run={runAiAnalysis} hasData={rows.length > 0} />
    </Section>
  )
}
