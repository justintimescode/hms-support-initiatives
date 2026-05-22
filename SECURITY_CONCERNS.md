# Security Concerns

A review of the codebase identified the following security issues. They are grouped by severity and each includes the relevant file and a suggested remediation. Items marked **RESOLVED** have been addressed; the resolution is documented for audit purposes.

---

## Critical

### 1. Customer data sent to external AI API without consent or disclosure
**Status: RESOLVED**
**Files:** `src/lib/ai-client.js`, `src/lib/ai-scrub.js`, `src/components/ai/AiBlock.jsx`

The previous inline `fetch('https://api.anthropic.com/...')` shipped the API key into the client bundle and sent raw customer data directly to a vendor. This has been replaced with a first-party proxy architecture:

- All AI traffic now routes through `VITE_AI_PROXY_URL` (a backend you control). The browser never contacts a model vendor directly.
- When no proxy is configured, `AiNotConfiguredError` is thrown and the UI shows a calm "not configured" state — no data leaves the browser.
- Every payload is scrubbed by `scrubForAi()` before it leaves the browser: case numbers → `CASE-<hash>`, account names → `ACCOUNT-<hash>`, analyst names → `ANALYST-<hash>`, free-text fields get email/name/case-number regex scrubbing and a 400-char cap.
- The scrub is deterministic (FNV-1a hash) so the AI can still reason about correlations without seeing real values.

**Remaining concern:** The proxy backend (`VITE_AI_PROXY_URL`) does not yet exist. Until it is built and deployed, the AI feature is inert. When the proxy is built, it must: (a) hold the model API key server-side, (b) re-scrub PII as a second defense layer, and (c) not log raw payloads.

---

## High

### 2. `window.__db` exposed in dev mode
**Status: RESOLVED**
**File:** `src/lib/db-client.js`

The `window.__db = dbClient` dev hook has been removed. The comment at the bottom of `db-client.js` explicitly documents why it must not be reintroduced:

> "A previous `window.__db = dbClient` dev hook meant anyone who could open DevTools on a misconfigured dev/preview build could dump all loaded customer data via `window.__db.query(...)`. Do not reintroduce it."

The `window.__jira` dev hook in `src/lib/jira-client.js` remains (gated on `import.meta.env?.DEV`). See item 12 below.

---

### 3. Analyst names written to the URL / browser history
**Status: RESOLVED**
**File:** `src/lib/useFilters.js`

The `parseUrlFilters` / `writeUrlFilters` pair that wrote raw analyst names into the URL has been replaced by `useFilters`. Analyst identity is now serialized as an opaque index token (`?a=a4`) — the index into a stable alphabetical sort of the loaded dataset. A raw name never appears in the URL, browser history, server logs, or shared links. The comment in `useFilters.js` explicitly flags the injection risk if the resolved value is ever interpolated rather than parameterized.

---

### 4. OPFS data persists indefinitely with no expiry or encryption
**Status: RESOLVED**
**Files:** `src/workers/db.worker.js`, `src/components/layout/DataRetentionNotice.jsx`

Two mitigations are now in place:

- **Auto-TTL:** `clearIfExpired()` runs on every worker init. If `meta.loaded_at` is older than `MAX_AGE_MS` (24 hours), the OPFS database is dropped and rebuilt empty before the app can read it. The threshold is a named constant at the top of the worker.
- **Visible notice:** `DataRetentionNotice` renders in the sidebar whenever data is loaded, showing "Data stored locally · loaded Xm ago · auto-clears after 24h" and a one-click "Clear data" button.

**Remaining concern:** OPFS data is still unencrypted at rest. On a shared workstation, a user with access to the browser profile directory can extract the raw DuckDB file before the 24-hour TTL fires. The TTL and notice reduce the window and visibility, but do not eliminate the risk. For deployments on shared machines, consider adding a `visibilitychange` / `pagehide` clear.

---

## Medium

### 5. Outdated `xlsx` package with known vulnerabilities
**Status: RESOLVED**
**Files:** `package.json`, `src/lib/useAppData.js`

