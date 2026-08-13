# Security Concerns

A review of the codebase identified the following security issues. They are grouped by severity and each includes the relevant file and a suggested remediation. Items marked **RESOLVED** have been addressed; the resolution is documented for audit purposes.

> **REVISION (2026-06-25):** re-reviewed the whole codebase against everything added since the previous pass — the **on-device Case Sentiment Grader** (v1.1.0: `sentiment.js`, the deep-read, the XLSX export), the v10 SLA changes, and the **Electron desktop build** (`electron/`). Net result: the sentiment grader is largely safe by design (#19), but it added a second AI egress endpoint (#1) and the free-text scrub it relies on is now load-bearing (#15); the packaged Electron app re-introduces the dev-server's unauthenticated-relay exposure in a *distributed* binary (#18); and the dependency picture has shifted — `dompurify` and `electron` now carry advisories that matter here (#17). New items #18–#19 added; #1, #7, #10, #13, #15, #16, #17 updated.

---

## Critical

### 1. Customer data sent to external AI API without consent or disclosure
**Status: RESOLVED**
**Files:** `src/lib/ai-client.js`, `src/lib/ai-scrub.js`, `src/components/ai/AiBlock.jsx`, `src/components/ai/SentimentDeepRead.jsx`

The previous inline `fetch('https://api.anthropic.com/...')` shipped the API key into the client bundle and sent raw customer data directly to a vendor. This has been replaced with a first-party proxy architecture:

- All AI traffic now routes through `VITE_AI_PROXY_URL` (a backend you control). The browser never contacts a model vendor directly.
- When no proxy is configured, `AiNotConfiguredError` is thrown and the UI shows a calm "not configured" state — no data leaves the browser.
- Every payload is scrubbed by `scrubForAi()` before it leaves the browser: case numbers → `CASE-<hash>`, account names → `ACCOUNT-<hash>`, analyst names → `ANALYST-<hash>`, free-text fields get email/phone/name/case-number regex scrubbing and a 400-char cap.
- The scrub is deterministic (FNV-1a hash) so the AI can still reason about correlations without seeing real values.

> **UPDATE (2026-06, sentiment deep-read):** `ai-client.js` gained a **second egress method** — `reviewSentiment()` → `POST {proxy}/api/sentiment` — for the Case Sentiment Grader's optional "deep read" (see #19). It follows the same contract as `analyzeCases()`: gated on `isConfigured()` (inert when no proxy is set), and `SentimentDeepRead.jsx` runs `scrubForAi()` on the payload *before* sending. Two differences worth flagging: (1) the deep-read payload carries the customer's **verbatim comment text and representative quote**, so the free-text scrub (#15) is now genuinely load-bearing rather than theoretical; (2) only a hand-picked handful (≤10 negative cases, `MAX_DEEP_READ`) is ever sent — it never fans out across the queue. Responses are mapped back to local cases by a non-PII `ref` index and rendered as plain text (no `dangerouslySetInnerHTML`).

**Remaining concern:** The proxy backend (`VITE_AI_PROXY_URL`) does not yet exist. Until it is built and deployed, the AI feature is inert. When the proxy is built, it must serve **both** `/api/insights` and `/api/sentiment`, and must: (a) hold the model API key server-side, (b) re-scrub PII as a second defense layer (especially the deep-read's verbatim comment field, per #15), and (c) not log raw payloads.

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

**Remaining concern:** ~~the project has two CSV-row builders (`toCsvRow` in `csv-export.js` and `escapeCsv`/`rowsToCsv` in `UpdateQueue.jsx`); consider consolidating onto a single shared builder~~ **consolidated (2026-06):** `UpdateQueue.jsx`'s local `escapeCsv`/`rowsToCsv`/`downloadCsv` were deleted; the only row builder is now `rowsToCsv` → `toCsvRow` → `sanitizeCellForExport` in `csv-export.js`, so the guard can't be bypassed by reusing the shared helpers. Any *new* export feature must still route through `rowsToCsv`; every new export PR must be reviewed for sanitizer coverage.

> **AUDIT NOTE (2026-06):** the Solution Proposed queue export (added with the `/solution-proposed` page) reuses the existing `exportUpdateQueueCsv` → `rowsToCsv`/`escapeCsv` path in `UpdateQueue.jsx` — **no new row builder was introduced**, so the `sanitizeCellForExport` guard still covers it. The accompanying change was cosmetic only: name-first filenames (`open-case-update-que-*`, `solution-proposed-update-que-*`).

> **AUDIT NOTE (2026-06, Jira Blockers export):** the "Cases waiting on Jira" table export (`JiraDashboard.jsx` → `jira-cases-<timestamp>.csv`) uses the shared `rowsToCsv`/`downloadCsv` from `csv-export.js` — no new row builder, sanitizer coverage intact. `downloadCsv` also gained a UTF-8 BOM so Excel on Windows decodes non-ASCII account/analyst names correctly.

> **AUDIT NOTE (2026-06, sentiment XLSX export):** the Case Sentiment Grader added a *new* export path — `sentiment-export.js` builds a two-sheet **`.xlsx`** workbook via exceljs, not a CSV. It does **not** bypass the guard: every string cell is funneled through a `txt()` helper that calls `sanitizeCellForExport()` from `csv-export.js`; numbers/dates are written as typed cells (no injection surface). This matters because Excel evaluates formulas in `.xlsx` files just as it does in `.csv`, so the `=`/`+`/`-`/`@` prefix guard is still required. Verified: the only string sinks (`txt(...)` at every `addRow`) route through the shared sanitizer. New non-CSV export features must do the same.

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

**Remaining concern:** `dompurify` (`^3.4.5`) is installed. Verify it is kept up to date — DOMPurify has had bypass CVEs in the past and patch releases matter. **This is no longer hypothetical:** as of 2026-06 `npm audit` flags the installed `dompurify <= 3.4.10` with **multiple sanitizer-bypass advisories** (IN_PLACE / cross-realm / `<template>` shadow-root / config-pollution bypasses — see #17). Most target `IN_PLACE` mode, which this app does not use (it sanitizes a string and assigns the result), so reachability is limited — but DOMPurify here guards the one live `dangerouslySetInnerHTML` sink, so this should be patched. The fix is **non-breaking** (`npm audit fix` bumps within the 3.x line). See #17.

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

### 13. Jira API token stored in plaintext on disk (dev server)
**Status: OPEN (by design)**
**Files:** `.jira-creds.json`, `.env`

In `npm run dev` the Atlassian API token lives in plaintext on disk — in `.jira-creds.json` when entered via **Settings → Jira connection**, or in `.env` as the pre-seed fallback. Both are gitignored and never bundled into the client. They are read **per request** by `vite.config.js` (Node side, `resolveJiraCreds`) and injected as an HTTP Basic auth header on the proxy — the token never reaches the browser bundle. `.jira-creds.json` is written `mode 0600`; note that on Windows the POSIX mode bits are largely advisory, so treat it as user-readable.

This is the standard pattern for Vite dev proxies and is acceptable for a local tool. The risk is:
- The credentials file on disk is readable by any process running as the same OS user.
- If the workstation is compromised, the token is exposed.
- The token grants read access to the entire Atlassian organization's Jira (not just the HMS project).

> **UPDATE (2026-06, desktop build):** the plaintext token applies to **`npm run dev` only**. The packaged Electron app does **not** use `.env` or `.jira-creds.json` — `electron/creds.cjs` has each user enter their *own* Jira email + token in Settings → Jira connection (as of 2026-08; previously a first-run setup screen) and persists it to `<userData>/credentials.enc` via Electron `safeStorage` (Windows **DPAPI**, keyed to the logged-in Windows user; the file is useless if copied to another machine/account), written `mode 0600`. The token is never returned to the renderer (`creds:status` deliberately omits it) and is injected server-side by the loopback proxy (see #18). This is a meaningful improvement over the dev `.env` for the distributed app. Residual: `creds.cjs` falls back to **plaintext** if `safeStorage.isEncryptionAvailable()` is false, and the token is still org-wide in scope.

**INCIDENT — token committed and pushed (action required):** a real Atlassian API token was committed in `.env.example` (commit `b8dc0aa`) and pushed to GitLab. It has since been redacted to a placeholder (commit `9c2a64a`), but the token still exists in earlier history on the remote. **The token must be revoked** at https://id.atlassian.com/manage-profile/security/api-tokens and a fresh one generated for local `.env` — redaction does not invalidate an already-exposed credential. History was intentionally left unrewritten (revocation is the real fix); if a clean history is also desired, purge with `git filter-repo` and force-push.

**Suggested fix:**
- Revoke the exposed token (above), then rotate periodically.
- Scope the Atlassian API token to the minimum required permissions (read-only, HMS project only if the Atlassian admin supports project-scoped tokens).
- Consider a secrets manager (1Password CLI, Doppler, etc.) to inject the token at dev-server start rather than storing it in a file.

---

### 14. ServiceNow imports mirrored to plaintext files on disk (NEW)
**Status: MOSTLY RESOLVED (2026-05) — opt-in & off by default in the browser; deletion paths fixed. Residual: still plaintext when enabled.**
**Files:** `vite.config.js` (`snFileCachePlugin`), `src/lib/imports-cache.js`, `src/lib/settings.js`, `src/lib/useAppData.js`, `src/pages/SettingsPage.jsx`

> **AUDIT NOTE (2026-06, desktop build):** in the Electron app the disk mirror defaults **ON** (`getDiskBackup()` returns true when `window.electronAPI` is present and no explicit toggle is stored). Rationale: there the mirror lives under the user's own profile (`%APPDATA%\KPI Analyzer\.servicenow-cache`, written by `electron/server.cjs`) — the same trust boundary as the Jira `cache.json` already stored there — and it is the mechanism that persists imports across app restarts (paired with the stable loopback port in `server.cjs`, since OPFS is keyed to the origin). The browser default remains OFF. Data is still plaintext at rest in both contexts; the Settings toggle still disables mirroring either way.

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
**Status: OPEN (latent — AI proxy not yet deployed; but the consuming path now exists)**
**Files:** `src/lib/ai-scrub.js`, `src/lib/ai-scrub.test.js`

`scrubText()` masks emails, ServiceNow-shaped case numbers, phone numbers, and "First Last" name pairs, then caps free text at 400 chars. Identifiers (case number, account, analyst) are hashed deterministically. This is solid defense-in-depth, but the free-text regex scrub does **not** catch: postal addresses, single-token names, hotel/property names embedded in prose, confirmation/reservation numbers, credit-card fragments, or non-Latin names. The `NAME_PAIR_RE` heuristic also produces false positives (e.g. "Night Audit" → "[name]") without improving safety.

> **UPDATE (2026-06):** two of the original gaps were addressed. (1) A `PHONE_RE` was added (conservative — requires separators so it won't eat ISO dates or bare numeric IDs), and `scrubForAi` now scrubs the deep-read free-text keys (`comments`, `quote`, `work_notes`) in addition to `short_description`/`close_notes`. (2) The suggested unit test now exists (`ai-scrub.test.js`) — it asserts the email/phone/case/name masking, the ISO-date/short-number non-over-match, the 400-char cap, and the non-mutating/deterministic guarantees. **However**, the risk is no longer purely hypothetical: the sentiment **deep-read** (#1, #19) is a concrete code path that packages the customer's *verbatim comment stream and representative quote* into the payload `scrubText` protects. The 400-char cap and the regex set are now the actual last line of defense for that text — so the residual gaps above are higher-priority than when this item read "currently moot."

Still gated: no proxy is configured (#1), so no payload leaves the browser yet. But **before the AI proxy ships**, harden this scrub and — per #1 — have the server re-scrub as a second layer and never log raw payloads. Treat the client scrub as best-effort masking, never as a guarantee.

**Suggested fix:**
- Expand the regex set further (postal addresses, long digit runs, reservation/confirmation patterns) and/or move the authoritative scrub server-side.
- ~~Add a unit test asserting the invariants documented at the bottom of `ai-scrub.js`.~~ **Done** (`ai-scrub.test.js`). Extend it as the regex set grows.

---

### 16. Dev-server middleware has no origin / host / auth check on data + proxy routes (NEW)
**Status: OPEN**
**Severity: Medium** (the authenticated Jira-proxy relay sub-case is higher impact)
**Files:** `vite.config.js` — `jiraFileCachePlugin`, `snFileCachePlugin`, `jiraCredsPlugin`, `jiraProxyPlugin`

The `npm run dev` server mounts middlewares that read, write, and delete data with **no `Origin`/`Host` validation, no CSRF token, and no authentication**:

- `GET /api/cache/sn` and `GET /api/cache/sn/{uuid}/source` stream the **raw, unscrubbed customer case exports** (full PII) to any caller; `GET /api/cache/jira` returns the full cached Jira issue set.
- The `DELETE` routes (`/api/cache/sn`, `/api/cache/sn/{uuid}`, `/api/cache/jira`) and the `PUT`/`POST` write routes let a caller wipe or overwrite the on-disk caches. The Jira `POST` streams an **unbounded** body to disk (no size cap) — a disk-fill DoS.
- `GET /api/creds/jira` discloses the configured Atlassian **email** and site URL (never the token) to any caller, and unauthenticated `POST`/`DELETE` on the same route can **overwrite or remove** the saved Jira credentials — writing an attacker-controlled `baseUrl` would silently repoint the proxy, so subsequent syncs would send the *user-supplied* token to that host. Same no-`Origin`/`Host`/CSRF posture as the routes above, and the same fix closes it. (`POST /api/creds/jira/test` is also an unauthenticated outbound-fetch primitive to an arbitrary `baseUrl`.)
- The `/api/jira` proxy injects the org-wide HTTP Basic token on **every** forwarded request and deliberately strips `Origin`/`Referer`/`Cookie` and sets `X-Atlassian-Token: no-check` (to defeat Atlassian's XSRF guard). Net effect: anything that can reach the dev server can drive **authenticated read/write calls against the entire Atlassian org** with the developer's token — a confused-deputy relay (see #13 for the token's scope).

**Threat model:** the dev server binds to localhost by default (`server.host` is unset), so it is not reachable from the LAN — but it **is** reachable from any web page open in the developer's own browser. Cross-origin reads of the JSON/blob responses are normally blocked by the same-origin policy (no `Access-Control-Allow-Origin` is set on these routes — **verify Vite 8's default `server.cors` does not reflect the request origin**), but a **DNS-rebinding** attack (rebind an attacker domain to `127.0.0.1`) makes the requests same-origin and bypasses that, exposing customer data and the Jira relay to a malicious site. Simple cross-origin `POST`s (e.g. to the Jira cache) can also be issued with no preflight. Error paths call `res.end(err.message)`, which can leak absolute server filesystem paths.

This is the **normal runtime**, not a developer-only edge case: live Jira sync and the disk mirror (#14) both require `npm run dev`. A static `vite build` has none of these middlewares, so deployed builds are unaffected.

> **IMPORTANT (2026-06):** a static `vite build` is unaffected, but the **Electron desktop build is not** — `electron/server.cjs` is a faithful port of these same middlewares (`/api/jira`, `/api/cache/jira`, `/api/cache/sn`) running inside the packaged app, and it carries every issue described here (no `Origin`/`Host`/auth check, unbounded body writes, `err.message` path leaks, the authenticated Jira relay). So this exposure is no longer confined to a developer's machine — it ships in a distributed binary. The fixes below apply equally to `server.cjs`. See **#18** for the full Electron analysis.

**Suggested fix:**
- Reject requests whose `Host` is not `localhost`/`127.0.0.1`, and deny cross-site requests (`Sec-Fetch-Site: cross-site`, or an `Origin` allowlist) on every `/api/cache/*` and `/api/jira` route — this closes both CSRF and DNS-rebinding. **Apply to `electron/server.cjs` as well.**
- Require a per-session shared token (minted at dev-server start, handed to the client) on the mutating and data-returning routes.
- Add a body-size cap to the cache write routes and return generic error messages instead of `err.message`.
- Scope the Jira proxy to the specific REST paths the app actually calls rather than forwarding everything under `/api/jira`.

---

### 17. Unpatched dependency advisories (`npm audit`) (NEW)
**Status: OPEN**
**Severity: Low–Medium** (the picture has shifted: one advisory is now **browser-reachable** and one **high-severity advisory ships in the Electron runtime**; the rest remain transitive/build-side)
**Files:** `package.json`, `package-lock.json`

> **RE-AUDIT (2026-06-25):** the count grew well past the "4 advisories" the original note recorded, and — more importantly — two are no longer merely build-time. The current `npm audit` (full tree) reports advisories against `dompurify`, `electron`, `qs`, `tmp`, `uuid`, plus `@babel/core`, `form-data`, `js-yaml`, and `tar`.

**Now reachable / shipped (act on these):**

- **`dompurify <= 3.4.10`** (moderate, multiple advisories) — sanitizer bypasses in IN_PLACE / cross-realm / `<template>` shadow-root / config-pollution modes. **This is the one library here that runs in the browser on attacker-influenced data** — it guards the lone `dangerouslySetInnerHTML` sink (Jira description HTML, #10). The app uses string-in/string-out sanitization, not `IN_PLACE`, so most of these bypasses aren't directly exercised — but this is exactly the "keep DOMPurify current" risk #10 warned about. **Fix is non-breaking** (`npm audit fix` stays within 3.x). Patch it.
- **`electron <= 39.8.4`** (high, ~18 advisories incl. ASAR integrity bypass, multiple use-after-frees, header injection, IPC spoofing) — the project pins `electron ^33.0.0`, so the **distributed desktop binary** (#18) ships an outdated Electron. Most of these need specific renderer/IPC conditions, but a packaged app handling customer PII should not sit ~9 majors behind. Fix is **breaking** (`npm audit fix --force` would jump to electron 42); plan a deliberate upgrade + smoke test rather than blindly forcing it.

**Transitive / build-side (lower priority):**

- **`tmp` < 0.2.6** (high) — path traversal via unsanitized prefix/postfix (GHSA-ph9p-34f9-6g65). Build tooling, not in the browser bundle.
- **`qs` 6.11.x** (moderate) — `qs.stringify` DoS (GHSA-q8mj-m7cp-5q26). Node/build-side.
- **`uuid` < 11.1.1** via **`exceljs`** (moderate) — missing buffer bounds check in v3/v5/v6 **only when `buf` is provided** (GHSA-w5hq-g745-h8pq). exceljs reaches the client (XLSX parse + sentiment export), but it uses random v4 and passes no `buf`, so the advisory isn't exercised here.
- **`@babel/core`, `form-data`, `js-yaml`, `tar`** — pulled in via Vite/Babel and `electron-builder`/`@electron/rebuild`; these run at build/package time only, not in the shipped app.

**Suggested fix:**
- Run `npm audit fix` for the **non-breaking** set first — it resolves `dompurify`, `qs`, `tmp`, `@babel/core`, `form-data`, `js-yaml`. The `dompurify` bump is the priority (browser-reachable).
- Plan a **deliberate Electron major upgrade** (33 → current) with a regression pass on the loopback server, IPC, and the setup/credential flow — don't rely on `--force` to do it silently.
- **Do not run `npm audit fix --force` blind** — it still "resolves" the `uuid` advisory by *downgrading* `exceljs` to 3.4.0, a regression from the 4.4 line the project deliberately migrated to (#5), and it would also force the Electron/electron-builder majors. Track an upstream `exceljs` release that bumps `uuid` instead, or accept the (un-exercised) risk with a note.
- Re-run `npm audit` in CI so new advisories surface on each dependency change.

---

### 18. Electron desktop build: packaged loopback server repeats the dev-server exposure (NEW)
**Status: OPEN (loopback server) — renderer is otherwise well-hardened**
**Severity: Medium** (the shipped Jira-relay + raw-customer-data routes mirror #16, now inside a *distributed* binary)
**Files:** `electron/main.cjs`, `electron/server.cjs`, `electron/creds.cjs`, `electron/preload.cjs`

The Windows desktop build (`npm run electron:build`) packages a local HTTP server (`server.cjs`) that runs in the Electron main process and is the production replacement for the Vite dev middleware — the renderer fetches the same relative `/api/jira`, `/api/cache/jira`, `/api/cache/sn` URLs. This is a brand-new distributed surface a static `vite build` doesn't have.

**Hardened (good — verified):**
- Renderer `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `preload.cjs` exposes only a 5-method `electronAPI` over `contextBridge` (`test` / `save` / `clear` / `status` / `openExternal`) — no `ipcRenderer`, `fs`, or Node surface leaks to the renderer. The credential UI moved from the first-run `setup.html` gate into the app's Settings page (Jira is optional, so the app no longer blocks on it); the bridge is correspondingly `save`/`clear` (no window navigation) rather than `saveAndLaunch`, and `status` still never returns the token.
- `setWindowOpenHandler` denies in-app popups and routes `https?:` links to the system browser; `open:external` re-validates the scheme.
- Credentials are encrypted at rest — see #13: `creds.cjs` uses Electron `safeStorage` (Windows DPAPI), `mode 0600`, token never returned to the renderer.
- The server binds to **`127.0.0.1` only** (not the LAN), and `serveStatic` has a path-traversal guard plus a `distDir` prefix check.
- The built `index.html` carries the production CSP (#9) — the Electron app loads the `vite build` output, so the meta-CSP applies in the renderer.

**Gaps:**
1. **Same no-`Origin`/`Host`/auth posture as #16 — now shipped.** `server.cjs` validates no `Origin`/`Host`, mints no CSRF token, requires no auth. `GET /api/cache/sn/{uuid}/source` streams the **raw, unscrubbed customer export**; `handleJira` injects the user's DPAPI-stored token on **every** forwarded request and relays **any method/path** under `/api/jira` — a confused-deputy against the whole Atlassian org. A malicious page in the user's browser can reach the loopback server via **DNS-rebinding** (and simple cross-origin `POST`s need no preflight). The port is now **stable across launches** (persisted in `<userData>/server-port.json` so OPFS/localStorage — which are keyed to the origin — survive restarts), which makes it easier to discover by a localhost port scan than the dev server's per-run random port.
2. **Unbounded request bodies** — `streamBodyToFile` buffers all chunks in memory, then writes; no size cap on `/api/cache/*` writes (memory + disk-fill DoS).
3. **Error bodies leak paths** — `res.end(err.message)` / `res.end(e.message)` exposes absolute `%APPDATA%` filesystem paths.
4. **No `will-navigate` handler** — `setWindowOpenHandler` covers `window.open`/`target=_blank` but not in-page navigation away from the loopback origin (defense-in-depth gap).
5. **DevTools enabled in the production menu** (`role: 'toggleDevTools'`). The renderer has no Node access, so impact is bounded to inspecting already-local data — but it's avoidable exposure for an app holding customer PII.
6. **`serveStatic` guard uses `filePath.startsWith(distDir)`** without a trailing separator — a classic prefix-match footgun (a sibling dir whose name starts with the dist basename would pass the check). No such sibling exists in the packaged layout today, so it's latent; harden to `startsWith(distDir + path.sep)` or `path.relative`.
7. **Outdated Electron** ships in the binary — see #17 (`electron <= 39.8.4`, high).

**Suggested fix:**
- Apply #16's fixes to `server.cjs`: reject non-`localhost` `Host`, deny `Sec-Fetch-Site: cross-site` (or an `Origin` allowlist), and require a per-session token minted at boot and handed to the renderer on `/api/cache/*` and `/api/jira`. This closes both CSRF and DNS-rebinding for the shipped app.
- Add a request-body size cap; return generic error strings instead of `err.message`.
- Add a `will-navigate` handler pinning the renderer to the loopback origin; drop `toggleDevTools` from production menus (or gate it behind a debug flag).
- Plan an Electron major upgrade off the 33.x line (#17).

---

### 19. On-device Case Sentiment Grader — reviewed (NEW)
**Status: REVIEWED — low risk; egress folds into #1/#15, export into #7**
**Severity: Informational**
**Files:** `src/lib/sentiment.js`, `src/lib/sentiment-export.js`, `src/components/ai/SentimentDeepRead.jsx`, `src/components/charts/SentimentBlock.jsx`, `src/pages/SentimentPage.jsx`

The v1.1.0 Case Sentiment Grader was reviewed as a new feature. Its core (`sentiment.js`) is a pure lexicon/heuristic engine — **no network, no model, and no new dependency** (verified against `package.json`: no Transformers.js/ONNX/WebLLM). It operates only on journal text already in the browser and emits no identifier it wasn't given. Findings:

- **Rendering is safe.** The sentiment columns that contain customer free-text (representative quote, coaching note, emotions) are rendered as React text nodes (auto-escaped). A codebase-wide search confirms the only `dangerouslySetInnerHTML` sink remains the DOMPurify-sanitized Jira description (#10) — the grader introduced no new HTML sink.
- **Export is sanitized (#7).** `sentiment-export.js` builds an XLSX via exceljs and routes every string cell through `sanitizeCellForExport()` (the `txt()` helper); typed numbers/dates have no injection surface. Excel evaluates formulas in `.xlsx` too, so this is necessary — and the new path correctly reuses the shared guard.
- **The deep-read is the only egress (#1).** `SentimentDeepRead.jsx` is the lone network path: gated on `aiClient.isConfigured()` (inert with no proxy), capped at ≤10 hand-picked negatives, scrubbed via `scrubForAi()` before send, responses mapped back by a non-PII `ref` index. Its payload carries verbatim customer comments + the quote, so the scrub gaps in #15 apply directly to it.
- **New PII-hygiene flag (a feature, not a risk).** `gradeCase` sets a `sentiment_pii` flag (and surfaces the affected case numbers) when the customer-visible journal contains AnyDesk/TeamViewer mentions or a `password:`-shaped token — i.e. it *helps* analysts spot accidentally-pasted remote-access creds. The flagged case numbers stay in the local/exported report; nothing leaves the device.

**No action required** beyond keeping #15's scrub current before the AI proxy ships.

---

## Summary

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Customer data sent to external AI API | Critical | RESOLVED — proxy seam holds; **+** new `/api/sentiment` deep-read egress (scrubbed, inert until proxy) |
| 2 | `window.__db` exposed in dev mode | High | RESOLVED |
| 3 | Analyst names in URL / browser history | High | RESOLVED |
| 4 | OPFS data persists unencrypted, no default expiry | High | PARTIALLY RESOLVED — **regressed**: 24h auto-TTL removed; auto-delete now opt-in & OFF by default |
| 5 | Outdated `xlsx` package with known vulns | Medium | RESOLVED (`xlsx` removed, migrated to `exceljs`, validated 574/574) |
| 6 | No file type / magic byte validation | Medium | RESOLVED |
| 7 | CSV / formula injection not sanitized | Medium | RESOLVED — all CSV + the new sentiment **XLSX** export route through `sanitizeCellForExport` |
| 8 | Analyst param from URL (SQL injection risk) | Medium | RESOLVED |
| 9 | No Content Security Policy | Low | RESOLVED (prod build) |
| 10 | Free-text fields not sanitized for XSS | Low | PARTIALLY RESOLVED (Jira HTML sanitized; SN + sentiment fields text-only) — **DOMPurify now has reachable advisories, see #17** |
| 11 | No authentication | Informational | OPEN |
| 12 | `window.__jira` dev hook | Informational | OPEN |
| 13 | Jira API token in plaintext `.env` (+ token leaked to GitLab) | Informational | OPEN (by design) — **leaked token must be revoked**; desktop build now uses **DPAPI-encrypted** creds |
| 14 | ServiceNow imports mirrored to plaintext disk files | Informational | MOSTLY RESOLVED — opt-in & OFF by default (browser) / ON (desktop, own profile); plaintext when enabled |
| 15 | AI free-text scrub is heuristic / incomplete | Informational | OPEN (latent — proxy not deployed) — phone scrub + tests added; **now load-bearing for the deep-read** |
| 16 | Dev-server middleware: no origin/host/auth on data + Jira-proxy routes | Medium | OPEN — **also ships in Electron `server.cjs`, see #18** |
| 17 | Unpatched dependency advisories (`npm audit`) | Low–Medium | OPEN — **dompurify now browser-reachable; electron high & shipped** |
| 18 | Electron desktop: packaged loopback server repeats #16 in a distributed binary | Medium | OPEN — **NEW** (renderer otherwise well-hardened) |
| 19 | On-device Case Sentiment Grader | Informational | REVIEWED — **NEW**; low risk (egress → #1/#15, export → #7) |
