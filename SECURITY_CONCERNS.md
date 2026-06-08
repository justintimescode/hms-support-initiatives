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

### 4. OPFS data persists with no automatic expiry and no encryption
**Status: PARTIALLY RESOLVED — regressed by the multi-import refactor**
**Files:** `src/workers/db.worker.js`, `src/lib/useAppData.js`, `src/lib/settings.js`, `src/components/layout/DataRetentionNotice.jsx`, `src/pages/SettingsPage.jsx`

> **AUDIT CORRECTION (2026-05):** an earlier revision of this document claimed a hard 24-hour auto-TTL (`clearIfExpired()` / `MAX_AGE_MS` in the worker). That logic **no longer exists.** The multi-import refactor replaced the single-dataset worker (which dropped data older than 24h on every init) with a persistent per-import model that, by default, **keeps every uploaded import indefinitely.** The text below reflects the code as it actually stands.

Current mitigations:

- **Opt-in auto-delete (default OFF):** `enforceAutoDelete()` (useAppData.js) runs on boot and prunes imports older than a user-chosen threshold. It is gated on `getAutoDelete()` in `settings.js`, which **defaults to `{ enabled: false, days: 30 }`** — so out of the box, nothing is ever auto-deleted. The toggle lives on the Settings page. The active import is never auto-deleted.
- **Visible notice:** `DataRetentionNotice` renders in the sidebar whenever imports exist, showing the import count and total bytes stored, with a "Manage imports" link to the Connections page where any import can be deleted with one click.

**Remaining concerns:**

1. **No expiry by default.** Because auto-delete ships disabled, customer case data accumulates in OPFS until the user manually clears it or enables the setting. This is a regression from the previously-documented 24h behavior. Consider: (a) shipping auto-delete *enabled* with a sane default (e.g. 7–30 days), and/or (b) adding a `visibilitychange` / `pagehide` clear for shared-workstation deployments.
2. **Unencrypted at rest.** OPFS data is not encrypted. A user with access to the browser profile directory can extract the raw DuckDB file. The notice raises visibility but does not eliminate the risk.
3. **See item #14 (disk mirror)** — case data is *also* written to plaintext files on disk during `npm run dev`, with no TTL at all.

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
**Status: RESOLVED (2026-05) — was briefly REGRESSED**
**Files:** `src/lib/csv-export.js`, `src/pages/UpdateQueue.jsx`

`sanitizeCellForExport()` and `toCsvRow()` are implemented in `csv-export.js`. Leading formula-trigger characters (`=`, `+`, `-`, `@`, tab, CR, LF) are prefixed with a single quote before any cell value is written to a CSV row.

> **AUDIT NOTE:** the "Export Update Queue → CSV" feature (`UpdateQueue.jsx`, added after the original audit) initially shipped with its **own** `escapeCsv()` helper that only did RFC-4180 quoting (commas/quotes/newlines) and **bypassed the formula-injection guard entirely.** A ServiceNow `account` or `short_description` beginning with `=`, `+`, `-`, or `@` was written verbatim and would execute on open in Excel/Sheets. This has been fixed: `escapeCsv()` now calls `sanitizeCellForExport()` on every cell before quoting.

**Remaining concern:** the project has two CSV-row builders (`toCsvRow` in `csv-export.js` and `escapeCsv`/`rowsToCsv` in `UpdateQueue.jsx`). Any *new* export feature must route through the sanitizer; consider consolidating onto a single shared builder so the guard can't be forgotten again. Every new export PR must be reviewed for sanitizer coverage.

> **AUDIT NOTE (2026-06):** the Solution Proposed queue export (added with the `/solution-proposed` page) reuses the existing `exportUpdateQueueCsv` → `rowsToCsv`/`escapeCsv` path in `UpdateQueue.jsx` — **no new row builder was introduced**, so the `sanitizeCellForExport` guard still covers it. The accompanying change was cosmetic only: name-first filenames (`open-case-update-que-*`, `solution-proposed-update-que-*`).

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

### 14. ServiceNow imports mirrored to plaintext files on disk (NEW)
**Status: MOSTLY RESOLVED (2026-05) — opt-in & off by default; deletion paths fixed. Residual: still plaintext when opted in.**
**Files:** `vite.config.js` (`snFileCachePlugin`), `src/lib/imports-cache.js`, `src/lib/settings.js`, `src/lib/useAppData.js`, `src/pages/SettingsPage.jsx`

The multi-import refactor added a server-side disk mirror: during `npm run dev`, an uploaded ServiceNow export can be streamed to `<project>/.servicenow-cache/{uuid}/source.{ext}` (the raw, unmodified CSV/XLSX) plus a `meta.json`. This lets a different browser or a cleared profile recover imports on next boot. It is a **new data-at-rest surface that did not exist when items #1–#13 were written**, and it is *not* covered by the OPFS discussion in #4.