The `xlsx` (SheetJS) dependency — unmaintained on npm and carrying a ReDoS advisory (GHSA-5pgg-2g8v-p4x9) — has been removed entirely and replaced with `exceljs` (`^4.4.0`). The single parse site (`handleFile`) now uses `readXlsxRows()`, which dynamically imports exceljs (kept off the initial bundle) and re-emits each cell as the same primitive the old `xlsx` `raw:false` path produced — date cells as `YYYY-MM-DD HH:MM:SS` wall-clock strings (built from the Date's UTC components, so `parseDate`'s local-time parse is unchanged) and booleans as `TRUE`/`FALSE`.

**Validation:** ran the old (`xlsx`) and new (`exceljs`) readers against a real 574-row ServiceNow export and compared `enrichForSql` output field-by-field. All 574 rows produced byte-identical SQL columns, so `enrich.js` / `normalizeXlsxRow` required no changes.

**Note:** `dompurify` and `exceljs` should be kept current; both are parser/sanitizer libraries where patch releases matter.

---

### 6. No file type validation beyond extension
**Status: RESOLVED**
**File:** `src/lib/useAppData.js` — `validateUpload()`

Magic-byte validation and a size ceiling are now applied before any parser touches the data:

- XLSX/XLS: checks for `PK\x03\x04` (ZIP/OOXML) or `\xD0\xCF\x11\xE0` (OLE2 compound doc). Rejects anything else with a user-facing message.
- CSV: scans the first 1 KB for NUL bytes — a reliable indicator of binary content masquerading as text.
- Size ceiling: 50 MB hard limit before any parsing begins.
- MIME type (`file.type`) is still not checked (browsers report it inconsistently), but the magic-byte check is a stronger signal.

---

### 7. CSV / formula injection not sanitized
**Status: RESOLVED (export path)**
**File:** `src/lib/csv-export.js`

`sanitizeCellForExport()` and `toCsvRow()` are implemented and ready. Leading formula-trigger characters (`=`, `+`, `-`, `@`, tab, CR, LF) are prefixed with a single quote before any cell value is written to a CSV row. The comment in the file explicitly notes this utility must be used whenever an export feature is added.

**Remaining concern:** No export feature exists yet, so the sanitizer has not been exercised in production. When export is implemented, a code review must verify every cell value passes through `sanitizeCellForExport` before being written.

---

### 8. Analyst param from URL (SQL injection risk)
**Status: RESOLVED**
**Files:** `src/lib/useFilters.js`, `src/lib/queries.js`

The URL `?a=` parameter is now resolved to an opaque index token (see item 3). The resolved `analyst` value is always either `'__all__'` or a name that exists in the loaded dataset — it is never a raw URL string. All SQL queries in `queries.js` pass it as a parameterized value (`assigned_to = ?`), not via string interpolation. The comment in `useFilters.js` explicitly warns against interpolation.

---

## Low

### 9. No Content Security Policy
**Status: RESOLVED (production builds)**
**File:** `vite.config.js`

