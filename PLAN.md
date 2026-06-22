# PLAN — Case Sentiment Grader

_Phase 0 deliverable. Grounded in a full recon of the codebase contract (see citations
below). Stop point: **GATE 0** — awaiting approval before Phase 1._

---

## 0. The one decision I need from you (GATE 0)

**The two baseline files do not exist in the repo.** `src/lib/sentiment.js` and
`src/components/charts/SentimentBlock.jsx` are both absent (verified by glob). The brief
says to treat them as the starting point "if they are not yet in the repo, place
`sentiment.js` at `src/lib/sentiment.js` and `SentimentBlock.jsx` at
`src/components/charts/SentimentBlock.jsx` first."

So there is no tuned lexicon for me to preserve. **My recommendation (and default if you
don't say otherwise): author both files from scratch to the exact API/spec in the brief**
(`POS`/`NEG`/`IMPACT` lexicons, `COMPRESS_K = 8`, `EMOTION_RULES`/`TARGET_RULES`, public
API `parseInteractionStream`/`scoreText`/`detectEmotions`/`detectFrustrationTarget`/
`gradeCase`/`summarizeSentiment`), tuned to clear the **≥ 60 % sign-agreement** bar on the
seed fixture. The "don't regress the tuned lexicon" constraint is then moot.

**If you have the tuned versions, paste them before I start Phase 1** and I'll harden +
integrate those instead of authoring new ones. Everything else in this plan is unaffected
by that choice.

---

## 1. Architecture (as decided in the brief — implementing, not relitigating)

Sentiment is a **baked, derived field**, exactly like SLA / interaction counts / category.
Computed once in the shared enrichment functions; the small scalar/short-string outputs are
persisted in DuckDB; the UI reads baked fields and only falls back to the engine at render
time when a field is absent (older import, not yet rebuilt). This makes sentiment a
queryable dimension and avoids re-grading on every filter change.

The engine (`src/lib/sentiment.js`) stays **framework-free** (pure ESM, no React/recharts/
Vite) so it's unit-testable in plain Node and reusable by the enrichment pipeline. A single
shared helper `gradeFromRow(r)` does one stream parse per row and returns the baked fields;
both `enrichRow` and `enrichForSql` call it.

---

## 2. Confirmed codebase facts (with citations)

| Fact | Location |
|---|---|
| `WORK_NOTE_HEADER = /^(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})\s*-\s*(.+)/gm` | `src/lib/enrich.js:196` |
| `ANALYST_AUTHOR = /\(Infor\)/i` (matches literal `(Infor)`) | `src/lib/enrich.js:197` |
| `parseInteractions(text)` → `{totalTurns, customerTurns, analystTurns}`; header path tests `m[2]` vs `ANALYST_AUTHOR`; header-less path → all `customerTurns:0` | `src/lib/enrich.js:315-328` |
| Customer comment stream = `r.work_notes` (`enrichForSql` calls `parseInteractions(r.work_notes)`) | `src/lib/enrich.js:593` |
| Field-map: `work_notes: r['Additional comments'] ?? r['Work notes'] ?? null` | `src/lib/enrich.js:183` |
| `enrichRow(r, snapshotMs)` returns `{...r, _camelCase fields}` | `src/lib/enrich.js:465` |
| `enrichForSql(r, snapshotMs)` returns `{snake_case fields}` — strings `?? null`, booleans plain, **counts plain Number, only `*_ms` use `BigInt()`** | `src/lib/enrich.js:556-643` |
| `SQL_COLUMNS` (37 entries, last = `lifecycle`), append-only for positional Arrow alignment | `src/lib/enrich.js:647-688` |
| `SCHEMA_VERSION = '8'`; changelog comment block | `src/lib/enrich.js:21-45` |
| Worker imports `{ enrichForSql, SQL_COLUMNS, SCHEMA_VERSION }` | `src/workers/db.worker.js:14` |
| **`CASES_COLUMNS` DDL — explicit typed columns; tables created from it, then `insertArrowTable({create:false})`** | `src/workers/db.worker.js:24-62, 182, 242` |
| `buildArrowTable` loops `SQL_COLUMNS` → `arrow.tableFromArrays(cols)` | `src/workers/db.worker.js:170-178` |
| "Rebuild needed" badge: `stale = imp.schemaVersion !== schemaVersion` | `src/components/connections/ImportsCard.jsx:130,152` |
| Theme tokens + `alpha(color, fraction)` (color-mix; never hex-concat) | `src/lib/theme.js:12, 69-71` |
| `Card` / `Section` / `Pill {color}` / `CopyableNumber` (forces `T.snGreen`) / `EmptyState {title,subtitle,message,cta}` | `src/components/...` |
| `.eyebrow` `.display` `.mono` `.fade-in` `.scrollbar` injected in `Shell.jsx`; `prefers-reduced-motion` block in `index.css:282-296` (theme-toggle only) | `Shell.jsx`, `index.css` |
| AI seam: `aiClient.isConfigured()`, `aiClient.analyzeCases(payload)` → POST `${VITE_AI_PROXY_URL}/api/insights`; `AiNotConfiguredError` | `src/lib/ai-client.js` |
| `scrubForAi({label, cases[]})` masks `number/account/assigned_to`, `scrubText` on `short_description`/`close_notes` only; exports `shortHash`, `scrubText` | `src/lib/ai-scrub.js` |
| `AiBlock` 4-state machine (not-configured card / loading / error+retry / result) | `src/components/ai/AiBlock.jsx` |
| Routes under `<AppLayout>`; `NAV_GROUPS` "Tools" group; `useOutletContext()` provides `{rows, view, enriched, teamMembers, ...}` | `App.jsx:35-59`, `AppLayout.jsx:17-65,77`, `InsightsPage.jsx:7` |
| Filter-preserving nav via `FilterNavLink` / `useFilterNavigate` | `src/components/FilterLink.jsx`, `src/lib/nav.js` |
| DOMPurify pattern (SECURITY #10) | `src/components/jira/JiraAnalysisBlock.jsx:113-115` |
| Recharts idiom: `ResponsiveContainer` in fixed-height div in `Card`, T-token colors | `charts/TrajectoryBlock.jsx`, `charts/SlaBlock.jsx` |
| Sort/expand table idiom (no keyboard a11y today) | `CaseTable.jsx`, `JiraAnalysisBlock.jsx` |
| ExcelJS used via `(await import('exceljs')).default`; CSV export sanitizes formula injection (SECURITY #7) | `useAppData.js:126`, `csv-export.js:24-26` |
| No `*.test.js` anywhere; no `test` script; `"type":"module"` | repo-wide |

---

## 3. New persisted columns (the `sentiment_*` schema)

Appended **after `lifecycle`** in `SQL_COLUMNS` (`enrich.js`) **and** in `CASES_COLUMNS`
DDL (`db.worker.js`) — order must stay aligned (positional Arrow bind).

| Column | DDL type | JS value (both pipelines) | Meaning |
|---|---|---|---|
| `sentiment_scoreable` | `BOOLEAN` | `bool` | ≥ 1 attributable customer message |
| `sentiment_valence` | `BIGINT` | `Number \| null` | compressed tone −5..+5 (null if !scoreable) |
| `sentiment_label` | `VARCHAR` | `'Positive'\|'Neutral'\|'Negative'\|null` | bucketed valence |
| `sentiment_start` | `BIGINT` | `Number\|null` | opening-message valence (−5..+5) |
| `sentiment_end` | `BIGINT` | `Number\|null` | closing-message valence (null if single touchpoint) |
| `sentiment_arc` | `VARCHAR` | `string\|null` | `improved (recovery)` / `stable` / `declined` / `single touchpoint` |
| `sentiment_emotions` | `VARCHAR` | `string` | controlled-vocab, comma-joined |
| `sentiment_target` | `VARCHAR` | `string\|null` | frustration target (controlled vocab) |
| `sentiment_quote` | `VARCHAR` | `string\|null` | representative customer line (plain text, capped) |
| `sentiment_coaching` | `VARCHAR` | `string\|null` | templated coaching note |
| `sentiment_pii` | `BOOLEAN` | `bool` | credential / remote-access exposure in stream |
| `sentiment_dup` | `BOOLEAN` | `bool` | duplicate analyst double-post (≤ 60 s) |

`sentiment_valence` is a plain `Number|null` (not `BigInt`) — matching the **proven**
count-column convention (`priority_rank`, `interaction_count`, `customer_turns` are plain
Numbers fed into `BIGINT` DDL columns at `enrich.js:625,635-637`). This keeps the parity
deep-equal trivially true (`Number === Number`). Null survival through the Arrow path is a
Phase-2 test; if Arrow null-typing of an all-silent batch misbehaves, fall back to `DOUBLE`.

Responsiveness (median first reply h, % within 1 h) is derived in `summarizeSentiment` from
the **existing** `frt_ms` — no new column. "Auto-closed" = `is_closed && customer_turns===0`,
derived in summary/export — no new column.

`SCHEMA_VERSION` `'8' → '9'`, with a `// v9:` changelog comment matching the existing style.

---

## 4. Files touched, by phase

**Phase 1 — engine + tests**
- `src/lib/sentiment.js` _(new)_ — pure engine; full API + `gradeFromRow(r)` shared helper.
- `src/lib/sentiment.test.js` _(new)_ — `node --test`; attribution, gating, determinism,
  valence-sign (≥60 %), arc, hygiene, summary math.
- `package.json` _(edit)_ — add `"test": "node --test"`.
- _(verify `eslint.config.js` lints/ignores the new test files cleanly.)_

**Phase 2 — bake into enrichment**
- `src/lib/enrich.js` _(edit)_ — import `gradeFromRow`; add the 12 `sentiment_*` keys to
  **both** `enrichRow` and `enrichForSql` (identical snake_case keys, identical values);
  extend `SQL_COLUMNS`; bump `SCHEMA_VERSION`; add `// v9:` changelog.
- `src/workers/db.worker.js` _(edit)_ — append the 12 columns to `CASES_COLUMNS` DDL
  (**required**, contrary to the brief's assumption — see Deviation 2).
- `src/lib/enrich.sentiment.test.js` _(new)_ — **parity test** (the most important),
  baked-equals-`gradeCase`, silent-row null survival.

**Phase 3 — UI**
- `src/components/charts/SentimentBlock.jsx` _(new)_ — reads baked fields, falls back to
  `summarizeSentiment(rows)`; headline tiles + recharts distribution + sortable/expandable
  per-case table; keyboard-activatable; `EmptyState`; reduced-motion-safe.
- `src/pages/SentimentPage.jsx` _(new)_ — sources rows via `useOutletContext()` exactly like
  `InsightsPage` (team vs individual).
- `src/App.jsx` _(edit)_ — register `<Route path="/sentiment" .../>`.
- `src/components/layout/AppLayout.jsx` _(edit)_ — add `{to:"/sentiment", label:"Sentiment",
  icon:…}` to the Tools group (icon imported from an already-proven `lucide-react` export).

**Phase 4 — deep-read + export**
- `src/lib/ai-client.js` _(edit)_ — add `reviewSentiment(payload)` → POST `/api/sentiment`
  (mirrors `analyzeCases`; documented), gated on `isConfigured()`.
- `src/lib/ai-scrub.js` _(edit, additive)_ — extend `scrubForAi` to also `scrubText` the
  comment/journal/`quote` fields used by the sentiment payload (existing AiBlock fields
  untouched → no behavior change; strengthens defense-in-depth).
- `src/lib/sentiment-export.js` _(new)_ — exceljs two-sheet workbook (`Headline Metrics`,
  `Per-Case Detail` in the exact column order); cells routed through `sanitizeCellForExport`.
- `SentimentBlock.jsx` / `SentimentPage.jsx` _(edit)_ — opt-in per-case / "deep-read the N
  negatives" action (calm not-configured card when unconfigured) + "Download grades" button.

**Phase 5 — docs**
- `CODEREVIEW(sentiment).md` _(new)_, `README.md` _(edit, "Customer sentiment" section)_.

---

## 5. Engine design notes (Phase 1)

- `parseInteractionStream(text)` → ordered `[{ts:Date|null, author, isAnalyst, text}]`,
  reusing **identical** `WORK_NOTE_HEADER` + `ANALYST_AUTHOR` semantics (so counts never
  disagree with `parseInteractions`). Sort by `ts` when all present, else preserve order.
  Strips `[code]…[/code]` blocks and HTML tags; handles header-less / empty / relayed-voice.
- `scoreText`: `POS`/`NEG`/`IMPACT` lexicons → **diminishing-returns cap** (after the first
  3 distinct same-polarity hits in one message, additional hits weight 0.5×) → saturating
  compression with `COMPRESS_K = 8` to −5..+5. Re-check magnitudes vs the fixture so a single
  rant lands near ±2–3, not ±5.
- `gradeCase`: scoreable gating (≥1 customer msg), start/end/arc, emotions, target, quote,
  templated coaching, `pii` (AnyDesk/`password:`-style), `dup` (identical analyst body ≤60 s).
- `summarizeSentiment(rows)`: prefers baked fields, falls back to `gradeFromRow`; computes
  coverage / distribution / trajectory / responsiveness (`frt_ms`) / hygiene. Memoized at the
  call site.
- **Determinism:** no `Date.now()`, no `Math.random()`, no locale parsing. FRT comes from
  parsed stream timestamps / baked `frt_ms`, never "now".

---

## 6. Deviations from the brief (each justified)

1. **Baseline files absent → authored to spec.** (Brief's documented fallback. See §0.)
2. **Worker DDL *must* change.** Brief: "worker needs no change beyond consuming the new
   `SQL_COLUMNS`." Reality (`db.worker.js:24-62,182,242`): tables are created from the
   explicit `CASES_COLUMNS` DDL and rows inserted with `{create:false}`, so the new columns
   must also be appended to that DDL with SQL types, or the Arrow insert mismatches.
3. **12 baked fields, not 10.** Added `sentiment_pii` + `sentiment_dup`. The brief says the
   names are "a suggestion"; baking hygiene keeps `summarizeSentiment` fully baked-field-based
   (no stream re-parse on every filter change — the architecture's stated goal) and makes
   hygiene a queryable dimension. Both are non-null booleans → Arrow/DuckDB-safe.
4. **`sentiment_*` keys are snake_case in *both* `enrichRow` and `enrichForSql`** (the SLA
   fields use `_camelCase` vs `snake_case`). Required by the brief's parity test
   (`enrichRow(r).sentiment_*` deep-equals `enrichForSql(r).sentiment_*`) and lets the UI read
   one uniform key regardless of source.
5. **`sentiment_valence` = plain `Number|null` + `BIGINT` DDL** (not `BigInt`), matching the
   proven count-column convention and keeping parity exact. (See §3.)
6. **`scrubForAi` extended additively** to cover comment/journal/`quote` free-text for the
   deep-read; existing AiBlock payload fields are untouched (no behavior change).
7. **Keyboard a11y added** to the sentiment table (focusable sortable headers, Enter/Space-
   activatable rows) — exceeds `CaseTable` (which has none), per the brief's a11y floor.
8. **Excel export sanitizes cells** via `sanitizeCellForExport` (SECURITY #7).

---

## 7. Security & invariants held throughout

- **SECURITY #1:** engine is 100 % local; deep-read goes only through `aiClient` +
  `scrubForAi`; no direct vendor `fetch`.
- **SECURITY #10:** quotes render as **text** (no `dangerouslySetInnerHTML`); DOMPurify only
  if HTML is ever introduced.
- **SECURITY #7:** export cells sanitized against formula injection.
- **No new runtime deps** (recharts / lucide-react / exceljs / dompurify already present;
  tests use Node's built-in runner).
- `npm run lint` + `npm run build` stay green; SLA / categories / interaction counts / Jira
  behavior untouched.

---

## 8. Gate checklist

- **GATE 0 (here):** approve §0 decision + this plan.
- **GATE 1:** `npm run test` + `npm run lint`, note on diminishing-returns magnitude change.
- **GATE 2:** `npm run test` + `npm run lint` + `npm run build`; parity test green.
- **GATE 3:** `npm run build` + `npm run lint`; states (data / empty / sorted / expanded).
- **GATE 4:** `npm run build` + `npm run lint`; deep-read disabled-state + clean `.xlsx`.
- **GATE 5:** full green run + `CODEREVIEW(sentiment).md` + README.
