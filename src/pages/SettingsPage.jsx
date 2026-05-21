import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { T } from "../lib/theme.js"

export default function SettingsPage() {
  return (
    <Section
      title="Settings"
      subtitle="App preferences and configuration."
    >
      <Card style={{ borderStyle: "dashed", background: T.surfaceAlt }}>
        <div className="eyebrow" style={{ color: T.muted }}>Coming soon</div>
        <div style={{ fontSize: 14, marginTop: 6 }}>Settings will land here in a later iteration.</div>
      </Card>
    </Section>
  )
}
