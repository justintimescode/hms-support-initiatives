# Code Review — Unified Jira ↔ ServiceNow Correlation & Insight Layer (2026-08-24)

A feature review for the **Impact Clusters** layer (`/operations`): a bipartite
correlation engine over Jira keys and ServiceNow case numbers, emitted as
connected components and ranked by an explainable customer-impact score. It also
**consolidates** two pre-existing cross-source joins into that one engine, so the
Jira Blockers page and the Jira Statistics blast-radius table can no longer
disagree.

Complements the existing docs:

- [`PLAN(unified-insights).md`](<./PLAN(unified-insights).md>) — the Phase 0 plan, plus a §12 addendum recording three corrections real data forced.
- [`CODEREVIEW(solution-proposed.md`](<./CODEREVIEW(solution-proposed.md>) — the prior feature review (v10).
- [`CODEREVIEW(5-31).md`](./CODEREVIEW%285-31%29.md) — four of its open P1s are closed here.
- [`SECURITY_CONCERNS.md`](./SECURITY_CONCERNS.md) — #3 (URL leakage) and #7 (export injection) are the relevant invariants.

**Status.** `npm test` → **337 pass / 4 fail**; every tracked `src/lib` suite is
green (**336 pass / 0 fail**) and the 4 failures are the pre-existing untracked
root scratch Playwright scripts. `npm run lint` → **18 problems, 16 in `src/`** —
down from the 19 `src/` baseline, with **zero new**. `npm run build` → exit 0.
Verified in the browser against a real 3,069-row ServiceNow export with a live
Jira cache: zero page or console errors on `/operations`, `/jira-blockers` and
`/jira-stats`, and the CSV exports downloaded and inspected.

**No schema change.** `SCHEMA_VERSION` stays `'12'`. Jira issues never reach
DuckDB, `queries.js` has no Jira join to extend, and every new derived field is
in-memory only. Nothing shows "Rebuild needed" — with one caveat in §7.

---

## 1. What shipped

| Area | File | Change |
|---|---|---|
| Thresholds | `src/lib/insight-thresholds.js` _(new)_ | Every weight, cap, band and enum, each with the reason it holds its value. |
| Engine | `src/lib/correlate.js` _(new)_ | Union-find connected components over abstract `{side, id, data}` nodes. **Imports nothing**; names no field from any source. |
| Adapters + metrics | `src/lib/insight-metrics.js` _(new)_ | The only source-aware module: SN/Jira → graph, `normalizePriority`, snapshot-anchored ages, escalation derivation, metric rollups. |
| Ranking | `src/lib/insight-rank.js` _(new)_ | `scoreCluster` + `factors`, bands, both named risk predicates, deterministic narratives, the `buildInsights` facade, `blockersByJira`. |
| Filters | `src/lib/insight-filters.js` _(new)_ | Dimension registry, cluster selectors, facets/drill-down, heatmap + age-comparison selectors, opaque URL tokens. |
| Export | `src/lib/insights-csv.js` _(new)_ | Cluster-level and case-level CSV, routed through the injection guard. |
| Page | `src/pages/OperationsPage.jsx` _(new)_ | Route, correlate-once memo, URL-backed filters, KPIs, exports. |
| Components | `src/components/insights/` _(new, 4 files)_ | `ClusterCard`, `ClusterRecordList`, `InsightCharts`, `OperationsFilterBar`. |
| **Consolidation** | `src/lib/jira-stats.js` | `blastRadius` is now a **thin projection** over the shared engine, not its own join. Local biased `percentile` deleted. |
| **Consolidation** | `src/components/jira/JiraDashboard.jsx` | The private `ticketGroups` memo and its `cases.length * 2 + …` impact formula **deleted**; reads the shared engine. Snapshot-anchored throughout. |
| Ingest fix | `src/lib/useAppData.js` | `readXlsxRows`: a repeated header keeps the **first** column (see §4). |
| Ingest fix | `src/lib/enrich.js` | `normalizeXlsxRow` maps `Region` and `Assignment group` (see §5). |
| P1 fixes | `src/lib/jira-enrich.js` | One shared `percentile`; `Math.max(...)` → `reduce`; `STALE_DAYS` exported. |
| Call sites | `src/pages/JiraStatsPage.jsx`, `src/pages/JiraBlockersPage.jsx` | Pass `snapshotMs` / live issues; the local raw-keyed issue map is gone. |
| Nav + route | `src/App.jsx`, `src/components/layout/AppLayout.jsx` | `/operations` → "Impact Clusters", in the **Jira** nav group. |
| Tests | 7 files _(new)_, ~2,820 lines | 188 new tests across the engine, metrics, ranking, filters, CSV, the migration equivalence proof, and XLSX ingest. |

~2,220 lines of new pure logic; ~2,820 lines of tests.

---

## 2. The consolidation, and what it cost

Three implementations of "which Jira is hurting which cases" existed:

1. `jira-stats.js` `blastRadius` — per-key counts, hand-rolled.
2. `JiraDashboard.jsx` `ticketGroups` — its own grouping AND its own impact
   formula, `cases.length * 2 + priorityWeight + min(20, oldestDays / 7)`.
3. Nothing shared between them, so the same ticket could rank differently on two
   screens.

Both now project the one engine. `blastRadius` reshapes a `blockersByJira` row
into the **exact legacy field names**, so `blastRadiusSummary`,
`openCasesHistogram`, `staleWithImpact` and `fixVersionPipeline` were not touched.

**What this cost, stated plainly:** the "Tickets blocking multiple cases" ordering
on `/jira-blockers` **changes**. The old formula let raw case count swamp
everything — a 20-case cluster of quiet P4s outranked a 2-case cluster with a live
customer escalation. Every term in the replacement is capped, so 500 quiet cases
cannot reach the `high` band on volume alone (asserted by test). That is the point
of the feature, not a regression, but it is a visible change and it was flagged as
open question **O3** in the plan before it was made.

`jira-stats.migration.test.js` carries a **reference oracle** — the
pre-migration `blastRadius` body verbatim, with only its `Date.now()` replaced by
the fixed anchor — and asserts the projection matches it `deepStrictEqual`, field
for field, including the per-key case lists.

---

## 3. Numbers that changed, and why

Nothing moved silently. Every difference below is asserted by a test.

| Surface | Change | Cause |
|---|---|---|
| `/jira` and `/jira-stats` Jira medians, p85, p90 | **shift downward** | **P1 #1.** Two copies of `percentile` used `Math.floor((p/100) * len)`, biased high — for `[1,2,3,4]` it returned `3` where the interpolating `stats.js` helper returns `2.5`. Both copies deleted. |
| `/jira-blockers` "Days linked", "Avg days linked", "Oldest blocker", "Days open" | shift by (today − snapshot) | Snapshot-anchored. `_jiraDaysSinceLinked` is wall-clocked in `enrich.js` despite `enrichRow` receiving `snapshotMs` (**C7**, a sixth `Date.now()` that was on no review list). The layer recomputes from `_jiraFirstLinked`. |
| `/jira-stats` "Days idle", per-case "Days open" | shift by (today − snapshot) | Same, plus **P1 #5**: `enrichIssue` caches wall-clock `_ageDays`/`_isStale`, which the projection now ignores. |
| `/jira-blockers` impact ordering | reorders | §2. Deliberate. |
| `/jira-stats` blast radius, **tied** rows only | may reorder | The old sort had no final tiebreak, so ties fell back to Map insertion order (i.e. row order). Ties now break on `key`, which is what makes a screenshot or CSV reproducible. No count changes. |
| Case numbers, on exports with a repeated `Number` header | **corrected** | §4. |
| Nothing else | — | Every DuckDB-backed surface is untouched. |

**P1 #2 was latent, not live.** The plan (§1 C2) states this with evidence:
`parseJiraRefs` already uppercases on all three paths and its regexes cannot
capture whitespace, so `blastRadius` / `mergeJiraIntoRows` were not mis-joining.
The normalization shipped anyway as boundary hardening, and it is what makes a
future adapter safe — but it is described here as hardening rather than as a fix
for numbers anyone was reading wrong.

---

## 4. A defect nobody had logged: duplicate XLSX headers replaced every case number

Found by driving the app against a real export rather than by reading code.

The standard ServiceNow case export ships the header `Number` **twice** — column 1
is the case number (`CS1887438`), a later column is the account number
(`ACCT9000004`). `readXlsxRows` walked columns left→right assigning
`obj[header] = value` unconditionally, so the **last occurrence won** and every
row's `number` became an account number.

Consequences, all live before this change:

- Case numbers wrong everywhere they are displayed, copied, or written to CSV.
- Non-unique React keys — the observed *"Encountered two children with the same
  key"* warnings (11 of them on `/jira-blockers`; **0** now).
- For this feature: distinct cases sharing an account would have **collapsed into
  one correlation node**, silently undercounting blast radius.

Fixed: the **first** occurrence of a repeated header wins. Positional, not
truthiness-based — "prefer whichever cell is non-empty" would let different *rows*
of one file resolve to different columns, which is a worse failure than a visible
null. `enrich.xlsx-ingest.test.js` covers it with an in-memory workbook, and
`buildGraph` additionally reports `duplicateCaseNumbers` so the remaining failure
mode is visible rather than quiet; the page renders a warning card when it fires.

---

## 5. `Region` and `Assignment group` exist after all

The task brief stated, and the plan's §1 C5 repeated, that neither column exists
in any ServiceNow export layout, and both were shipped in Phase 1 as
*declared-but-unavailable*.

Inspecting a real export disproved it. The header row contains `Region` (e.g.
`"NA"`), `Assignment group` (e.g. `"Hospitality - HMS Support"`), and also
`Country` and `City`. They were invisible only because `normalizeXlsxRow` never
mapped them.

Both are now mapped as raw passthroughs — the documented `parent_account` / `tags`
treatment: no SQL column, no schema bump, carried on the in-memory row — and are
**ordinary dimensions** whose `available` flag resolves from the active import
like every other one. Neither is ever aliased onto `parent_account` or `manager`;
that non-conflation is asserted by test. `Country` / `City` are left as a
follow-up rather than added speculatively.

Plan open question **O1 is withdrawn.**

---

## 6. Self-critique pass (adversarial)

Written by re-reading the layer looking for reasons it is wrong, not for reasons
it is good. Findings F1–F4 were found this way and fixed; F5–F9 are live
limitations.

### F1 — My own engine had the exact bug I spent Phase 2 fixing *(fixed)*

`projectCase` emitted the **raw** `row.number`, while the graph keys case nodes by
`normalizeKey(number)` — so `Insight.caseNumbers[]` and `Insight.edges[].caseNumber`
lived in two different value spaces. `blockersByJira` joins those two
(`caseByNumber.get(e.caseNumber)`), so for a non-canonical case number the join
found nothing and the row reported **`cases: 0`, `totalCases: 0`** for a ticket
that had one. A silent undercount to zero — the same failure mode as P1 #2, in the
module written to prevent it.

It did not bite real data (ServiceNow case numbers are canonical `CS…`) and the
migration oracle missed it because every fixture used canonical numbers. Fixed by
normalizing in `projectCase`; two regression tests now assert the two arrays are
joinable and that a padded/lowercased number does not vanish.

### F2 — Facets recomputed on every keystroke *(fixed)*

`facetsOf` was passed to the filter bar as a live callback and called per
dimension **per render**, including on every character typed into the search box.
Measured 7 ms on the real import but **80 ms across 15 dimensions on a 20k-case
one**. Now memoized once per correlation.

### F3 — The histogram re-scored every ticket to draw five bars *(fixed)*

`ImpactHistogramBlock` called `blockersByJira`, which runs the full `scoreCluster`
pass for every key, on every filter change — 10 ms real, **139 ms at 20k cases** —
to obtain data it does not use. Added `openCasesPerJira`, a scoring-free grouping
with the same `openCases` definition. Per-filter-change cost went from ~17 ms to
**5 ms** (real) and ~219 ms to **45 ms** (20×).

### F4 — I left two dev servers running and clobbered tracked artifacts *(fixed)*

A `pkill` did not take, so a later `vite` auto-incremented to port 5174. With
those servers up, `npm test` ran the untracked root scratch Playwright scripts
*successfully*, and those scripts screenshot to `tab-statistics.png`,
`app-state-1.png` and three siblings — which are **tracked** verification images.
They were overwritten. Both processes stopped, all five files restored via
`git checkout`. It also briefly made `npm test` read 338/1 instead of 335/4; that
was the phantom servers, not an improvement.

*Worth a follow-up on the repo itself:* those four scratch scripts are picked up
by `node --test` **and** write into tracked paths, so any run with a dev server up
dirties the working tree. They should be renamed out of the test glob or moved to
`scripts/`.

### F5 — `CaseDrilldown` was not reused, contrary to the brief

The brief asked for it, noting `jira-enrich.js` deliberately emits ServiceNow-style
aliases for exactly that purpose. I declined: `CaseDrilldown` derives its Age
column from `Date.now()` (via `format.js` `ageDays`) and expects raw enriched
rows. Reusing it would have placed a wall-clocked number beside a page of
snapshot-anchored ones — a visible discrepancy on any import older than today, in
the view whose entire premise is that one upload always renders identically. The
replacement (`ClusterRecordList`, 192 lines) reads the already-anchored
projections and reuses every other primitive (`Card`, `Pill`, `CopyableNumber`,
the `T` tokens). **This is a real deviation and a reviewer may reasonably prefer
the reuse**; the honest trade is 192 lines of duplication against one wrong column.

### F6 — Cluster metrics ignore the filter, on purpose, and that can read oddly

Per plan Decision 6, a cluster survives when **one** member matches and its
metrics still describe the **whole** cluster. So filtering to one analyst can show
a card reading "blocking 5 open cases" when only one of those cases is theirs. The
alternative — recomputing metrics on the filtered subset — makes "distinct
accounts affected" understate real blast radius, and a number whose meaning
changes when you filter is a number a manager cannot act on. Mitigated by an
explicit *"N of M cases match your filter — the numbers above describe the whole
cluster"* chip, but it is a genuine readability cost, not a solved problem.

### F7 — Charts are mouse-only

The heatmap cells are real `<button>`s with `aria-label`s and keyboard focus. The
three Recharts bar charts are not: `onClick` on a `<Bar>` has no keyboard
equivalent, and the factor-chip explanations are `title` tooltips. This inherits
the repo-wide accessibility gap already logged in `CODEREVIEW(5-31).md` P3 rather
than fixing or worsening it — but the new page adds four more instances of it.

### F8 — Two ceilings that are honest but still ceilings

`RENDER_LIMIT = 60` caps the rendered cluster list; the page says so and points at
the CSV, which contains all of them. The dimension filter bar shows the top 8
facet values per dimension and says `+N more (narrow with search)`. Both are
disclosed rather than silent — the rule from the brief — but a user with 300
clusters still cannot scroll to #61.

### F9 — "Escalation" is derived, and the word invites over-trust

There is no native escalation field. The enum composes explicit
`sentiment_escalated` events, SOP-SLA breaches, `sentiment_risk` against
`sentiment.js`'s validated bands, and Jira staleness. Every level ships its
contributing reasons, and the chart subtitle says the level is derived — but a
reader who sees "escalated" may still hear "someone filed an escalation in
ServiceNow". The `escalated` level *does* require a real escalation event; `at-risk`
and `watch` do not, and that distinction rests on the user reading the reasons.

### Also considered and deliberately left alone

- **`enrich.js:414`** `Math.min(...linkedDates)` — bounded by tickets-per-case, and
  editing `enrich.js` risks baked-value/parity churn for no real gain.
- **A lowercase `cause` reference** (`hms-12345`) still yields **no ticket at all**,
  because `JIRA_ID_ANY` is uppercase-only. Normalizing the lookup cannot fix that;
  it needs a relaxed regex, which risks turning prose tokens into phantom tickets.
- **P1 #5 globally.** Fixed *in this layer* per the brief's instruction. `/jira`
  and `/jira-stats` still read `enrichIssue`'s cached wall-clock ages through six
  other `Date.now()`-based helpers. That is a broader, separately-reviewable change.
- **The optional per-cluster LLM deep-read** was pre-scoped as cut-first (plan
  Decision 11 / O5) and is cut. The page is fully useful with no proxy configured.

---

## 7. The one open decision

**`SCHEMA_VERSION` was not bumped, and that leaves a sharp edge.** `number` is a
baked SQL column, so an import created *before* the §4 fix still holds account
numbers there. Without a bump those imports are not flagged, so they keep their
wrong case numbers until someone manually rebuilds them.

Bumping corrects every import at the cost of one forced "Rebuild needed" for
everyone. The brief was emphatic about not forcing that, so the conservative
choice shipped — but wrong case identifiers in an exported CSV are arguably worse
than a rebuild prompt. **This is a product call and it is still open** (plan
open question **O6**).

---

## 8. Security

- **#7 export injection.** Both CSV builders route every cell through
  `rowsToCsv` → `toCsvRow` → `sanitizeCellForExport`. There is no local escape
  helper — the failure mode that shipped a live hole once already. Tested with
  `=cmd|'/c calc'!A1`, `+HYPERLINK(...)`, `@SUM(...)` and a comma/quote/newline
  torture string; the test asserts each payload appears **only** in guarded form
  and never bare. Numeric cells are deliberately left alone (Excel parses `-30` as
  a number, not a formula) and the test scopes itself to strings for that reason.
- **#3 / #8 URL leakage.** View-local dimension filters serialize as **opaque
  index tokens** (`?od=account:3`), so no account name, region or assignment group
  reaches the URL — going further than `useFilters`, which does this for analyst
  and manager. Those two dimensions are marked `globalOnly` and are never offered
  by the view-local bar, so a person's name cannot leak through the new surface.
  An unresolvable token is ignored, never guessed at.
- **#1 AI seam.** Nothing on this page contacts a model. Sentiment is read from
  the baked columns; narratives are templated from structural facts.
- **#10 raw HTML.** No `dangerouslySetInnerHTML` anywhere in the new code.

---

## 9. Test coverage

188 new tests, 7 files, all with a fixed `SNAP` anchor and no wall clock.

| File | Covers |
|---|---|
| `correlate.test.js` | 1→N, N→1, transitive N↔M, isolation, key normalization, determinism under input permutation, stable ids, a 5,000-case cluster and a 2,000-node chain (no spread, no recursion), dangling-edge reporting, and a **source scan** asserting the module reads no clock, imports nothing, and names no source field. |
| `insight-metrics.test.js` | The full priority table both ways incl. `unknown → null` and the `priorityRank` 99 sentinel; bucket boundaries; `daysLinked` null-never-0; mention/`RN-` edge rules; poisoned cached `_ageDays` ignored; escalation levels and near-misses; null-risk skipped not zeroed; duplicate-case-number guard. |
| `insight-rank.test.js` | `score === clamp(Σ factors)` incl. a case that forces the clamp; caps; band boundaries at the exact thresholds; both risk predicates with each conjunct dropped in turn; narrative determinism and no un-substituted token; per-key projection attribution; the F1 value-space regression. |
| `insight-filters.test.js` | **Identity preservation** (the proof that filtering never re-correlates); facet↔drill-down reconciliation for every dimension; availability resolution; region/assignmentGroup non-conflation; heatmap rectangularity; opaque-token round-trip and every malformed-token case. |
| `insights-csv.test.js` | Injection guard, "Not linked" as a word, per-case linkage attribution, determinism, header-only empty document. |
| `jira-stats.migration.test.js` | The **reference-oracle equivalence proof**, downstream consumers unchanged, snapshot anchoring, and the documented percentile shift. |
| `enrich.xlsx-ingest.test.js` | Duplicate-header first-wins, case-number uniqueness, the newly mapped columns. |

**Not covered by automated tests:** every React component. The repo has no
component-test harness (no jsdom, no testing-library) and adding one was out of
scope, so the UI was verified by driving the real app headlessly instead — see
§10. Component logic is deliberately thin: the pure modules are tested, and the
components render finished data.

---

## 10. Verified in the browser

Playwright, `reducedMotion: 'reduce'`, client-side navigation, a real 3,069-row
export uploaded through the actual file input (the disk mirror is opt-in and off,
so nothing restores on boot — an earlier run that appeared to load data was a
false positive on my readiness check).

- `/operations`, `/jira-blockers`, `/jira-stats`: **zero page and console errors**;
  **zero** duplicate-React-key warnings (11 before §4).
- Score explainability visible on screen: chips `+30 / +20 / +15` summing to the
  displayed **65**.
- Narrative: *"RN-9723586 is blocking 10 open cases across 9 accounts. The oldest
  case (CS1884265) has been open 1d. 3 cases have missed the SOP SLA."*
- `Region` (APJ 9 · NA 9 · EMEA 8) and `Assignment group` facets populated with
  real values; the honest-absence note correctly lists `Parent account` (this
  export has no such column) and the five Jira-side dimensions (these clusters are
  all `RN-` keys, so there is no live join).
- Unknowns render as unknowns: "Oldest Jira —", "Age delta — unknown".
- URL token round-trip (`/operations?ob=high`), drill-downs, histogram
  click-through, and search all exercised.
- CSV downloads captured from the browser and inspected: 26 and 40 rows, BOM
  present, **zero unguarded formula cells**.

**Worth knowing about this dataset:** nearly every *asserted* Jira link in it is
an `RN-` ServiceNow Resolution Notes reference; the `HMS-` references are mostly
free-text mentions, correctly excluded. So the blast-radius and impact tables are
dominated by `RN-` records with no live Jira data. That is what made the Phase 1
edge-rule correction (plan §12 A) consequential rather than theoretical — the top
row of the Blockers table, `RN-9721586` with 10 cases across ~12 accounts, would
have vanished.

---

## 11. Performance

`PERF_BASELINE.md` §3's finding drove the design: the aggregation layer is ~5 ms
while per-row enrichment is ~664 ms, so correlation is computed **once** in a memo
keyed `[enrichedAllJoined, jiraIssueMap, snapshotMs]` — filters are **not** in that
key — and every filter selects from the result.

Measured outside the browser, medians of repeated runs:

| | 11,098 issues × 951 cases *(the real import)* | 20,000 × 20,000 |
|---|---|---|
| `buildInsights` (once per import) | **23 ms** | 295 ms |
| facets, all dimensions (once per import) | 13 ms | 188 ms |
| **per filter change** | **5 ms** | 45 ms |
| `clustersToCsv` | 8 ms (561 KiB) | 42 ms |

Budget was ≤150 ms for the real import; correlation lands at 23 ms. Correlation is
also **time-independent** by construction — who links to what does not depend on
when you ask — which is why `snapshotMs` only enters the projections. A 5,000-edge
single cluster and a 2,000-node transitive chain both complete without a spread or
a stack overflow.

Lint discipline held: no `Date.now()` in any render body, no components defined
during render. The three `react-hooks/purity` errors previously in
`JiraDashboard.jsx` are **gone** as a side effect of snapshot-anchoring it, taking
`src/` from 19 to 16.

---

## 12. Manual QA checklist

Needs a real export loaded via Connections, ideally with Jira synced.

- [ ] `/operations` with **no** import → honest empty state, no crash.
- [ ] With an import but **no** Jira sync → clusters still appear (the link lives
      in the ServiceNow case), Jira-side dimensions report unavailable.
- [ ] Global analyst / manager / date filters narrow the cluster list; each card
      shows "N of M cases match your filter".
- [ ] A view-local filter puts `?od=…` / `?ob=…` in the URL; copy the URL into a
      new tab against the same import and the view reproduces.
- [ ] Every chart segment and heatmap cell opens onto a real record list whose
      length matches the number clicked.
- [ ] Both CSV exports open in Excel with no formula prompt and correct
      non-ASCII account names.
- [ ] `/jira-blockers` and `/jira-stats` still render; spot-check that case counts
      match the pre-change values and that only the ordering moved.
- [ ] Dark mode and `prefers-reduced-motion`.

---

## 13. Follow-ups, highest value first

1. **Decide O6** (§7) — bump `SCHEMA_VERSION` so pre-fix imports are flagged for
   rebuild, or accept that they carry account numbers in `number` until rebuilt.
2. **Fix P1 #5 globally** — thread `snapshotMs` into `enrichIssue` and the six
   `Date.now()`-based helpers in `jira-enrich.js` / `jira-stats.js`, so `/jira` and
   `/jira-stats` stop reporting stale ages.
3. **Move the four root scratch scripts** out of the `node --test` glob (F4) — they
   dirty tracked screenshots whenever a dev server is up.
4. **Map `Country` / `City`** (§5) if geography beyond Region is wanted.
5. **Keyboard access for chart click-through** (F7), ideally as one repo-wide fix
   rather than per page.
6. **Relax the `cause`-field regex** for lowercase ticket references, with a
   false-positive study first.
