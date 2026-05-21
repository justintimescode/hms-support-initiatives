# Security Concerns

A review of the codebase identified the following security issues. They are grouped by severity and each includes the relevant file and a suggested remediation.

---

## Critical

### 1. Customer data sent to external AI API without consent or disclosure
**File:** `src/KpiAnalyzer.jsx` — `analyzeCases()`

Raw case data including `short_description`, `close_notes`, case numbers, account names, and product info is serialized and sent verbatim to an external LLM API. The `close_notes` field is truncated to 400 characters but still sent as-is. There is no user warning, opt-in consent flow, data masking, or disclosure of which third party receives the data. This likely violates data handling agreements for customer support data.

**Suggested fix:**
- Add an explicit consent dialog before any data leaves the browser, naming the third-party service.
- Strip or hash PII fields (account names, case numbers, analyst names) before including them in the prompt.
- Consider running a local/self-hosted model to keep data entirely in-browser.

---

## High

### 2. `window.__db` exposed in dev mode
**File:** `src/lib/db-client.js`

```js
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__db = dbClient
}
```

If the app is accidentally served in dev mode (misconfigured CI, `vite preview` of a dev build), the full DuckDB client is accessible from the browser console. Anyone who opens DevTools can run `window.__db.query("SELECT * FROM cases")` and dump all loaded customer data.

**Suggested fix:**
- Remove this block entirely, or gate it behind a more explicit local-only flag that cannot survive a production build.

---

### 3. Analyst names written to the URL / browser history
**File:** `src/KpiAnalyzer.jsx` — `writeUrlFilters()`

The selected analyst name (a real employee name from ServiceNow) is written directly into the URL query string. This means analyst names can leak via browser history, server access logs, shared links, or Slack/email previews.

**Suggested fix:**
- Avoid putting PII in the URL. Use an opaque ID or index instead of the raw name, or keep filter state in `sessionStorage` only.

---

### 4. OPFS data persists indefinitely with no expiry or encryption
**File:** `src/workers/db.worker.js`

The DuckDB database is written to `opfs://cases.duckdb` and survives page reloads with no TTL and no encryption at rest. On a shared workstation, anyone with access to the browser profile can extract the OPFS file and read all customer data. The `clearDatabase` function exists but is only triggered by an explicit user action.

**Suggested fix:**
- Store a `loaded_at` timestamp and automatically clear the database on init if the data is older than a defined threshold (e.g., 24 hours).
- Display a visible "data is stored in your browser" notice so users know to clear it when done.
- Consider clearing on `visibilitychange` / page unload for particularly sensitive deployments.

---

## Medium

### 5. Outdated `xlsx` package with known vulnerabilities
**File:** `package.json`

`"xlsx": "^0.18.5"` — the SheetJS `xlsx` package at this version has known vulnerabilities including prototype pollution. The npm version is no longer actively maintained for security fixes, and the maintainer has moved to a commercial model. A maliciously crafted XLSX file could exploit parser vulnerabilities.

**Suggested fix:**
- Evaluate replacing `xlsx` with an actively maintained alternative such as `exceljs`.
- If staying on `xlsx`, pin to the exact version and monitor for CVEs.
- Validate file size and structure before parsing.

---

### 6. No file type validation beyond extension
**File:** `src/KpiAnalyzer.jsx` — `handleFile()`

```js
const ext = file.name.split(".").pop().toLowerCase();
```

File type is determined purely by extension with no MIME type check and no magic byte validation. A file named `malicious.csv` that contains HTML with `<script>` tags, or a crafted binary, is passed directly to PapaParse.

**Suggested fix:**
- Check `file.type` against an allowlist (`text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
- Read the first few bytes and validate magic numbers before parsing (XLSX files start with `PK\x03\x04`).

---

### 7. CSV / formula injection not sanitized
**File:** `src/KpiAnalyzer.jsx` — rendering of case table data

Cell values from CSV/XLSX are rendered directly into the UI without sanitization. Values beginning with `=`, `-`, `+`, or `@` are classic formula injection payloads. While they don't execute in the browser, if the app ever gains a CSV/XLSX export feature (a common addition), those formulas will execute in the user's spreadsheet application.

**Suggested fix:**
- When building any future export, prefix dangerous leading characters with a single quote or strip them.
- Add a sanitization utility now so it's ready when export is implemented.

---

### 8. Analyst name sourced from URL with no sanitization
**File:** `src/KpiAnalyzer.jsx` — `parseUrlFilters()` → `src/lib/queries.js` — `buildWhere()`

The `analyst` value is read from `window.location.search` with no sanitization beyond a null check, then passed as a query parameter. The current path uses a prepared statement correctly:

```js
conds.push('assigned_to = ?')
params.push(analyst)
```

However, if any future code path uses string interpolation instead of parameterized queries, the URL becomes a direct SQL injection vector.

**Suggested fix:**
- Validate the analyst value against the known list of analysts loaded from the data before using it in any query.
- Add a lint rule or code comment flagging that `analyst` is user-controlled input.

---

## Low

### 9. No Content Security Policy
**File:** `index.html`, `vite.config.js`

There is no CSP configured. A CSP would restrict which origins scripts can load from and where data can be sent, partially mitigating both the AI data exfiltration risk and any XSS.

**Suggested fix:**
- Add a `<meta http-equiv="Content-Security-Policy">` tag to `index.html` with a strict policy, or configure CSP headers on the server/CDN serving the app.

---

### 10. Free-text fields not sanitized against XSS
**Files:** `src/KpiAnalyzer.jsx`, `src/lib/enrich.js`

`work_notes`, `close_notes`, and `short_description` are free-text fields from ServiceNow rendered into the UI. Currently rendered as text content (safe), but if any future change switches to `dangerouslySetInnerHTML` for rich text support, stored XSS from crafted work notes becomes possible.

**Suggested fix:**
- Add a DOMPurify sanitization step in `enrichRow` for these fields now, so the protection is in place before any rich text rendering is added.

---

## Informational

### 11. No authentication or access control
**File:** App-wide

The app has no login or access control. Anyone who can reach the URL can load and query data. This is likely intentional for a local tool, but if the app is ever deployed to a shared or public host, all customer data becomes accessible to anyone with the URL.

**Suggested fix:**
- If deploying beyond localhost, add at minimum HTTP Basic Auth at the server/CDN layer, or implement a simple token-based access gate.

---

## Summary

| # | Issue | Severity |
|---|---|---|
| 1 | Customer data sent to external AI API | Critical |
| 2 | `window.__db` exposed in dev mode | High |
| 3 | Analyst names in URL / browser history | High |
| 4 | OPFS data persists unencrypted indefinitely | High |
| 5 | Outdated `xlsx` package with known vulns | Medium |
| 6 | No file type / magic byte validation | Medium |
| 7 | CSV formula injection not sanitized | Medium |
| 8 | Analyst param from URL (SQL injection risk) | Medium |
| 9 | No Content Security Policy | Low |
| 10 | Free-text fields not sanitized for XSS | Low |
| 11 | No authentication | Informational |
