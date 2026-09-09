# ServiceNow KPI Analyzer

An analytics dashboard for ServiceNow case exports — runnable in the browser (`npm run dev`) or as a packaged Windows desktop app. Upload a CSV or Excel file from your ServiceNow instance and get a full analyst-grade breakdown of SLA performance, team workload, backlog health, Jira blocker tracking, and AI-powered qualitative insights — all processed locally on your machine with no data leaving it (except the optional AI proxy call, which is scrubbed before it leaves).

> **SLA here means the Infor SOP response cadence**, not ServiceNow's first-response-only `Made SLA` flag. See [SLA Performance](#sla-performance-sla) and `computeSlaSop()` in `src/lib/enrich.js`.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Desktop App (Windows)](#desktop-app-windows)
- [Architecture Overview](#architecture-overview)
- [Data Ingestion](#data-ingestion)
- [Pages & Features](#pages--features)
- [Jira Integration](#jira-integration)
- [AI Insights](#ai-insights)
- [Customer Sentiment](#customer-sentiment)
- [Impact Clusters — unified Jira ↔ ServiceNow correlation](#impact-clusters--unified-jira--servicenow-correlation)
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
- [Roadmap & Code Reviews](#roadmap--code-reviews)
- [Releases](#releases)

---

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and drop a ServiceNow case export (CSV or XLSX) on the dashboard. Every other page populates automatically. **That is the only required setup step** — no accounts, no tokens.

Jira is an optional second source. When you want the Jira pages (*All HMS Jira's*, *Statistics*, and the blocker analysis joined onto case rows), go to **Settings → Jira connection** and enter your Atlassian email and API token. It verifies against `/myself` before saving, takes effect on the next request with no restart, and the token is stored server-side — it never reaches the browser bundle. `.env` still works for a pre-seeded setup (see [Environment Variables](#environment-variables)); credentials saved in Settings take precedence over it.

> Distributing to teammates who don't run a dev server? See [Desktop App (Windows)](#desktop-app-windows) — it ships the same app as a double-click installer.

---

## Desktop App (Windows)

The app is **not** a static website: live Jira sync and the disk caches depend on Node-side middleware that only runs under `npm run dev` (the `/api/jira` auth proxy and the `/api/cache/*` file stores in `vite.config.js`). To hand a working build to teammates who don't have Node installed, it's packaged as an **Electron desktop app**.

Electron's main process runs a tiny loopback HTTP server (`electron/server.cjs`) that reimplements those three routes, then loads the built SPA from it — so the React code runs unchanged, with no CORS and the Jira token kept server-side. The caches move to the per-user `userData` directory (`%APPDATA%\KPI Analyzer\`) since a packaged app folder is read-only.

### Building the installer

```bash
npm install              # first time only — pulls electron + electron-builder
npm run electron:build   # → release/KPI Analyzer Setup <version>.exe
```

Share the resulting `.exe` from `release/` via a network share / SharePoint. Teammates double-click to install — no Node, no terminal, no `npm install`.

To run the packaged app locally during development (builds `dist/`, then launches Electron against it):

```bash
npm run electron:dev
```

### First run & credentials

The app opens straight to the dashboard — **there is no credential gate**. Drop a ServiceNow export and start working; nothing about the first run requires a Jira account.

Jira credentials are entered in-app at **Settings → Jira connection**, the same place and the same UI as in dev. **Test connection** verifies against `/myself` before anything is saved. In the packaged app the token is stored **per user, encrypted via Electron `safeStorage`** (Windows DPAPI — keyed to the Windows login, useless if copied elsewhere) at `%APPDATA%\KPI Analyzer\credentials.enc`, so each teammate's Jira access is scoped to their own permissions. **Disconnect** in the same card removes it; the **File** menu has shortcuts (*Jira connection…* / *Clear saved Jira credentials*).

> The desktop build only covers the Jira proxy + caches. The optional AI proxy (`VITE_AI_PROXY_URL`) is a build-time variable and is not exposed in Settings; it stays disabled in packaged builds unless baked in at `npm run build` time.

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
│   ├── opfs://cases.duckdb (NOT durable — index rebuilt from source blobs)
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

**In-memory pipeline** — `enrichRow()` in `src/lib/enrich.js` transforms raw CSV/XLSX rows into enriched objects with underscore-prefixed derived fields (`_created`, `_isClosed`, `_slaBreached`, `_slaDueSop`, `_jiraTickets`, etc.). All Recharts-based charts consume this pipeline. It is synchronous and available immediately after upload.

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

- **Raw source blob (OPFS) — the actual source of truth.** The original CSV/XLSX is kept at `imports/{uuid}/source.{ext}` with its metadata at `imports/{uuid}/meta.json`. The in-memory chart pipeline is re-derived from it on activation, "Rebuild from source" re-runs current enrichment against it, and the import index is rebuilt from it at startup (`restoreFromOpfs`).
- **DuckDB tables (derived).** Each import becomes a table `cases_import_{uuid}`; `cases` is a SQL **view** pointing at the active import's table, so every `FROM cases` query reads the active import unchanged. The worker opens the database at `opfs://cases.duckdb`, **but do not assume that file is durable** — see below. Treat the tables as a cache over the blobs, not as primary storage.
- **Disk mirror (dev-server, `npm run dev` only — opt-in, OFF by default).** When **Settings → Back up imports to disk** is enabled, each import's raw source + metadata is mirrored to `<project>/.servicenow-cache/{uuid}/` via a Vite middleware so a *different* browser or a cleared profile can recover imports on next boot. The directory holds **unscrubbed customer case data** and is gitignored. It is off by default so customer data stays out of the project folder unless you opt in; deleting an import (manually or via auto-delete) removes its disk copy, and a boot-time sweep clears orphans — see [Security](#security).

### DuckDB durability caveat

`opfs://cases.duckdb` **does not currently persist**, and the app is built to survive that rather than assume it away.

The worker uses the *blocking* duckdb-wasm build, whose `open()` is synchronous. Preparing an OPFS file handle is async (`registerOPFSFileName` → `prepareFileHandle(path, 3)`), and that call only registers a handle when `handle.getSize()` is non-zero — so a brand-new, empty database can never bootstrap itself into OPFS. duckdb logs `Buffering missing file: opfs:/cases.duckdb`, keeps everything in WASM memory, and the file stays at 0 bytes. A durable DuckDB file needs the **async** API, whose `open()` awaits handle preparation; that is a worker-wide refactor (every `conn.query` becomes `await`ed).

Consequences to keep in mind when changing this area:

- `init()` measures the file size and reports `dbDurable`; the Connections page says the list is "rebuilt from your stored files at startup" when it is false. **Do not report success from `open()` alone** — a non-persistent database is indistinguishable from a persistent one until the next reload, which is how this went unnoticed while it stranded dozens of imports.
- The index is rebuilt on every cold boot by re-parsing each stored blob, so startup cost scales with the number of imports. Deleting old imports is the user-facing remedy.
- `getTotalStorageBytes()` walks the whole `imports/` tree, so anything stranded there is still charged to the user. Clear-all sweeps **every** directory (`listImportDirectories()`), not just indexed uuids, and the Connections page names the gap between the two — otherwise orphaned bytes are unreclaimable and the two numbers silently disagree.

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

**CSV export** — the queue can be exported to a name-first, timestamped `.csv` (`open-case-update-que-YYYYMMDD-HHMMSS.csv`) for sharing in a standup or ticket. Every cell is passed through `sanitizeCellForExport()` ([`csv-export.js`](src/lib/csv-export.js)) to neutralize spreadsheet formula injection before download.

#### Solution Proposed (`/solution-proposed`)
An **auto-close countdown** for cases in the ServiceNow `Solution Proposed` status (state = `Resolved`, awaiting customer confirmation). Per current policy these cases **no longer owe a recurring SOP cadence update** — instead, ServiceNow auto-closes a Resolved case 90 days (`SOLUTION_PROPOSED_AUTOCLOSE_MS`) after the **resolution notes are saved** if the customer never confirms, and this screen shows, for the selected analyst, every such case and how long until that auto-close. The countdown is measured from when the case was resolved — the timestamp of the `<b>Resolution notes</b>` journal entry (`resolved_at_ms`, baked at ingest), falling back to the last Infor note then the created date — against the data-as-of snapshot (never `Date.now()`, so it's deterministic for a given import), clamped so it can't start before creation. **The system "Case Resolved – Reminder N" auto-close warning notes do _not_ move the anchor** (only the resolution-notes save does). The table is sortable (Case / Priority / Account / Resolved / Auto-closes / Time remaining) with urgency coloring (danger ≤ 7 days or already past, warn ≤ 30 days), counts of cases closing within 7 / 30 days, a real empty state, and a sanitized CSV export (`solution-proposed-auto-close-YYYYMMDD-HHMMSS.csv`). Backed by `getSolutionProposedAutoClose()` in [`queries.js`](src/lib/queries.js). **Modeling note:** ServiceNow's true auto-close anchor is instance-configured; this models it as the resolution-notes save time against the import snapshot.

### Performance

#### SLA Performance (`/sla`)

> **SLA = the Infor SOP response cadence, not ServiceNow's `Made SLA` flag.**
> ServiceNow only judges `Made SLA` on the *first* response and ignores
> correspondence cadence afterward. Per Infor SOP, the real SLA is the response
> cadence enforced on the Update Queue: a per-priority required update interval
> (P1 1h … P4 7d; development cases 30d) plus the first-response target
> (P1 30m … P4 4h). A case **breaches SLA** if it missed its first-response
> target or let any update gap over its life exceed the cadence — judged across
> the whole case by `computeSlaSop()` in `enrich.js`. Eligibility (the
> denominator) = the case has a defined cadence.
>
> **Solution Proposed (state = `Resolved`) cases no longer owe a recurring
> cadence update** (v10). Their cadence trailing-gap clock **stops at the last
> Infor update** rather than running to the snapshot, so a resolved case sitting
> idle stops accruing a trailing-gap breach and drops out of the
> at-risk/overdue/forecast surfaces — but a missed first response (judged to the
> snapshot, so a never-answered resolved case still counts) or a real inter-update
> gap *before* resolution still breaches. SLA % generally rises as a result.
> (Closed cases stop at their close time, as before.) The three clocks are kept
> distinct: cadence stops at the last Infor update; the initial-response window
> runs to the snapshot; the 90-day auto-close countdown starts when the resolution
> notes are saved (system auto-close reminder notes do not move it — see the
> Solution Proposed screen above).
>
> System auto-resolution / "Case Resolved – Reminder N" notes are authored
> `System  Automatic Reminders (Infor)`; despite the `(Infor)` tag they are **not**
> analyst work and are excluded from the Infor-update timeline (cadence) and the
> interaction turn counts.

- Radial gauge showing overall SLA hit rate (color-coded: green ≥ 95%, amber ≥ 85%, red below).
- Bar chart breaking the SLA rate down by priority level.
- List of open cases approaching or already past their next-update-due deadline, segmented into: Breached, Due < 24h, Due this week, Comfortable, No SLA.
- **Breach Forecast** — forward-looking complement to the Update Queue: open cases whose SOP next-update deadline lands within the next 7 days, ranked soonest-first, with a momentum read (time since last Infor update). A **stalled** flag marks cases not touched in longer than the time they have left — i.e. on current cadence they're heading for a breach. Snapshot-anchored; covers all open work for the current analyst selection, independent of the date range. (`slaBreachForecast()` in `stats.js`.)
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
- **Resolved / Closed by assignee** — stacked bar chart of completed work per analyst, separating Closed (State=Closed) from Resolved (Solution Proposed, awaiting customer confirmation), sorted high to low. Click any bar segment to drill into those cases in a `CaseDrilldown` panel. (`WorkloadResolvedBlock.jsx`)
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
Live engineering analytics for the HMS Jira project. Optional — needs Jira connected in **Settings** and a local proxy (`npm run dev` or the desktop app). See [Jira Integration](#jira-integration).

#### Statistics (`/jira-stats`)
Deep-dive statistics for the HMS project. See [Jira Integration](#jira-integration).

#### Impact Clusters (`/operations`)
Correlated Jira + ServiceNow ecosystems, ranked by real customer impact rather than ticket age. Consolidates the cross-source join that previously lived in two places. See [Impact Clusters](#impact-clusters--unified-jira--servicenow-correlation).

### Tools

#### Connections (`/connections`)
Data source management. The **ServiceNow imports** card is a full file manager: upload new exports, switch the active import, rename, rebuild-from-source, and delete — each import is persisted independently (see [Multi-import model](#multi-import-model--persistence)). The **Jira** card shows sync status and triggers recent/full syncs. Placeholder cards for a ServiceNow API direct connector and Gainsight integration (coming later).

#### Insights (`/insights`)
AI-powered qualitative analysis. See [AI Insights](#ai-insights).

#### Customer Sentiment (`/sentiment`)
Deterministic, on-device customer-sentiment grading — valence, arc, emotions, responsiveness, hygiene, a representative quote, and a templated coaching note — reproducing the structured columns of the LLM sentiment review without sending any case to a model. See [Customer Sentiment](#customer-sentiment).

#### Cases (`/cases`)
Full sortable and searchable case register. Every column from the enriched dataset is available. Keyword search filters across all text fields.

#### Surveys (`/surveys`)
Placeholder for future CSAT/survey data integration.

#### Settings (`/settings`)
Local, browser-only app preferences (stored in `localStorage`, no backend). Exposes three toggles:

- **Auto-delete old imports** — prune imports older than a configurable threshold on startup; the active import is always kept. Off by default.
- **Back up imports to disk** — mirror each import's raw source to `.servicenow-cache/` for cross-browser / cross-restart recovery. Off by default in the browser (writes into the project folder); **on by default in the desktop (Electron) app** where the mirror under `%APPDATA%\KPI Analyzer` is what persists imports across restarts. See [Security](#security).
- **Jira auto-sync** — when on (default), the app runs a lightweight delta poll (fetching only issues changed since the last sync) on an interval (default 15 min) and whenever the window regains focus. Once a day it runs a full reconcile to catch deleted or moved issues. A sync lock prevents manual and scheduled syncs from overlapping; background failures log silently without disturbing the UI. Requires an initial manual sync first. Turn it off to sync only on demand.

---

## Jira Integration

Jira is **optional**. The app boots, imports ServiceNow exports and runs every non-Jira page with no credentials at all; connect it when you want the Jira pages.

Sync runs through a local proxy (`/api/jira → <your site>/rest`) that injects HTTP Basic auth server-side, so the token never reaches the browser bundle. The dev server (`vite.config.js → jiraProxyPlugin`) and the packaged app (`electron/server.cjs → handleJira`) implement the same contract. **A bare `vite build` has neither**, so live sync is unavailable in static builds.

### Setup

Go to **Settings → Jira connection**, enter your Jira site URL, Atlassian email, and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens), then **Connect**. The credentials are verified against `/myself` before they are saved, and resolved per request — no restart, in either build.

Where the token lands:

| Build | Location | Protection |
|---|---|---|
| `npm run dev` | `.jira-creds.json` in the project folder | gitignored, plaintext (same trust level as the `.env` it replaces), mode `0600` |
| Desktop app | `%APPDATA%\KPI Analyzer\credentials.enc` | encrypted with Electron `safeStorage` (Windows DPAPI, keyed to your login) |

`.env` still works and is read as a fallback, so a scripted dev setup can pre-seed credentials (see [Environment Variables](#environment-variables)). Credentials saved in Settings take precedence over `.env`, and both are re-read per request.

### Sync modes

| Button | Window | Use case |
|---|---|---|
| Last 24h | 1 day | Quick check after a standup |
| Last 5 days | 5 days | End-of-week refresh |
| Last 14 days | 14 days | Sprint retrospective |
| Last month | 30 days | Monthly review |
| Full sync | 90 days | First sync or full refresh |

Incremental syncs merge onto the existing cache (updated issues replace, new ones append). A full sync replaces everything.

**90-day retention.** Every Jira analytic reads a window of 90 days or less (the widest is created-vs-resolved at 12 weeks), so the sync and the cache are both bounded to 90 days of `updated` history — earlier builds pulled 365 days, caching ~10k issues with embedded changelogs that nothing ever read. Issues that fall out of the window are pruned when the cache is read and again whenever it is written, so an incremental merge cannot grow the cache past the window. The single knob is `FULL_SYNC_DAYS` in [src/lib/jira-client.js](src/lib/jira-client.js); widening it means re-checking the window constants in `jira-stats.js` / `JiraStatsPage.jsx` first.

### Background auto-sync

When **Settings → Jira auto-sync** is on (default), a scheduler runs automatically:

- **Delta poll** — fetches only issues updated since the last sync, runs every 15 minutes and on window focus / visibility change. Uses a `sinceExpr` JQL bound so the request is minimal.
- **Daily full reconcile** — once the cache is a day stale it runs a full sync to catch deletions and moved issues that a delta cannot see.
- **Sync lock** — a ref-based lock prevents manual and scheduled syncs from overlapping; if a sync is in flight the next trigger is dropped, not queued.
- **Silent failure** — background sync failures log a warning and retry next tick without disturbing the connected Jira UI or triggering an error state.
- **FreshnessIndicator** — while a background sync is in progress the Jira freshness pill in the top bar shows a spinner. The `jiraAutoSyncing` flag is kept in its own separate React state (not merged into `jiraState`) so background sync pulses do not cascade re-renders through data-dependent pages.

### Caching

Jira data is cached as a JSON file at `.jira-cache/cache.json` via a Vite dev plugin (`jiraFileCachePlugin`). The file is fully inspectable, survives browser clearing, and is served at `/api/cache/jira`. On startup, the app hydrates from this file before attempting a live sync.

**What gets cached.** Only `{ key, fields, changelog }` per issue, and the changelog is reduced to `history.created` plus `field === 'status'` items — the only parts `parseStatusHistory()` reads. `expand=changelog` otherwise returns every field edit with author objects and both the id and display form of each value, which accounted for 355 MB of a 386 MB cache file that nothing read. Slimming happens at fetch time and again on read (`slimIssues()`), so an oversized cache from an older build shrinks on the next boot. Combined with the 90-day window, a real HMS cache went **386 MB → 18.5 MB** with every status transition preserved.

A pre-upgrade cache can be big enough that parsing it once in the renderer is itself slow. `node --max-old-space-size=8192 scripts/compact-jira-cache.mjs` normalises the file in place (keeping a `.bak`) using the same imported prune + slim; deleting `.jira-cache/` and re-syncing works equally well.

Adding a field a consumer needs means updating `slimIssue()` **and** re-syncing — an already-slimmed cache won't have it.

### Project resolution

`resolveProject()` looks up the project by name ("Hospitality Management Solution") via `/project/search`, not by key, so the sync is provably scoped to the right space. The key (`HMS`) is only a fast-path fallback.

### Search endpoint compatibility

The app tries the newer cursor-based `/search/jql` endpoint first and falls back to the legacy `startAt`-based `/search` endpoint on 403/404/410. This handles both current and older Jira Cloud instances.

### Jira Blockers page (`/jira-blockers`)

Shows open ServiceNow cases that have at least one active Jira ticket reference. Ticket IDs are parsed from the case journals — `system_log`, `work_notes`, and `additional_comments` — looking for the System note "Jira Reference ID ... has been linked" / "... has been created and linked" plus any free-text `HMS-XXXXX` mention, and from the `cause` field (any `[A-Z]+-\d+` pattern). `RN-` prefixed IDs are recognized as ServiceNow-internal Resolution Notes references and are not linked to Atlassian. Days linked is anchored to the System link note only: cases whose tickets came solely from `cause` or a free-text mention show "Not linked" instead of a fake 0.

Free-text mentions are **display-only**: the ticket appears on the case (clickable, tagged "mentioned", with live Jira data when synced), but a prose name-drop never marks the case as blocked — mentions are excluded from `_jiraActiveTickets`/`jira_active_keys` (My Day triage, account-risk `openBlockers`), the "Likely closeable" mismatch flag, the blast-radius "cases blocked" counts, and the "Tickets blocking multiple cases" ranking. Only the `cause` field and System notes assert a real linkage.

When Jira is synced, each ticket gets live status, assignee, priority, fix versions, and engineering cycle time from the Jira API. The "Likely closeable" panel surfaces cases where every linked Jira ticket is already Done but the ServiceNow case is still open.

**Blast radius table** — ranks Jira tickets by how many open ServiceNow cases they are blocking. Since the unified-insights work this is a projection over the shared correlation engine, scored by the same explainable function the [Impact Clusters](#impact-clusters--unified-jira--servicenow-correlation) page uses, so the two surfaces cannot disagree. One fix at the top of this list unblocks the most customer impact.

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

## Customer Sentiment

A deterministic, **on-device** reproduction of the structured columns of the LLM "Customer Sentiment Review" — so the team never has to run a whole export through a model. The grader reads the customer-visible comment stream and emits a valence, a label, a conversation arc, emotions, a frustration target, a representative quote, and a templated coaching note. **No case is sent to a model.** The engine (`src/lib/sentiment.js`) is pure and framework-free, with no network or wall-clock dependencies, so the same row always grades the same way.

> **Honest accuracy.** The grader is *exact* on coverage, responsiveness, and hygiene (those are structural counts) and *directional* on tone: valence sign agrees with the LLM review on a single line roughly 60–65% of the time, and better across a full message stream where start/end/arc are visible. The coaching note is **templated** — it states the structural facts (responsiveness, arc, closure), not the model's prose.

### How it works

- **Attribution mirrors the interaction-count parser exactly.** A journal entry whose author line contains `(Infor)` is an analyst turn; everything else is the customer (`WORK_NOTE_HEADER` / `ANALYST_AUTHOR` in `enrich.js`). Sentiment and interaction counts therefore never disagree.
- **Scoring** uses a tuned support / hospitality-PMS lexicon (`POS` / `NEG` / `IMPACT`) compressed onto a −5..+5 scale (`5·tanh(raw / COMPRESS_K)`, `COMPRESS_K = 8`), with a **diminishing-returns cap**: after the first 3 distinct same-polarity cues in one message, further cues count at ½× so a multi-cue rant can't saturate the score.
- **Scoreable gating.** A case is graded only where the customer actually wrote something. Phone-resolved / silent cases are **counted in coverage** but carry a null grade.
- **Hygiene** (exact, structural): duplicate analyst double-posts (identical body ≤60 s apart) and credential / remote-access exposure (`AnyDesk`, `password:`) in the stream.

### Baked as a queryable field

Sentiment is computed once in the shared enrichment (`enrichRow` + `enrichForSql`) and persisted in DuckDB — exactly like SLA, category, and interaction counts — so it is a queryable dimension and is not re-graded on every filter change. The `sentiment_*` columns were added at **`SCHEMA_VERSION` 9**; older imports show a "Rebuild needed" badge and re-grade from source on rebuild. Both pipelines emit byte-identical sentiment values, enforced by a parity test (`enrichRow(r).sentiment_*` deep-equals `enrichForSql(r).sentiment_*`).

### Sentiment page (`/sentiment`)

Headline tiles (average valence + a /100 normalization, scoreable coverage, recovery rate, still-negative-at-close, median first reply + % within 1 h, hygiene flags), a sentiment-distribution chart, and a sortable, keyboard-navigable per-case table whose rows expand to the representative quote (rendered as text) and the coaching note. A **Download grades** button regenerates the two-sheet review workbook (`Headline Metrics` + `Per-Case Detail`) on device via ExcelJS, every cell routed through the formula-injection guard.

### Optional Claude deep-read (opt-in, per-case)

The hybrid: the lexicon engine grades the whole queue locally; for prose coaching on the handful of cases that warrant it, a **Deep-read the N negatives** action sends *only* those (≤ 10) cases — `scrubForAi`-masked — through the existing first-party AI proxy (`aiClient.reviewSentiment`). It is strictly gated on `aiClient.isConfigured()` (showing the same calm "not configured" card as the Insights feature when no proxy is set) and never fans out across the queue or calls a vendor directly (SECURITY #1).

---

## Impact Clusters — unified Jira ↔ ServiceNow correlation

`/operations` answers one question: **which engineering work is hurting which
customers, and how badly?** It correlates Jira tickets with the ServiceNow cases
waiting on them, groups them into ecosystems, and ranks those by customer impact
instead of by ticket age.

### Where the link comes from

The link lives **in the ServiceNow case**, not in Jira. `parseJiraRefs`
(`enrich.js`) already extracts ticket references from the case journals
(`system_log`, `work_notes`, `additional_comments`) and the `cause` field, and
classifies each one by `source`. This layer consumes that; it re-parses nothing.

Only **asserted** linkage becomes a correlation edge:

- the `cause` field, and the System "Jira Reference ID … has been (created and)
  linked" note → **an edge**;
- a free-text mention (`HMS-12345` in prose) → **never an edge**. Even a note
  reading "not related to HMS-123" would match the pattern. Mentions are carried
  through and shown, tagged, and excluded from every count;
- an `RN-` reference → **an edge**, tagged non-Atlassian. It is a ServiceNow
  Resolution Notes record, not a Jira ticket, so it is never joined to the live
  Jira map and never rendered as a browse URL — but `enrich.js` counts its System
  link note toward `_jiraFirstLinked` *by design*, because that note marks when
  the case started waiting on engineering. Two cases sharing an `RN-` really are
  correlated.

#### `RN-` refs are resolved to the Jira they stand for

An `RN-` handle and an `HMS-` key are routinely the *same defect written down
twice*, from the two sides of one workflow:

```
[Work notes] Jira Reference ID RN-9732370 has been linked to this case.
[Cause]      External Defect ID: HMS-97290
```

Neither note names the other, so the parser — which pulls every `[A-Z]+-\d+`
token independently — used to emit two tickets for one defect. A cluster listed
`HMS-97290` *and* `RN-9732370` as separate rows, double-counting the defect in
`distinctJiras`, halving `casesPerJira`, and splitting the blast-radius table
into two rows that each told half the story.

`buildAliasMap` (insight-metrics.js) resolves this from **co-occurrence pooled
across the whole import**, not from a single case. That is what puts cases
carrying *only* the `RN-` in the right bucket: `RN-9732370` appears alongside
`HMS-97290` on eight separate cases, so a ninth whose `cause` field was left
blank still lands on `HMS-97290`. The surviving key keeps the raw ref as
display-only provenance (`aliasedFrom`), rendered as a subdued `· RN-9732370`
suffix so a ref found in the work notes is still findable on screen.

It requires a **strict plurality** — the top candidate must be backed by more
cases than the runner-up — and refuses to guess otherwise:

- `RN-9732370` → `HMS-97290` ×8 vs `HMS-97333` ×1 ⇒ resolved to `HMS-97290`. The
  lone dissenter is one case whose `cause` reads `HMS-97290/HMS-97333`, i.e. a
  case blocked on two defects — not evidence about what the ref is.
- `RN-9651814` → `HMS-97002` ×2 vs `HMS-96993` ×2 ⇒ **not resolved.** A tie is
  never broken alphabetically: attributing a case to the wrong defect is a worse
  failure than showing one extra row, so the ref stays its own non-Atlassian node
  exactly as before.

Free-text mentions are **not** evidence — that would launder a name-drop into an
edge for every case carrying the ref, which is the whole point of the rule above.
The mapping is always derived from the unfiltered corpus, so a ticket's identity
never changes with the analyst or date filters. On the two cached imports this
resolves 213 of 298 `RN-` rows (and 15 of 30 on the smaller one); the rest either
never co-occur with a Jira key (76 refs) or tie.

### Clusters, not pairs

Edges form a bipartite graph over case numbers and ticket keys; the view shows its
**connected components**. That is what makes many-to-many work: one Jira spanning
several cases, one case blocked by several Jiras, and the transitive groups that
fall out of both (a case linking both J1 and J2 fuses them into one ecosystem).
Union-find, iterative, O(n + m).

A case that references a ticket only in prose asserts no linkage, so it forms no
cluster; those cases are listed separately at the bottom of the page and excluded
from every aggregate above it.

### The ranking is explainable

Each cluster carries a 0–100 `score` **and** the named contributions that sum to
it, shown as chips (`Open cases blocked +30` · `Accounts affected +20` ·
`Escalation: at-risk +15` → 65). Terms: affected open cases, distinct accounts,
oldest unresolved Jira age, oldest open case age, derived escalation level,
negative sentiment, and a high-urgency × long-unresolved interaction. **Every term
is capped**, so raw case volume cannot swamp an escalation — 500 quiet cases
cannot reach the `high` band on volume alone. All weights are named exports in
`insight-thresholds.js`.

Two named risk shapes are flagged separately: *long-running Jira + multiple
unresolved cases*, and *high urgency + negative sentiment + escalation* (strictly
all three).

### Honest accuracy

This view makes no claim it cannot support from the import in front of it.

- **Nothing is sent to a model.** Sentiment is read from the baked `sentiment_*`
  columns (see [Customer Sentiment](#customer-sentiment)); the per-cluster
  narrative is a deterministic template over facts already computed. There is no
  AI call on this page.
- **Unknown is null, never zero.** An unknown priority does not become "low"; an
  unscored case does not become "no risk"; a case with no System link note reports
  **"Not linked"**, never `0` days. A missing Jira age renders "—", not `0`.
- **Snapshot-anchored.** Every age, idle count and delta is measured against the
  active import's upload time, not the wall clock, so the same upload always
  renders identically — stated on the page itself. The Jira cache's own freshness
  is shown separately rather than blended in.
- **Escalation is derived**, because ServiceNow has no escalation field. The enum
  composes explicit `sentiment_escalated` events, SOP-SLA breaches, sentiment risk
  against the validated bands in `sentiment.js`, and Jira staleness — and every
  level ships the reasons that produced it. `escalated` requires a real escalation
  event; `at-risk` and `watch` do not.
- **Cluster metrics describe the whole cluster, even when filtered.** A Jira
  blocking five cases blocks five cases regardless of who is looking, so filtering
  to one analyst does not shrink the number; a chip reads "N of M cases match your
  filter" instead.
- **Ceilings are disclosed.** The list renders the top 60 clusters and says so,
  pointing at the CSV, which contains all of them. Facet chips show the top 8
  values per dimension with a "+N more" note.

### Filter dimensions, and what your export supports

Filters are a declared registry; each dimension's availability is resolved from
the **active import**, and an absent one renders "Not available in this export —
needs `<column>`" rather than a misleading zero (the same pattern as
`AiEffectivenessBlock`).

Case side: `account`, `parent_account`, `product_line`, `region`,
`assignment_group`, priority, category, lifecycle, age bucket, plus `assigned_to`
and `manager` (owned by the global filter bar above). Jira side: `assignee`,
`priority`, `fixVersions`, `statusCategory`, age bucket — all of which need a Jira
sync.

> **`Region` and `Assignment group` note.** These were long assumed absent from
> ServiceNow exports. They are not: the standard case layout ships both, and they
> were simply never mapped by `normalizeXlsxRow`. They are now mapped as raw
> passthroughs (like `parent_account` and `tags` — no SQL column) and are ordinary
> dimensions. `Country` and `City` are also present in that layout and remain
> unmapped.

View-local filter selections are serialized into the URL as **opaque index
tokens** (`?od=account:3`), so a shared link carries no account name, region or
personal name — the same treatment `useFilters` gives the analyst selector
(SECURITY #3). A token that no longer resolves is ignored, so a link shared
against a different import degrades to "no filter" rather than to a wrong one.

### Consolidation

This layer is also the **single** implementation of the cross-source join. Two
others existed and are gone:

- `jira-stats.js` `blastRadius` is now a thin projection over the shared engine,
  emitting the same field names its consumers already read.
- `JiraDashboard.jsx`'s private `ticketGroups` memo and its own impact formula
  (`cases.length * 2 + priorityWeight + min(20, oldestDays / 7)`) are deleted.

So the Blockers page, the Jira Statistics blast-radius table and this view rank
tickets with one function and cannot disagree. The visible consequence is that the
"Tickets blocking multiple cases" ordering changed — the old formula let raw case
count outweigh a live customer escalation. See
`CODEREVIEW(unified-insights).md` for the equivalence proof and the full list of
numbers that moved.

### Exports

Two CSVs — one row per cluster, one row per case — both routed through
`rowsToCsv` → `sanitizeCellForExport` (SECURITY #7). "Days linked" exports the
word **"Not linked"**, never `0`. The cluster CSV includes the factor breakdown,
so a spreadsheet reader sees *why* a row ranks where it does.

### Modules

```
src/lib/insight-thresholds.js   named weights, caps, bands, enums
src/lib/correlate.js            the engine — imports nothing, knows no field name
src/lib/insight-metrics.js      the ONLY source-aware module: adapters + metrics
src/lib/insight-rank.js         scoring, factors, flags, narratives, buildInsights
src/lib/insight-filters.js      dimension registry, selectors, drill-down, tokens
src/lib/insights-csv.js         sanitized exports
src/components/insights/…       presentation only
src/pages/OperationsPage.jsx    route + outlet context
```

`correlate.js` takes normalized node/edge descriptors and returns clusters — it
names no ServiceNow or Jira field and imports nothing, so adding a future source
(Gainsight, a ServiceNow API connector) means writing one adapter in
`insight-metrics.js` and not touching the engine. Correlation is computed **once**
per import and every filter selects from the result; ~23 ms for 11,098 issues ×
951 cases.

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
| `_slaDue` | `sla_due` | ServiceNow's raw "SLA due" date — retained for reference; no longer drives any metric |
| `_resolvedMs` | `_closed - _created` | Resolution time in ms |
| `_frtMs` | `first_response_time` | First response time in ms |
| `_isClosed` | `state` | true ONLY when state is `"Closed"`. `State="Resolved"` (Status "Solution Proposed") is its own `_lifecycle` bucket — neither open nor closed. Never use `!_isClosed` to mean "open"; use `_isOpen` |
| `_madeSla` | `made_sla` | ServiceNow's first-response-only flag — retained raw; no longer drives any metric |
| `_category` | `short_description` + `close_notes` | Auto-categorized (11 categories) |
| `_jiraTickets` | journals + `cause` | Parsed Jira ticket references |
| `_jiraActiveTickets` | `_jiraTickets` | Tickets not yet closed |
| `_jiraFirstLinked` | journals | Earliest "linked" event timestamp; `null` when no System link note exists |
| `_interactionCount` | `work_notes` | Total conversation turns |
| `_customerTurns` | `work_notes` | Customer-authored turns |
| `_analystTurns` | `work_notes` | Infor-authored turns |
| `_lastInforUpdate` | `additional_comments` | Most recent Infor-authored timestamp |
| `_caseType` | `state` | `'development'` or `'support'` |
| `_updateThresholdMs` | `_caseType` + priority | SOP cadence threshold |
| `_slaEligible` | `_updateThresholdMs` | true when the case has a defined SOP cadence (drives the SLA denominator) |
| `_slaBreached` | journal timeline + SOP cadence | **the real SLA**: true if the case missed its first-response target or any cadence-update gap over its life (`computeSlaSop`) |
| `_slaBreachReason` | `computeSlaSop` | why it missed — `'initial'` (first response) or `'cadence'`; `null` if met/ineligible. Powers the SLA breach-reason split |
| `_slaDueSop` | last Infor update + cadence | SOP next-update-due deadline (open cases) — drives At-Risk / Breach Forecast / SLA Risk |
| `sentiment_scoreable` | `work_notes` | true when the customer wrote something (else a null grade) |
| `sentiment_valence` | `work_notes` | customer tone, −5..+5 (null if not scoreable) |
| `sentiment_label` | `sentiment_valence` | Positive / Neutral / Negative |
| `sentiment_arc` | first vs last customer message | improved (recovery) / stable / declined / single touchpoint |
| `sentiment_*` (start, end, emotions, target, quote, coaching, pii, dup) | `work_notes` | the remaining baked grade outputs — see [Customer Sentiment](#customer-sentiment) |

> The `sentiment_*` fields are the one set baked under **snake_case in both pipelines** (the SLA/Jira fields use `_camelCase` in `enrichRow` and `snake_case` in `enrichForSql`). One shared key name lets the UI read the grade identically whether it came from the in-memory pipeline or DuckDB, and lets the parity test deep-equal the two — see `gradeFromRow()` in `sentiment.js`.

### Jira reference parsing

`parseJiraRefs()` does a two-pass walk:

1. **Pass 1** — scans each journal (`system_log`, `work_notes`, `additional_comments` — deduped via `jiraJournals`, each segment walked independently so header dates never bleed across journals) line by line for "Jira Reference ID `[KEY]` has been linked" / "...has been created and linked" and "...has been closed" events. The event itself is recorded even when the journal header (and thus the timestamp) is missing — so a truncated closed note still marks the ticket `jira_closed`. Each journal is also scanned for free-text `HMS-XXXXX` mentions, which attach the ticket display-only: no link date, never an active blocker (mention-mining is restricted to the real Jira project key so prose tokens like "UTF-8" can't become phantom tickets).
2. **Pass 2** — extracts every `[A-Z]+-\d+` pattern from the `cause` field (canonical blockers).

`RN-` prefixed IDs are flagged as ServiceNow-internal and marked `clickable: false` so they don't generate broken Atlassian links. They are still a real *asserted* link — the System note marks when the case started waiting on engineering whether the tracked record is a Jira ticket or an internal Resolution Notes record — so they count toward `_jiraFirstLinked`, appear in the blast-radius table, and form correlation clusters. What `clickable: false` buys is that they are never joined to the live Jira map and never rendered as a browse URL. Only free-text mentions are excluded from linkage entirely. In the insight layer an `RN-` ref is additionally **resolved to the Jira key it stands for** where the import proves the pairing, so one defect is one ticket — see [`RN-` refs are resolved to the Jira they stand for](#rn--refs-are-resolved-to-the-jira-they-stand-for).

### XLSX normalization

`normalizeXlsxRow()` maps ServiceNow Excel display-label column names to internal field names. It also converts the `First Response Time` column (an absolute timestamp in XLSX exports) into a millisecond duration by subtracting `Created`.

---

## DuckDB SQL Backend

A Web Worker (`src/workers/db.worker.js`) runs a DuckDB-WASM instance using the blocking browser build. The main thread communicates via a promise-based `postMessage` wrapper in `src/lib/db-client.js`.

### Schema

Each import owns a base table `cases_import_{uuid}` with 49 columns covering all raw and enriched fields (`SQL_COLUMNS` in `enrich.js`), including the baked customer-sentiment grade added in `SCHEMA_VERSION` 9. `cases` is a **view** redefined to point at the active import's table, so all query helpers read `FROM cases` without change. An `imports_index` table tracks every import's `uuid`, `display_name`, `uploaded_at`, `row_count`, `file_size`, `file_type`, `schema_version`, and `is_active` flag. `SCHEMA_VERSION` is bumped when columns change — imports built against an older version are flagged in the file manager with a "Rebuild needed" badge (re-parses the stored source blob). A legacy single-`cases`-table build is auto-migrated to import #1 on first boot.

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
| `getUpdateQueue()` | SOP-driven overdue/due-soon/initial-response-miss lists for truly-open cases |
| `getSolutionProposedAutoClose()` | Per-analyst 90-day auto-close countdown for Solution Proposed (state=Resolved) cases — counted from the resolution-notes save (`resolved_at_ms`), snapshot-anchored |

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
| Older than 90 days | Everything before the 90-day cutoff |
| Last 90 days | Rolling 90-day window |
| Last 60 days | Rolling 60-day window |
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

> **Repeated headers.** The standard case layout ships the header `Number` **twice** — column 1 is the case number (`CS1887438`) and a later column is the account number (`ACCT9000004`). The XLSX reader keeps the **first** occurrence of any repeated header, which is the record's own field. Before this rule the last one won, so every case's `number` was silently an account number.

| XLSX display label | CSV internal name | Used for |
|---|---|---|
| `Number` | `number` | Case identifier |
| `Short Description` | `short_description` | Categorization, AI analysis |
| `State` | `state` | Open/closed, case type classification |
| `Status` | `status` | Display |
| `Priority` | `priority` | SLA thresholds, SOP cadence |
| `Assigned to` | `assigned_to` | Analyst filtering |
| `Account` | `account` | Account analytics |
| `Contact` | `contact` | Per-case sentiment export (Contact column) |
| `Product line` | `product_line` | Product analytics |
| `Region` | `region` | Impact Clusters filter dimension (raw passthrough, no SQL column) |
| `Assignment group` | `assignment_group` | Impact Clusters filter dimension (raw passthrough, no SQL column) |
| `Made SLA` | `made_sla` | Retained raw (ServiceNow first-response flag); no longer drives metrics |
| `SLA due` | `sla_due` | Retained raw; SLA risk now uses the SOP next-update deadline |
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

**No variable is required to run the app.** All of them live in `.env` (gitignored); copy `.env.example` if you want one.

| Variable | Required | Description |
|---|---|---|
| `JIRA_BASE_URL` | Optional | Atlassian instance URL, e.g. `https://infor.atlassian.net` |
| `JIRA_EMAIL` | Optional | Your Atlassian account email |
| `JIRA_API_TOKEN` | Optional | API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEY` | Optional | Project key, e.g. `HMS` |
| `VITE_AI_PROXY_URL` | For AI | Base URL of your first-party AI proxy backend |

The `JIRA_*` variables are a **fallback** for the credentials normally entered in **Settings → Jira connection** — useful for a scripted or pre-seeded dev setup. Settings wins where both exist. They are intentionally **not** prefixed with `VITE_` — Vite only exposes `VITE_`-prefixed vars to the client bundle. These are read by `vite.config.js` on the Node side and used to build a server-side `Authorization` header, so they never appear in the browser bundle.

`VITE_AI_PROXY_URL` **is** prefixed with `VITE_` because the proxy URL (not a secret) is needed in the client bundle to know where to send requests. The API key lives on the proxy server, not here.

---

## Other Commands

```bash
npm run dev             # start dev server with Jira proxy
npm run build           # production build (no Jira proxy, no live sync)
npm run preview         # preview the production build locally
npm run lint            # run ESLint
npm run electron:dev    # build + launch the Electron desktop app locally
npm run electron:build  # build the Windows installer → release/
```

---

## Security

See [SECURITY_CONCERNS.md](./SECURITY_CONCERNS.md) for the full audit (17 items, with statuses). Summary of the current posture:

- **Customer data** stays on the machine. The only *network* egress is the optional AI proxy call, which scrubs PII (case numbers, account names, analyst names, emails) before leaving the browser. The AI proxy is not yet deployed, so today the feature is inert and nothing leaves the browser.
- **Jira credentials** are read server-side by the Vite dev proxy and never bundled into client code.
- **Data at rest** lives in OPFS (browser) and the `.servicenow-cache/` disk mirror (raw, unencrypted exports), governed by **Settings → Back up imports to disk**: **off by default in the browser** (where the mirror writes into the gitignored project folder) and **on by default in the desktop app** (where it writes under `%APPDATA%\KPI Analyzer` and is what makes imports survive an app restart). Neither layer has an automatic expiry by default; retention is controlled by the opt-in **Settings → Auto-delete old imports** (off by default), which now cleans all layers, plus the one-click delete in the Connections file manager and a boot-time orphan sweep. *(The previously-documented 24h auto-TTL was removed by the multi-import refactor — see #4.)*
- **File uploads** are validated by magic bytes and a 50 MB size ceiling before parsing.
- **SQL queries** use parameterized statements throughout. User-controlled URL parameters are resolved to known values from the loaded dataset before being passed to any query.
- **Jira HTML descriptions** are sanitized with DOMPurify before rendering; ServiceNow free-text fields are rendered as plain text only.
- **CSV exports** (Update Queue, Solution Proposed, Jira Blockers) route every cell through the formula-injection sanitizer in `src/lib/csv-export.js` via the single shared `rowsToCsv` → `toCsvRow` → `sanitizeCellForExport` path.
- **Customer sentiment** is graded 100% on device — the engine has no network path. The optional per-case **deep-read** sends only a hand-picked handful of cases (the negatives) through the scrubbed AI proxy (`scrubForAi` + `aiClient.reviewSentiment`), strictly gated on configuration; never the whole queue, never a vendor directly. The sentiment **Excel export** routes every cell through the same `sanitizeCellForExport` formula-injection guard.
- **Production builds** ship a Content-Security-Policy meta tag.

---

## Releases

| Version | Date | Highlights |
|---|---|---|
| **1.2.1** | 2026-07-23 | Perf fix: isolate `jiraAutoSyncing` into its own React state atom so background Jira sync pulses don't cascade re-renders through data-dependent pages; `FreshnessIndicator` receives it as a dedicated prop. |
| **1.2.0** | 2026-07-09 | Background Jira auto-sync (delta poll + daily full reconcile, sync lock, silent failure); Jira auto-sync Settings toggle; **Resolved / Closed by assignee** workload chart with segment drilldown (`WorkloadResolvedBlock`); spinner in FreshnessIndicator during sync. |
| **1.1.2** | 2026-07-02 | Docs: expanded `SECURITY_CONCERNS.md`. |
| **1.1.1** | 2026-06-25 | See git log. |
| **1.1.0** | 2026-06-22 | See git log. |
| **1.0.3** | 2026-06-19 | See git log. |

---

## Roadmap & Code Reviews

Living review documents track the codebase's health and where it's headed:

| Document | Focus |
|---|---|
| [CODEREVIEW(solution-proposed.md)](./CODEREVIEW(solution-proposed.md)) | **Latest.** Solution Proposed (v10): the SLA cadence clock-stop for Resolved cases (three distinct clock-stops), the resolution-notes-saved auto-close anchor (`resolved_at_ms`) with system auto-reminder notes excluded, the new column + `SCHEMA_VERSION` 10 bump, the deleted cadence plumbing, and an adversarial self-critique pass (4 SLA findings, all fixed). |
| [CODEREVIEW(sentiment).md](./CODEREVIEW(sentiment).md) | Feature review of the on-device Case Sentiment Grader — the bake-vs-render decision, honest accuracy limits, the `SCHEMA_VERSION` 9 columns, tuning knobs, and an adversarial self-critique pass (8 findings: 6 fixed, 2 documented non-changes). |
| [CODEREVIEW(6-10).md](./CODEREVIEW(6-10).md) | Whole-codebase review + a prioritized roadmap of future iterations framed around what makes the app more valuable to **analysts and managers** (saved views, SLA trend-over-time, CSAT join, in-app SOP config, alerting/digests, ServiceNow direct connector, and more). |
| [CODEREVIEW(5-31).md](./CODEREVIEW(5-31).md) | Prior review — code-quality / statistical-correctness findings (Jira percentile bias, join-key normalization, dev-SQL-in-prod) and the `feat/analytics-and-hardening` cycle. |
| [SECURITY_CONCERNS.md](./SECURITY_CONCERNS.md) | Security audit (17 items with statuses) — see [Security](#security) above. |
