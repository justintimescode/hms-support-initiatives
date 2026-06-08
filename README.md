# ServiceNow KPI Analyzer

A browser-based analytics dashboard for ServiceNow case exports. Upload a CSV or Excel file from your ServiceNow instance and get a full analyst-grade breakdown of SLA performance, team workload, backlog health, Jira blocker tracking, and AI-powered qualitative insights — all processed locally in your browser with no data leaving your machine (except the optional AI proxy call, which is scrubbed before it leaves).

---

## Table of Contents

- [Getting Started](#getting-started)
- [Architecture Overview](#architecture-overview)
- [Data Ingestion](#data-ingestion)
- [Pages & Features](#pages--features)
- [Jira Integration](#jira-integration)
- [AI Insights](#ai-insights)
- [SOP / Update Queue Engine](#sop--update-queue-engine)
- [Data Enrichment Pipeline](#data-enrichment-pipeline)
- [DuckDB SQL Backend](#duckdb-sql-backend)
- [URL State & Filtering](#url-state--filtering)
- [Print / PDF Export](#print--pdf-export)
- [Tech Stack](#tech-stack)
- [Supported Export Columns](#supported-export-columns)
- [Environment Variables](#environment-variables)
- [Other Commands](#other-commands)
- [Security](#security)

---

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, go to **Connections**, and drop a ServiceNow case export (CSV or XLSX). Every other page populates automatically.

For Jira live sync, copy `.env.example` to `.env`, fill in your Atlassian email and API token, and restart the dev server. The token is read once at startup by Vite's Node-side proxy config and never reaches the browser bundle.

---

## Architecture Overview

```
Browser
├── React 19 SPA (Vite 8)
│   ├── AppLayout — owns all app state via useAppData()
│   │   └── Outlet context — every route reads what it needs, no prop drilling
│   ├── In-memory pipeline — enrichRow() → stats.js → Recharts
│   └── DuckDB pipeline — db.worker.js → queries.js → useQuery()
│
├── Web Worker (db.worker.js)
│   ├── DuckDB-WASM (blocking browser build)
│   ├── OPFS persistence (opfs://cases.duckdb)
│   └── Multi-import model: one table per upload, `cases` view → active import
│
├── Vite dev-server proxy (/api/jira → infor.atlassian.net)
│   └── HTTP Basic auth injected server-side (token never in bundle)
│
└── Vite dev-server disk mirrors (npm run dev only)
    ├── /api/cache/jira  → .jira-cache/cache.json          (issue cache)
    └── /api/cache/sn    → .servicenow-cache/{uuid}/source  (import backup; raw case data)
```

The app runs two parallel data pipelines:

**In-memory pipeline** — `enrichRow()` in `src/lib/enrich.js` transforms raw CSV/XLSX rows into enriched objects with underscore-prefixed derived fields (`_created`, `_isClosed`, `_madeSla`, `_jiraTickets`, etc.). All Recharts-based charts consume this pipeline. It is synchronous and available immediately after upload.

**DuckDB SQL pipeline** — the same rows are also loaded into a DuckDB-WASM instance running in a Web Worker. SQL query helpers in `src/lib/queries.js` back the Update Queue and are being incrementally rolled out to replace in-memory computations. A `DevCompare` overlay on several pages shows side-by-side diffs between the two pipelines during the migration.

Both pipelines produce identical values for any given row — `enrich.js` is the single source of truth for all derived fields.

---

## Data Ingestion

### File formats

- **XLSX / XLS** — strongly recommended. ServiceNow's Excel export uses display-label column names (`Assigned to`, `Short Description`, `Made SLA`, etc.) which are mapped to internal field names by `normalizeXlsxRow()` in `enrich.js`. The XLSX path also correctly converts the `First Response Time` absolute timestamp into a millisecond duration relative to case creation.
- **CSV** — supported. Uses internal ServiceNow field names (`assigned_to`, `short_description`, `made_sla`, etc.). Some columns (SLA due date, first response time, resolution notes) can fail to populate depending on how the export was configured.

### Validation

Before any parser touches the file, `validateUpload()` in `useAppData.js` checks:

- **Size ceiling** — 50 MB hard limit.
- **Magic bytes** — XLSX/XLS files must start with `PK\x03\x04` (ZIP/OOXML) or `\xD0\xCF\x11\xE0` (OLE2 compound doc). CSV files must not contain NUL bytes.
- **Extension allowlist** — `.csv`, `.xlsx`, `.xls` only.

### Multi-import model & persistence

Every upload is a persistent **import**, not a one-shot replace. The app keeps a library of imports; exactly one is *active* at a time, and all charts/queries read the active import. You can upload several exports, switch between them, rename them, and rebuild any of them from its stored source — all from the **Connections** page file manager.

Persistence has three layers:

- **OPFS (primary, browser-side).** Each import becomes a DuckDB table `cases_import_{uuid}` persisted to `opfs://cases.duckdb`. `cases` is a SQL **view** that points at the active import's table, so every `FROM cases` query reads the active import unchanged. Survives page reloads.
- **Raw source blob (OPFS).** The original CSV/XLSX is also kept at `imports/{uuid}/source.{ext}` so the in-memory chart pipeline can be re-derived on activation and "Rebuild from source" works with current enrichment logic.
- **Disk mirror (dev-server, `npm run dev` only — opt-in, OFF by default).** When **Settings → Back up imports to disk** is enabled, each import's raw source + metadata is mirrored to `<project>/.servicenow-cache/{uuid}/` via a Vite middleware so a *different* browser or a cleared profile can recover imports on next boot. The directory holds **unscrubbed customer case data** and is gitignored. It is off by default so customer data stays out of the project folder unless you opt in; deleting an import (manually or via auto-delete) removes its disk copy, and a boot-time sweep clears orphans — see [Security](#security).

> **Retention:** there is **no automatic expiry by default.** Imports persist until you delete them or enable **Settings → Auto-delete old imports** (off by default; prunes imports older than N days on startup, never the active one). A **Data stored locally** notice in the sidebar shows the import count and bytes used, linking to the file manager. *(An earlier single-dataset build auto-cleared data after 24h; the multi-import refactor removed that — see SECURITY_CONCERNS.md #4.)*

---

## Pages & Features

The sidebar is organized into five groups. All pages respect the global analyst selector and date range filter in the top bar (except Jira pages, which are project-scoped and explicitly note this).

### Overview

#### Dashboard (`/`)
Top-line KPI summary cards for the current view: total cases, open/closed counts, SLA rate, **median resolution time** (with p90 and average shown alongside — the median is the typical case, the p90 reveals the long tail the average hides), at-risk count, and breached count. Includes delta indicators when period comparison is active. Quick-access shortcut cards to Update Queue, SLA, and Team Leaderboard.

#### My Day (`/my-day`)
A personal triage landing page for a single analyst — a focused recomposition of data from the Update Queue and Backlog, scoped to whoever is selected. Pick an analyst (or use the top-bar selector) and see, in one screen: **overdue customer updates** (from the snapshot-anchored Update Queue), **updates due soon** (approaching the SOP cadence but not yet overdue), **SLA at risk** (breached / due < 24h / due this week on open cases), **stuck cases** (open 30 days+), and **Jira-blocked** open cases. Four summary tiles link to the full pages. This page deliberately **ignores the global date-range filter** — it reflects live open work, not a historical window.

#### Monthly Summary (`/report`)
A manager-ready, print-first **period-over-period** report. Computes a current window (30 / 60 / 90 days, anchored to the data snapshot) against the immediately-preceding equal window, across the full dataset (independent of the global filters). Headline KPIs carry deltas — cases created, SLA %, median resolution, average FRT, FCR %, reopen % — followed by a backlog outlook (open now, net/week, projected clear), an accounts-to-watch table (from the churn-risk signal), and a per-analyst snapshot. A **Print / Save as PDF** button produces a clean one-pager (the app chrome is `.no-print`). Also reachable from the top-bar **Print** menu.

#### Update Queue (`/update-queue`)
SOP-driven queue of open cases that need an Infor-authored customer-facing update. Powered entirely by DuckDB SQL (`getUpdateQueue()` in `queries.js`). Two sections:

**Overdue / Due Soon** — cases classified by `case_type` (support vs. development) and bucketed against their SOP cadence threshold:

| Case type | Classification | Threshold |
|---|---|---|
| Support | P1 Critical | 1 hour |
| Support | P2 Major | 24 hours |
| Support | P3 Medium | 3 days |
| Support | P4 Standard | 7 days |
| Development | Any priority | 30 days |

"Due soon" fires at 75% of the threshold (`WARN_FRACTION = 0.75`). Development cases also get a "Jira check recommended" nudge after 7 days of silence. Elapsed time is computed against `meta.loaded_at` (the snapshot timestamp), not `Date.now()`, so the queue is deterministic for a given dataset.

**Initial Response Misses** — open cases with no first response logged that have been open longer than their priority's initial-response target (P1: 30m, P2/P3: 2h, P4: 4h). Clicking any row in the overdue/due-soon table opens a `CaseDrilldown` panel.

**CSV export** — the queue can be exported to a name-first, timestamped `.csv` (`open-case-update-que-YYYYMMDD-HHMMSS.csv`; the Solution Proposed queue exports as `solution-proposed-update-que-YYYYMMDD-HHMMSS.csv`) for sharing in a standup or ticket. Every cell is passed through `sanitizeCellForExport()` ([`csv-export.js`](src/lib/csv-export.js)) to neutralize spreadsheet formula injection before download.

#### Solution Proposed (`/solution-proposed`)
The same SOP cadence engine as the Update Queue, scoped to cases sitting in the ServiceNow `Solution Proposed` status (resolved pending customer confirmation, but still owing an Infor-authored cadence update). It reuses the exact overdue/due-soon logic and look: `getUpdateQueue()` is generalized with a `statusEquals` filter and an `includeClosed` flag, because a proposed solution moves the case to a resolved `state` while `status` stays `Solution Proposed` — so the queue's default open-only filter would otherwise hide every one of them. The Initial Response section is dropped (first-response targets don't apply to already-proposed solutions). Exports through the same sanitized CSV path.

### Performance

#### SLA Performance (`/sla`)
- Radial gauge showing overall SLA hit rate (color-coded: green ≥ 90%, yellow ≥ 75%, red below).
- Bar chart breaking SLA rate down by priority level.
- List of open cases approaching or already past their SLA deadline, segmented into: Breached, Due < 24h, Due this week, Comfortable, No SLA.
- **Breach Forecast** — forward-looking complement to the Update Queue: open cases on track to breach SLA within the next 7 days, ranked soonest-first, with a momentum read (time since last Infor update). A **stalled** flag marks cases not touched in longer than the time they have left — i.e. on current cadence they're heading for a breach. Snapshot-anchored; covers all open work for the current analyst selection, independent of the date range. (`slaBreachForecast()` in `stats.js`.)
- **First Response Time distribution** — the full histogram of time-to-first-response with median, p90, and average, rather than the mean alone (which a few slow outliers distort). (`frtDistribution()` in `stats.js`.)

#### Open Backlog (`/backlog`)
**Team view:**
- Stacked bar chart of open cases per analyst, broken down by aging bucket (0–7d, 8–30d, 31–90d, 90d+), sorted by oldest-heavy queues first.
- Stuck cases list: open cases older than 30 days with assignee shown.

**Individual view:**
- SLA-risk donut chart (Breached / Due < 24h / Due this week / Comfortable / No SLA).
- Stuck cases list scoped to the analyst.
- Interaction breakdown: cases sorted by total conversation turns, with customer vs. analyst turn split.

#### Trends Over Time (`/trends`)
- Daily open-case trajectory line chart from the oldest record to today.
- Weekly created-vs-resolved bar chart with a rolling 4-week net line. A net above zero means the backlog grew that week.
- Optional date-range highlight band overlaid on both charts.
- **Backlog burn-down forecast** — a Monte Carlo projection rather than a single straight line. It bootstraps from the recent *mature* weekly history (each simulated future week replays a real past week's created/resolved pair, with resolution capped by what's actually open), runs ~2,000 trials, and reports a **p10–p90 cone** around the **p50 median** plus the probability the backlog clears and a median weeks-to-clear + clear date. Inputs are de-biased first: "now" is anchored to the snapshot and the resolution-immature tail (recent weeks whose cases haven't closed yet) is dropped before sampling, while the charted history is trimmed of its cold-start ramp. The chart overlays the actual open trajectory with the forecast cone. (`backlogForecast()` in `stats.js`.)

#### Workload Cadence (`/cadence`)
- Weekday bar charts: average open caseload by day of week, and case creation count by day of week.
- Hour-of-day intake heatmap (weekday × hour grid). Click any tile to see the individual cases created in that slot.

#### Priority Analysis (`/priority`)
- Volume and resolution time broken down by priority level.
- Confirms whether high-priority work is actually being resolved faster than lower-priority work.

#### Case Categorization (`/categories`)
- Auto-derived category breakdown (11 categories: Night Audit, Login & Access, Email & Notifications, Reservations & Availability, Rates & Pricing, Billing & Folio, Reports & Data, Integrations & Interfaces, Performance & Errors, User & Permissions, Printing & Hardware).
- Keyword cloud from resolution notes.
- Categories are derived by scanning `short_description` and `close_notes` for keyword patterns defined in `enrich.js`.

#### Accounts & Products (`/accounts`)
- Every serviced account ranked by case volume, in a scrollable bar list (this standalone page is uncapped and shows the account count; the Dashboard's account block still shows only the top 30).
- Product line breakdown.
- Helps spot account concentration risk and recurring product hotspots.
- **Account churn-risk signal** — ranks accounts by a transparent composite of three pressures: rising case volume (last 90 days vs the prior 90), falling SLA over the same comparison, and open Jira-blocked / breached cases right now. The contributing signals are shown as chips so the ranking is explainable. Uses the full dataset across all analysts, anchored to the snapshot. (`accountChurnRisk()` in `stats.js`.)

### Team

#### Workload Distribution (`/workload`)
- Lorenz curve showing how evenly work is distributed across the team.
- Gini coefficient (0 = perfectly equal, 1 = one person does everything).
- Top-20% and top-50% share statistics.
- Per-analyst open-case aging stacked bar chart.

#### Team Leaderboard (`/team`)
Sortable table with one row per analyst: total cases, open cases, SLA %, average resolution time, **median · p90 resolution**, average first response time, at-risk count, breached count. Click any analyst name to drill into their full individual dashboard.

**Member profiles** — condensed card per analyst showing priority mix bar chart, top 3 categories, top 3 accounts, and key KPIs. Clicking a card opens an **Analyst Profile modal** (`AnalystProfileModal.jsx`) — full per-analyst KPIs, quality signals, SLA-risk and stuck-case blocks, and the per-analyst AI insights path — without leaving the leaderboard. An "Open full dashboard →" action instead drills into the analyst's filtered individual view.

**Resolution Quality** — two manager-grade quality signals plus a per-analyst breakdown:
- **First-contact resolution (FCR)** — share of closed cases resolved in ≤1 analyst touch (approximated from Infor-authored journal turns). Higher is better.
- **Reopen rate** — share of resolved cases that bounced back open, derived from the snapshot (a case carrying a close timestamp but currently in an open state). Lower is better.
Both are computed in `qualityMetrics()` (`stats.js`) and baked per-analyst into `teamMembers`. Managers weight these above raw closure volume.

**Interaction Quality** — bar chart of average customer and analyst turns per case per team member. More turns often indicate unclear expectations or complex issues.

#### Cases w/ Jira Blockers (`/jira-blockers`)
Open cases that have at least one active Jira ticket reference, parsed from work notes and cause fields. See [Jira Integration](#jira-integration) for full detail.

### Jira

#### All HMS Jira's (`/jira`)
Live engineering analytics for the HMS Jira project. Requires a configured `.env` and `npm run dev`. See [Jira Integration](#jira-integration).

#### Statistics (`/jira-stats`)
Deep-dive statistics for the HMS project. See [Jira Integration](#jira-integration).

### Tools

#### Connections (`/connections`)
Data source management. The **ServiceNow imports** card is a full file manager: upload new exports, switch the active import, rename, rebuild-from-source, and delete — each import is persisted independently (see [Multi-import model](#multi-import-model--persistence)). The **Jira** card shows sync status and triggers recent/full syncs. Placeholder cards for a ServiceNow API direct connector and Gainsight integration (coming later).

#### Insights (`/insights`)
AI-powered qualitative analysis. See [AI Insights](#ai-insights).

#### Cases (`/cases`)
Full sortable and searchable case register. Every column from the enriched dataset is available. Keyword search filters across all text fields.

#### Surveys (`/surveys`)
Placeholder for future CSAT/survey data integration.

#### Settings (`/settings`)
Local, browser-only app preferences (stored in `localStorage`, no backend). Exposes **Auto-delete old imports** (prune imports older than a threshold on startup; the active import is always kept) and **Back up imports to disk** (opt into the `.servicenow-cache/` disk mirror for cross-browser recovery — see [Security](#security)). Both off by default.

---

## Jira Integration

Jira sync runs through a Vite dev-server proxy (`/api/jira → infor.atlassian.net/rest`). The proxy injects HTTP Basic auth server-side — the token never reaches the browser bundle. **This is dev-only**: a `vite build` has no dev server, so live sync is unavailable in static builds.

### Setup

```
JIRA_BASE_URL=https://infor.atlassian.net
JIRA_EMAIL=your.email@infor.com
JIRA_API_TOKEN=<token from id.atlassian.com/manage-profile/security/api-tokens>
JIRA_PROJECT_KEY=HMS
```

Restart `npm run dev` after editing `.env`. The proxy reads credentials once at startup.

### Sync modes

| Button | Window | Use case |
|---|---|---|
| Last 24h | 1 day | Quick check after a standup |
| Last 5 days | 5 days | End-of-week refresh |
| Last 14 days | 14 days | Sprint retrospective |
| Last month | 30 days | Monthly review |
| Full sync | 365 days | First sync or full refresh |

Incremental syncs merge onto the existing cache (updated issues replace, new ones append). A full sync replaces everything.

### Caching

Jira data is cached as a JSON file at `.jira-cache/cache.json` via a Vite dev plugin (`jiraFileCachePlugin`). The file is fully inspectable, survives browser clearing, and is served at `/api/cache/jira`. On startup, the app hydrates from this file before attempting a live sync.

### Project resolution

`resolveProject()` looks up the project by name ("Hospitality Management Solution") via `/project/search`, not by key, so the sync is provably scoped to the right space. The key (`HMS`) is only a fast-path fallback.

### Search endpoint compatibility

The app tries the newer cursor-based `/search/jql` endpoint first and falls back to the legacy `startAt`-based `/search` endpoint on 403/404/410. This handles both current and older Jira Cloud instances.

### Jira Blockers page (`/jira-blockers`)

Shows open ServiceNow cases that have at least one active Jira ticket reference. Ticket IDs are parsed from `work_notes` / `system_log` (looking for "Jira Reference ID ... has been linked" patterns) and from the `cause` field (any `[A-Z]+-\d+` pattern). `RN-` prefixed IDs are recognized as ServiceNow-internal Resolution Notes references and are not linked to Atlassian.

When Jira is synced, each ticket gets live status, assignee, priority, fix versions, and engineering cycle time from the Jira API. The "Likely closeable" panel surfaces cases where every linked Jira ticket is already Done but the ServiceNow case is still open.

**Blast radius table** — ranks Jira tickets by how many open ServiceNow cases they are blocking, weighted by priority and age. One fix at the top of this list unblocks the most customer impact.

### All HMS Jira's page (`/jira`)

Full project analytics:
- KPI strip: total issues, created 7d/30d, currently open, resolved 30d, median resolve time.
- Cycle time vs. lead time: median, average, p85 for both. Cycle = first "In Progress" → Done. Lead = created → resolved.
- Weekly ticket creation bar chart (last 12 weeks).
- Trajectory block (open-issue count over time).
- Recently created and recently resolved issue tables (sortable, searchable, expandable with lazy-loaded description via DOMPurify-sanitized `dangerouslySetInnerHTML`).

### Statistics page (`/jira-stats`)

- **KPI strip** — total, created 7d/30d/90d, open, resolved 30d, median resolve.
- **Daily creation** — 90-day bar chart with 7-day rolling average line.
- **Created vs. resolved** — 12-week grouped bar chart with net line.
- **Intake by weekday** — which days new Jiras tend to land.
- **Composition** — last 14 days: issue type mix, priority mix, top components, top labels.
- **Blast radius** — cross-source table joining Jira tickets to open ServiceNow cases. Sortable by open case count, days idle, priority. Expandable rows show linked cases and the Jira description. Histogram shows distribution of open-case counts per ticket.
- **Lifecycle & health** — resolution time by priority (median/p90/max, last 90 days), open backlog aging buckets, open-by-status breakdown, stale Jiras with open cases, fix-version pipeline (upcoming releases with open-case impact per release, expandable to individual tickets).

---

## AI Insights

The AI feature routes case data through a first-party backend proxy (`VITE_AI_PROXY_URL`). The browser never contacts a model vendor directly. When no proxy is configured, the feature shows a calm "not configured" state — no data leaves the browser.

### PII scrubbing

Every payload is scrubbed by `scrubForAi()` in `src/lib/ai-scrub.js` before it leaves the browser:

- Case numbers → `CASE-<6-char FNV-1a hash>`
- Account names → `ACCOUNT-<hash>`
- Analyst names → `ANALYST-<hash>`
- Free-text fields (`short_description`, `close_notes`) → email addresses, case-number-shaped tokens, and "First Last" name pairs are regex-replaced; text is capped at 400 characters.

The hash is deterministic, so the AI can still reason that "these cases share an account" without seeing the real name.

### Payload shape

Up to 50 cases are sampled (the most recent by date range). The payload includes:
- Scrubbed case list with priority, state, product, category, scrubbed description/notes, resolution hours, SLA met flag.
- Aggregate KPIs: total cases, SLA rate, top 6 categories.
- Analysis label (analyst name or "all analysts", also scrubbed).

### Output

The proxy returns JSON with five sections: `themes`, `recurring_issues`, `skill_opportunities`, `kb_gaps`, `watch_outs`. Each is rendered as a card grid on the Insights page.

---

## SOP / Update Queue Engine

The Update Queue is the most operationally critical feature. All thresholds live in `src/lib/sop-thresholds.js` — edit there when the SOP changes, nowhere else.

### Case classification

`classifyCase()` in `enrich.js` inspects the ServiceNow `state` field at ingest time:

- If the state contains `development researching`, `code fix pending`, or `code deployment pending` → `case_type = 'development'`, threshold = 30 days.
- Otherwise → `case_type = 'support'`, threshold = priority-driven (see table above).

Classification is baked at ingest so the SQL query can use it without re-parsing strings.

### Elapsed time

`last_infor_update` is parsed from `additional_comments` (the work notes journal) by `parseInforUpdates()`. It walks timestamped entries looking for `(Infor)` in the author field and returns the most recent Infor-authored timestamp. If no Infor update exists, elapsed time is measured from `created_at`.

### Snapshot anchoring

The queue is computed against `meta.loaded_at` (the timestamp when the file was uploaded), not `Date.now()`. This means the queue is deterministic and reproducible for a given dataset — re-opening the app shows the same queue as when the file was loaded, not a shifted version based on how much time has passed since.

---

## Data Enrichment Pipeline

`src/lib/enrich.js` is the single source of truth for all derived fields. Both the in-memory pipeline and the DuckDB worker call the same functions.

### Key derived fields

| Field | Source | Description |
|---|---|---|
| `_created` | `sys_created_on` | Parsed Date |
| `_closed` | `closed_at` | Parsed Date |
| `_slaDue` | `sla_due` | Parsed Date |
| `_resolvedMs` | `_closed - _created` | Resolution time in ms |
| `_frtMs` | `first_response_time` | First response time in ms |
| `_isClosed` | `state` | true if state is "closed" or "resolved" |
| `_madeSla` | `made_sla` | Normalized boolean |
| `_category` | `short_description` + `close_notes` | Auto-categorized (11 categories) |
| `_jiraTickets` | `work_notes` + `cause` | Parsed Jira ticket references |
| `_jiraActiveTickets` | `_jiraTickets` | Tickets not yet closed |
| `_jiraFirstLinked` | `work_notes` | Earliest "linked" event timestamp |
| `_interactionCount` | `work_notes` | Total conversation turns |
| `_customerTurns` | `work_notes` | Customer-authored turns |
| `_analystTurns` | `work_notes` | Infor-authored turns |
| `_lastInforUpdate` | `additional_comments` | Most recent Infor-authored timestamp |
| `_caseType` | `state` | `'development'` or `'support'` |
| `_updateThresholdMs` | `_caseType` + priority | SOP cadence threshold |

### Jira reference parsing

`parseJiraRefs()` does a two-pass walk:

1. **Pass 1** — scans `work_notes` / `system_log` line by line for "Jira Reference ID `[KEY]` has been linked" and "...has been closed" events, recording timestamps.
2. **Pass 2** — extracts every `[A-Z]+-\d+` pattern from the `cause` field (canonical blockers).

`RN-` prefixed IDs are flagged as ServiceNow-internal and marked `clickable: false` so they don't generate broken Atlassian links.

### XLSX normalization

`normalizeXlsxRow()` maps ServiceNow Excel display-label column names to internal field names. It also converts the `First Response Time` column (an absolute timestamp in XLSX exports) into a millisecond duration by subtracting `Created`.

---

## DuckDB SQL Backend

A Web Worker (`src/workers/db.worker.js`) runs a DuckDB-WASM instance using the blocking browser build. The main thread communicates via a promise-based `postMessage` wrapper in `src/lib/db-client.js`.

### Schema

Each import owns a base table `cases_import_{uuid}` with 34 columns covering all raw and enriched fields (`SQL_COLUMNS` in `enrich.js`). `cases` is a **view** redefined to point at the active import's table, so all query helpers read `FROM cases` without change. An `imports_index` table tracks every import's `uuid`, `display_name`, `uploaded_at`, `row_count`, `file_size`, `file_type`, `schema_version`, and `is_active` flag. `SCHEMA_VERSION` is bumped when columns change — imports built against an older version are flagged in the file manager with a "Rebuild needed" badge (re-parses the stored source blob). A legacy single-`cases`-table build is auto-migrated to import #1 on first boot.

### Ingestion

CSV files are streamed through PapaParse in 10,000-row chunks. Each chunk is enriched via `enrichForSql()` and bulk-inserted using Apache Arrow's `tableFromArrays` + `insertArrowTable`. XLSX files go through the same path after being pre-parsed on the main thread.

### Query helpers (`src/lib/queries.js`)

| Function | Description |
|---|---|
| `buildWhere()` | Builds a parameterized WHERE clause from analyst + date range filters |
| `getKpis()` | Headline KPI aggregates |
| `getCompareKpis()` | Same, over the comparison window |
| `getPriorityData()` | Per-priority breakdown |
| `getCategoryData()` | Per-category counts |
| `getAccountData()` | Top 30 accounts by volume |
| `getProductData()` | Per-product-line counts |
| `getUpdateQueue()` | SOP-driven overdue/due-soon/initial-response-miss lists (optional `statusEquals` / `includeClosed` scope the same engine to a status, e.g. Solution Proposed) |

All queries use parameterized statements (`conn.prepare()` + `stmt.query(...params)`). User-controlled inputs (analyst name, date range) are never interpolated into SQL strings.

### `useQuery` hook

`src/lib/useQuery.js` wraps async query functions with loading/error state and dependency-based re-execution. Used by pages that read from DuckDB.

---

## URL State & Filtering

All active filters are reflected in the URL query string via `useFilters()` in `src/lib/useFilters.js`. This enables bookmarking and sharing specific views.

| Parameter | Meaning |
|---|---|
| `?a=a4` | Analyst — opaque index token (alphabetical sort of loaded names) |
| `?from=2025-01-01` | Date range start (ISO date) |
| `?to=2025-03-31` | Date range end (ISO date) |
| `?field=closed` | Filter by closed date (default: created date) |
| `?compare=1` | Enable period comparison mode |

Analyst identity is serialized as an opaque index (`a4` = the 5th analyst alphabetically) rather than a raw name. This prevents analyst names from appearing in browser history, server logs, or shared links.

### Date range presets

| Preset | Window |
|---|---|
| All time | No filter |
| YTD | Jan 1 of current year → today |
| Last 90 days | Rolling 90-day window |
| Last 30 days | Rolling 30-day window |
| Last 7 days | Rolling 7-day window |
| Custom | Date picker |

### Period comparison

When comparison is active, every KPI card shows a delta indicator (↑/↓ with color) comparing the current window against the equivalent prior period of the same length. The comparison window is computed by `previousWindow()` in `stats.js`.

---

## Print / PDF Export

The print menu in the top bar offers:

- **Print team report** — renders all team-view sections stacked vertically.
- **Print individual report** — renders all individual-view sections for the selected analyst.
- **Monthly summary report** — opens the [Monthly Summary](#monthly-summary-report) page (`/report`), a print-first period-over-period one-pager with KPI deltas.

Print mode is triggered by setting `printMode` state, which causes all `print-section` divs to render simultaneously. After a 500ms settle delay, `window.print()` is called. The sidebar and top bar are hidden in print via `.no-print` CSS class.

---

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| UI framework | React | 19 |
| Build tool | Vite | 8 |
| Routing | React Router | 7 |
| Charts | Recharts | 3 |
| CSV parsing | PapaParse | 5 |
| Excel parsing | ExcelJS | 4 |
| HTML sanitization | DOMPurify | 3 |
| Icons | Lucide React | latest |
| In-browser SQL | DuckDB-WASM | 1.33 |
| Arrow serialization | Apache Arrow | (bundled with DuckDB) |

> XLSX parsing goes through ExcelJS. The previously-used `xlsx` (SheetJS) package — which carried a ReDoS advisory — has been removed entirely (see SECURITY_CONCERNS.md #5).

---

## Supported Export Columns

The app works with standard ServiceNow case table exports. XLSX is strongly recommended — CSV exports may not populate all columns depending on export configuration.

| XLSX display label | CSV internal name | Used for |
|---|---|---|
| `Number` | `number` | Case identifier |
| `Short Description` | `short_description` | Categorization, AI analysis |
| `State` | `state` | Open/closed, case type classification |
| `Status` | `status` | Display |
| `Priority` | `priority` | SLA thresholds, SOP cadence |
| `Assigned to` | `assigned_to` | Analyst filtering |
| `Account` | `account` | Account analytics |
| `Product line` | `product_line` | Product analytics |
| `Made SLA` | `made_sla` | SLA hit rate |
| `SLA due` | `sla_due` | SLA risk segmentation |
| `Created` | `sys_created_on` | All time-based analytics |
| `Closed` | `closed_at` | Resolution time, trajectory |
| `First Response Time` | `first_response_time` | FRT metrics |
| `Resolution notes` | `close_notes` | Categorization, AI analysis |
| `Additional comments` | `additional_comments` | Update Queue (Infor update tracking) |
| `Work notes` | `work_notes` | Jira reference parsing, interaction counts |
| `Work notes` (alt) | `system_log` | Jira reference parsing |
| `Cause` | `cause` | Jira blocker extraction |
| `Case Action Summary` | `case_action_summary` | Case detail panel |

---

## Environment Variables

All variables live in `.env` (gitignored). Copy `.env.example` to get started.

| Variable | Required | Description |
|---|---|---|
| `JIRA_BASE_URL` | For Jira | Atlassian instance URL, e.g. `https://infor.atlassian.net` |
| `JIRA_EMAIL` | For Jira | Your Atlassian account email |
| `JIRA_API_TOKEN` | For Jira | API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEY` | For Jira | Project key, e.g. `HMS` |
| `VITE_AI_PROXY_URL` | For AI | Base URL of your first-party AI proxy backend |

`JIRA_*` variables are intentionally **not** prefixed with `VITE_` — Vite only exposes `VITE_`-prefixed vars to the client bundle. The Jira credentials are read by `vite.config.js` on the Node side and used to build a server-side `Authorization` header. They never appear in the browser bundle.

`VITE_AI_PROXY_URL` **is** prefixed with `VITE_` because the proxy URL (not a secret) is needed in the client bundle to know where to send requests. The API key lives on the proxy server, not here.

---

## Other Commands

```bash
npm run dev      # start dev server with Jira proxy
npm run build    # production build (no Jira proxy, no live sync)
npm run preview  # preview the production build locally
npm run lint     # run ESLint
```

---

## Security

See [SECURITY_CONCERNS.md](./SECURITY_CONCERNS.md) for the full audit (17 items, with statuses). Summary of the current posture:

- **Customer data** stays on the machine. The only *network* egress is the optional AI proxy call, which scrubs PII (case numbers, account names, analyst names, emails) before leaving the browser. The AI proxy is not yet deployed, so today the feature is inert and nothing leaves the browser.
- **Jira credentials** are read server-side by the Vite dev proxy and never bundled into client code.
- **Data at rest** lives in OPFS (browser) and — only if you opt in via **Settings → Back up imports to disk** (off by default) — the gitignored `.servicenow-cache/` disk mirror (raw, unencrypted exports). Neither has an automatic expiry by default; retention is controlled by the opt-in **Settings → Auto-delete old imports** (off by default), which now cleans all layers, plus the one-click delete in the Connections file manager and a boot-time orphan sweep. *(The previously-documented 24h auto-TTL was removed by the multi-import refactor — see #4.)*
- **File uploads** are validated by magic bytes and a 50 MB size ceiling before parsing.
- **SQL queries** use parameterized statements throughout. User-controlled URL parameters are resolved to known values from the loaded dataset before being passed to any query.
- **Jira HTML descriptions** are sanitized with DOMPurify before rendering; ServiceNow free-text fields are rendered as plain text only.
- **CSV exports** (Update Queue + Solution Proposed) route every cell through the formula-injection sanitizer in `src/lib/csv-export.js` via a single shared `rowsToCsv`/`escapeCsv` path.
- **Production builds** ship a Content-Security-Policy meta tag.
