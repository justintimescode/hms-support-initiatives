# PLAN — Solution Proposed: stop the cadence clock, add auto-close countdown

> **Superseded on the auto-close anchor (see `CODEREVIEW(solution-proposed.md)` §3).**
> This first-iteration plan anchored the countdown to "last activity (any author)"
> (`last_activity_ms`). Per a later domain caveat, the auto-close clock now starts at
> the **resolution-notes-saved time** (`resolved_at_ms` = the `<b>Resolution notes</b>`
> journal marker), system "auto-close reminder" notes are ignored, and System
> auto-reminder "(Infor)" notes are excluded from cadence/interaction counts. The SLA
> cadence design below (three clock-stops) is unchanged.

_Phase 0 (GATE 0) deliverable. Grounded in a full read of `enrich.js`,
`queries.js`, `stats.js`, `sop-thresholds.js`, `db.worker.js`,
`SolutionProposedQueuePage.jsx`, `UpdateQueue.jsx`, `UpdateQueuePage.jsx`,
`AppLayout.jsx`, `App.jsx`, `format.js`, `csv-export.js`,
`enrich.sentiment.test.js`. Stop point: awaiting approval before Phase 1._

Branch: `feat/case-sentiment-grader` (the sentiment work, v9, is already
committed here — relevant to the version bump below).

---

## Decision 1 — SLA treatment of Solution Proposed: **STOP THE CLOCK** (recommended)

In `computeSlaSop`:

- `end = isClosed ? (closedMs ?? snapshotMs ?? Date.now())`
  `: isSolutionProposed ? (lastActivityMs ?? createdMs)`
  `: (snapshotMs ?? Date.now())`
- `dueSop = null` when `isClosed || isSolutionProposed` (was: set whenever
  `!isClosed`).

Effect: a Resolved case idling to the snapshot no longer accrues a trailing-gap
cadence breach and drops out of at-risk / overdue / forecast / stuck. BUT we keep
judging what happened **before** resolution:
- a real **inter-update gap** between two pre-resolution Infor updates still
  breaches (`ts[i] - ts[i-1] > cadence` is checked regardless of `end`);
- a missed **initial response** still breaches (`breachReason = 'initial'`);
- the case is **still `sla_eligible`** (it has a cadence threshold) — it just now
  usually passes, so SLA % rises (intended).

**Not chosen:** full exemption (`eligible = false`). Rejected because it would
also drop initial-response and pre-resolution cadence misses out of the
denominator, overstating SLA. We only want to stop the *trailing-idle* breach.

## Decision 2 — "Last update" = **journal-max** (recommended)

`lastActivityMs` = latest timestamp across **all** journal entries (every author)
from the existing `WORK_NOTE_HEADER` scan over `work_notes`, else `null`.
Implemented as a small pure helper `parseLastActivity(text)` beside
`parseInforUpdates`.

- Auto-close anchor falls back to `created_at` when the journal has no parseable
  entry (per the test "null-journal resolved case falls back to created").
- Uses `work_notes` per the task contract. In the real XLSX export `work_notes`
  and `additional_comments` map from the same source column, so this agrees with
  the cadence engine's `additional_comments` timeline; for header-less / disjoint
  CSVs a negative `end - ts[last]` simply never breaches (safe).
- The field map exposes **no** `sys_updated_on` / `Updated` column, so we do not
  wire one up. **Modeling assumption** to surface in the UI subtitle + README:
  ServiceNow's real auto-close anchor is instance-configured; we approximate it
  with the last journal activity measured against the data-as-of snapshot. (If a
  future field-map change adds an explicit updated timestamp, prefer it via
  `max(explicit, journalMax)` in both pipelines.)

---

## Schema / column changes

- **New SQL column (the only one): `last_activity_ms BIGINT`.** Appended **last**
  in both `SQL_COLUMNS` (`enrich.js`) and the `CASES_COLUMNS` DDL
  (`db.worker.js`). The Arrow insert binds **by position**, so appending leaves
  every existing column's slot untouched. `auto_close_at_ms` is **not** stored —
  it's derivable from `last_activity_ms` + snapshot in the page query (fewer
  columns, single source of truth for the constant).
- **`SCHEMA_VERSION` `'9'` → `'10'`.** v9 (sentiment grader) is already committed
  on this branch, so this is a *separate* bump, not a shared one. Add a `// v10:`
  changelog comment covering: cadence clock-stop for Solution Proposed,
  `sla_due_sop` now null for them, and the new `last_activity_ms` column. Old
  imports (v9) get the "Rebuild needed" badge and re-grade on rebuild.
- New constant `SOLUTION_PROPOSED_AUTOCLOSE_MS = 90 * 24 * 60 * 60 * 1000` in
  `sop-thresholds.js` (no magic numbers in logic).
- In-memory `enrichRow` exposes `_lastActivity` (Date|null = journal-max) and
  `_autoCloseAt` (Date|null, Solution-Proposed only =
  `(lastActivityMs ?? createdMs) + SOLUTION_PROPOSED_AUTOCLOSE_MS`).
- `enrich.sentiment.test.js` asserts `SCHEMA_VERSION === "9"` → update to `"10"`
  (and its test title). Only existing test referencing the version.

**Parity** (fields differ by key/type between pipelines, so the test maps them):
`row._slaEligible === sql.sla_eligible`, `row._slaBreached === sql.sla_breached`,
`(row._slaDueSop?.getTime() ?? null) === (sql.sla_due_sop?.getTime() ?? null)`,
`(row._lastActivity?.getTime() ?? null) === Number(sql.last_activity_ms ?? NaN)`
(treating null≡null).

---

## Files per phase

