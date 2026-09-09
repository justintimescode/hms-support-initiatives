# PLAN — Unified Jira ↔ ServiceNow Correlation & Insight Layer

_Phase 0 (GATE 0) deliverable. Grounded in a full read of `README.md`
(Architecture / Jira Integration / Customer Sentiment / Data Enrichment /
DuckDB), `enrich.js`, `jira-enrich.js`, `jira-stats.js`, `JiraDashboard.jsx`,
`sentiment.js`, `stats.js`, `constants.js`, `sop-thresholds.js`, `useAppData.js`,
`useFilters.js`, `App.jsx`, `AppLayout.jsx`, `nav.js`, `JiraStatsPage.jsx`,
`JiraBlockersPage.jsx`, `InsightsPage.jsx`, `SentimentPage.jsx`,
`CategoriesPage.jsx`, `CaseDrilldown.jsx`, `AiEffectivenessBlock.jsx`,
`SentimentDeepRead.jsx`, `csv-export.js`, `sentiment-export.js`, `ai-client.js`,
`ai-scrub.js`, `dod.js`, `theme.js`, `format.js`, `queries.js`, `jira-client.js`,
`eslint.config.js`, `PLAN.md`, `CODEREVIEW(5-31).md`,
`CODEREVIEW(solution-proposed.md)`, `PERF_BASELINE.md`, and the existing
`node --test` suites. Baseline re-measured, not assumed (§0)._

**Filed as `PLAN(unified-insights).md`, not `PLAN.md`** — the existing `PLAN.md`
is the Solution-Proposed plan and is cited by
`CODEREVIEW(solution-proposed.md)`; clobbering it would erase that history. The
name mirrors the `CODEREVIEW(<feature>).md` convention.

**Stop point: awaiting approval before Phase 1.**

---

## 0. Baseline re-measured (the numbers this change must hold)

`PERF_BASELINE.md` §7 states "65 pass". That is **stale** — suites have landed
since it was written. Measured just now on `main`:

| Command | Brief / `PERF_BASELINE.md` §7 | **Actual, measured** |
|---|---|---|
| `npm test` | 65 pass | **148 pass, 4 fail** |
| `npm run lint` | 19 `src/` errors | **21 total / 19 in `src/`** ✅ matches |
| `npm run build` | exit 0 | **exit 0** ✅ matches |

The 4 failures are the untracked root scratch Playwright scripts
(`test-jira-perf.js|.mjs`, `test-jira-perf-detailed.mjs`, `test-jira-tabs.mjs`)
that hard-code `localhost:5174`; `test-jira-perf.js` also contributes the 2
non-`src/` lint errors. **The baseline I will hold is 148 pass / 4 pre-existing
fails / 19 `src/` lint errors / build exit 0**, plus every test I add.

`PERF_BASELINE.md` §7 will be corrected in Phase 4.

---

## 1. Conflicts between the brief and the code — the code wins

Raised here rather than coded around, per the brief's closing instruction.

### C1 — `/insights` and the name "Insights" are already taken 🚧 *blocking a naming call*

`src/pages/InsightsPage.jsx` exists and owns route `/insights`, nav label
**"Insights"** in the **Analysis** group. It is the AI "Deep Pattern Analysis"
page (`AiBlock` + `runAiAnalysis`). The brief's new modules are all named
`insight-*` and the new page is `OperationsPage.jsx`, so the *modules* do not
collide — but the *route, nav label and user-facing concept* would.

Recommendation (see Decision 10): new route **`/operations`**, file
**`OperationsPage.jsx`** (as the brief specifies), nav label
**"Impact Clusters"**, placed in the **Jira** group beside "Cases w/ Jira
Blockers" and "Statistics" — that is where a user looking for a cross-source
Jira↔case view will hunt, and it keeps "Insights"/"Sentiment" meaning what they
already mean. The `insight-*` module prefix stays as briefed.

### C2 — P1 #2 (unnormalized join keys) is **latent, not live**

The brief calls this "a confirmed live bug". Reading `parseJiraRefs`, every
`t.id` is already canonical uppercase on all three paths:

| Path | Regex | Canonicalization |
|---|---|---|
| System link/close notes | `JIRA_LINKED` / `JIRA_CLOSED` (both `/i`) | `.toUpperCase()` applied |
| `cause` field | `JIRA_ID_ANY = /[A-Z]+-\d+/g` — **no `/i`** | uppercase by construction |
| Free-text mentions | `JIRA_MENTION = /\bHMS-\d+\b/gi` | `.toUpperCase()` applied |

And none of those regexes can capture leading/trailing whitespace, so `.trim()`
is a no-op today. `issue.key` from the Jira REST API is canonical too. So
`blastRadius` / `mergeJiraIntoRows` are **not currently mis-joining**.

I will still implement the normalization — it is cheap, it is the correct
boundary behavior, it is what makes a future adapter (Gainsight, a ServiceNow
API connector, a hand-maintained key list) safe, and the brief asks for the
test. But the review note will describe it honestly as **defensive hardening**,
not a fix for observed wrong numbers. Nothing in Phase 2's "numbers unchanged"
proof is expected to move because of it.

*Adjacent real gap, deliberately out of scope:* because `JIRA_ID_ANY` is
uppercase-only, a `cause` field reading `hms-12345` yields **no ticket at all**.
Normalizing the lookup cannot fix that — it needs a relaxed regex, which risks
false positives on prose. Logged as a follow-up, not touched.

### C3 — P1 #3's line has moved, and there are three more spreads

