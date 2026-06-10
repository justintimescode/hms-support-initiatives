# Code Review & Product Roadmap — ServiceNow KPI Analyzer (2026-06-10)

A whole-codebase review with an emphasis the prior reviews didn't cover: **what
would make this a materially better tool for the two people who actually use it —
the support analyst working their queue, and the manager reading the numbers.**

This complements, rather than repeats, the two existing documents:

- [`CODEREVIEW(5-31).md`](./CODEREVIEW(5-31).md) — code-quality / statistical-correctness findings.
- [`SECURITY_CONCERNS.md`](./SECURITY_CONCERNS.md) — the 17-item security audit.

Carry-forward items from those docs are summarized here only where they affect
the analyst/manager experience or are confirmed still-open as of this review.

---

## 1. Overall health

This is a genuinely well-built internal tool, and it has matured since the last
review. The architecture is coherent and the *why* is documented inline:

- **Single source of truth for derivation.** `src/lib/enrich.js` computes every
  derived field, and both the in-memory pipeline (`enrichRow` → `stats.js` →
  Recharts) and the DuckDB worker (`enrichForSql` → `queries.js`) call the same
  functions. This is the most important design decision in the codebase and it
  has held up well — the recent SLA recode touched one function (`computeSlaSop`)
  and both pipelines moved together.
- **Snapshot-anchored, deterministic queues.** The Update Queue / Solution
  Proposed / My Day surfaces compute against `meta.loaded_at`, not `Date.now()`,
  so a given upload always shows the same queue. This is the right call for a
  tool people screenshot into standups.
- **Privacy-respecting by construction.** Opaque analyst tokens in the URL,
  parameterized SQL, local-only processing, and a packaged Electron build that
  keeps the Jira token in OS-encrypted storage.

The dominant risks are **not** structural. In priority order they are:
**(1) no automated tests** behind numbers people make staffing and SLA decisions
on; **(2) a stalled dual-pipeline migration** that now costs performance in
production; **(3) statistical-correctness papercuts** on the Jira side; and
**(4) the app is read-only and passive** — it shows you the queue but never
pushes, reminds, or closes the loop.

Build: `npm run build` passes. Lint: pre-existing ESLint errors remain (unused
vars + `Date.now()`-in-render purity + "components during render"); none
introduced by the recent SLA work.

---

## 2. Recently shipped (context for this review)

- **SLA recoded to the Infor SOP response cadence** (2026-06). Every SLA metric
  now derives from `computeSlaSop()` — first-response target + per-priority
  update cadence, judged across the whole case life — instead of ServiceNow's
  first-response-only `Made SLA` flag. New per-row fields `_slaEligible` /
  `_slaBreached` / `_slaDueSop`; new baked columns `sla_breached` / `sla_due_sop`;
  `SCHEMA_VERSION` 4 → 5. See `MEMORY` and the README SLA section.
- **Electron desktop packaging.** A loopback server in the main process
  reimplements the Jira proxy + caches so the SPA runs unchanged off a
  double-click installer, with credentials in `safeStorage` (DPAPI).

Both are solid. Section 4 lists follow-ups specifically created by the SLA recode.

---

## 3. Codebase review — by area

### 3.1 The dual-pipeline migration has stalled (and now costs prod performance)

The in-memory and DuckDB pipelines were meant to converge, with the SQL side
eventually replacing the in-memory one (`DevCompare` overlays validate parity
during the migration). That convergence hasn't happened, and the half-state has
a real cost:

- **Dev-only SQL runs in production.** `Home.jsx:28`, `AccountsPage.jsx:14-15`,
  and `CategoriesPage.jsx:16` call `useQuery(...)` with `{ enabled: !!rows }` —
  *not* gated on `import.meta.env.DEV`. `DevCompare` renders `null` outside dev,
  so these DuckDB round-trips fire on every analyst/date change in production
  purely to be discarded. **Fix:** gate `enabled` on `import.meta.env.DEV`. Free
  win, confirmed still open.
- **Two percentile implementations** (see 3.2) and **two CSV-row builders** are
  a direct symptom of the unfinished migration.

**Decision to make:** either finish the SQL migration (move the headline KPI
pages onto `getKpis`/`getPriorityData` and delete the in-memory equivalents) or
declare the in-memory pipeline the product and delete the SQL KPI helpers +
`DevCompare`. Living in both is the most expensive option. Given that the
in-memory pipeline re-parses on load (so it never needs a rebuild) and the SQL
pipeline forces a "Rebuild needed" badge on every `SCHEMA_VERSION` bump, the
in-memory side is arguably the better product default for everything except the
Update Queue, which genuinely benefits from SQL.

