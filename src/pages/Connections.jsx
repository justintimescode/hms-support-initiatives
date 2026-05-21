import { useState } from "react"
import { useOutletContext } from "react-router-dom"
import {
  Upload, FileSpreadsheet, Plug, ExternalLink, Database, Heart,
  AlertTriangle, RotateCcw, Loader2,
} from "lucide-react"
import { T } from "../lib/theme.js"
import { fmtFullDate, fmtFullDateTime } from "../lib/format.js"
import { Section } from "../components/layout/Section.jsx"
import { Card } from "../components/layout/Card.jsx"
import { Pill } from "../components/Pill.jsx"

/* All data sources in one place. CSV upload + Jira sync are real;
 * ServiceNow API + Gainsight are placeholders. */
export default function Connections() {
  const {
    rows, filename, uploading, uploadError, inputRef, handleFile, reset,
    snapshotMs,
    jiraState, syncJira,
  } = useOutletContext()

  return (
    <Section
      title="Connections"
      subtitle="The data sources that feed every page in the app. Upload a ServiceNow case export to get started; everything else is optional."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
        <CsvCard
          rows={rows}
          filename={filename}
          uploading={uploading}
          uploadError={uploadError}
          inputRef={inputRef}
          onPick={handleFile}
          onReset={reset}
          snapshotMs={snapshotMs}
        />
        <JiraCard jiraState={jiraState} onSync={syncJira} />
        <PlaceholderCard
          title="ServiceNow API"
          icon={Database}
          subtitle="Direct ServiceNow connector — eliminates manual CSV/XLSX exports."
        />
        <PlaceholderCard
          title="Gainsight"
          icon={Heart}
          subtitle="Customer health + sentiment signals joined onto each case account."
        />
      </div>
    </Section>
  )
}

function CsvCard({ rows, filename, uploading, uploadError, inputRef, onPick, onReset, snapshotMs }) {
  const [drag, setDrag] = useState(false)
  const hasData = !!rows
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileSpreadsheet size={16} style={{ color: T.accent }} />
          <span className="display" style={{ fontSize: 16, fontWeight: 600 }}>ServiceNow case export</span>
        </div>
        <Pill color={hasData ? T.ok : T.muted}>{hasData ? "loaded" : "not loaded"}</Pill>
      </div>

      {hasData ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: T.sub }}>
            <div><span className="mono" style={{ color: T.ink }}>{filename}</span></div>
            <div className="mono">{rows.length.toLocaleString()} rows</div>
            {snapshotMs && (
              <div style={{ fontSize: 12 }}>Loaded {fmtFullDate(snapshotMs)}</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label
              className="hoverlift"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px",
                background: T.ink, color: T.surface,
                border: `1px solid ${T.ink}`, borderRadius: 6,
                fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onPick(f)
                }}
              />
              <Upload size={13} /> Replace data
            </label>
            <button
              onClick={onReset}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px",
                background: "transparent", color: T.danger,
                border: `1px solid ${T.danger}`, borderRadius: 6,
                fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}
            >
              <RotateCcw size={13} /> Clear data
            </button>
          </div>
        </>
      ) : (
        <>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              const f = e.dataTransfer.files?.[0]
              if (f) onPick(f)
            }}
            className="hoverlift"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 8,
              padding: "32px 16px",
              borderRadius: 6,
              border: `1.5px dashed ${drag ? T.accent : T.border}`,
              background: drag ? T.accentSoft + "55" : T.surfaceAlt,
              cursor: "pointer",
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onPick(f)
              }}
            />
            {uploading ? (
              <>
                <Loader2 size={24} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
                <div style={{ fontSize: 12, color: T.sub }}>Parsing…</div>
              </>
            ) : (
              <>
                <Upload size={24} style={{ color: T.accent }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>Drop a CSV or Excel file</div>
                <div style={{ fontSize: 12, color: T.sub }}>or click to browse · .csv, .xlsx</div>
              </>
            )}
          </label>
          {uploadError && (
            <div style={{ color: T.danger, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={14} /> {uploadError}
            </div>
          )}
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            background: T.warnSoft, border: `1px solid ${T.warn}`,
            borderRadius: 6, padding: "10px 12px", fontSize: 12, color: T.ink,
          }}>
            <AlertTriangle size={14} style={{ color: T.warn, flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>XLSX recommended.</strong> Some ServiceNow CSV columns
              (SLA due, first response time, resolution notes) can fail to
              populate — export via <em>Excel → .xlsx</em> for the most complete results.
            </span>
          </div>
        </>
      )}
    </Card>
  )
}