`CODEREVIEW(5-31).md` cites `JiraDashboard.jsx:~266` /
`Math.max(...g.cases.map(...))`. The live code is
[`JiraDashboard.jsx:350`](src/components/jira/JiraDashboard.jsx#L350):
`Math.max(...linkedDays)`. Full census of spreads:

| Site | Array bounded by | Risk |
|---|---|---|
| `JiraDashboard.jsx:350` | **cases per ticket — unbounded** | **the real `RangeError`; in scope** |
| `jira-enrich.js:433-434` | linked tickets per case (small) | low; one-line, in path → **fix** |
| `enrich.js:414` | linked tickets per case (small) | low; **not touched** — `enrich.js` edits risk baked-value/parity churn |
| `AccountProductBlock.jsx:7`, `CategoryBlock.jsx:7`, `JiraStatsPage.jsx:582` | categories / accounts (bounded) | out of scope |

### C4 — P1 #5 cannot be fully fixed from this layer, and I am not going to pretend otherwise

`enrichIssue` caches `Date.now()`-derived `_ageDays`, `_isStale`, and the final
open-ended `timeInStatus` interval. The brief's own instruction —
"recompute age from `created` against `snapshotMs` in your layer rather than
trusting the cached value" — is the *right* call and is what I will do. But that
**avoids** the bug in the new layer; it does not fix it for `/jira` and
`/jira-stats`, which still read the cached values.

A true fix means threading `snapshotMs` into the `issues.map(enrichIssue)` call
in `useAppData` and through `staleIssues` / `jiraSummary` / `createdWithin` /
`dailyCreation` / `weeklyCreatedResolved` / `resolutionStatsByPriority` (all
`Date.now()`-based). That is a broad numbers change across two existing pages
and is **out of scope here** — logged as the top follow-up in the review note.

### C5 — Two requested filter dimensions do not exist

Confirmed against `normalizeXlsxRow`: there is **no** region column and **no**
assignment-group column. Nearest real dimensions are `parent_account` (raw
passthrough, no SQL column — see `dod.js`) and `manager` (v12 SQL column) /
`assigned_to`. Handled by Decision 7 (declared-but-unavailable registry), never
by aliasing. **Open question O1.**

### C6 — "the individual/team `view` split" is derived, not a toggle

`useAppData.js:221`: `const view = analyst === "__all__" ? "team" : "individual"`.
There is no independent control. So "honor the view split" reduces to "honor the
analyst filter", which the cluster selectors do anyway. Noted so the review note
does not claim a toggle that does not exist.

### C7 — `_jiraDaysSinceLinked` is wall-clocked (a sixth `Date.now()`, not on the P1 list)

[`enrich.js:705`](src/lib/enrich.js#L705) computes `_jiraDaysSinceLinked` from
`Date.now()`, not `snapshotMs`, despite `enrichRow` receiving `snapshotMs`. It is
the field behind the "Days linked" column and the old `oldestDays` impact term.
It is **not** in `SQL_COLUMNS` (only `jira_first_linked` is), so correcting it
needs **no schema bump** — but it would change displayed numbers on
`/jira-blockers`. Decision 4 recomputes it inside the new layer from
`_jiraFirstLinked` against `snapshotMs` and leaves `enrich.js` alone.

### C8 — README has a stale row

The Data Enrichment table still says `_isClosed` = "true if state is closed **or
resolved**", contradicting the v8 three-state lifecycle. One-line doc fix in
Phase 4 (I am editing that file anyway).

---

## 2. Decisions

### Decision 1 — Bipartite graph + iterative union-find; edges are **asserted linkage only** (recommended)

Nodes = normalized Jira keys and case numbers. An edge exists for a
`(case, ticket)` pair **iff** `ticket.source !== 'mention'` **and**
`ticket.clickable` (i.e. not `RN-`). Connected components via **union-find with
path compression + union by size** — no recursion, no `Math.max(...spread)`.

- `source === 'mention'` ⇒ **never an edge**. Load-bearing across
  `_jiraActiveTickets`, "Likely closeable", blast-radius counts, My Day triage,
  `accountChurnRisk.openBlockers`, and documented in the README.
- `RN-` ⇒ excluded from Atlassian linkage (`clickable === false`), still shown
  where the existing UI shows it.

**Not chosen:** iterative BFS over an adjacency map. Equivalent complexity, but
union-find needs no queue allocation per component and gives the stable cluster
id for free. **Also not chosen:** treating mentions as weak edges with a lower
weight — it would silently re-introduce prose name-drops into blocker counts,
breaking invariant 1 and the README's explicit promise.

### Decision 2 — Clusters retain their **edge list**, not just membership (recommended)

Each cluster carries `edges: [{ jiraKey, caseNumber, source }]`.

This is not decoration — it is what makes `blastRadius` expressible as a
projection. `blastRadius` is **per-Jira-key**; a cluster with 3 Jiras and 5
cases must project to 3 rows, each listing only the cases actually edged to
*that* key. Membership arrays alone cannot recover that. Edges also give the
drill-down an honest "this case is linked to *this* Jira" mapping.

The brief's Insight Object contract is therefore **extended additively** with
`edges` (and `mentionEdges`, display-only). Nothing is removed or renamed.

**Not chosen:** recomputing the per-key case list from raw rows inside
`blastRadius`. That is the parallel implementation the consolidation exists to
delete.

### Decision 3 — A cluster requires ≥1 asserted edge; mention-only cases are returned **alongside**, not inside (recommended)

`buildInsights` returns `{ clusters, mentionOnly, dimensions, snapshotMs }`.

- A case whose only refs are mentions (or `RN-`) creates no edge, so it is not a
  cluster. It lands in `mentionOnly` so the UI can honestly say *"N cases
  reference a Jira in prose only — not counted as blocked"*, tagged.
- `cluster.mentionedOnlyKeys` = keys mentioned by that cluster's cases which
  have no asserted edge **anywhere in the cluster** — display-only metadata.

**Not chosen:** emitting singleton clusters for unedged cases. It would inflate
the cluster count, and a "cluster" of one case and zero Jiras carries no
cross-source insight — it would be noise at the bottom of every ranking.

### Decision 4 — Every time-dependent value is recomputed in-layer against one `snapshotMs` (recommended)

No `Date.now()`, no argless `new Date()`, in any of the five new modules. Every
function that touches time takes `snapshotMs` explicitly. Specifically
recomputed rather than read from cache:

| Value | Cached source (not trusted) | Recomputed from |
|---|---|---|
| Jira `ageDays` | `issue._ageDays` (P1 #5) | `issue.created` vs `snapshotMs` |
| Jira `daysSinceUpdate`, `isStale` | `issue._isStale` (P1 #5) | `issue.updated` vs `snapshotMs` |
| case `ageDays` | — (`blastRadius` used `Date.now()`) | `row._created` vs `snapshotMs` |
| case `daysLinked` | `row._jiraDaysSinceLinked` (C7) | `row._jiraFirstLinked` vs `snapshotMs`; **`null` when `_jiraFirstLinked` is null** |

`daysLinked` keeps the **"Not linked"** contract: `null`, never `0`, for
cause-only and mention-only cases (invariant 4).

### Decision 5 — The anchor is the **ServiceNow** `snapshotMs`, with Jira freshness disclosed (recommended)

`snapshotMs` = `activeImport.uploadedAt`. Jira has its own freshness
(`jiraState.fetchedAt`) and the two can differ by days.

One anchor for the whole view means every number on screen shares one "as of",
which is what makes the view reproducible and internally consistent. The Jira
side's *own* freshness is then surfaced in the page subtitle
("Jira data as of …") rather than silently blended.

**Not chosen:** `max(snapshotMs, jiraFetchedAt)` or per-side anchors. Two
anchors make `ageDelta` — the whole point of the age comparison — meaningless,
and a `max` would age SN cases against a clock their data never saw.

### Decision 6 — Filters select **whole clusters**; metrics stay full-cluster (recommended)

Correlation is computed **once**, memoized on
`[enrichedAllJoined, jiraIssueMap, snapshotMs]`. `manager`, `analyst`,
`dateRange` and every view-local filter are **cluster selectors** applied
downstream. A cluster survives if **≥1 of its cases matches**; its `metrics`
are always computed over the **full** cluster, with a
"*N of M cases in your current filter*" chip.

Rationale: a Jira blocking 5 cases across 3 analysts still blocks 5 cases.
Recomputing "distinct accounts affected" on the filtered subset would make the
headline metric understate real blast radius — a number that changes meaning
when you filter is a number a manager cannot act on.

Selectors **filter, never map or clone**, so cluster object identity is
preserved by reference (`===`). That is directly testable — it is how the suite
proves filtering never re-correlates.

**Not chosen:** recomputing metrics per filtered subset (understates impact, and
forces re-derivation on every filter change — the exact perf shape
`PERF_BASELINE.md` §3 warns about).

### Decision 7 — Filters are a **declared dimension registry** with a resolved `available` flag (recommended)

`insight-filters.js` exports `DIMENSIONS`, each declaring `id`, `label`,
`side` (`'case' | 'jira'`), `get(cluster) → values[]`, `needs` (the export column
that lights it up), and `declaredOnly`. `resolveDimensions(rows, issues)` sets
`available` by probing the active import for a non-empty value, following
`AiEffectivenessBlock.jsx`'s honest-absence pattern — an absent dimension renders
*"Not available in this export — needs `<column>`"*, never a silent zero.

**Available** (real columns): `account`, `parent_account`, `product_line`,
`assigned_to`, `manager`, `priority` (normalized), `_category`, lifecycle, case
age bucket · Jira `assignee`, `priority` (normalized), `fixVersions`,
`statusCategory`, Jira age bucket.

**Declared but unavailable** (C5): `region` → *needs a Region / Location column
(not present in any known ServiceNow export layout; `parent_account` is the
nearest real dimension and is offered separately — it is **not** relabelled
"Region")*; `assignment_group` → *needs an Assignment group column; `manager`
and `assigned_to` are the nearest real dimensions*.

View-local filter state goes in the URL (opaque tokens where the value is a
person's name, matching `useFilters`' SECURITY #3/#8 treatment) so a filtered
view is shareable.

### Decision 8 — `blastRadius` becomes a thin projection; `ticketGroups` is deleted (recommended)

- `jira-stats.js` `blastRadius(rows, issueIndex, snapshotMs)` → projects
  `buildInsights(...)` per Jira key, emitting **byte-identical field names** so
  `blastRadiusSummary`, `openCasesHistogram`, `staleWithImpact` and
  `fixVersionPipeline` keep working untouched. Signature gains `snapshotMs`
  (Decision 4); the sole call site is `JiraStatsPage.jsx:41`, which already has
  `snapshotMs` available in outlet context.
- `JiraDashboard.jsx`'s `ticketGroups` memo and its local `impact` formula are
  **deleted** and replaced by a read of the shared engine.

**Honest consequence — the Blockers ranking will reorder.** The old formula was
`cases.length * 2 + priorityWeight + min(20, oldestDays / 7)`. Replacing it with
the shared explainable score changes the order of "Tickets blocking multiple
cases". The brief asks for numbers to be unchanged "or changed only where a P1
bug fix explains it" — this change is **deliberate consolidation**, not a bug
fix, so I am flagging it rather than hiding it.

What **must** stay identical on `/jira-blockers` (Phase 2 gate): the case table
rows and sort, `summary.total` / `active` / `resolved` / `devOnly` /
`mentionOnly` / `uniqueActive` / `mismatched`, and the "Likely closeable" list.
What **will** change, documented with a before/after table in the review note:
the impact ordering, and any "days" figure that moves from wall-clock to
snapshot anchoring (C7).

**Not chosen:** adopting the old `ticketGroups` formula as the shared score, so
nothing reorders. Rejected because it throws away the point of the feature —
ranking by real customer impact (open cases, distinct accounts, escalation,
sentiment) rather than ticket age — and would leave the new page ranking by a
formula the brief explicitly identifies as the duplication to remove.

### Decision 9 — One `percentile`: `stats.js` (recommended)

Delete the biased `Math.floor((p/100) * len)` helpers in `jira-enrich.js:~204`
and `jira-stats.js:~26`; both import `percentile` from `stats.js` (which
interpolates). `statOf` sorts ascending first, matching the `sortedAsc` contract.

**Numbers change, by design (P1 #1):** every Jira median / p85 / p90 on `/jira`
and `/jira-stats` shifts **downward** (the old form was biased high — for 4
values it returned the 3rd as the median). Documented in the review note with a
worked example. This is the one place I *want* existing numbers to move.

### Decision 10 — Route `/operations`, nav label "Impact Clusters", **Jira** group (recommended)

Per C1. File `src/pages/OperationsPage.jsx` as briefed; filter-preserving via
`FilterNavLink`, following the `/sentiment` precedent. Icon: `Network` from
lucide-react (verified present at implementation time; fallback `Share2`).

**Not chosen:** `/insights` (taken), or the Analysis group (a cross-source
Jira↔case view belongs next to Blockers and Statistics, which is where a user
will look for it).

### Decision 11 — Narratives are deterministic templates; the LLM is strictly optional (recommended)

`insight-rank.js` composes summaries from the structural facts already computed,
the way `sentiment.js`'s `buildCoachingNote` does — counts, ages, accounts,
flags. No model call in the baseline path.

An *optional* per-cluster deep-read may be added behind `ai-client.js`, with
every payload through `scrubForAi()` and a calm `NotConfiguredCard` when
`VITE_AI_PROXY_URL` is unset, mirroring `SentimentDeepRead.jsx`. **Scoped as
Phase 3-optional** — it is cut first if Phase 3 runs long, because the page must
be fully useful with no proxy configured.

### Decision 12 — Sentiment is **read**, never re-derived (recommended)

Consume the baked `sentiment_*` columns. Import `RISK_HIGH` / `RISK_ELEVATED`
from `sentiment.js`. No second scorer, no re-grading at render, no case text to
a model for sentiment.

Two honest handling rules, from reading `analyzeJournal`:
- `sentiment_risk` is **`null` for closed cases** by design. `worstRisk` skips
  nulls; a null is never coerced to `0` (which would read as "measured, and
  safe").
- `negativeCount` reads `sentiment_label === 'Negative'`; `escalatedCount` reads
  `sentiment_escalated`.

---

## 3. Schema / column impact: **none**

**No new SQL column. No `SCHEMA_VERSION` bump. Stays `'12'`.**

Justification, verified rather than assumed:

- Jira issues exist **only** in the in-memory pipeline (`.jira-cache/cache.json`
  → `loadCache` → `enrichIssue` → `jiraState.issues`). They are never written to
  DuckDB.
- `grep` over `queries.js` finds **no** `jira_keys` / `jira_active_keys` /
  `UNNEST` / `string_split` usage — there is no SQL-side Jira join to extend.
- The correlation layer's inputs (`enrichedAllJoined`, `jiraIssueMap`,
  `snapshotMs`) are all already in memory in `useAppData`.
- `_jiraDaysSinceLinked` (C7) is in-memory only, not in `SQL_COLUMNS`.

A bump would force every existing import to show "Rebuild needed" for zero
persisted benefit. `db.worker.js` and every DuckDB-backed surface are untouched.

---

## 4. Module graph

Pure ESM, no React, no network, no wall-clock. Flat `src/lib`, `jira-*`-style
naming. Import direction is strictly one-way (no cycles):

```
insight-thresholds.js   leaf. named constants + weights (mirrors sop-thresholds.js).
                        imports only STALE_DAYS from jira-enrich.js (see below).
        ▲
correlate.js            leaf. imports NOTHING. normalizeKey + union-find +
                        connected components over abstract {nodes, edges}.
                        Knows no field name from either source.
                        Owns the @typedef Insight contract.
        ▲
insight-metrics.js      the ONLY source-aware module: SN/Jira → node/edge
                        adapters, normalizePriority(source, value), age &
                        bucket mapping, escalation derivation, metric builders.
                        imports: correlate, insight-thresholds, enrich
                        (priorityRank), jira-enrich (JIRA_AGING_BUCKETS),
                        constants (AGING_BUCKETS), stats (percentile),
                        sentiment (RISK_HIGH/RISK_ELEVATED).
        ▲
insight-rank.js         scoring + factors + bands + flags + narratives, and the
                        terminal buildInsights() facade.
        ▲
insight-filters.js      dimension registry + cluster selectors + drill-down.

src/components/insights/…   presentation only. Recharts + Card/Section/
                            EmptyState/Pill/CaseDrilldown + T tokens + lucide.
src/pages/OperationsPage.jsx  route + Section wrapper; reads outlet context.
```

**Adapters live in `insight-metrics.js`, not a 6th module.** That module is
already declared source-aware — `normalizePriority(source, value)` takes the
source as an argument — so it is the natural home, and it keeps the module count
at the five the brief specifies. `correlate.js` stays field-name-free: adding a
Gainsight or ServiceNow-API source means writing one adapter in
`insight-metrics.js` and touching the engine not at all.

**`buildInsights` lives in `insight-rank.js`** (the terminal stage), so the page
makes one call. *Not chosen:* a 6th `insights.js` facade — module creep for one
exported function.

**`JIRA_STALE_DAYS`:** `30` currently exists three times — `jira-enrich.js`
`STALE_DAYS` (module-private), `jira-stats.js` default params, and
`JiraStatsPage.jsx`. I will **export** `STALE_DAYS` from `jira-enrich.js` and
re-export it as `JIRA_STALE_DAYS` from `insight-thresholds.js`, so the new layer
adds no fourth copy. The existing duplicate default params are left alone
(out of scope).

### Insight Object

The brief's contract verbatim, plus the two additive fields from Decision 2.
Documented as a JSDoc `@typedef` in `correlate.js`:

```js
{
  id, jiraKeys: [], caseNumbers: [], mentionedOnlyKeys: [],
  edges: [ { jiraKey, caseNumber, source } ],        // + Decision 2
  mentionEdges: [ { jiraKey, caseNumber } ],         // + Decision 2, display-only
  jira: [ { key, summary, status, statusCategory, priority, priorityNorm,
            assignee, fixVersions, ageDays, isStale, daysSinceUpdate, url, hasLive } ],
  cases: [ { number, account, parentAccount, productLine, assignedTo, manager,
             priority, priorityNorm, lifecycle, isOpen, ageDays, ageBucket,
             daysLinked, slaBreached, sentimentRisk, sentimentEscalated,
             sentimentSignals } ],
  metrics: {
    jiraAgeDays: { max, median, oldestKey },
    caseAgeDays: { max, median, oldestNumber },
    ageDelta, priorityNorm,
    escalation: { level, reasons: [] },
    sentiment: { worstRisk, negativeCount, escalatedCount, worstQuote },
    volume: { totalCases, openCases, distinctAccounts, casesPerJira },
  },
  score, factors: [ { label, weight, detail } ], band, clusterFlags: [], summary
}
```

`id` = `'c:' + shortest-stable-hash of the sorted member keys` — stable across
runs and independent of row order.

---

## 5. Normalization

### `normalizePriority(source, value) → 0..100 | null`

One function, mapping table adjacent to it. SN ranks are read through
`priorityRank`, never re-parsed.

| SN (`priorityRank`) | → | Jira (lowercased name) | → |
|---|---|---|---|
| `1` Critical | **100** | `blocker`, `highest`, `critical`, `urgent` | **100** |
| `2` Major | **75** | `high`, `major` | **75** |
| `3` Medium/Standard | **50** | `medium`, `normal` | **50** |
| `4` Standard | **25** | `low`, `minor` | **25** |
| — | — | `lowest`, `trivial` | **10** |
| `99` (the `priorityRank` unknown sentinel) or unparseable | **`null`** | unrecognized / absent | **`null`** |

The `99` case is explicit and load-bearing: `priorityRank` returns `99` — not
`null` — for anything it cannot parse, and feeding `99` into a 0..100 urgency
scale would rank every unknown priority as maximally urgent. Cluster
`priorityNorm` = **max over non-null** member values (the most urgent thing in
the cluster defines its urgency), `null` when all members are null. `null` is
never coerced to `0` or `100`, and never sorts above a known value.

### Age

Jira age and case age computed **independently** from `created`/`_created`
against `snapshotMs`, plus `ageDelta = caseAgeDays.max − jiraAgeDays.max`
(positive ⇒ the case has been waiting longer than the Jira has existed).
Buckets reuse the existing arrays — `JIRA_AGING_BUCKETS` (jira-enrich) for
Jiras, `AGING_BUCKETS` (constants) for cases; they are byte-identical thresholds
today, which is why the new charts agree with the existing ones. One shared
`ageBucketOfDays(days, buckets)` helper — **no third threshold table.**

### Escalation

No native field. Documented enum, most severe first, with contributing reasons
shipped alongside:

| Level | Fires when |
|---|---|
| `escalated` | any case has `sentiment_escalated` (reason from `sentiment_esc_reason`) |
| `at-risk` | any case `_slaBreached` (reason from `_slaBreachReason`), or `sentiment_risk ≥ RISK_HIGH` |
| `watch` | `sentiment_risk ≥ RISK_ELEVATED`, or a stale Jira (`daysSinceUpdate ≥ JIRA_STALE_DAYS`) with ≥1 open case |
| `none` | nothing above |

### Percentiles

`percentile` from `stats.js` only (Decision 9).

---

## 6. Ranking, flags, narrative

Every weight and threshold is a **named export** in `insight-thresholds.js` with
a comment justifying it. `score = clamp(0, 100, Σ factors.weight)`; each factor
is `{ label, weight, detail }` — signed and named, exactly like
`sentiment_risk_factors` and `accountChurnRisk`'s signal chips.

| Constant | Value | Why |
|---|---|---|
| `W_OPEN_CASE` | 6 / open case, cap 30 | real customer impact, not ticket age — the headline term |
| `W_DISTINCT_ACCOUNT` | 5 / account beyond the first, cap 20 | breadth beats depth: 4 accounts × 1 case is worse than 1 account × 4 |
| `W_JIRA_AGE` | 1 / week open, cap 15 | engineering dwell, the old formula's only real signal |
| `W_CASE_AGE` | 1 / week oldest open case, cap 15 | the customer's wait, which the Jira age can hide |
| `W_ESCALATION` | `escalated` 25 · `at-risk` 15 · `watch` 7 | an explicit escalation outranks any amount of volume |
| `W_SENTIMENT` | 10 if `worstRisk ≥ RISK_HIGH`, 5 if `≥ RISK_ELEVATED`, +5 per escalated case (cap 15) | reuses validated bands rather than inventing thresholds |
| `W_URGENCY_AGE_INTERACTION` | 12 when `priorityNorm ≥ 75` **and** oldest open case ≥ 30d | the named interaction: urgent *and* long-unresolved is worse than the sum |
| `BAND_HIGH` / `BAND_MEDIUM` | 60 / 35 | band boundaries, asserted at the exact thresholds |

Caps exist so no single term can dominate the ranking — the failure mode of the
old formula, where `cases.length * 2` swamped everything else.

**Risk-cluster predicates** — two separately-testable pure functions:

- `isStaleJiraMultiCase(cluster)` — ≥1 Jira with `daysSinceUpdate ≥
  JIRA_STALE_DAYS` **and** `metrics.volume.openCases ≥ MULTI_CASE_MIN` (2).
- `isUrgentNegativeEscalated(cluster)` — strictly conjunctive:
  `priorityNorm ≥ URGENCY_HIGH_MIN` (75) **and** (`worstRisk ≥ RISK_HIGH` or
  `negativeCount ≥ 1`) **and** `escalation.level ∈ {escalated, at-risk}`.
  Kept conjunctive so the near-miss negative test is meaningful.

**Narratives** — deterministic templates over facts already computed. Every
token is substituted from a non-null value or the clause is dropped, so no
`{placeholder}` can ever reach the screen (asserted).

**Ordering** — `score desc`, then `openCases desc`, then `id` ascending
(lexicographic). The `id` tiebreak is what makes screenshots and CSV
reproducible. *Note:* today's `blastRadius` sorts by `openCount, totalCount`
with **no** final tiebreak, so tied rows fall back to Map insertion order — i.e.
row order. Adding the explicit tiebreak may reorder tied rows on `/jira-stats`;
called out in the review note as an intended determinism fix.

---

## 7. Performance

`PERF_BASELINE.md` §3 is unambiguous: aggregation is ~5 ms, per-row enrichment
is ~664 ms. So the design rule is **correlate once, filter many**.

- One memo keyed `[enrichedAllJoined, jiraIssueMap, snapshotMs]`. Filters are
  **not** in the key.
- O(n + m) with `Map`/`Set`. Union-find is near-linear.
- The graph spans only *referenced* keys (hundreds), not all ~11k issues; the
  11k-issue map is built once upstream in `useAppData`. The normalized index is
  one extra ~11k-entry `Map` build, single-digit ms.
- Budget **≤150 ms** for ~11k issues × ~1k cases, measured via
  `scripts/pipeline-bench.mjs`-style timing in Phase 4 and recorded in the
  review note.
- No `Math.max(...spread)` anywhere — `reduce` only.
- Components receive finished data; **no metric computation in JSX**.

Lint discipline (zero new errors): no `Date.now()` in render
(`react-hooks/purity` — the rule that already flags `JiraDashboard.jsx:249`), and
**no component definitions inside render** (`react-hooks/static-components` —
the 12 existing errors in `JiraDashboard`). `no-unused-vars` with
`varsIgnorePattern: '^[A-Z_]'`.

---

## 8. Files per phase

### Phase 1 — pure core (no UI)
- **NEW** `src/lib/insight-thresholds.js`
- **NEW** `src/lib/correlate.js` — `normalizeKey`, `buildIndex`, `correlate`, the `Insight` typedef
- **NEW** `src/lib/insight-metrics.js` — adapters, `normalizePriority`, `ageBucketOfDays`, escalation, metric builders
- `src/lib/jira-enrich.js` — **export** `STALE_DAYS` (one word); no behavior change
- **NEW** `src/lib/correlate.test.js`
- **NEW** `src/lib/insight-metrics.test.js`

**Gate 1:** green, plus the full pre-existing baseline (§0) unchanged.

### Phase 2 — rank, filter, and the migration
- **NEW** `src/lib/insight-rank.js` — scoring, factors, bands, flags, narratives, `buildInsights`
- **NEW** `src/lib/insight-filters.js` — `DIMENSIONS`, `resolveDimensions`, selectors, drill-down
- `src/lib/jira-stats.js` — `blastRadius` → projection over clusters (+`snapshotMs`); delete the local `percentile` (Decision 9)
- `src/lib/jira-enrich.js` — delete the local `percentile`; `Math.max(...)` → `reduce` (C3)
- `src/components/jira/JiraDashboard.jsx` — delete `ticketGroups` + local `impact`; read the shared engine; `Math.max(...linkedDays)` → `reduce` (**P1 #3**)
- `src/pages/JiraStatsPage.jsx` — pass `snapshotMs` to `blastRadius`
- `src/pages/JiraBlockersPage.jsx` — pass what `JiraDashboard` now needs (`snapshotMs`, cluster set)
- **NEW** `src/lib/insight-rank.test.js`
- **NEW** `src/lib/insight-filters.test.js`
- **NEW** `src/lib/jira-stats.migration.test.js` — projection equivalence + the percentile change

**Gate 2:** the equivalence proof of Decision 8 — what is identical, what moved
and why, with a before/after table.

### Phase 3 — page, components, drill-down, export, route
- **NEW** `src/pages/OperationsPage.jsx`
- **NEW** `src/components/insights/` — `ClusterList.jsx`, `ClusterCard.jsx`
  (factors as signal chips), `AgeComparisonBlock.jsx` (Jira vs case),
  `ImpactHistogramBlock.jsx` (extends `openCasesHistogram`),
  `EscalationHeatmapBlock.jsx` (escalation × urgency, cells click through),
  `DimensionFilterBar.jsx` (registry-driven, honest-absence states)
- Drill-down reuses `CaseDrilldown` for cases and for Jira objects (which carry
  the SN-style aliases `number` / `_created` / `assigned_to` /
  `short_description` deliberately). Reuses `Card`, `Section`, `EmptyState`,
  `Pill`, `T`, `alpha()`, lucide-react. No new chart library, no new styling
  system, inline style props only.
- CSV via `rowsToCsv` → `toCsvRow` → `sanitizeCellForExport` +
  `downloadCsv`/`csvTimestamp`. **No local `escapeCsv`** (SECURITY #7). Any
  `dangerouslySetInnerHTML` through DOMPurify (SECURITY #10) — none planned.
- `src/App.jsx` + `src/components/layout/AppLayout.jsx` — route + nav
  (Decision 10), filter-preserving.
- *Optional, cut-first:* `src/components/insights/ClusterDeepRead.jsx` behind
  `ai-client.js` + `scrubForAi()` (Decision 11).

### Phase 4 — verify + document
- Full `npm test` / `npm run lint` / `npm run build`; perf measurement against
  the ≤150 ms budget.
- Headless visual verification (Playwright, upload from `.servicenow-cache`,
  client-side nav, `reducedMotion`).
- **NEW** `CODEREVIEW(unified-insights).md` — repo style, including an
  adversarial self-critique pass (the `CODEREVIEW(solution-proposed.md)` §7
  precedent).
- `README.md` — new layer section; the honest-accuracy statement; the
  declared-but-unavailable dimensions; modeling assumptions (Decision 5's single
  anchor, Decision 6's full-cluster metrics, the derived escalation enum); the
  P1 #1 percentile numbers change; the C8 `_isClosed` correction.
- `PERF_BASELINE.md` §7 — correct the stale test count (§0).

Commits: the four P1 fixes land as **separately-scoped commits with their own
tests**, distinct from the feature commits. No opportunistic refactoring beyond
them.

---

## 9. Tests

`node --test`, alongside the modules in `src/lib/`, following
`enrich.sentiment.test.js` / `enrich.sla-solution-proposed.test.js` for shape and
rigor: fixed `SNAP` anchor, no wall-clock, table-driven.

**`correlate.test.js`**
1. 1→N: one Jira, three cases ⇒ one cluster, 3 case members, 3 edges.
2. N→1: one case, three Jiras ⇒ one cluster.
3. Transitive N↔M: J1–C1, C1–J2, J2–C2 ⇒ **one** component, not two.
4. A mention-only ref creates **no** edge and **no** cluster; the case appears in `mentionOnly`; the key appears in `mentionedOnlyKeys`, tagged.
5. An `RN-` ref is excluded from Atlassian linkage (no edge) and stays visible.
6. Key normalization: lowercase / whitespace-padded parsed ids still join to the live map (C2 — defensive).
7. Determinism: same input + same `snapshotMs` ⇒ deep-equal across two calls; ordering stable; `id` independent of input row order.
8. Cluster sizes of 5,000 edges do not throw (no spread, no recursion) and finish inside budget.
9. **No wall-clock, by construction:** the module source contains no `Date.now(` and no argless `new Date()`; and output shifts when `snapshotMs` shifts.

**`insight-metrics.test.js`**
10. `daysLinked` is `null` — never `0` — for cause-only and mention-only cases.
11. `normalizePriority` across both sources, the full table, including `unknown → null`, the `priorityRank`-99 case, and the never-rank-unknown-as-urgent guarantee (a null-priority cluster never outranks a `100` one).
12. Age/percentile agreement: cluster percentiles equal `stats.js` `percentile`, and buckets equal `JIRA_AGING_BUCKETS` / `AGING_BUCKETS` at each boundary.
13. Ages recomputed from `snapshotMs`, not from the cached `_ageDays` / `_jiraDaysSinceLinked` (P1 #5, C7) — a fixture with a deliberately wrong cached value proves it.
14. Escalation enum: each level fires on a crafted positive, stays silent on a near-miss, and ships its reasons.
15. Closed-case `sentiment_risk === null` is skipped, not read as `0`.
16. Same no-wall-clock assertion as (9).

**`insight-rank.test.js`**
17. Explainability: `score === clamp(0, 100, Σ factors.weight)` (clamped form, since the cap is real).
18. Band boundaries hold at the exact thresholds (59/60, 34/35).
19. `isStaleJiraMultiCase` — crafted positive fires; near-miss (stale Jira, 1 open case) stays silent.
20. `isUrgentNegativeEscalated` — crafted positive fires; near-miss (each of the three conjuncts dropped in turn) stays silent.
21. Narratives are deterministic and contain **no** un-substituted `{token}`.
22. Ordering stable under input permutation.
23. Same no-wall-clock assertion as (9).

**`insight-filters.test.js`**
24. **Filtering never re-correlates:** selector output elements are `===` the pre-filter cluster objects.
25. Every aggregate count reconciles with its drill-down list length.
26. Registry: an absent column ⇒ `available: false` + a `needs` string; a present column ⇒ `available: true`. `region` / `assignment_group` are always `declaredOnly` and never alias `parent_account` / `manager`.
27. Decision 6 semantics: a cluster survives on ≥1 matching case, and its `metrics` are unchanged by the filter.

**`jira-stats.migration.test.js`**
28. `blastRadius` projection emits the exact legacy field set, and `blastRadiusSummary` / `openCasesHistogram` / `staleWithImpact` / `fixVersionPipeline` consume it unchanged.
29. Per-key case lists contain only cases edged to *that* key (Decision 2).
30. `percentile` consolidation: the documented worked example (median of 4) now returns the interpolated value, and Jira stats shift down as described (P1 #1).

---

## 10. Invariants — how each is held

| # | Invariant | Held by |
|---|---|---|
| 1 | Mentions never assert linkage or count as blockers | Decision 1 edge rule; tests 4, 5 |
| 2 | `enrich.js` / `jira-enrich.js` stay the single sources of truth | derivation lives in the new pure modules; `enrich.js` untouched, `jira-enrich.js` only loses a duplicate `percentile` and a spread |
| 3 | Snapshot-anchored determinism | Decision 4/5; tests 7, 9, 16, 22, 23 |
| 4 | "Not linked" is never `0` | Decision 4; test 10 |
| 5 | Nothing leaves the device except through the scrubbed AI seam | Decision 11; pure modules make no network call |
| 6 | Existing pages keep working; DuckDB surfaces untouched | §3 (no schema change); Gate 2 equivalence proof |
| 7 | Baseline holds | §0 measured; re-verified at every gate |

---

## 11. Open questions

**O1 (C5) — region & assignment group.** Neither exists in any known export
layout. I will ship them as **declared-but-unavailable** with a one-line note on
the column that would light them up, and will *not* alias `parent_account` to
"Region" or `manager` to "Assignment group". If either dimension is genuinely
wanted, the fix is upstream — add the column to the ServiceNow report — and I
would want to know the exact column name to declare against.

**O2 (C1, Decision 10) — route/label/placement.** Recommending `/operations` +
"Impact Clusters" in the **Jira** nav group. If you would rather it sit in
**Analysis** next to Insights/Sentiment, or carry a different label, that is a
one-line change — but it should be settled before Phase 3.

**O3 (Decision 8) — the Blockers ranking reorder.** Adopting the shared score
means "Tickets blocking multiple cases" on `/jira-blockers` reorders. I believe
that is the point of the consolidation and recommend it. The alternative —
freeze the old `cases.length * 2 + priorityWeight + min(20, oldestDays/7)`
formula as the shared score so nothing moves — is available but throws away
ranking by real customer impact.

**O4 (C4) — scope of the P1 #5 fix.** I fix it *in the new layer* per the
brief's instruction. Fixing it globally (so `/jira` and `/jira-stats` also stop
reporting stale ages) is a broader, separately-reviewable change across six
`Date.now()`-based helpers. Confirm you want it left as a follow-up.

**O5 (Decision 11) — optional LLM deep-read.** Currently scoped as
Phase 3-optional and cut first if Phase 3 runs long, since `VITE_AI_PROXY_URL`
is unset in this environment and the page must be fully useful without it. Say
if you want it guaranteed in scope.

---

## 12. Phase 2 addendum — three corrections found by driving real data

Recorded here because §1 (C2, C5) and Decision 1 were **wrong**, and a plan that
stays wrong is worse than no plan. All three were found by running the app
against a real 3,069-row export rather than by reading code.

### A. `RN-` refs DO correlate (Decision 1 corrected)

Phase 1 excluded non-clickable (`RN-`) refs from graph edges. That was wrong:
neither `blastRadius` nor `JiraDashboard`'s `ticketGroups` skips a non-clickable
ref today — **mentions are the only thing either drops** — and `enrich.js` counts
an `RN-` System link note toward `_jiraFirstLinked` "by design", because the note
marks when the case started waiting on engineering "whether the tracked record is
a real Jira ticket or an internal Resolution Notes record".

Excluding them would have silently deleted rows from two shipped tables. On the
real export the effect is severe: the **top blocker is `RN-9721586` with 10 cases
across ~12 accounts**, and almost every asserted link in that export is an `RN-`
ref (the `HMS-` references are mostly free-text mentions). That entire table would
have emptied.

Corrected: `RN-` refs create edges, tagged `isAtlassian: false` — never joined to
the live Jira map, never rendered as a browse URL. Mentions remain the sole
exclusion, which is the invariant that actually matters.

### B. A duplicate XLSX header silently replaced every case number

**Not on any review list.** The standard ServiceNow case export ships the header
`Number` **twice**: column 1 is the case number (`CS1887438`), a later column is
the account number (`ACCT9000004`). `readXlsxRows` assigned unconditionally while
walking columns left→right, so the **last occurrence won** and every row's
`number` became an account number.

Consequences: case numbers wrong everywhere they are displayed, copied or
CSV-exported; non-unique React keys (the observed "two children with the same key"
warnings — 11 of them, now 0); and for this feature, distinct cases sharing an
account would have **collapsed into one correlation node**, undercounting blast
radius. The Phase 2 oracle test did not catch it because its fixtures used unique
synthetic numbers.

Fixed: the first occurrence of a repeated header wins. Positional, not
truthiness-based — "prefer whichever is non-empty" would let different ROWS of one
file resolve to different columns. Covered by `enrich.xlsx-ingest.test.js`, plus a
guard in `buildGraph` that reports `duplicateCaseNumbers` instead of merging
quietly.

**Open question O6 — `SCHEMA_VERSION`.** `number` is a baked SQL column, so
imports created before this fix still hold account numbers there. I did **not**
bump `SCHEMA_VERSION` (the brief was emphatic about not forcing "Rebuild needed"
on everyone), which means an affected existing import keeps its wrong case numbers
until manually rebuilt. Bumping would correct everyone at the cost of one forced
rebuild. **This is your call** — I lean toward bumping, because wrong case
identifiers in a CSV export are worse than a rebuild prompt.

### C. `Region` and `Assignment group` DO exist (C5 / O1 withdrawn)

The brief stated, and §1 C5 repeated, that neither column exists in any
ServiceNow export. Inspecting a real export disproves it — the header row contains
`Region` (e.g. `"NA"`) and `Assignment group` (e.g.
`"Hospitality - HMS Support"`), along with `Country` and `City`. They were
invisible only because `normalizeXlsxRow` never mapped them.

Corrected: both are now mapped as raw passthroughs (the documented
`parent_account` / `tags` pattern — no SQL column, no schema bump) and are
**ordinary dimensions** in the registry rather than declared-but-unavailable.
`available` resolves from the active import like every other dimension, so an
export lacking the column still says so honestly. Neither is ever aliased onto
`parent_account` or `manager`; that non-conflation is asserted by test.

**O1 is withdrawn.** `Country` / `City` are also available and are left as a
follow-up rather than added speculatively.