Properties:
- The files are the **raw customer case exports in plaintext** — full PII, no scrubbing, no encryption.
- `.servicenow-cache/` is correctly gitignored (verified) and the Vite middleware guards the `uuid` path segment against traversal (`/^[a-zA-Z0-9-]{1,64}$/`).
- The endpoint only exists under the dev server, so a static `vite build` deploy has no disk mirror. (Note: live Jira sync also requires `npm run dev`, so the dev server is the normal runtime, not a developer-only edge case.)

**Mitigations applied (Tier 0 + Tier 1):**
- **Opt-in, default OFF.** The mirror is now gated behind `getDiskBackup()` (`settings.js`, defaults `false`) and a "Back up imports to disk" toggle on the Settings page. The secure default keeps customer data out of the project directory entirely; uploads write only to OPFS. `writeDiskBlob`/`writeDiskMeta` call sites in `useAppData.js` (upload + rename) are guarded by the flag.
- **Deletion now covers the mirror.** `enforceAutoDelete` deletes all three layers (DuckDB table, OPFS blob, disk mirror) — the previously-omitted `deleteDiskImport` is included. Manual delete and "clear all" already did.
- **Orphan sweep on boot.** `sweepDiskOrphans()` reconciles `.servicenow-cache/` against the live import index on startup and removes any disk entry with no matching import — cleaning up historical orphans left by the old prune bug.

**Residual concerns:**
- When a user *opts in*, the mirror is still **plaintext / unencrypted**. Rely on full-disk encryption (BitLocker/FileVault) for at-rest protection, keep the project out of any cloud-synced folder (OneDrive/Dropbox) to avoid accidental egress, and consider relocating the cache to `%LOCALAPPDATA%`/`$XDG_CACHE_HOME` so it can't be zipped with the repo.
- App-level encryption with a `.env` key (Tier 3) would only defend against accidental egress (folder copied without `.env`), not a local-access attacker — deferred as low value relative to default-OFF.

---

### 15. AI free-text scrub is heuristic and incomplete (NEW)
**Status: OPEN (latent — AI proxy not yet deployed)**
**File:** `src/lib/ai-scrub.js`

`scrubText()` masks emails, ServiceNow-shaped case numbers, and "First Last" name pairs, then caps free text at 400 chars. Identifiers (case number, account, analyst) are hashed deterministically. This is solid defense-in-depth, but the free-text regex scrub does **not** catch: phone numbers, postal addresses, single-token names, hotel/property names embedded in prose, confirmation/reservation numbers, credit-card fragments, or non-Latin names. The `NAME_PAIR_RE` heuristic also produces false positives (e.g. "Night Audit" → "[name]") without improving safety.

Currently moot: no proxy is configured (#1), so no payload ever leaves the browser. But **before the AI proxy ships**, this scrub must be hardened and — per #1 — the server must re-scrub as a second layer and must not log raw payloads. Treat the client scrub as best-effort masking, never as a guarantee.

**Suggested fix:**
- Expand the regex set (phone, address, long digit runs) and/or move the authoritative scrub server-side.
- Add a unit test asserting the invariants documented at the bottom of `ai-scrub.js`.

---

## Summary

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Customer data sent to external AI API | Critical | RESOLVED |
| 2 | `window.__db` exposed in dev mode | High | RESOLVED |
| 3 | Analyst names in URL / browser history | High | RESOLVED |
| 4 | OPFS data persists unencrypted, no default expiry | High | PARTIALLY RESOLVED — **regressed**: 24h auto-TTL removed; auto-delete now opt-in & OFF by default |
| 5 | Outdated `xlsx` package with known vulns | Medium | RESOLVED (`xlsx` removed, migrated to `exceljs`, validated 574/574) |
| 6 | No file type / magic byte validation | Medium | RESOLVED |
| 7 | CSV formula injection not sanitized | Medium | RESOLVED (2026-05) — export shipped bypassing the guard; now wired through `sanitizeCellForExport` |
| 8 | Analyst param from URL (SQL injection risk) | Medium | RESOLVED |
| 9 | No Content Security Policy | Low | RESOLVED (prod build) |
| 10 | Free-text fields not sanitized for XSS | Low | PARTIALLY RESOLVED (Jira HTML sanitized; SN fields text-only) |
| 11 | No authentication | Informational | OPEN |
| 12 | `window.__jira` dev hook | Informational | OPEN |
| 13 | Jira API token in plaintext `.env` (+ token leaked to GitLab) | Informational | OPEN (by design) — **leaked token must be revoked** |
| 14 | ServiceNow imports mirrored to plaintext disk files | Informational | MOSTLY RESOLVED — **NEW**: opt-in & OFF by default; delete/sweep fixed; plaintext when opted in |
| 15 | AI free-text scrub is heuristic / incomplete | Informational | OPEN (latent — proxy not deployed) — **NEW** |
