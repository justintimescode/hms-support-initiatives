import { useEffect, useState } from "react"
import { ExternalLink, Loader2, Check, AlertTriangle, Info } from "lucide-react"
import { T, alpha } from "../../lib/theme.js"
import { Card } from "../layout/Card.jsx"
import { Pill } from "../Pill.jsx"
import {
  ATLASSIAN_TOKEN_URL, getJiraCredsStatus, testJiraCreds, saveJiraCreds,
  clearJiraCreds, openExternal,
} from "../../lib/jira-creds.js"

const DEFAULT_BASE_URL = "https://infor.atlassian.net"

/* Settings → Jira connection.
 *
 * The ONLY place Jira credentials are entered, in both the desktop app and
 * `npm run dev`. Jira is optional: the app boots, imports ServiceNow exports and
 * runs every other page with this left untouched — so this card leads with that
 * and never nags. Saving takes effect on the next Jira request; no restart.
 *
 * onChanged() lets useAppData re-probe and flip the Jira pages out of (or back
 * into) their "not connected" state without a reload. */
export function JiraConnectionCard({ onChanged }) {
  const [status, setStatus] = useState(null) // null = still probing
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [email, setEmail] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(null) // 'test' | 'save' | 'clear'
  const [msg, setMsg] = useState(null) // { kind: 'ok'|'err'|'info', text }

  useEffect(() => {
    let cancelled = false
    getJiraCredsStatus().then((s) => {
      if (cancelled) return
      setStatus(s)
      setBaseUrl(s.baseUrl || DEFAULT_BASE_URL)
      setEmail(s.email || "")
    })
    return () => { cancelled = true }
  }, [])

  const creds = () => ({ baseUrl: baseUrl.trim() || DEFAULT_BASE_URL, email: email.trim(), token: token.trim() })
  const canSubmit = !busy && email.trim() && token.trim()

  const refresh = async () => {
    // onChanged owns the app-wide re-probe; fall back to a local one without it.
    const next = onChanged ? await onChanged() : await getJiraCredsStatus()
    setStatus(next)
    return next
  }

  const doTest = async () => {
    setBusy("test"); setMsg({ kind: "info", text: "Testing connection…" })
    const r = await testJiraCreds(creds())
    setBusy(null)
    setMsg(r.ok
      ? { kind: "ok", text: `Connected as ${r.displayName}. Save to keep these credentials.` }
      : { kind: "err", text: r.message })
  }

  const doSave = async () => {
    setBusy("save"); setMsg({ kind: "info", text: "Verifying and saving…" })
    // Verify first so a typo'd token never becomes the saved state.
    const test = await testJiraCreds(creds())
    if (!test.ok) {
      setBusy(null)
      setMsg({ kind: "err", text: test.message })
      return
    }
    const r = await saveJiraCreds(creds())
    if (!r.ok) {
      setBusy(null)
      setMsg({ kind: "err", text: r.message })
      return
    }
    setToken("") // never keep the secret in component state longer than needed
    await refresh()
    setBusy(null)
    setMsg({ kind: "ok", text: `Connected as ${test.displayName}. Sync Jira from the Connections page.` })
  }

  const doClear = async () => {
    setBusy("clear")
    const r = await clearJiraCreds()
    setToken("")
    const next = await refresh()
    setBusy(null)
    if (!r.ok) setMsg({ kind: "err", text: r.message })
    else if (next.configured) setMsg({ kind: "info", text: "Saved credentials removed — still connected via .env." })
    else setMsg({ kind: "info", text: "Jira disconnected. Every non-Jira page is unaffected." })
  }

  const connected = !!status?.configured
  const unavailable = status && !status.available
  // Only offer Disconnect when there is something of ours to forget. With
  // source 'env' the credentials come from a file the user edits themselves.
  const canDisconnect = connected && status?.source !== "env"

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="eyebrow" style={{ color: T.muted }}>Jira connection</div>
        <Pill color={connected ? T.ok : T.muted}>{connected ? "connected" : "not connected"}</Pill>
      </div>

      <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.55, maxWidth: 520 }}>
        <strong style={{ color: T.ink }}>Optional.</strong> ServiceNow imports, SLA, cadence, team and
        every other page work with no Jira account at all. Add your own Atlassian email and API token
        here when you want the Jira pages — <em>All HMS Jira's</em>, <em>Statistics</em>, and the
        blocker analysis joined onto case rows. Takes effect immediately; no restart.
      </div>

      {connected && status?.source === "env" && (
        <Note icon={Info}>
          Currently using the credentials in <span className="mono">.env</span>. Saving below stores
          your own and takes precedence over that file.
        </Note>
      )}

      {unavailable ? (
        <Note icon={AlertTriangle} tone={T.warn}>
          This build has nowhere to store a token — live Jira sync needs either the desktop app or
          <span className="mono"> npm run dev</span>. Everything else on this page still works.
        </Note>
      ) : (
        <>
          <Field label="Jira site URL">
            <input
              type="url" value={baseUrl} placeholder={DEFAULT_BASE_URL}
              onChange={(e) => setBaseUrl(e.target.value)} style={input}
            />
          </Field>
          <Field label="Atlassian email">
            <input
              type="email" value={email} placeholder="you@infor.com" autoComplete="off"
              onChange={(e) => setEmail(e.target.value)} style={input}
            />
          </Field>
          <Field
            label="API token"
            hint={
              <button type="button" onClick={() => openExternal(ATLASSIAN_TOKEN_URL)} style={linkBtn}>
                create one here <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
              </button>
            }
          >
            <input
              type="password" value={token} autoComplete="off"
              placeholder={connected ? "•••••••• saved — paste a new token to replace" : "paste your API token"}
              onChange={(e) => setToken(e.target.value)} style={input}
            />
          </Field>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={doTest} disabled={!canSubmit} style={btn(!canSubmit, false)}>
              {busy === "test" && <Spinner />} Test connection
            </button>
            <button onClick={doSave} disabled={!canSubmit} style={btn(!canSubmit, true)}>
              {busy === "save" ? <Spinner /> : <Check size={13} />} {connected ? "Update" : "Connect"}
            </button>
            {canDisconnect && (
              <button onClick={doClear} disabled={!!busy} style={{ ...btn(!!busy, false), color: T.danger, borderColor: alpha(T.danger, 0.4) }}>
                {busy === "clear" && <Spinner />} Disconnect
              </button>
            )}
          </div>

          {msg && (
            <div style={{
              fontSize: 12.5, lineHeight: 1.5,
              color: msg.kind === "ok" ? T.ok : msg.kind === "err" ? T.danger : T.sub,
            }}>
              {msg.text}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.6, borderTop: `1px solid ${T.borderSoft}`, paddingTop: 10 }}>
            {status?.storage === "keystore" ? (
              <>Your token is stored <strong>encrypted by Windows</strong> under your own profile
              (<span className="mono">credentials.enc</span>), keyed to your login — useless if copied to
              another machine.</>
            ) : (
              <>Dev mode: your token is written to <span className="mono">.jira-creds.json</span> in the
              project folder (gitignored, plaintext — same trust level as the{" "}
              <span className="mono">.env</span> it replaces). The packaged desktop app encrypts it with
              the Windows keystore instead.</>
            )}{" "}
            The token stays server-side either way — it is never sent to the browser, and only the local
            Jira proxy reads it.
          </div>
        </>
      )}
    </Card>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 460 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, display: "flex", gap: 6, alignItems: "baseline" }}>
        {label} {hint}
      </span>
      {children}
    </label>
  )
}

function Note({ icon: Icon, tone = T.sub, children }) {
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: T.sub,
      background: T.surfaceAlt, border: `1px solid ${T.borderSoft}`, borderRadius: 6,
      padding: "9px 11px", lineHeight: 1.55, maxWidth: 520,
    }}>
      <Icon size={13} style={{ color: tone, flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </div>
  )
}

const Spinner = () => <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />

const input = {
  fontSize: 13, padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 5,
  background: T.surface, color: T.ink, fontFamily: "DM Sans, sans-serif", width: "100%",
  boxSizing: "border-box",
}

const linkBtn = {
  background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 400,
  fontSize: 12, color: T.accent, cursor: "pointer",
}

function btn(disabled, primary) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
    background: primary && !disabled ? T.accent : "transparent",
    color: primary && !disabled ? T.onAccent : disabled ? T.muted : T.sub,
    border: `1px solid ${primary && !disabled ? T.accent : T.border}`,
    borderRadius: 6, fontSize: 13, fontWeight: 500,
    fontFamily: "DM Sans, sans-serif",
    cursor: disabled ? "not-allowed" : "pointer",
  }
}
