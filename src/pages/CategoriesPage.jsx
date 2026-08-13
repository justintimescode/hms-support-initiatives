import { useOutletContext } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { CategoryBlock } from "../components/charts/CategoryBlock.jsx"
import { EmptyState } from "../components/EmptyState.jsx"
import { useQuery } from "../lib/useQuery.js"
import { getCategoryData } from "../lib/queries.js"
import { DevCompare } from "../components/dev/DevCompare.jsx"
import { flattenByKey } from "../components/dev/devCompareUtils.js"

export default function CategoriesPage() {
  const { rows, view, categoryData, analyst, manager, dateRange } = useOutletContext()
  const dr = dateRange || { from: null, to: null, field: "_created" }
  const sql = useQuery(
    () => getCategoryData({ analyst, manager, dateRange: dr }),
    [analyst, manager, dr.from, dr.to, dr.field],
    { enabled: !!rows },
  )
  if (!rows) return <Section title="Case Categorization"><EmptyState /></Section>
  return (
    <Section
      title="Case Categorization"
      subtitle={
        view === "team"
          ? "What kinds of problems are showing up across the team. Auto-derived from case titles and comments."
          : "What kinds of problems are showing up in this queue. Categories are auto-derived by scanning the short description and case comments for keyword patterns (Billing & Folio, Front Desk & Stay 360, Reports & Data, etc.)."
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