### 3.2 Statistical correctness

The thing people trust most about this tool is the numbers, so these matter more
than their severity suggests.

- **Jira percentiles are biased high — still open.** `jira-enrich.js:204` and
  `jira-stats.js:26` both use `Math.floor((p/100) * sorted.length)` with no
  interpolation, while `stats.js` `percentile()` interpolates correctly. Every
  Jira median / p85 / p90 (cycle time, lead time, resolution-by-priority) skews
  upward. **Fix:** export the `stats.js` `percentile` and use it on both sides —
  this also kills one of the duplicate implementations.
- **SLA recode follow-ups (new this cycle).** The SLA verdict is now a per-case
  lifetime boolean aggregated over the filtered window. Two things to validate
  and one to add:
  - The trailing-gap check for *open* cases anchors to the snapshot; for *closed*
    cases it anchors to close time and counts the last-update→close gap as a
    breach. Confirm with a few known cases that this matches how managers expect
    closed work to be judged (a case that went quiet for >cadence right before
    resolution now counts as a breach — likely correct, worth confirming).
  - **Existing imports need a rebuild** to recompute the SQL columns
    (`SCHEMA_VERSION` 4→5). In-memory charts update on reload without a rebuild;
    the SQL-backed dev overlays do not. Make sure stakeholders know the SLA % they
    see in the Update Queue's SQL path is correct only after a rebuild.
  - **Have `computeSlaSop` return a `breachReason`** (`'initial' | 'cadence'`).
    Now that both fold into one number, analysts and managers will immediately
    ask "*why* did we miss — slow first touch or dropped cadence?" The data
    already knows; surfacing it is a small change with high explanatory value
    (see 4.1).

### 3.3 Performance & scale

- **`CaseTable` renders every row** with no virtualization (`CasesPage`). On a
  large export this is the biggest single UI-scalability risk; it also makes the
  full case register feel sluggish exactly when a manager is searching it.
  **Fix:** virtualize (e.g. windowing) or paginate.
- **Unmemoized `flatMap`** in several page wrappers re-allocates a large array
  each render (noted prior review).
- The dev-SQL-in-prod issue (3.1) is also a performance item.

### 3.4 No automated tests — the biggest gap

There is no test runner and no tests (`package.json` has no `test` script; the
only `*.test.js` files are inside `node_modules`). For a tool whose entire value
proposition is *trustworthy derived metrics*, this is the highest-leverage gap in
the codebase — and the SLA recode just raised the stakes, because the new cadence
logic is subtle (first-response vs cadence, open vs closed anchoring, the
no-update branch).

**Recommendation:** add Vitest and cover the pure core first — it's all pure
functions, so this is cheap and high-yield:

- `computeSlaSop` — table-driven cases: on-time, late first response, dropped
  cadence, closed-with-trailing-gap, dev 30-day rule, no-cadence (ineligible).
- `parseInforUpdates`, `classifyCase`, `parseJiraRefs`, `normalizeXlsxRow`.
- `stats.js` `percentile` (and use it to lock the Jira percentile fix).
- A parity test asserting `enrichRow` and `enrichForSql` produce the same SLA
  verdict for the same row + snapshot (the single-source-of-truth invariant).

### 3.5 Code quality / consistency (carry-forward)

- **Dead AI path in `TeamView` `MemberCard`** — wire `runMemberAi` to the button
  or delete the plumbing.
- **Duplicate helpers** — two `percentile`, two CSV-row builders, `DevKpiCompare`
  vs `dev/DevCompare`. Consolidate as the migration resolves.
- **Lint debt** — clear the pre-existing errors and add a CI lint gate so the
  count can't grow.

### 3.6 Accessibility (consistent gap)

Sortable `<th onClick>`, clickable `<tr>` rows, and heatmap tiles are mouse-only
(no `role` / `tabIndex` / `onKeyDown` / `aria-sort`), and several status cells
(SLA met/missed, risk buckets) signal by color alone. For a tool that may be used
by a wide internal audience, add keyboard handlers and a non-color signal
(icon/label) to status cells. The SLA cell in `CaseTable` now has a `title`
tooltip — extend that pattern.

---

## 4. Future iterations — making it better for analysts & managers

Framed by the job each persona is trying to do. Each item notes the **leverage**
(how much groundwork already exists), because several of the highest-value ideas
are cheap precisely because the plumbing is already there.