### Phase 1 — SLA logic (risky core)
- `src/lib/sop-thresholds.js` — add `SOLUTION_PROPOSED_AUTOCLOSE_MS`.
- `src/lib/enrich.js` — add `parseLastActivity`; extend `computeSlaSop`
  (params `isSolutionProposed`, `lastActivityMs`; new `end`/`dueSop` rules;
  updated JSDoc); thread them through **both** `enrichRow` and `enrichForSql`;
  expose `_lastActivity`/`_autoCloseAt` (in-memory) and `last_activity_ms`
  (SQL, `BigInt | null`); append `last_activity_ms` to `SQL_COLUMNS`; bump
  `SCHEMA_VERSION` + `// v10:` note.
- `src/workers/db.worker.js` — append `last_activity_ms BIGINT` to
  `CASES_COLUMNS`; add a defensive `ALTER TABLE … ADD COLUMN IF NOT EXISTS
  last_activity_ms BIGINT` in `legacyMigrateIfNeeded` (consistent with the
  existing `sla_breached`/`sla_due_sop`/`lifecycle` ALTERs).
- `src/lib/enrich.sentiment.test.js` — version assertion `"9"` → `"10"`.
- **NEW** `src/lib/enrich.sla-solution-proposed.test.js` (`node --test`): the 7
  task cases — (1) Resolved, last update 40d pre-snapshot, P3 → no cadence
  breach + `_slaDueSop === null`; (2) Resolved missing initial response → still
  breached (`initial`); (3) Resolved with a >cadence gap between two
  pre-resolution Infor updates → still breaches (`cadence`); (4) regression: an
  `open` case unchanged (trailing gap still judged, `_slaDueSop` set); (5)
  parity of `sla_eligible`/`sla_breached`/`sla_due_sop`/`last_activity_ms`; (6)
  auto-close = `last_activity_ms + 90d`, sign of countdown vs snapshot correct;
  (7) null-journal resolved case → auto-close anchored to created.

### Phase 2 — replace the tab + remove dead plumbing
- `src/lib/queries.js` — add `getSolutionProposedAutoClose({ analyst,
  snapshotMs })`: `WHERE SQL_SOLUTION_PROPOSED [AND assigned_to = ?]`, returns
  number / account / priority / priority_rank / assigned_to / short_description /
  the last-activity anchor (`coalesce(last_activity_ms, epoch_ms(created_at))`) /
  `auto_close_at_ms = anchor + 90d` / `days_remaining = (auto_close_at_ms −
  snapshotMs)/86400000`, **anchored to `snapshotMs`** (no `now()`), ordered
  soonest-to-close first, nulls last. Remove `statusEquals`/`includeClosed`
  params + their branch from `getUpdateQueue`. **Keep** `SQL_SOLUTION_PROPOSED`
  (used by `getKpis` + the new query).
- `src/pages/SolutionProposedQueuePage.jsx` — rewrite (same filename/route) as
  the analyst-scoped auto-close countdown: `Section` + honest subtitle;
  sortable, keyboard-accessible table (Case, Priority pill, Account, Last update
  `fmtFullDate`, Auto-closes `fmtFullDate`, Time remaining `fmtDuration` with
  urgency color — danger ≤7d/past, warn ≤30d, else normal); counts ("closing
  within 7 / 30 days"); empty state; CSV via `rowsToCsv`/`downloadCsv`/
  `csvTimestamp` (`csvName="solution-proposed-auto-close"`); reduced-motion safe.
- `src/pages/UpdateQueue.jsx` — remove `statusEquals`/`includeClosed`; since the
  only remaining caller (`UpdateQueuePage`) passes all-defaults, inline the
  defaulted-only props (`title`/`subtitle`/`showInitialResponse`/`csvName`) and
  drop the stale "generalized for a second tab" comment. Plain `/update-queue`
  behavior unchanged.
- `src/lib/sop-thresholds.js` — drop `SOLUTION_PROPOSED_STATUS` (now unused).
- `src/components/layout/AppLayout.jsx` — keep the nav entry + path; swap icon
  `ClipboardCheck` → `Timer` (lucide-react) to signal a countdown.

### Phase 3 — verify, regress, document
- Full green `npm run test` / `lint` / `build`; SLA regression spot-check on a
  real export; manual QA checklist of the new page.
- **NEW** `CODEREVIEW(solution-proposed.md)` in the repo review-note style.
- `README.md` — update the `getUpdateQueue` row (~L509, no more
  statusEquals/includeClosed) and any SOP note implying Solution Proposed owes
  cadence updates; document the auto-close countdown + Decision-2 assumption.

---

## Downstream SLA surfaces (baked-field reads only — no code change expected)

`stats.js computeKpis` (slaRate/slaMet/slaEligible/slaMissedCadence; at-risk &
breached gate on `_isOpen`), `queries.js getKpis` (`sla_rate`, `at_risk_count`,
`breached_count` gate on `SQL_OPEN`), `slaRiskSegments` / `agingBuckets` /
`stuckCases` / `slaBreachForecast` / `openByAssigneeAge` / `accountChurnRisk`
(all gate open-work on `_isOpen`), and the read-only consumers `KpiRow` /
`SlaBlock` / `SlaRiskBlock` / `SlaForecastBlock` / `StuckCasesList` /
`AnalystProfileModal` / `TeamView` / `MyDayPage` / `MonthlySummaryReport` /
`CaseTable` per-case SLA cell. Solution-Proposed already gates out of every
open-only surface via `_isOpen` / `SQL_OPEN`, and now also carries
`sla_due_sop = null` + (usually) no breach. To be re-verified by grep at GATE 1.
