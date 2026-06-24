# Code Review — Case Sentiment Grader (2026-06-19)

A feature review for the **Case Sentiment Grader**: a deterministic, on-device
reproduction of the structured columns of the LLM "Customer Sentiment Review,"
added so the team never has to run a whole case export through a model. The
model stays available as an *optional* per-case deep-read.

Complements the existing docs:

- [`CODEREVIEW(6-10).md`](./CODEREVIEW(6-10).md) — whole-codebase review + roadmap. (Its risk #1 was "no automated tests"; this feature ships **39 tests** and the repo's first `test` script.)
- [`SECURITY_CONCERNS.md`](./SECURITY_CONCERNS.md) — the security audit (SECURITY #1 / #7 / #10 are the relevant invariants here).

**Status:** `npm run test` → 39 pass / 0 fail. `npm run build` → passes. `npm run lint` → the 14 sentiment files are clean; the repo's pre-existing 21 `react-hooks` errors (in `JiraAnalysisBlock`, `StuckCasesList`, `AssigneeAgingBlock`, `SlaRiskBlock`, `JiraDashboard`, `useQuery`) are unchanged — this feature introduced **zero** new lint errors.

---

## 1. What shipped

| Area | File | Change |
|---|---|---|
| Engine | `src/lib/sentiment.js` _(new)_ | Pure, framework-free grader: stream parse, lexicon scorer, emotions/target vocabularies, per-case grade, portfolio summary, bake adapter. |
| Bake | `src/lib/enrich.js` | `enrichRow` + `enrichForSql` both spread `gradeFromRow(r, frtMs)`; `SQL_COLUMNS` +12; `SCHEMA_VERSION` `'8'→'9'`; `normalizeXlsxRow` surfaces `contact`. |
| Persistence | `src/workers/db.worker.js` | 12 `sentiment_*` columns appended to the `CASES_COLUMNS` DDL (positional Arrow alignment). |
| UI | `src/components/charts/SentimentBlock.jsx` _(new)_, `src/pages/SentimentPage.jsx` _(new)_ | Headline tiles, distribution chart, sortable/keyboard-navigable per-case table, `EmptyState`, "Download grades". |
| Routing | `src/App.jsx`, `src/components/layout/AppLayout.jsx` | `/sentiment` route + Tools nav entry (`Gauge`), filter-preserving. |
| Deep-read | `src/lib/ai-client.js`, `src/lib/ai-scrub.js`, `src/components/ai/SentimentDeepRead.jsx` _(new)_ | Opt-in, per-case LLM coaching through the proxy seam; `scrubForAi` extended for the deep-read free-text. |
| Export | `src/lib/sentiment-export.js` _(new)_ | Two-sheet ExcelJS workbook regenerated on device. |
| Tests | `sentiment.test.js`, `enrich.sentiment.test.js`, `sentiment-export.test.js`, `ai-scrub.test.js` _(all new)_ | 39 tests via `node --test`. |

---

## 2. The bake-vs-render decision (and why)

Sentiment is a **baked, derived field**, computed once in the shared enrichment
(`enrichRow` + `enrichForSql`) and persisted to DuckDB — exactly like SLA,
category, and interaction counts. The UI reads the baked fields and only falls
back to the engine at render time for a row that lacks them (an older import not
yet rebuilt).

Why bake rather than grade-on-render:

- **It makes sentiment a queryable dimension.** "Show me the negative cases for
  this account" is a future SQL filter that comes for free, not a re-scan.
- **It avoids re-grading on every filter change.** The Sentiment page re-renders
  on each analyst/date change; re-parsing every journal each time would be the
  hot path the architecture explicitly avoids. `summarizeSentiment` reads baked
  columns via `resolveGrade` and only re-grades rows missing them.
- **It keeps one source of truth.** `enrich.js` already owns derivation for both
  pipelines; sentiment slots into that contract instead of inventing a parallel one.

**Parity is the load-bearing invariant.** Both pipelines call the *same*
`gradeFromRow(r, frtMs)` with the *same* inputs, so the `sentiment_*` values are
byte-identical. Unlike the SLA fields (which use `_camelCase` in `enrichRow` and
`snake_case` in `enrichForSql`), the sentiment fields use **snake_case in both** —
this is what lets the parity test deep-equal the two and lets the UI read one key
name regardless of source. The numeric columns are plain `Number | null` (never
`BigInt`), matching the proven count-column convention (`priority_rank`,
`interaction_count`), which keeps the deep-equal honest. A dedicated parity test
(`enrich.sentiment.test.js`) enforces this on representative rows; a real Arrow
round-trip test confirms the nullable-`BIGINT` columns serialize cleanly.

---

## 3. Honest accuracy limits

The grader is **exact** where the data is structural and **directional** where it
is interpretive:

- **Exact:** coverage (analyzed / scoreable / phone-silent / auto-closed),
  responsiveness (median first reply, % within 1 h — from baked `frt_ms`), and
  hygiene (duplicate analyst double-posts, credential/remote-access exposure).
  These are counts and timestamps, not judgments.
- **Directional:** tone. Valence-sign agreement with the LLM review is **≈ 60–65 %
  on a single line** and better across a full message stream where start/end/arc
  are visible. The synthetic strict fixture clears 100 %, but that is curated to
  lexicon-detectable lines; the real miss is **context-only tone** — sarcasm
  ("is it fixed by now?"), and business-impact lines with no explicit negative
  word. The module's `HONEST LIMITS` header says the same.
- **Templated coaching.** `sentiment_coaching` is *not* the model's prose. It
  states the structural facts the model would open with (responsiveness, arc,
  closure) so the column is useful at a glance. Prose coaching is the opt-in
  deep-read, reserved for the handful of cases that warrant it.

This framing is surfaced in the UI (the page subtitle and the deep-read card),
not buried — the feature does not over-claim.

---

## 4. New columns + schema bump

`SCHEMA_VERSION` `'8' → '9'` with a `// v9:` changelog entry in the established
style. Twelve columns appended (after `lifecycle`) to **both** `SQL_COLUMNS`
(`enrich.js`) and the `CASES_COLUMNS` DDL (`db.worker.js`), in the same order
(the Arrow insert binds positionally):

`sentiment_scoreable` (BOOLEAN), `sentiment_valence` / `sentiment_start` /
`sentiment_end` (BIGINT, plain `Number | null`), `sentiment_label` /
`sentiment_arc` / `sentiment_emotions` / `sentiment_target` / `sentiment_quote` /
`sentiment_coaching` (VARCHAR), `sentiment_pii` / `sentiment_dup` (BOOLEAN).

> **Note (corrects a brief assumption):** the brief expected "no worker change
> beyond consuming the new `SQL_COLUMNS`." In fact the worker creates each table
> from the explicit `CASES_COLUMNS` DDL and inserts with `{ create: false }`, so
> the DDL had to gain the columns too — otherwise the Arrow insert mismatches.

Migration: bumping the version flags every existing import with the "Rebuild
needed" badge (`ImportsCard.jsx`); rebuilding re-parses the stored source blob
and bakes the new columns. New imports bake them immediately.

The hygiene flags (`sentiment_pii` / `sentiment_dup`) go **beyond the brief's
10-field list** (it called the names "a suggestion"). Baking them keeps
`summarizeSentiment` fully baked-field-based — re-deriving them at summary time
would re-parse the stream on every filter change, defeating the bake. They are
non-null booleans, so they carry no Arrow null-typing risk.

---

## 5. Tuning knobs

Everything tunable lives in `sentiment.js`, near the top, with `// why` comments:

- **`COMPRESS_K = 8`** — the soft-compression constant. Valence is
  `5·tanh(raw / COMPRESS_K)`, mapping an unbounded lexicon sum onto −5..+5 while
  keeping typical gratitude/single-complaint lines near ±2. Raise it to flatten
  magnitudes, lower it to sharpen them.
- **`POS` / `NEG` / `IMPACT` lexicons** — the tuned support/hospitality
  vocabulary with per-term weights (≈ −3..+3). `IMPACT` terms are mildly negative
  and also flag the "anxious (business impact)" emotion.
- **`INTENS` / `NEGATORS`** — intensifier multipliers and negation handling for
  single-word hits.
- **Diminishing-returns cap** — after the first 3 distinct same-polarity hits in
  one message, further hits weigh ½×, so a multi-cue rant can't saturate.
- **`EMOTION_RULES` / `TARGET_RULES`** — controlled vocabularies (first-match
  wins) for the emotion labels and frustration-target buckets.
- **Arc thresholds** — `arc()` calls a ±1 valence delta "improved"/"declined".

---

## 6. Security posture

- **SECURITY #1 — no client→vendor calls.** The engine is 100 % local with no
  network path. The optional deep-read goes *only* through `aiClient.reviewSentiment`
  (the proxy seam) with `scrubForAi` applied, strictly gated on
  `aiClient.isConfigured()`. When no proxy is set it shows the same calm
  "not configured" card as `AiBlock`. It never fans out across the queue (≤ 10
  negatives) and never calls a vendor directly.
- **SECURITY #7 — export injection.** Every string cell in the workbook routes
  through `sanitizeCellForExport` (a leading `=`/`+`/`-`/`@` is prefixed with `'`).
  A round-trip test confirms it.
- **SECURITY #10 — no raw HTML.** The representative quote and coaching note
  render as text (React-escaped), never `dangerouslySetInnerHTML`. The engine
  also strips `[code]` blocks and HTML tags from bodies before scoring.
- **PII scrubbing hardened.** `scrubForAi` now also scrubs the deep-read's
  free-text (`comments`, `quote`, `work_notes`) — additive, so the existing
  insights payload is unaffected — and `scrubText` gained a phone-number regex.
  Residual surface (addresses, single-token names) is the documented job of the
  server-side re-scrub (defense in depth).

---

## 7. Self-critique pass (adversarial review)

The diff was put through a 5-dimension adversarial review
(security / parity-determinism / correctness / cleanliness / a11y), with every
finding independently re-verified against the code. **8 findings confirmed.**
Six were fixed; two were deliberate non-changes with rationale.

**Fixed**

1. **(major, a11y) Nested interactive controls.** The expandable `<tr>` was
   `role="button" tabIndex=0` *and* contained `CopyableNumber` (itself a
   `role=button`) — nested interactive content, invalid ARIA, two tab stops per
   row. **Fix:** the disclosure control is now a single real `<button>` (the
   chevron, carrying `aria-expanded`); the row toggles on mouse click for
   convenience but is no longer a focus stop. Keyboard users get one real button
   per row plus the copy button — no nesting.
2. **(minor, correctness) Export auto-closed used a header count.** `isAutoClosed`
   keyed off `custMsgs === 0` (a header count that counts empty-bodied entries),
   so it disagreed with the body-based "Phone / silent" coverage line in the same
   sheet. **Fix:** key off `!g.scoreable` (the same body-based signal); covered by
   a new test.
3. **(minor, cleanliness) `round1` misnamed** — it rounds to an integer, not one
   decimal (cf. `round2` in the export). **Fix:** renamed `roundInt`.
4. **(minor, cleanliness) `scoreText` JSDoc detached** from the function by the
   `compress` block, and omitted the `raw` return field. **Fix:** reordered;
   `@returns` corrected.
5. **(nit, security) Heuristic scrub coverage.** **Fix:** added a phone-number
   regex to `scrubText`; added the previously-missing `ai-scrub` test.
6. **(nit, a11y) "Show all" button** lacked `type="button"`. **Fix:** added.

**Deliberate non-changes (documented)**

- **(minor) `scoreText` double-counts an overlapping phrase + its constituent
  word** (e.g. "not working" scores the phrase *and* the negated word "working").
  Dedup is by key, not by character span. **Left as-is:** the magnitudes are
  *tuned*, the double-count is same-direction (no sign flip), bounded by `tanh`,
  identical across both pipelines (parity/determinism intact), and the module
  already disclaims valence-magnitude fidelity. The comment was corrected to state
  this is intentional reinforcement, not span-distinct. A span-blanking change is
  a clean one-line follow-up if exact magnitudes ever matter.
- **(nit) `parseTs` duplicates `enrich.js`'s `parseDate`.** **Left as-is:**
  importing `parseDate` would create a **circular dependency** (`enrich.js`
  already imports `gradeFromRow` from `sentiment.js`) and break the "engine
  imports nothing" rule that keeps it unit-testable in plain Node.

---

## 8. Test coverage

39 tests, `node --test` (zero new deps):

- **`sentiment.test.js`** — attribution (incl. relayed voice), scoreable gating +
  coaching fallbacks, determinism (deep-equal), valence sign (≥ 60 % on the strict
  fixture + high-confidence individual signs), all four arc transitions, the cap
  math, dup/PII hygiene, emotions/target vocabularies, and exact summary math.
- **`enrich.sentiment.test.js`** — the **parity** test (`enrichRow` vs
  `enrichForSql`), no-type-drift, baked == direct `gradeCase`, silent-row null
  survival, and a real Arrow round-trip.
- **`sentiment-export.test.js`** — both sheets, exact column order vs the spec,
  content, the auto-closed edge case, and the injection guard.
- **`ai-scrub.test.js`** — email/case/phone/name masking, no over-match on ISO
  dates, the 400-char cap, the deep-read field scrubbing, and
  non-mutation/determinism.

---

## 9. Manual QA checklist

Automated tests cover the engine, parity, export, and scrub. The following
checks need a human with a **real ServiceNow export** loaded via Connections
(the data layer is DuckDB-WASM/OPFS in a browser, outside the `node --test`
reach). Each notes what already backs it.

- [ ] **Load a real export → `/sentiment` renders.** Headline tiles, distribution
  chart, and per-case table populate from the active import.
- [ ] **Negatives sort to the top.** The table defaults to `valence` ascending —
  confirm the most-negative cases lead. _(Design + code; sort logic unit-shaped.)_
- [ ] **Expander shows the quote + coaching.** Activate a row (click, or Tab to
  the chevron button and press Enter/Space) → representative quote (italic text)
  + templated coaching note. _(a11y: single real button per row, no nesting.)_
- [ ] **Silent cases excluded from scoring but counted in coverage.** A
  phone-resolved case shows in "Phone / silent" and (if closed) "Auto-closed",
  but carries no valence/label. _(Backed by the silent-row + auto-closed tests.)_
- [ ] **Export round-trips.** "Download grades" produces a `.xlsx` that opens in
  Excel with both sheets, the exact column order, and no formula errors.
  _(Backed by the build→buffer→reload export test.)_
- [ ] **Deep-read gated correctly.** With `VITE_AI_PROXY_URL` unset, the deep-read
  card shows "not configured" and offers no action; with it set, "Deep-read the N
  negatives" sends only those (scrubbed) cases. _(Gate verified; live proxy n/a here.)_
- [ ] **Older import migrates.** An import built before v9 shows the "Rebuild
  needed" badge on Connections; "Rebuild from source" re-grades and the new
  `sentiment_*` columns populate. _(SCHEMA_VERSION 9 ⇒ `ImportsCard` stale check.)_
- [ ] **Filter bar drives the page.** Changing the analyst/date range updates the
  grades; navigating to `/sentiment` preserves the active filters.
- [ ] **Light + dark theme** both read correctly (tokens via `alpha()`); keyboard
  focus rings are visible on the header sort buttons and row chevrons.

---

## 10. Future follow-ups (small, optional)

- Span-distinct lexicon scoring (see §7) if exact valence magnitudes are ever
  asserted against the LLM review.
- A "negative cases" SQL filter / saved view, now that sentiment is a queryable
  column.
- Wire `VITE_AI_PROXY_URL` into the Electron setup screen so the deep-read can be
  enabled in packaged builds (today it stays inert there, by design).
