// Encrypted credential storage for the packaged app.
//
// Replaces the dev-only plaintext .env. Each teammate enters their OWN Jira
// email + API token in the first-run setup screen; we persist it to
// <userData>/credentials.enc, encrypted with Electron's safeStorage (Windows
// DPAPI — keyed to the logged-in Windows user, so the file is useless if
// copied to another machine/account).
//
// Shape on disk (after decrypt): { baseUrl, email, token }

const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_BASE_URL = 'https://infor.atlassian.net'

function credsFile() {
  return path.join(app.getPath('userData'), 'credentials.enc')
}

/** @returns {{baseUrl:string,email:string,token:string}|null} */
function loadCreds() {
  let raw
  try {
    raw = fs.readFileSync(credsFile())
  } catch {
    return null // not configured yet
  }
  try {
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8') // fallback only if OS encryption is unavailable
    const c = JSON.parse(json)
    if (!c?.email || !c?.token) return null
    return { baseUrl: c.baseUrl || DEFAULT_BASE_URL, email: c.email, token: c.token }
  } catch {
    // Corrupt or undecryptable (e.g. copied from another user) — treat as
    // unconfigured so the setup screen reappears rather than crashing.
    return null
  }
}

function saveCreds({ baseUrl, email, token }) {
  const json = JSON.stringify({ baseUrl: baseUrl || DEFAULT_BASE_URL, email, token })
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  fs.writeFileSync(credsFile(), data, { mode: 0o600 })
}

function clearCreds() {
  try {
    fs.unlinkSync(credsFile())
  } catch {
    /* already gone */
  }
}

/** HTTP Basic auth header value for the proxy, or null if not configured. */
function toAuthHeader(creds) {
  if (!creds?.email || !creds?.token) return null
  return 'Basic ' + Buffer.from(`${creds.email}:${creds.token}`).toString('base64')
}

module.exports = { DEFAULT_BASE_URL, loadCreds, saveCreds, clearCreds, toAuthHeader }
