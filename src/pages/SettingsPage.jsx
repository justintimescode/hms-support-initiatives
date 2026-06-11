import { useState } from "react"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { T } from "../lib/theme.js"
import { getAutoDelete, setAutoDelete, getDiskBackup, setDiskBackup } from "../lib/settings.js"

/** Pill-style on/off switch, accessible (role="switch" + aria-checked). */
function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{
        flexShrink: 0, width: 46, height: 26, borderRadius: 13, cursor: "pointer",
        border: `1px solid ${checked ? T.accent : T.border}`,
        background: checked ? T.accent : T.surfaceAlt, position: "relative", transition: "background 0.15s",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 22 : 2, width: 20, height: 20,
        borderRadius: "50%", background: "#fff", transition: "left 0.15s",
      }} />
    </button>
  )
}

export default function SettingsPage() {
  const initial = getAutoDelete()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [days, setDays] = useState(initial.days)
  const [diskBackup, setDiskBackupState] = useState(getDiskBackup())

  const persist = (next) => {
    const merged = { enabled, days, ...next }
    setEnabled(merged.enabled)
    setDays(merged.days)
    setAutoDelete(merged)
  }

  const toggleDiskBackup = (on) => {
    setDiskBackupState(on)
    setDiskBackup(on)
  }

  return (
    <Section title="Settings" subtitle="App preferences and configuration. Stored locally in this browser.">
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="eyebrow" style={{ color: T.muted }}>Data retention</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ maxWidth: 420 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Auto-delete old imports</div>
              <div style={{ fontSize: 13, color: T.sub, marginTop: 4, lineHeight: 1.5 }}>
                On startup, permanently delete imports older than the threshold below. The active import is
                always kept, even if it's older — your current working set is never silently lost.
              </div>
            </div>
            <Toggle checked={enabled} onChange={(on) => persist({ enabled: on })} />
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

        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="eyebrow" style={{ color: T.muted }}>Disk backup</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ maxWidth: 420 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Back up imports to disk</div>
              <div style={{ fontSize: 13, color: T.sub, marginTop: 4, lineHeight: 1.5 }}>
                When on, each new upload is also mirrored to <span className="mono">.servicenow-cache/</span>{" "}
                so imports can be recovered after clearing the browser, in a different browser, or — in the
                desktop app — across restarts. The mirror stores the <strong>raw, unencrypted</strong> case
                export. <strong>On by default in the desktop app</strong> (saved under your Windows profile);{" "}
                <strong>off by default in the browser</strong>, where the mirror writes into the project
                folder. Applies to imports saved while it's on; existing on-disk backups are still used for
                recovery and cleaned up when their import is deleted.
              </div>
            </div>
            <Toggle checked={diskBackup} onChange={toggleDiskBackup} />
          </div>
        </Card>
      </div>
    </Section>
  )
}
