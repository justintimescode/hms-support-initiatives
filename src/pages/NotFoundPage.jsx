import { Link } from "react-router-dom"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { T } from "../lib/theme.js"

export default function NotFoundPage() {
  return (
    <Section title="Page not found">
      <Card>
        <div style={{ fontSize: 14, color: T.sub }}>
          The page you tried to open doesn't exist. Head back to the{" "}
          <Link to="/" style={{ color: T.accent, fontWeight: 600 }}>Dashboard</Link>.
        </div>
      </Card>
    </Section>
  )
}
