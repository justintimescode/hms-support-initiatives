# Code Review — ServiceNow KPI Analyzer (2026-05-31)

Updated review covering the `feat/analytics-and-hardening` cycle. Captures what
was fixed/added this round and the prioritized findings that remain open.

---

## Overall health

A genuinely well-engineered internal tool — better than most. The architecture
is coherent (single-source-of-truth enrichment feeding both an in-memory and a
DuckDB pipeline, opaque-token URL filters, parameterized SQL, a clean
page → block → chart hierarchy), and inline comments explain the *why* of most
decisions. The dominant risks are not structural; they are **statistical
accuracy** (a couple of metrics are subtly biased), **doc/behavior drift** (now
largely corrected), and **leftover migration scaffolding**.

Build: `npm run build` passes. Lint: **24 pre-existing ESLint errors** remain
(unused vars + one `set-state-in-effect`); none introduced this cycle.

---

## Shipped this cycle (`feat/analytics-and-hardening`)

### Security / hardening
- **CSV formula-injection fixed.** The Update-Queue CSV export shipped with its
  own `escapeCsv()` that only did RFC-4180 quoting and bypassed the
  formula-injection guard. It now routes every cell through
  `sanitizeCellForExport()` (`csv-export.js`). — *SECURITY_CONCERNS #7*
- **Disk mirror hardened.** `.servicenow-cache/` (raw, unencrypted customer
  exports written during `npm run dev`) is now **opt-in, default OFF**
  (`settings.js` `getDiskBackup`, Settings toggle). `enforceAutoDelete` now
  deletes the disk layer too (was orphaning plaintext copies), and a boot-time
  `sweepDiskOrphans()` reconciles the mirror against the live index. —
  *SECURITY_CONCERNS #14*
- **Doc corrections.** `SECURITY_CONCERNS.md` corrected for the removed 24h
  OPFS auto-TTL (#4) and the two new surfaces (#14 disk mirror, #15 AI scrub
  limits). `README.md` brought in line with the multi-import model, retention,
  disk mirror, CSV export, real Settings/Connections, and the DuckDB schema.

### Analytics / UX
- **My Day** (`/my-day`) — personal triage page: overdue updates, SLA-at-risk,
  stuck cases, Jira-blocked work for the selected analyst; ignores the global
  date filter (live open work).
- **Median / p90 resolution** on the Dashboard KPI row and Team Leaderboard
  (`computeKpis` now returns `resP50/resP90/frtP50/frtP90`).
- **First-response-time distribution** histogram + p50/p90/avg (SLA page).
- **SLA breach forecast** — open cases due to breach within 7 days, ranked, with
  stalled / no-response momentum flags (SLA page); snapshot-anchored.
- **Account churn-risk** — rising volume + falling SLA + open Jira blockers,
  ranked with explainable signal chips (Accounts page).

