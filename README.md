# ServiceNow KPI Analyzer

A browser-based analytics dashboard for ServiceNow case exports. Upload a CSV or Excel file from your ServiceNow instance and get instant KPI dashboards, SLA tracking, trend analysis, and AI-powered insights — all processed locally in your browser with no data leaving your machine.

## Features

### Data Ingestion
- Upload **CSV** or **Excel (.xlsx/.xls)** exports directly from ServiceNow
- Automatic column normalization for both CSV field names and XLSX display-label headers (e.g. `Assigned to`, `Short Description`, `Made SLA`, etc.)
- Data is processed entirely client-side — nothing is sent to a server

### Analysis Views

The app has two top-level scopes, each with its own set of tabs:

**Team view** — aggregate metrics across all analysts
- **Overview** — headline KPIs: total cases, open/closed counts, SLA rate, avg resolution time, avg first response time, at-risk and breached SLA counts
- **SLA Performance** — team-wide SLA hit rate by priority, cases approaching or past their SLA deadline
- **Trends Over Time** — daily open-case trajectory, weekly intake vs. resolved cadence with rolling 4-week net, and a date-range band overlay
- **Priority Analysis** — volume and resolution time broken down by priority level
- **Jira Blockers** — open cases blocked on engineering work, parsed from work notes and cause fields
- **Workload Distribution** — Lorenz curve and Gini coefficient showing how evenly work is spread across the team; per-analyst open-case aging stacked bar chart
- **AI Analysis** — Claude-powered qualitative summary of themes, recurring issues, knowledge-base gaps, and skill-development opportunities (samples up to 50 anonymized cases)
- **Case Register** — full sortable/searchable case table

**Individual view** — drill into a single analyst
- Same tabs as team view (Overview, SLA, Trends, Priority, Jira Blockers, AI, Cases), scoped to the selected analyst
- Interaction stats: avg conversation turns, customer vs. analyst turn breakdown, multi-touch percentage

### Filtering & Navigation
- **Date range presets**: All-time, YTD, Last 90 days, Last 30 days, Last 7 days, or custom date picker
- **Date field toggle**: filter by created date or closed date
- **Period comparison**: compare the current window against the equivalent prior period, with delta indicators on every KPI card
- **URL state**: all active filters (date range, analyst, page, compare mode) are reflected in the URL query string for bookmarking and sharing

### Enrichment & Categorization
Cases are automatically enriched with:
- **Auto-categorization** into 11 categories (Night Audit, Login & Access, Email & Notifications, Reservations & Availability, Rates & Pricing, Billing & Folio, Reports & Data, Integrations & Interfaces, Performance & Errors, User & Permissions, Printing & Hardware) based on short description and resolution notes
- **SLA risk segmentation**: Breached, Due < 24h, Due this week, Comfortable, No SLA
- **Open case aging buckets**: 0–7d, 8–30d, 31–90d, 90d+
- **Jira ticket extraction**: parses linked/closed Jira IDs from work notes and cause fields, with clickable links to `infor.atlassian.net`
- **Interaction parsing**: counts customer vs. analyst turns from timestamped work note entries
- **Weekday analytics**: cases created by day of week, average open caseload by day of week, and an hour-of-day creation heatmap

### Print / PDF Export
- Print the full team or individual report to PDF via the print menu in the toolbar
- All chart tabs render stacked in print mode so every section appears in the output

### DuckDB Backend (in progress)
- A Web Worker runs an in-browser [DuckDB-WASM](https://github.com/duckdb/duckdb-wasm) instance in parallel with the in-memory pipeline
- Data is persisted to the browser's Origin Private File System (OPFS) so it survives page reloads
- SQL query helpers are being migrated to replace the in-memory pipeline incrementally

## Tech Stack

| Layer | Library |
|---|---|
| UI framework | React 19 |
| Build tool | Vite 8 |
| Charts | Recharts 3 |
| CSV parsing | PapaParse 5 |
| Excel parsing | SheetJS (xlsx) |
| Icons | Lucide React |
| In-browser SQL | DuckDB-WASM |

## Getting Started

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` and upload a ServiceNow case export (CSV or XLSX).

### Supported Export Columns

The app works with standard ServiceNow case exports. For CSV exports, the expected field names are the internal ServiceNow column names (e.g. `sys_created_on`, `assigned_to`, `made_sla`). For XLSX exports, the display-label column names are automatically mapped (e.g. `Created`, `Assigned to`, `Made SLA`).

Key columns used:
- `Number` / `number`
- `Short Description` / `short_description`
- `State` / `state`
- `Priority` / `priority`
- `Assigned to` / `assigned_to`
- `Account` / `account`
- `Product line` / `product_line`
- `Made SLA` / `made_sla`
- `SLA due` / `sla_due`
- `Created` / `sys_created_on`
- `Closed` / `closed_at`
- `First Response Time` / `first_response_time`
- `Resolution notes` / `close_notes`
- `Additional comments` / `work_notes`
- `Cause` / `cause`

## Other Commands

```bash
npm run build    # production build
npm run preview  # preview the production build locally
npm run lint     # run ESLint
```
