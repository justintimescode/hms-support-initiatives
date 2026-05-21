import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { CaseTable } from "../components/CaseTable.jsx"
import { EmptyState } from "../components/EmptyState.jsx"

export default function CasesPage() {
  const { rows: loadedRows, view, enriched, teamMembers } = useOutletContext()
  if (!loadedRows) return <Section title="Case Register"><EmptyState /></Section>
  const rows = view === "team"
    ? (teamMembers ? teamMembers.flatMap((m) => m.rows) : enriched)
    : enriched
  return (
    <Section
      title="Case Register"
      subtitle={
        view === "team"
          ? "The full underlying case list across the team. Sort by any column or search by keyword to inspect the individual cases behind every metric in the app."
          : "The full underlying case list — every record from the uploaded export. Sort by any column or search by keyword to inspect the individual cases behind the metrics above."
      }
    >
      <CaseTable rows={rows} />
    </Section>
  )
}