### Categorization (WIP folded in)
- Reworked HMS taxonomy; best-score categorization weighting the case title over
  the comments journal; `SCHEMA_VERSION 2 → 4` (existing imports show "Rebuild
  needed"); `createImport` preserves `uploadedAt` on cold-boot restore.

---

## Open findings (prioritized)

### P1 — Statistical correctness (numbers users already trust)
1. **Jira percentiles biased high.** `jira-enrich.js:~204` and
   `jira-stats.js:~26` use `Math.floor((p/100) * len)` — for a median over 4
   values this returns the 3rd. The SN-side `stats.js` `percentile` interpolates
   correctly. Every Jira median / p85 / p90 skews upward. **Fix:** consolidate
   onto the `stats.js` implementation (single shared helper).
2. **SN↔Jira join keys not normalized.** `jira-stats.js` `blastRadius` /
   `jira-enrich.js` `mergeJiraIntoRows` key the live map by canonical
   `issue.key` but look up regex-parsed `t.id` with no `.toUpperCase()/.trim()`
   — a synced ticket can wrongly show as "not live." **Fix:** normalize both
   sides.
3. **`Math.max(...g.cases.map(...))`** (`JiraDashboard.jsx:~266`) spreads an
   unbounded array → `RangeError` on exactly the hot tickets the blast-radius
   feature exists to surface. **Fix:** use a reduce.
4. **Cycle-time selection bias** (`jira-enrich.js:~163`): issues that went
   straight to Done (no "In Progress" event) get `null` cycle time and drop out
   of the median denominator, biasing it toward longer cycles.
5. **Cached `Date.now()` staleness** (`jira-enrich.js` `timeInStatus`,
   `_ageDays`, `_isStale`): computed at enrich time and cached, so a cache
   hydrated days later understates current dwell.

### P2 — Robustness / smaller correctness
- `SlaBlock.jsx:~82` `String(r.priority)` renders literal `"null"` — guard with
  `String(r.priority || "")`.
- `TeamView.jsx:~171` unguarded `r._jiraTickets.length` — use `?.length`.
- Legacy Jira pagination can truncate when `total` is absent
  (`jira-client.js:~241`); `_searchMode` pins to legacy for the whole session on
  one transient 403.
- JQL is string-interpolated from parsed keys (`jira-client.js:~310,338`) —
  validate keys against `^[A-Z][A-Z0-9]+-\d+$` first.

### P2 — Security (still open / by design)
- **OPFS unencrypted, no expiry by default.** Opt-in auto-delete ships OFF;
  consider enabling with a 7–30 day default. (#4)
- **AI free-text scrub is heuristic** — misses phones, addresses, single names,
  confirmation numbers. Latent (no proxy deployed); must be hardened + re-scrubbed
  server-side before the proxy ships. (#15)
- **`window.__jira` dev hook** (`jira-client.js`) — gated on DEV, stripped from
  prod builds; remove or hide behind an explicit local flag. (#12)
- **Jira token in plaintext `.env`** + the **GitLab PAT embedded in the git
  remote URL** — rotate the PAT and move to a credential helper. (#13)
- **No authentication** — fine for local use; needs a gate if ever hosted. (#11)

### P3 — Performance
- **Dev-only SQL runs in production**: `Home.jsx`, `PriorityPage.jsx`,
  `CategoriesPage.jsx`, `AccountsPage.jsx` call `useQuery(...)` to feed
  `<DevCompare>`, which renders `null` outside DEV — so the DuckDB round-trips
  execute on every filter change in prod just to be discarded. Gate `enabled` on
  `import.meta.env.DEV`.
- **Unmemoized `flatMap`** in several page wrappers (`BacklogPage`, `Cadence`,
  `Insights`, `Cases`) re-allocates a big array each render.
- **`CaseTable` renders all rows** with no virtualization — the biggest UI
  scalability risk on large exports.

### P3 — Code quality / consistency
- **24 ESLint errors** — mostly unused vars; add a CI lint gate.
- **Dead AI path** in `TeamView` `MemberCard` (`onRunAi` / `setShowAi` /
  `showAi` never fire; button hard-disabled). Wire it or delete the plumbing.
- **Duplicate widgets/helpers**: `DevKpiCompare` vs `dev/DevCompare`; multiple
  `fmtBytes`; two percentile impls (see P1.1); two CSV-row builders.
- Stale tooltip copy in `JiraAnalysisBlock` ("IndexedDB cache write failed" —
  caching moved to disk).

### P3 — Accessibility (consistent gap)
- Sortable `<th onClick>`, clickable `<tr>` rows, and heatmap tiles are
  mouse-only (no `role` / `tabIndex` / `onKeyDown` / `aria-sort`). Several status
  cells signal by color alone.

---

## Suggested next steps (highest value first)
1. **Fix the Jira percentile bias + join-key normalization** (P1.1, P1.2) — they
   affect numbers already on screen and unblock further Jira stats.
2. **Replace the `Math.max(...)` spread** (P1.3) — latent crash on hot tickets.
3. **Gate dev-only SQL behind `import.meta.env.DEV`** (P3) — free prod win.
4. **Decide the dead AI path** — wire `runMemberAi` to the button or remove it.
5. **Add a CI lint gate** once the 24 existing errors are cleared.
6. **Rotate the exposed GitLab PAT** and move to a credential helper.

---

## Future feature ideas (beyond this cycle)
- CSAT / survey integration (Surveys + Gainsight placeholders) → "SLA met but
  customer unhappy" analysis.
- Reopen rate & first-contact-resolution (interaction turns already parsed).
- Backlog burn-down / forecast (weekly net already computed).
- Saved/named views (filters already serialize to the URL).
- Full case-register export (sanitizer now wired) and dark mode + virtualized
  tables for polish.
- "Data freshness vs. now" banner on snapshot-anchored views (Update Queue / My
  Day) to prevent acting on a stale upload.
