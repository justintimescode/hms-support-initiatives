import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { CategoryBlock } from "../components/charts/CategoryBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { useQuery } from "../lib/useQuery.js"
import { getCategoryData } from "../lib/queries.js"
import { DevCompare } from "../components/dev/DevCompare.jsx"
import { flattenByKey } from "../components/dev/devCompareUtils.js"

export default function CategoriesPage() {
  const { rows, view, categoryData, analyst, dateRange } = useOutletContext()
  const dr = dateRange || { from: null, to: null, field: "_created" }
  const sql = useQuery(
    () => getCategoryData({ analyst, dateRange: dr }),
    [analyst, dr.from, dr.to, dr.field],
    { enabled: !!rows },
  )
  if (!rows) return <Section title="Case Categorization"><EmptyState /></Section>
  return (
    <Section
      title="Case Categorization"
      subtitle={
        view === "team"
          ? "What kinds of problems are showing up across the team. Auto-derived from short descriptions and resolution notes."
          : "What kinds of problems are showing up in this queue. Categories are auto-derived by scanning short descriptions and resolution notes for keyword patterns (Night Audit, Login & Access, Billing & Folio, etc.). The keyword cloud surfaces the most-mentioned terms in resolution notes — a quick read on the language of the work."
      }
    >
      <DevCompare
        label="getCategoryData"
        note={`analyst: ${analyst === "__all__" ? "all" : analyst}`}
        metrics={flattenByKey(categoryData, sql.data, "name", ["count"])}
      />
      <CategoryBlock categoryData={categoryData} />
    </Section>
  )
}