A Vite plugin (`cspProdPlugin`, `apply: 'build'`) now injects a `<meta http-equiv="Content-Security-Policy">` into the built `index.html`. It runs on `vite build` only — the dev server keeps the looser rules HMR and the `/api/jira` proxy need. Policy:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';          /* DuckDB-WASM */
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;  /* inline style props + Google Fonts */
img-src 'self' data:;
connect-src 'self';
font-src 'self' data: https://fonts.gstatic.com;
```

**Remaining concern:** `connect-src` is `'self'` only. When the AI proxy (#1) is deployed, its origin must be added to `connect-src` (or the proxy served same-origin). The `'unsafe-inline'` style allowance is required by the app's inline-style-prop pattern; eliminating it would mean a styling refactor.

---

### 10. Free-text fields not sanitized against XSS
**Status: PARTIALLY RESOLVED**
**Files:** `src/components/jira/JiraAnalysisBlock.jsx`, `src/lib/enrich.js`

Jira issue descriptions are now sanitized with DOMPurify before being injected via `dangerouslySetInnerHTML`:

```js
// JiraAnalysisBlock.jsx line 127
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(detail.html) }}
```

ServiceNow free-text fields (`work_notes`, `close_notes`, `short_description`) are still rendered as plain text content (safe). The comment in `enrich.js` explicitly warns that DOMPurify must be applied before any future switch to `dangerouslySetInnerHTML` for those fields.

**Remaining concern:** `dompurify` (`^3.4.5`) is installed. Verify it is kept up to date — DOMPurify has had bypass CVEs in the past and patch releases matter.

---

## Informational

### 11. No authentication or access control
**Status: OPEN**
**File:** App-wide

The app has no login or access control. Anyone who can reach the URL can load and query data. This is likely intentional for a local tool, but if the app is ever deployed to a shared or public host, all customer data becomes accessible to anyone with the URL.

**Suggested fix:**
- If deploying beyond localhost, add at minimum HTTP Basic Auth at the server/CDN layer, or implement a simple token-based access gate.

---

### 12. `window.__jira` dev hook still present
**Status: OPEN (low risk)**
**File:** `src/lib/jira-client.js`

```js
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__jira = { pingJira, resolveProject, getFieldMap, ... }
}
```

This is gated on `import.meta.env?.DEV` (stripped from production builds by Vite's tree-shaking), so it does not appear in `vite build` output. However, if the app is accidentally served in dev mode (misconfigured CI, `vite preview` of a dev build), anyone with DevTools can call `window.__jira.fetchHmsProject()` and pull the full Jira issue set. The Jira data is less sensitive than the ServiceNow case data (no customer PII), but it is still internal engineering data.

**Suggested fix:**
- Remove the hook, or gate it behind a more explicit local-only flag (e.g. `localStorage.getItem('__devMode')`).
- At minimum, document that `vite preview` must never be used with a `.env` that contains real credentials.

---

### 13. Jira API token stored in plaintext `.env` file
**Status: OPEN (by design)**
**File:** `.env`

The Atlassian API token lives in `.env` in plaintext. The file is gitignored and never bundled into the client. The token is read once at dev-server startup by `vite.config.js` (Node side) and injected as an HTTP Basic auth header on the proxy — it never reaches the browser bundle.

This is the standard pattern for Vite dev proxies and is acceptable for a local tool. The risk is:
- The `.env` file on disk is readable by any process running as the same OS user.
- If the workstation is compromised, the token is exposed.
- The token grants read access to the entire Atlassian organization's Jira (not just the HMS project).

**INCIDENT — token committed and pushed (action required):** a real Atlassian API token was committed in `.env.example` (commit `b8dc0aa`) and pushed to GitLab. It has since been redacted to a placeholder (commit `9c2a64a`), but the token still exists in earlier history on the remote. **The token must be revoked** at https://id.atlassian.com/manage-profile/security/api-tokens and a fresh one generated for local `.env` — redaction does not invalidate an already-exposed credential. History was intentionally left unrewritten (revocation is the real fix); if a clean history is also desired, purge with `git filter-repo` and force-push.

**Suggested fix:**
- Revoke the exposed token (above), then rotate periodically.
- Scope the Atlassian API token to the minimum required permissions (read-only, HMS project only if the Atlassian admin supports project-scoped tokens).
- Consider a secrets manager (1Password CLI, Doppler, etc.) to inject the token at dev-server start rather than storing it in a file.

---

## Summary

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Customer data sent to external AI API | Critical | RESOLVED |
| 2 | `window.__db` exposed in dev mode | High | RESOLVED |
| 3 | Analyst names in URL / browser history | High | RESOLVED |
| 4 | OPFS data persists unencrypted indefinitely | High | RESOLVED (TTL + notice; encryption still open) |
| 5 | Outdated `xlsx` package with known vulns | Medium | RESOLVED (`xlsx` removed, migrated to `exceljs`, validated 574/574) |
| 6 | No file type / magic byte validation | Medium | RESOLVED |
| 7 | CSV formula injection not sanitized | Medium | RESOLVED (export utility ready; no export feature yet) |
| 8 | Analyst param from URL (SQL injection risk) | Medium | RESOLVED |
| 9 | No Content Security Policy | Low | RESOLVED (prod build) |
| 10 | Free-text fields not sanitized for XSS | Low | PARTIALLY RESOLVED (Jira HTML sanitized; SN fields text-only) |
| 11 | No authentication | Informational | OPEN |
| 12 | `window.__jira` dev hook | Informational | OPEN |
| 13 | Jira API token in plaintext `.env` (+ token leaked to GitLab) | Informational | OPEN (by design) — **leaked token must be revoked** |
