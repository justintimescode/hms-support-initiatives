import { useState } from "react"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { T } from "../lib/theme.js"
import { getAutoDelete, setAutoDelete } from "../lib/settings.js"

export default function SettingsPage() {
  const initial = getAutoDelete()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [days, setDays] = useState(initial.days)

  const persist = (next) => {
    const merged = { enabled, days, ...next }
    setEnabled(merged.enabled)
    setDays(merged.days)
    setAutoDelete(merged)
  }

  return (
    <Section title="Settings" subtitle="App preferences and configuration. Stored locally in this browser.">
      <Card style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}>
        <div className="eyebrow" style={{ color: T.muted }}>Data retention</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Auto-delete old imports</div>
            <div style={{ fontSize: 13, color: T.sub, marginTop: 4, lineHeight: 1.5 }}>
              On startup, permanently delete imports older than the threshold below. The active import is
              always kept, even if it's older — your current working set is never silently lost.
            </div>
          </div>
          <button
            onClick={() => persist({ enabled: !enabled })}
            role="switch"
            aria-checked={enabled}
            style={{
              flexShrink: 0, width: 46, height: 26, borderRadius: 13, cursor: "pointer",
              border: `1px solid ${enabled ? T.accent : T.border}`,
              background: enabled ? T.accent : T.surfaceAlt, position: "relative", transition: "background 0.15s",
            }}
          >
            <span style={{
              position: "absolute", top: 2, left: enabled ? 22 : 2, width: 20, height: 20,
              borderRadius: "50%", background: "#fff", transition: "left 0.15s",
            }} />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: enabled ? 1 : 0.5 }}>
          <span style={{ fontSize: 13, color: T.sub }}>Delete imports older than</span>
          <input
            type="number"
            min={1}
            value={days}
            disabled={!enabled}
            onChange={(e) => persist({ days: Math.max(1, Number(e.target.value) || 1) })}
            style={{
              width: 70, fontSize: 13, padding: "6px 8px", border: `1px solid ${T.border}`,
              borderRadius: 4, background: T.surface, color: T.ink, fontFamily: "JetBrains Mono, monospace",
            }}
          />
          <span style={{ fontSize: 13, color: T.sub }}>days</span>
        </div>
      </Card>
    </Section>
  )
}