### 4.1 Make the numbers trustworthy *and* explainable

- **SLA breach reason split** *(analyst + manager)* — ✅ **shipped 2026-06-10.**
  `computeSlaSop` now returns `breachReason` (`'initial'` | `'cadence'`), exposed
  as `_slaBreachReason` and aggregated in `computeKpis` (`slaMissedInitial` /
  `slaMissedCadence`). The SLA page shows a "Why cases missed" composition bar
  (first response vs cadence) and the case register shows the reason per row.
  *(In-memory pipeline only — not baked into a SQL column, so no schema bump.)*
- **"Why is this case breaching?" on drilldown** *(analyst)*. In `CaseDrilldown`,
  show the cadence timeline: first response vs target, and each update gap vs the
  threshold, with the offending gap highlighted. **Leverage: high** — the update
  timeline is already parsed (`parseInforUpdates` now returns `times`).
- **Confidence/coverage notes** *(manager)*. Where a metric excludes rows (no
  cadence defined, no FRT recorded), show the eligible-vs-total count inline so a
  90% SLA on 30% of cases isn't read as 90% overall.

### 4.2 SLA & metrics *over time*, not just point-in-time

Today the SLA page is a single aggregate for the selected window. Managers
think in trends ("are we improving?").

- **SLA-trend line** *(manager)*. Plot weekly/monthly SLA% (and FCR, reopen,
  median resolution) over the dataset's span. **Leverage: medium** — the weekly
  bucketing machinery exists (`weeklyIntakeResolved`, `dailyTrajectory`); the new
  per-case `_slaBreached` can be bucketed by created/closed week the same way.
- **Snapshot-over-snapshot comparison** *(manager)*. The multi-import library
  already stores multiple uploads. Let managers pick *two imports* and diff the
  KPIs (this week's export vs last week's) — a true week-over-week without
  re-deriving from one file's internal window. **Leverage: medium-high** — imports
  are already persisted and individually queryable; this is mostly UI + a
  two-import KPI diff (the delta rendering already exists in `KpiRow`).

### 4.3 Close the data loop (connectors)

- **ServiceNow direct API connector** *(everyone)*. The Connections page already
  shows a placeholder card. Eliminating the manual CSV/XLSX export is the single
  biggest UX upgrade — fresher data, no re-upload ritual, and it unlocks
  scheduling/alerting (4.5). **Leverage: medium** — the Jira integration is a
  working template for a credentialed server-side proxy (dev-server middleware +
  the Electron loopback server); a ServiceNow table-API fetch can follow the same
  pattern, reusing `normalizeXlsxRow`/`enrichForSql` on the response.
- **CSAT / survey join** *(manager)*. The Surveys page + `SurveyPlaceholder` are
  stubs. Joining CSAT scores onto cases enables the analysis the prior review
  called out: **"SLA met but customer unhappy"** and CSAT-by-category/account.
  **Leverage: low-medium** — needs a data source, but the account/category join
  and the churn-risk scoring give it a home immediately.

### 4.4 Saved views & shareable reporting

- **Saved / named views** *(everyone)*. Filters already serialize to the URL
  (`useFilters`), so "My P1 backlog" or "Acme account, last 30d" is essentially a
  saved query string + a name in `localStorage`. **Leverage: very high** — this
  is nearly free and removes repetitive filter-setting.
- **Scheduled / emailed Monthly Summary** *(manager)*. The report is already a
  print-first one-pager. In the Electron build, the main process could render and
  email/save it on a cadence. **Leverage: medium** — report exists; Electron shell
  can run a scheduler and write to disk; email needs an SMTP/Graph path.
- **Exec deck export** *(manager)*. A structured "leadership summary" export
  (PNG/PPTX or a tighter PDF) beyond the current full-page print. **Leverage:
  medium** — `MonthlySummaryReport` is the content source.

### 4.5 From passive dashboard to active assistant

The tool currently shows the queue; it never *acts*.

- **Overdue/at-risk digest & notifications** *(analyst)*. A daily "you have N
  overdue updates, M due in 24h" — as an Electron desktop notification and/or an
  emailed digest. **Leverage: high** — `getUpdateQueue` already produces exactly
  these lists, snapshot-anchored; the Electron main process can schedule and
  notify.
- **Proactive churn-risk / SLA-dip alerts** *(manager)*. `accountChurnRisk`
  already ranks accounts by rising volume + falling SLA + open blockers; turn the
  top movers into an alert rather than a page you have to remember to open.
  **Leverage: high** — scoring exists.
