import { Section } from "../components/layout/Section.jsx"
import { SurveyPlaceholder } from "../components/SurveyPlaceholder.jsx"

export default function SurveysPage() {
  return (
    <Section
      title="Customer Surveys"
      subtitle="Placeholder for customer satisfaction data. Will populate automatically once ServiceNow survey responses are available in the export."
    >
      <SurveyPlaceholder />
    </Section>
  )
}
