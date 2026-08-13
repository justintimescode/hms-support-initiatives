// Jira credential management, from the renderer's point of view.
//
// Jira is OPTIONAL. Nothing about booting the app, importing a ServiceNow
// export, or any non-Jira page depends on a token existing. This module is what
// Settings → Jira connection uses when the user *does* want the Jira pages.
//
// Two transports, one API. Which one is live depends on how the app was
// launched, and callers should not care:
//
//   Desktop (Electron)  → window.electronAPI (preload.cjs → IPC → main.cjs).
//                         Token stored encrypted with the OS keystore at
//                         %APPDATA%\KPI Analyzer\credentials.enc.
//   Browser (npm run dev) → /api/creds/jira on the Vite dev server
//                         (vite.config.js → jiraCredsPlugin). Token stored in
//                         the gitignored, plaintext .jira-creds.json, same
//                         trust level as the .env it replaces.
//
// In both cases the token is written server-side and never read back — it
// never enters the client bundle, and only the Jira proxy ever sees it. A
// static `vite build` served without either host has no credential store at
// all, so status() reports unavailable and the UI says so.

const ENDPOINT = "/api/creds/jira"

const bridge = () => (typeof window !== "undefined" ? window.electronAPI : null)

export const ATLASSIAN_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens"

/** Open an external URL — via the shell in the desktop app, a tab in the browser. */
export function openExternal(url) {
  const api = bridge()
  if (api?.openExternal) api.openExternal(url)
  else window.open(url, "_blank", "noopener,noreferrer")
}

/**
 * Who (if anyone) we are configured to talk to Jira as.
 * @returns {Promise<{ configured: boolean, baseUrl: string, email: string,
 *   source: 'keystore'|'file'|'env'|null, storage: 'keystore'|'file'|null,
 *   available: boolean }>}
 *   `available: false` means there is no credential store to write to (a static
 *   build with no dev server and no Electron host) — the form is read-only then.
 */
export async function getJiraCredsStatus() {
  const api = bridge()
  if (api?.status) {
    const s = await api.status()
    return {
      configured: !!s.configured,
      baseUrl: s.baseUrl || "",
      email: s.email || "",
      source: s.source ?? (s.configured ? "keystore" : null),
      storage: "keystore",
      available: true,
    }
  }
  try {
    const res = await fetch(ENDPOINT, { cache: "no-store" })
    if (!res.ok) throw new Error(`creds GET → ${res.status}`)
    const s = await res.json()
    return {
      configured: !!s.configured,
      baseUrl: s.baseUrl || "",
      email: s.email || "",
      source: s.source ?? null,
      storage: "file",
      available: true,
    }
  } catch {
    // No dev server, no Electron host: nowhere to keep a token.
    return { configured: false, baseUrl: "", email: "", source: null, storage: null, available: false }
  }
}

/** Verify credentials against Jira /myself without saving them.
 *  @returns {Promise<{ ok: boolean, displayName?: string, message?: string }>} */
export async function testJiraCreds(creds) {
  const api = bridge()
  if (api?.test) return api.test(creds)
  return postJson(`${ENDPOINT}/test`, creds, "Could not reach the local dev server to test credentials.")
}

/** Persist credentials. Takes effect on the next Jira request — no restart.
 *  @returns {Promise<{ ok: boolean, message?: string }>} */
export async function saveJiraCreds(creds) {
  const api = bridge()
  if (api?.save) return api.save(creds)
  return postJson(ENDPOINT, creds, "Could not reach the local dev server to save credentials.")
}

/** Forget the saved credentials. Jira pages revert to "not connected"; every
 *  other page is unaffected. */
export async function clearJiraCreds() {
  const api = bridge()
  if (api?.clear) return api.clear()
  try {
    const res = await fetch(ENDPOINT, { method: "DELETE" })
    if (!res.ok) throw new Error(`creds DELETE → ${res.status}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Could not remove credentials: ${err.message}` }
  }
}

async function postJson(url, body, unreachableMsg) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  } catch {
    return { ok: false, message: unreachableMsg }
  }
}