- **Drill-everywhere** *(everyone)*. Many headline numbers (KPI cards, priority
  bars, risk buckets) aren't clickable. Make every number open the underlying
  case list. **Leverage: high** — `CaseDrilldown` is already built and used by the
  Update Queue and SLA Risk block; extend it to the KPI row and charts.

### 4.6 Team management & coaching

- **Per-analyst coaching packet** *(manager)*. `AnalystProfileModal` +
  `qualityMetrics` (FCR, reopen) + interaction quality already exist per analyst.
  Package them into a printable 1:1 sheet with period-over-period deltas — a
  ready-made coaching artifact. **Leverage: high** — all the components and metrics
  exist; this is composition + print styling.
- **Workload rebalancing hints** *(manager)*. The Workload page computes a Gini
  coefficient and aging-by-assignee. Turn the diagnosis into a suggestion ("move
  N aged P3s off the two most-loaded queues"). **Leverage: medium**.

### 4.7 Self-service configuration

- **In-app SOP threshold editing** *(manager)*. Thresholds live in
  `sop-thresholds.js` (code-only) — changing the SLA cadence today requires a code
  edit + rebuild. A Settings panel to edit cadence/first-response targets would
  make the tool self-serve as the SOP evolves. **Leverage: medium**, with one
  important caveat: thresholds are **baked at ingest** into the SQL columns and
  into `_slaBreached`, so changing them must trigger a re-derive (re-`enrichRow`
  for in-memory; "Rebuild" for SQL). Wire the setting to force that, or move the
  SLA verdict to query-time for the SQL path.
- **Configurable targets / goal lines** *(manager)*. The SLA color thresholds
  (95/85) and the 30-day "stuck" cutoff are hardcoded. Let a manager set the
  team's SLA target and render it as a goal line on the relevant charts.
  **Leverage: low**.

### 4.8 Polish

- **Virtualized case table** (also a perf item, 3.3) — makes the register usable
  on large exports.
- **Dark mode** — the theme is already centralized in `theme.js`/`T`.
- **Accessibility pass** (3.6).

---

## 5. Suggested sequencing

Ordered by value-to-effort. Quick wins first; bets last.

| # | Item | Persona | Effort | Leverage |
|---|---|---|---|---|
| 1 | Gate dev-only SQL behind `import.meta.env.DEV` (3.1) | — (perf) | XS | free |
| 2 | Vitest on `computeSlaSop` + enrich core + percentile (3.4) | trust | S | high |
| 3 | Saved / named views (4.4) | both | S | very high |
| 4 | SLA breach-reason split + drilldown timeline (4.1) | both | S | high |
| 5 | Fix Jira percentile bias + consolidate `percentile` (3.2) | manager | S | high |
| 6 | Drill-everywhere from KPI cards & charts (4.5) | both | S–M | high |
| 7 | Overdue/at-risk digest + desktop notifications (4.5) | analyst | M | high |
| 8 | SLA-trend-over-time + snapshot-vs-snapshot diff (4.2) | manager | M | medium-high |
| 9 | Per-analyst coaching packet (4.6) | manager | M | high |
| 10 | Virtualize `CaseTable` (3.3) | both | M | medium |
| 11 | Finish OR retire the dual pipeline (3.1) | — (debt) | M–L | structural |
| 12 | ServiceNow direct API connector (4.3) | everyone | L | medium |
| 13 | CSAT / survey join (4.3) | manager | L | medium |
| 14 | In-app SOP threshold config (4.7) | manager | M | medium |

The first five are days, not weeks, and several (1, 3, 4) ride on plumbing that
already exists. They also de-risk everything after them — #2 in particular, since
the SLA recode is fresh and currently unguarded by tests.

---

## 6. Risks & watch-items

- **SLA correctness depends on a rebuild.** Existing imports show "Rebuild
  needed" after the `SCHEMA_VERSION` 4→5 bump; the SQL pipeline's SLA columns are
  correct only after rebuilding. In-memory charts are correct on reload.
- **No tests** behind the metrics — see 3.4. This is the top non-security risk.
- **Security posture** is tracked separately in
  [`SECURITY_CONCERNS.md`](./SECURITY_CONCERNS.md). The items most relevant to a
  wider rollout: the AI proxy is not deployed (feature inert), the dev-server
  `/api/cache/*` + `/api/jira` routes have no origin/host/auth checks (#16), and
  there is no authentication (#11). Resolve these before any hosted/shared
  deployment; the Electron packaging already mitigates the credential-at-rest and
  CORS concerns for the desktop distribution path.