function JiraCard({ jiraState, onSync }) {
  const status = jiraState?.status || "idle"
  const meta = jiraState?.meta
  const syncedAt = meta?.fetchedAt ? fmtFullDateTime(meta.fetchedAt) : null
  const syncing = status === "loading" || status === "hydrating"
  const pillTone = status === "ready" ? T.ok
    : status === "loading" || status === "hydrating" ? T.warn
    : status === "unconfigured" || status === "error" ? T.danger
    : T.muted
  const pillLabel = status === "ready" ? "connected"
    : status === "loading" ? "syncing…"
    : status === "hydrating" ? "loading cache…"
    : status === "unconfigured" ? "needs token"
    : status === "error" ? "error"
    : "idle"

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ExternalLink size={16} style={{ color: T.accent }} />
          <span className="display" style={{ fontSize: 16, fontWeight: 600 }}>Jira (Atlassian)</span>
        </div>
        <Pill color={pillTone}>{pillLabel}</Pill>
      </div>
      <div style={{ fontSize: 13, color: T.sub }}>
        Live engineering data for the HMS project. Used for blocker analysis on case rows and for the standalone Jira project lens.
      </div>
      {status === "ready" && meta && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.sub }}>
          {meta.projectName && (
            <div>Project <strong style={{ color: T.ink }}>{meta.projectName}</strong>{meta.projectKey ? <span className="mono" style={{ color: T.muted }}> ({meta.projectKey})</span> : null}</div>
          )}
          {meta.count != null && <div className="mono">{meta.count} issues cached</div>}
          {syncedAt && <div>Synced {syncedAt}</div>}
          {meta.cacheSaved === false && (
            <div style={{ color: T.warn, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={12} /> cache did not persist
            </div>
          )}
        </div>
      )}
      {status === "unconfigured" && (
        <div style={{ fontSize: 12, color: T.sub }}>
          Add JIRA_EMAIL and JIRA_API_TOKEN to <span className="mono">.env</span>, then restart <span className="mono">npm run dev</span>.
        </div>
      )}
      {status === "error" && jiraState?.error && (
        <div style={{ color: T.danger, fontSize: 12 }}>{jiraState.error}</div>
      )}
      {syncing && <JiraSyncProgress status={status} progress={jiraState?.progress} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => onSync("recent")}
          disabled={syncing}
          style={btnSecondary(syncing)}
        >
          Sync recent
        </button>
        <button
          onClick={() => onSync("full")}
          disabled={syncing}
          style={btnPrimary(syncing)}
        >
          {status === "ready" ? "Full re-sync" : "Sync Jira now"}
        </button>
      </div>
    </Card>
  )
}

function JiraSyncProgress({ status, progress }) {
  const total = progress?.total
  const fetched = progress?.fetched ?? 0
  const determinate = status === "loading" && total > 0
  const pct = determinate ? Math.min(100, Math.round((fetched / total) * 100)) : 0

  const label = status === "hydrating"
    ? "Restoring cached data…"
    : determinate
      ? `Fetched ${fetched.toLocaleString()} of ${total.toLocaleString()} issues`
      : progress
        ? `Fetched ${fetched.toLocaleString()} issues…`
        : "Contacting Atlassian…"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: T.sub }}>{label}</div>
      <div style={{ position: "relative", height: 6, background: T.surfaceAlt, borderRadius: 3, overflow: "hidden" }}>
        {determinate ? (
          <div style={{ height: "100%", width: `${pct}%`, background: T.accent, borderRadius: 3, transition: "width 0.3s ease" }} />
        ) : (
          <div style={{ position: "absolute", top: 0, bottom: 0, width: "45%", background: T.accent, borderRadius: 3, animation: "indeterminate 1.2s linear infinite" }} />
        )}
      </div>
    </div>
  )
}

function PlaceholderCard({ title, icon: Icon, subtitle }) {
  return (
    <Card style={{ background: T.surfaceAlt, borderStyle: "dashed", display: "flex", flexDirection: "column", gap: 10, opacity: 0.85 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon size={16} style={{ color: T.muted }} />
          <span className="display" style={{ fontSize: 16, fontWeight: 600, color: T.sub }}>{title}</span>
        </div>
        <Pill color={T.muted}>coming soon</Pill>
      </div>
      <div style={{ fontSize: 13, color: T.sub }}>{subtitle}</div>
      <button
        disabled
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          background: "transparent",
          color: T.muted,
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          fontSize: 13,
          cursor: "not-allowed",
        }}
      >
        <Plug size={13} style={{ verticalAlign: "middle", marginRight: 4 }} /> Configure
      </button>
    </Card>
  )
}

function btnPrimary(disabled) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 14px",
    background: disabled ? T.surfaceAlt : T.accent,
    color: disabled ? T.muted : T.surface,
    border: `1px solid ${disabled ? T.border : T.accent}`,
    borderRadius: 6,
    fontSize: 13, fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
  }
}
function btnSecondary(disabled) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 14px",
    background: "transparent",
    color: disabled ? T.muted : T.sub,
    border: `1px solid ${T.border}`,
    borderRadius: 6,
    fontSize: 13, fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
  }
}

