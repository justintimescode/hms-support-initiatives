// Combined attributes for the unified insight layer: the SOURCE-AWARE half.
//
// correlate.js is deliberately ignorant of ServiceNow and Jira. This module is
// where that ignorance is paid for: it holds the two adapters that turn enriched
// rows and enriched issues into abstract graph nodes/edges, the one priority
// scale both sources map onto, and the metric builders that read the resulting
// clusters. Adding a third source (Gainsight, a ServiceNow API connector) means
// adding an adapter HERE and changing nothing in the engine.
//
// Pure ESM: no React, no network, and no wall clock. Every value that depends on
// "when" takes an explicit `snapshotMs` — the active import's upload time — so a
// given import always renders identically. That invariant is also what makes
// this file testable, and it is enforced by a source scan in the test suite.
//
// Nothing here re-derives a value that enrich.js / jira-enrich.js / sentiment.js
// already own. Priorities read through `priorityRank`, percentiles through
// `stats.js`, aging through the existing bucket tables, sentiment through the
// baked `sentiment_*` columns, parent accounts through `dod.js`. This module
// combines; it does not compete.

import { priorityRank } from './enrich.js';
import { JIRA_AGING_BUCKETS } from './jira-enrich.js';
import { AGING_BUCKETS } from './constants.js';
import { percentile } from './stats.js';
import { RISK_HIGH, RISK_ELEVATED } from './sentiment.js';
import { parentAccountRaw } from './dod.js';
import { correlate, nodeKey, normalizeKey } from './correlate.js';
import {
  URGENCY_CRITICAL, URGENCY_HIGH, URGENCY_MEDIUM, URGENCY_LOW, URGENCY_LOWEST,
  JIRA_STALE_DAYS, MS_PER_DAY,
  ESC_NONE, ESC_WATCH, ESC_AT_RISK, ESC_ESCALATED, ESCALATION_LEVELS,
  MAX_ESCALATION_REASONS,
} from './insight-thresholds.js';

/* --------------------------------- sides --------------------------------- */

// Graph partition names. Opaque to correlate.js — it only groups by them.
export const SIDE_CASE = 'case';
export const SIDE_JIRA = 'jira';

/* ------------------------------ small helpers ---------------------------- */

// BIGINT columns can arrive as BigInt from DuckDB; the in-memory pipeline gives
// plain Numbers. Coerce once, and never turn a null into a 0 — see `sentimentOf`
// for why that distinction carries real meaning here.
const num = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Median of a numeric list, via the ONE interpolating percentile in stats.js.
 *  Never the `Math.floor((p/100) * len)` form that biased every Jira median
 *  high (CODEREVIEW(5-31).md P1 #1). */
export function medianOf(values) {
  const v = (values || []).filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? percentile(v, 50) : null;
}

/** Largest value in a list, or null. `reduce`, never `Math.max(...array)` —
 *  cluster member counts are data-dependent and a spread over a hot ticket's
 *  case list is the confirmed RangeError in CODEREVIEW(5-31).md P1 #3. */
export function maxOf(values) {
  return (values || []).reduce(
    (best, x) => (x == null || !Number.isFinite(x) ? best : best == null || x > best ? x : best),
    null,
  );
}

/** Whole days from `fromMs` to `toMs`, floored. Null when either end is unknown
 *  — an unknown age is reported as unknown, never as 0. */
export function daysBetween(fromMs, toMs) {
  if (fromMs == null || toMs == null) return null;
  return Math.floor((toMs - fromMs) / MS_PER_DAY);
}

/** Name of the aging bucket a day-count falls in, using an EXISTING bucket
 *  table (`AGING_BUCKETS` for cases, `JIRA_AGING_BUCKETS` for Jiras — identical
 *  thresholds by design, which is why the new charts agree with the old ones).
 *  Returns null when nothing matches, e.g. a negative age from a row created
 *  after the snapshot. */
export function ageBucketOfDays(days, buckets) {
  if (days == null) return null;
  const b = (buckets || []).find((x) => days >= x.min && days <= x.max);
  return b ? b.name : null;
}

/* ---------------------------- priority mapping --------------------------- */
//
// ServiceNow ships "1 - Critical" … "4 - Standard" and is read through
// `priorityRank` (which returns 99 — NOT null — for anything it cannot parse).
// Jira ships instance-specific name strings. Both map onto ONE 0..100 urgency
// scale so a cluster spanning both sources has a single comparable urgency.
//
// The tables live next to the function on purpose: retuning urgency should be a
// one-screen edit, not a hunt.

const SN_RANK_TO_URGENCY = {
  1: URGENCY_CRITICAL, // P1 Critical
  2: URGENCY_HIGH,     // P2 Major
  3: URGENCY_MEDIUM,   // P3 Medium / Standard (the label varies by export)
  4: URGENCY_LOW,      // P4 Standard
};

const JIRA_NAME_TO_URGENCY = {
  blocker: URGENCY_CRITICAL,
  highest: URGENCY_CRITICAL,
  critical: URGENCY_CRITICAL,
  urgent: URGENCY_CRITICAL,
  high: URGENCY_HIGH,
  major: URGENCY_HIGH,
  medium: URGENCY_MEDIUM,
  normal: URGENCY_MEDIUM,
  low: URGENCY_LOW,
  minor: URGENCY_LOW,
  lowest: URGENCY_LOWEST,
  trivial: URGENCY_LOWEST,
};

/**
 * Map a priority from either source onto the shared 0..100 urgency scale.
 *
 * Unknown is `null`, explicitly and always — never a silent default. This is
 * load-bearing on the ServiceNow side: `priorityRank` returns the sentinel `99`
 * for an unparseable priority, and letting `99` reach a 0..100 urgency scale
 * would rank every unknown-priority cluster as maximally urgent. Callers must
 * treat null as "not known", never as 0 and never as 100.
 *
 * @param {'case'|'jira'} source
 * @param {*} value  the raw priority ("2 - Major", "Highest", null, …)
 * @returns {number|null} 0..100, or null when unknown
 * @throws {TypeError} on an unrecognized `source` — that is a programming error,
 *   and failing loudly beats silently nulling out every priority in the app.
 */
export function normalizePriority(source, value) {
  if (source === SIDE_CASE) {
    if (value == null || String(value).trim() === '') return null;
    return SN_RANK_TO_URGENCY[priorityRank(value)] ?? null;
  }
  if (source === SIDE_JIRA) {
    if (value == null) return null;
    return JIRA_NAME_TO_URGENCY[String(value).trim().toLowerCase()] ?? null;
  }
  throw new TypeError(`normalizePriority: unknown source "${source}" (expected "${SIDE_CASE}" or "${SIDE_JIRA}")`);
}

/* ------------------------- per-record time helpers ----------------------- */

/** A case's age in days at the snapshot. Recomputed, never read from a cached
 *  wall-clock field. */
export function caseAgeDaysOf(row, snapshotMs) {
  const created = row?._created;
  return daysBetween(created ? created.getTime() : null, snapshotMs);
}

/**
 * Days since the case was linked to engineering, at the snapshot.
 *
 * Returns **null**, never 0, when the case carries no System "Jira Reference ID
 * … linked" note — i.e. its tickets came only from the `cause` field or a
 * free-text mention. That is the app-wide "Not linked" contract, which the
 * README and the CSV exports both depend on.
 *
 * Recomputed from `_jiraFirstLinked` rather than reading `_jiraDaysSinceLinked`,
 * which is derived from the wall clock in enrich.js and therefore drifts for any
 * import older than today (PLAN(unified-insights).md C7).
 */
export function daysLinkedOf(row, snapshotMs) {
  const linked = row?._jiraFirstLinked;
  if (!linked) return null;
  return daysBetween(linked.getTime(), snapshotMs);
}

/* ------------------------------- projections ----------------------------- */

/**
 * Project an enriched ServiceNow row into the stable case shape the Insight
 * Object exposes. Reads baked fields only — no re-derivation, and specifically
 * no re-grading of sentiment.
 */
export function projectCase(row, snapshotMs) {
  const ageDays = caseAgeDaysOf(row, snapshotMs);
  return {
    // NORMALIZED, deliberately. The graph keys case nodes by `normalizeKey(number)`
    // and `Insight.edges[].caseNumber` therefore carries the normalized form, so a
    // raw value here would put `caseNumbers[]` and `edges[]` in two different value
    // spaces. Consumers join those two — `blockersByJira` does exactly that — and a
    // mismatch makes the join silently find nothing and report ZERO cases for a
    // ticket that has some. That is the same silent-drop failure mode as the
    // unnormalized SN<->Jira lookup (CODEREVIEW(5-31).md P1 #2), and it is worse
    // here because it undercounts rather than under-decorates. Real ServiceNow case
    // numbers are already canonical, so this changes no displayed value on real
    // data; it makes the contract sound rather than accidentally sound.
    number: normalizeKey(row?.number) || null,
    shortDescription: row?.short_description || null,
    account: row?.account || null,
    parentAccount: parentAccountRaw(row),
    productLine: row?.product_line || null,
    // Both DO exist in the standard ServiceNow export; they were simply never
    // mapped before (see normalizeXlsxRow). Raw passthrough, in-memory only.
    region: row?.region || null,
    assignmentGroup: row?.assignment_group || null,
    assignedTo: row?.assigned_to || null,
    manager: row?.manager || null,
    priority: row?.priority || null,
    priorityNorm: normalizePriority(SIDE_CASE, row?.priority ?? null),
    category: row?._category ?? null,
    lifecycle: row?._lifecycle ?? null,
    // Raw timestamps (ms), so the global date-range filter can select on the
    // projection without reaching back into the enriched row.
    createdMs: row?._created ? row._created.getTime() : null,
    closedMs: row?._closed ? row._closed.getTime() : null,
    // Three-state lifecycle: `isOpen` is TRULY open. A Solution-Proposed case is
    // neither open nor closed, so it is excluded from open-work counts — never
    // use `!isClosed` to mean "open" (see [[closed-vs-resolved]] in enrich.js).
    isOpen: !!row?._isOpen,
    isClosed: !!row?._isClosed,
    ageDays,
    ageBucket: ageBucketOfDays(ageDays, AGING_BUCKETS),
    daysLinked: daysLinkedOf(row, snapshotMs),
    slaBreached: !!row?._slaBreached,
    slaBreachReason: row?._slaBreachReason ?? null,
    // Baked sentiment (v11). `sentimentRisk` is null for CLOSED cases by design.
    sentimentRisk: num(row?.sentiment_risk),
    sentimentEscalated: !!row?.sentiment_escalated,
    sentimentEscReason: row?.sentiment_esc_reason ?? null,
    sentimentLabel: row?.sentiment_label ?? null,
    sentimentSignals: row?.sentiment_signals ?? null,
    sentimentQuote: row?.sentiment_last_quote ?? row?.sentiment_quote ?? null,
  };
}

/**
 * Project a Jira key (plus its live issue, when synced) into the stable Jira
 * shape. `issue` is null for a key a case asserts a link to but that the current
 * Jira cache has no record of — the key is still a real cluster member, it just
 * reports `hasLive: false` and null attributes rather than pretending.
 *
 * Age and staleness are recomputed from `created`/`updated` against the
 * snapshot, NOT read from `enrichIssue`'s cached `_ageDays` / `_isStale`, which
 * are wall-clock-derived at enrich time and understate a cache hydrated days
 * later (CODEREVIEW(5-31).md P1 #5).
 */
export function projectJira(key, issue, snapshotMs, { isAtlassian = true, refActive = true, aliases = null } = {}) {
  const hasLive = !!issue;
  const created = issue?.created ?? null;
  const updated = issue?.updated ?? null;
  const ageDays = daysBetween(created ? created.getTime() : null, snapshotMs);
  const daysSinceUpdate = daysBetween(updated ? updated.getTime() : null, snapshotMs);
  const statusCategory = issue?.statusCategory ?? null;
  // Unknown when the issue is not in the cache — null, not a guess.
  const isOpen = hasLive ? statusCategory !== 'Done' : null;
  return {
    key,
    summary: issue?.summary || '',
    issueType: issue?.issueType ?? null,
    status: issue?.status ?? null,
    statusCategory,
    priority: issue?.priority ?? null,
    priorityNorm: normalizePriority(SIDE_JIRA, issue?.priority ?? null),
    assignee: issue?.assignee ?? null,
    fixVersions: issue?.fixVersions || [],
    ageDays,
    ageBucket: ageBucketOfDays(ageDays, JIRA_AGING_BUCKETS),
    daysSinceUpdate,
    // `>=` on whole days, matching `staleWithImpact` (the blast-radius side these
    // clusters project onto) rather than `enrichIssue`'s `>` on raw ms.
    isStale: isOpen === true && daysSinceUpdate != null && daysSinceUpdate >= JIRA_STALE_DAYS,
    updated,
    url: issue?.url ?? null,
    hasLive,
    isOpen,
    // False for an `RN-` ServiceNow Resolution Notes record: a real asserted
    // engineering link, but not an Atlassian ticket — so it has no live join and
    // must never be rendered as a browse URL.
    isAtlassian,
    // The ServiceNow-internal `RN-` refs that resolved onto this key (see
    // `buildAliasMap`). Display-only provenance: these are not separate tickets,
    // which is the whole point of resolving them, but a reader looking at a case's
    // work notes needs to see why an `RN-` they can find there is not on screen.
    // Empty for a key nothing aliased onto.
    aliasedFrom: aliasList(aliases),
    // Journal-inferred liveness, used ONLY when there is no live Jira join —
    // see `effectiveTicketStatus` in insight-rank.js.
    refActive,
    // The raw enriched issue, for consumers that need the full object (the
    // blast-radius row expander lazily fetches its description from it).
    issue: issue ?? null,
  };
}

/** `projectJira` for a correlated node, carrying the adapter's tags. */
export function projectJiraNode(node, snapshotMs) {
  return projectJira(node.id, node.data, snapshotMs, {
    isAtlassian: node.isAtlassian !== false,
    refActive: node.refActive !== false,
    aliases: node.aliases ?? null,
  });
}

/* --------------------------------- adapters ------------------------------ */

/**
 * Index enriched Jira issues by NORMALIZED key.
 *
 * Accepts an array of issues or an existing Map (e.g. `useAppData`'s
 * `jiraIssueMap`, which is keyed by the raw `issue.key`) and re-keys it. This is
 * the single boundary where the SN↔Jira join key is canonicalized on the Jira
 * side; `buildGraph` canonicalizes the ServiceNow side with the same helper, so
 * the two can no longer disagree (CODEREVIEW(5-31).md P1 #2).
 */
export function buildIssueIndex(issues) {
  const index = new Map();
  const iter = issues instanceof Map ? issues.values() : issues || [];
  for (const issue of iter) {
    if (!issue || issue.key == null) continue;
    const key = normalizeKey(issue.key);
    if (key && !index.has(key)) index.set(key, issue);
  }
  return index;
}

const pushInto = (map, key, value) => {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  if (!list.includes(value)) list.push(value);
};

/* ------------------------- internal-ref aliasing ------------------------- */

/**
 * Resolve each ServiceNow-internal `RN-` reference to the Atlassian key it stands
 * for, so one defect renders as ONE ticket.
 *
 * WHY THIS EXISTS. The two ids are the same ticket recorded twice, from two
 * different sides of the same workflow:
 *
 *   [Work notes] Jira Reference ID RN-9732370 has been linked to this case.
 *   [Cause]      External Defect ID: HMS-97290
 *
 * `RN-9732370` is the ServiceNow-side handle its integration mints when the case
 * is linked to engineering; `HMS-97290` is the Jira ticket an analyst records in
 * the `cause` field. Neither note names the other, so `parseJiraRefs` — which
 * pulls every `[A-Z]+-\d+` token independently — has no way to know they are one
 * thing. Both are asserted links, so both became graph nodes, and a cluster
 * listed `HMS-97290` and `RN-9732370` as two separate tickets: the same defect
 * double-counted in `distinctJiras`, halving `casesPerJira` and splitting the
 * blast-radius table into two rows that each told half the story.
 *
 * THE EVIDENCE IS CO-OCCURRENCE, and it has to be pooled across the whole
 * import rather than read off one case. That is the half that makes cases
 * carrying ONLY the `RN-` land in the right bucket: `RN-9732370` appears with
 * `HMS-97290` on 8 separate cases, so a 9th case whose `cause` field was left
 * blank still resolves onto `HMS-97290` instead of drifting off into a cluster of
 * its own. Measured on the two cached imports: of 317 distinct `RN-` refs, 215
 * co-occur with exactly one Atlassian key, 26 with several, and 76 with none.
 *
 * WHERE IT STOPS. A strict plurality is required: the top candidate must be
 * backed by more cases than the runner-up. That is what keeps the ambiguous 8%
 * honest rather than guessed at —
 *
 *   * `RN-9732370` → HMS-97290 ×8, HMS-97333 ×1. Resolved to HMS-97290. The lone
 *     dissenter is one case whose cause field reads `HMS-97290/HMS-97333`, i.e.
 *     a case blocked on two defects, not evidence about what the RN is.
 *   * `RN-9651814` → HMS-97002 ×2, HMS-96993 ×2. A genuine tie: NOT resolved.
 *     The ref stays its own node, exactly as before, and keeps rendering as a
 *     ServiceNow-internal reference. An unresolvable alias is left visible rather
 *     than attributed to a coin-flip winner.
 *
 * A tie is therefore never broken alphabetically: silently attributing a case to
 * the wrong defect is a worse failure than showing one extra row. The 76 refs
 * with no Atlassian key at all are untouched for the same reason — there is
 * nothing to resolve them to.
 *
 * Free-text mentions are NOT evidence. Allowing them would resolve a further 34
 * refs, but a mention is prose ("not related to HMS-123" matches too), and the
 * app-wide rule is that prose never asserts linkage — see `buildGraph`. Letting
 * a mention pick the alias target would launder a name-drop into an edge for
 * every case carrying that ref, which is precisely the rule's point.
 *
 * @param {object[]} rows  enriched SN rows (`enrichedAllJoined`) — the FULL
 *   corpus, never a filtered subset: the case that proves the alias may itself be
 *   filtered out of the view, and the mapping must not change with the filters.
 * @returns {Map<string,string>} normalized internal ref → normalized Atlassian key
 */
export function buildAliasMap(rows) {
  // internal ref -> Map(atlassian key -> number of cases asserting both)
  const tally = new Map();

  for (const row of rows || []) {
    const tickets = row?._jiraTickets || [];
    if (!tickets.length) continue;

    const internal = new Set();
    const atlassian = new Set();
    for (const t of tickets) {
      const id = normalizeKey(t?.id);
      // Prose is not evidence — see the note above.
      if (!id || t.source === 'mention') continue;
      // `clickable` is enrich.js's single source of truth for "is this a real
      // Atlassian ticket", reused here rather than re-deriving the `RN-` prefix.
      if (t.clickable === false) internal.add(id);
      else atlassian.add(id);
    }
    if (!internal.size || !atlassian.size) continue;

    for (const ref of internal) {
      let m = tally.get(ref);
      if (!m) {
        m = new Map();
        tally.set(ref, m);
      }
      // One case is one vote per distinct key, however many times it is written.
      for (const key of atlassian) m.set(key, (m.get(key) ?? 0) + 1);
    }
  }

  const alias = new Map();
  for (const [ref, m] of tally) {
    let best = null;
    let bestVotes = 0;
    let runnerUp = 0;
    // Sorted so the scan order — and therefore the outcome — cannot depend on
    // the order rows arrived in.
    for (const key of [...m.keys()].sort(cmpStr)) {
      const votes = m.get(key);
      if (votes > bestVotes) {
        runnerUp = bestVotes;
        bestVotes = votes;
        best = key;
      } else if (votes > runnerUp) {
        runnerUp = votes;
      }
    }
    // Strict plurality only. A tie leaves the ref unresolved.
    if (best && bestVotes > runnerUp) alias.set(ref, best);
  }
  return alias;
}

/**
 * THE ADAPTER: enriched ServiceNow rows → abstract graph nodes and edges.
 *
 * The link between a Jira ticket and a ServiceNow case lives IN the ServiceNow
 * case — `parseJiraRefs` already extracts it from the journals (`system_log`,
 * `work_notes`, `additional_comments`) and the `cause` field, and classifies
 * each reference by `source`. This function does not re-parse anything; it reads
 * `row._jiraTickets` and decides which of those references may become an edge.
 *
 * An edge is created for every asserted linkage, and ONLY for asserted linkage:
 *   * `source === 'mention'` NEVER creates an edge. A free-text name-drop is
 *     prose — even "not related to HMS-123" would match — so it must not make
 *     the case count as blocked. This is the one exclusion, and it is
 *     load-bearing across `_jiraActiveTickets`, "Likely closeable", the
 *     blast-radius counts, My Day triage and account risk; the README states it
 *     explicitly. Mentions are carried out separately so the UI can still show
 *     them, tagged.
 *   * `clickable === false` (an `RN-` ServiceNow-internal Resolution Notes ref)
 *     DOES create an edge, tagged `isAtlassian: false`. It is a genuine asserted
 *     link — enrich.js counts an RN- System note toward `_jiraFirstLinked` "by
 *     design", because the note marks the moment the case started waiting on
 *     engineering "whether the tracked record is a real Jira ticket or an
 *     internal Resolution Notes record". Two cases sharing an RN- really are
 *     correlated. What `isAtlassian: false` buys is that the key is never joined
 *     to the live Jira map and never rendered as a browse URL.
 *
 *     This matches the surfaces being consolidated: neither `blastRadius` nor
 *     JiraDashboard's `ticketGroups` skips a non-clickable ref today — mentions
 *     are the only thing either one drops. Excluding RN- here would silently
 *     delete rows from the blast-radius table and from "Tickets blocking
 *     multiple cases".
 *
 *     What it does NOT stay is a SEPARATE ticket from the Jira key it stands for.
 *     Every internal ref is first resolved through `aliasMap`, so the `RN-` handle
 *     and the `HMS-` key naming the same defect become one node with one edge
 *     rather than two of each. The raw ref is kept on the node as `aliases` so the
 *     UI can still show where the link came from. See `buildAliasMap` for how the
 *     mapping is derived and where it deliberately refuses to guess.
 *
 * A case with no ticket references at all is not part of the Jira ecosystem and
 * becomes no node — otherwise ~90% of a typical export would arrive as isolated
 * nodes for the caller to filter back out.
 *
 * Time-free by construction: correlation depends only on WHO links to WHAT, so
 * the snapshot anchor is needed for the projections and metrics, not here.
 *
 * @param {object[]} rows  enriched SN rows (`enrichedAllJoined`)
 * @param {Map<string,object>} issueIndex  from `buildIssueIndex`
 * @param {Map<string,string>} [aliasMap]  from `buildAliasMap`. Omitted ⇒ no
 *   aliasing, i.e. every reference keys a node under its own raw id.
 */
export function buildGraph(rows, issueIndex, aliasMap) {
  const caseNodes = new Map();
  const jiraNodes = new Map();
  const edges = [];
  const mentionsByCase = new Map();
  const internalByCase = new Map();
  const duplicateCaseNumbers = new Set();

  for (const row of rows || []) {
    const caseId = normalizeKey(row?.number);
    if (!caseId) continue;
    const tickets = row?._jiraTickets || [];
    if (!tickets.length) continue;

    const ck = nodeKey(SIDE_CASE, caseId);
    const existingCase = caseNodes.get(ck);
    if (!existingCase) {
      caseNodes.set(ck, { side: SIDE_CASE, id: caseId, data: row });
    } else if (existingCase.data !== row) {
      // Two DIFFERENT rows claiming one case number. A ServiceNow case number is
      // unique in reality, so this means the ingest mapped the wrong column — a
      // ServiceNow export can repeat the "Number" header (case number in one
      // column, account number in another), and taking the wrong one collapses
      // every case sharing an account into a single node, silently undercounting
      // blast radius. Surface it instead of merging quietly; `readXlsxRows` takes
      // the first occurrence of a repeated header precisely to prevent this.
      duplicateCaseNumbers.add(caseId);
    }

    // Resolve every asserted reference to its canonical id FIRST, then emit one
    // node and one edge per distinct canonical id. Emitting as we go would give a
    // case that carries both `RN-9732370` and `HMS-97290` two edges to the same
    // node — harmless to union-find, which is idempotent, but `caseCsvRows` lists
    // edge targets per case without deduping, so the CSV would read
    // "HMS-97290, HMS-97290".
    const resolved = new Map(); // canonical id -> pending node/edge facts
    const seenRaw = new Set();  // a case counts once per distinct RAW reference

    for (const t of tickets) {
      const rawId = normalizeKey(t?.id);
      if (!rawId || seenRaw.has(rawId)) continue;
      seenRaw.add(rawId);

      if (t.source === 'mention') {
        pushInto(mentionsByCase, caseId, rawId);
        continue;
      }

      // `clickable` is enrich.js's single source of truth for "is this a real
      // Atlassian ticket". A descriptor that omits it is assumed to be one.
      const rawInternal = t.clickable === false;
      // Recorded under the id the case actually carries, aliased or not: this is
      // provenance ("what does this case say"), not identity.
      if (rawInternal) pushInto(internalByCase, caseId, rawId);

      const alias = rawInternal ? aliasMap?.get(rawId) ?? null : null;
      const jiraId = alias ?? rawId;
      // Alias targets are Atlassian keys by construction, so the final id alone
      // decides this — two references resolving to one id always agree.
      const isAtlassian = !(rawInternal && !alias);

      // Journal-inferred liveness: `parseJiraRefs` marks a ticket 'jira_closed'
      // only when a System "…has been closed" note was seen. A key is treated as
      // still active if ANY referencing case says so — the fallback used when no
      // Jira sync has happened.
      const refActive = t.status !== 'jira_closed';
      const source = t.source ?? 'unknown';

      const pending = resolved.get(jiraId);
      if (!pending) {
        resolved.set(jiraId, {
          isAtlassian,
          refActive,
          kind: source,
          // True while the only reference backing this id came in through an
          // alias, so a direct one can still claim the edge's source below.
          viaAlias: !!alias,
          aliases: alias ? new Set([rawId]) : null,
        });
      } else {
        if (refActive) pending.refActive = true;
        if (alias) (pending.aliases ??= new Set()).add(rawId);
        // The reference that NAMES the ticket describes the link better than the
        // internal handle that resolved onto it, so it owns the edge's `source`.
        // This keeps `blockersByJira().sources` reading 'cause' for a key the
        // cause field names, exactly as it did before aliasing existed.
        if (!alias && pending.viaAlias) {
          pending.kind = source;
          pending.viaAlias = false;
        }
      }
    }

    // Insertion order — deterministic for a given row, and `correlate` sorts the
    // edges inside every component anyway.
    for (const [jiraId, r] of resolved) {
      const jk = nodeKey(SIDE_JIRA, jiraId);
      const existing = jiraNodes.get(jk);
      if (!existing) {
        jiraNodes.set(jk, {
          side: SIDE_JIRA,
          id: jiraId,
          isAtlassian: r.isAtlassian,
          refActive: r.refActive,
          // Every internal ref that resolved onto this key, pooled across cases.
          aliases: r.aliases ? new Set(r.aliases) : null,
          // An unaliased RN- key cannot be in the Jira cache, so do not even look.
          data: r.isAtlassian ? issueIndex?.get(jiraId) ?? null : null,
        });
      } else {
        if (r.refActive) existing.refActive = true;
        if (r.aliases) {
          if (!existing.aliases) existing.aliases = new Set();
          for (const a of r.aliases) existing.aliases.add(a);
        }
      }
      edges.push({ from: ck, to: jk, kind: r.kind });
    }
  }

  return {
    nodes: [...caseNodes.values(), ...jiraNodes.values()],
    edges,
    mentionsByCase,
    internalByCase,
    duplicateCaseNumbers: [...duplicateCaseNumbers].sort(cmpStr),
  };
}

/** Sorted array form of a node's pooled alias set — the shape the projections and
 *  the CSV expose. Always an array, never null, so consumers need no guard. */
const aliasList = (aliases) => (aliases ? [...aliases].sort(cmpStr) : []);

/**
 * Adapter + engine in one call: enriched rows and issues → connected components.
 *
 * Time-free, like `buildGraph`. The result is what `insight-rank.js` decorates
 * with projections, metrics, scores and narratives.
 */
export function correlateSources(rows, issues, aliasRows) {
  const issueIndex = buildIssueIndex(issues);
  // Derived from `aliasRows` — the FULL import — rather than from `rows`, which
  // on the Blockers page is one analyst's slice of open, engineering-owned cases.
  // The evidence that an `RN-` means a given Jira key often sits on a case the
  // current view filters out (a closed one, or another analyst's), so deriving
  // the mapping from the visible rows would make one defect render as one ticket
  // on the Operations page and two on the Blockers page — and flicker as the
  // analyst filter changes. Same reason `buildInsights` is memoized on the
  // unfiltered corpus: identity must not depend on what is on screen.
  const aliasMap = buildAliasMap(aliasRows || rows);
  const graph = buildGraph(rows, issueIndex, aliasMap);
  const result = correlate({
    nodes: graph.nodes,
    edges: graph.edges,
    // Jira keys make the readable component-id prefix — a cluster is the thing
    // engineering has to fix, and `c:HMS-4821:…` says that at a glance.
    idSide: SIDE_JIRA,
  });
  return {
    ...result,
    issueIndex,
    aliasMap,
    mentionsByCase: graph.mentionsByCase,
    internalByCase: graph.internalByCase,
    duplicateCaseNumbers: graph.duplicateCaseNumbers,
  };
}

/* -------------------------------- escalation ----------------------------- */

/** Position of a level in the ascending-severity enum. */
export const escalationRank = (level) => ESCALATION_LEVELS.indexOf(level);

const clip = (s, n = 120) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Derive the cluster's escalation status. ServiceNow has NO native escalation
 * field, so this is a documented composite of real signals, and it ships the
 * contributing reasons alongside the level rather than just a label.
 *
 * Signals, most severe first:
 *   escalated — an explicit `sentiment_escalated` event on any case (an
 *               escalation request, or the customer raising priority to P1/P2).
 *   at-risk   — a SOP-SLA breach (`_slaBreached` + `_slaBreachReason`), or an
 *               escalation risk at or above sentiment.js's validated RISK_HIGH.
 *   watch     — escalation risk at or above RISK_ELEVATED, or a stale Jira that
 *               still has at least one truly-open case behind it.
 *   none      — nothing above fired.
 *
 * Reasons are emitted severity-first and capped; the overflow is counted, not
 * silently discarded.
 *
 * @param {object[]} cases  `projectCase` outputs (arrive sorted by case number)
 * @param {object[]} jiras  `projectJira` outputs (arrive sorted by key)
 */
export function escalationOf(cases, jiras) {
  const caseList = cases || [];
  const jiraList = jiras || [];
  const openCases = caseList.reduce((n, c) => n + (c.isOpen ? 1 : 0), 0);

  let level = ESC_NONE;
  const bump = (next) => {
    if (escalationRank(next) > escalationRank(level)) level = next;
  };

  const escalated = [];
  const atRisk = [];
  const watch = [];

  for (const c of caseList) {
    if (c.sentimentEscalated) {
      bump(ESC_ESCALATED);
      const why = clip(c.sentimentEscReason);
      escalated.push(`${c.number} — escalation raised by the customer${why ? `: ${why}` : ''}`);
    }
  }
  for (const c of caseList) {
    if (c.slaBreached) {
      bump(ESC_AT_RISK);
      atRisk.push(`${c.number} — SOP SLA breached (${c.slaBreachReason || 'cadence'})`);
    }
    if (c.sentimentRisk != null && c.sentimentRisk >= RISK_HIGH) {
      bump(ESC_AT_RISK);
      atRisk.push(`${c.number} — escalation risk ${c.sentimentRisk}/100`);
    }
  }
  for (const c of caseList) {
    if (c.sentimentRisk != null && c.sentimentRisk >= RISK_ELEVATED && c.sentimentRisk < RISK_HIGH) {
      bump(ESC_WATCH);
      watch.push(`${c.number} — elevated escalation risk ${c.sentimentRisk}/100`);
    }
  }
  if (openCases > 0) {
    for (const j of jiraList) {
      if (j.isStale) {
        bump(ESC_WATCH);
        watch.push(`${j.key} — no Jira activity in ${j.daysSinceUpdate}d with ${openCases} case${openCases === 1 ? '' : 's'} still open`);
      }
    }
  }

  const all = [...escalated, ...atRisk, ...watch];
  const reasons = all.slice(0, MAX_ESCALATION_REASONS);
  const overflow = all.length - reasons.length;
  if (overflow > 0) reasons.push(`+${overflow} more`);

  return { level, reasons };
}

/* --------------------------------- rollups ------------------------------- */

/**
 * Worst-case sentiment across the cluster, read from the baked columns.
 *
 * `sentimentRisk` is null for CLOSED cases by design (sentiment.js scores
 * escalation risk for open work and reopen risk for Solution Proposed). Nulls
 * are SKIPPED, never coerced to 0 — a 0 would read as "measured, and safe",
 * which is a claim the data does not support.
 */
export function sentimentOf(cases) {
  let worstRisk = null;
  let worstQuote = null;
  let worstNumber = null;
  let negativeCount = 0;
  let escalatedCount = 0;
  for (const c of cases || []) {
    if (c.sentimentLabel === 'Negative') negativeCount++;
    if (c.sentimentEscalated) escalatedCount++;
    const r = c.sentimentRisk;
    // Strict `>` so the first case in (case-number) order wins a tie — stable.
    if (r != null && (worstRisk == null || r > worstRisk)) {
      worstRisk = r;
      worstQuote = c.sentimentQuote ?? null;
      worstNumber = c.number ?? null;
    }
  }
  return { worstRisk, negativeCount, escalatedCount, worstQuote, worstNumber };
}

/** Volume of the cluster. `openCases` is TRULY open (Solution Proposed excluded
 *  — it is no longer active engineering-blocked work). */
export function volumeOf(cases, jiraKeys) {
  const caseList = cases || [];
  const accounts = new Set();
  let openCases = 0;
  for (const c of caseList) {
    if (c.isOpen) openCases++;
    if (c.account) accounts.add(c.account);
  }
  const jiraCount = (jiraKeys || []).length;
  return {
    totalCases: caseList.length,
    openCases,
    distinctAccounts: accounts.size,
    distinctJiras: jiraCount,
    casesPerJira: jiraCount ? round2(caseList.length / jiraCount) : null,
  };
}

/**
 * Age comparison — the point of the whole age visualization: has the CASE been
 * waiting longer than the Jira has existed?
 *
 * `jiraAgeDays` / `caseAgeDays` describe ALL members (the cluster's real age
 * distribution). The two `oldestOpen*` scalars are the "oldest unresolved"
 * figures the ranking uses, kept separate so a cluster full of closed cases
 * cannot earn an age penalty for work nobody is waiting on.
 */
export function agesOf(cases, jiras) {
  const caseList = cases || [];
  const jiraList = jiras || [];

  const jiraAges = jiraList.map((j) => j.ageDays);
  const caseAges = caseList.map((c) => c.ageDays);
  const jiraMax = maxOf(jiraAges);
  const caseMax = maxOf(caseAges);

  // Tie → lowest key/number, since both lists arrive sorted and `>` is strict.
  let oldestKey = null;
  for (const j of jiraList) if (j.ageDays != null && j.ageDays === jiraMax) { oldestKey = j.key; break; }
  let oldestNumber = null;
  for (const c of caseList) if (c.ageDays != null && c.ageDays === caseMax) { oldestNumber = c.number; break; }

  return {
    jiraAgeDays: { max: jiraMax, median: medianOf(jiraAges), oldestKey },
    caseAgeDays: { max: caseMax, median: medianOf(caseAges), oldestNumber },
    // Positive ⇒ the case predates the Jira: the customer was already waiting
    // before engineering had a ticket to work.
    ageDelta: caseMax == null || jiraMax == null ? null : caseMax - jiraMax,
    oldestOpenJiraAgeDays: maxOf(jiraList.filter((j) => j.isOpen === true).map((j) => j.ageDays)),
    oldestOpenCaseAgeDays: maxOf(caseList.filter((c) => c.isOpen).map((c) => c.ageDays)),
  };
}

/**
 * Cluster-level urgency: the most urgent thing in the cluster defines it.
 *
 * Null when NO member has a known priority — never 0 (which would read as
 * "known to be trivial") and never a default high (which would let unknowns
 * jump the queue). Unknown members simply do not vote.
 */
export function clusterUrgency(cases, jiras) {
  return maxOf([
    ...(cases || []).map((c) => c.priorityNorm),
    ...(jiras || []).map((j) => j.priorityNorm),
  ]);
}

/**
 * Assemble the full `metrics` block of an Insight Object from already-projected
 * members. Takes no `snapshotMs`: the projections it reads are already anchored,
 * so there is no second place for a clock to sneak in.
 */
export function clusterMetrics(cases, jiras) {
  const jiraKeys = (jiras || []).map((j) => j.key);
  const ages = agesOf(cases, jiras);
  return {
    jiraAgeDays: ages.jiraAgeDays,
    caseAgeDays: ages.caseAgeDays,
    ageDelta: ages.ageDelta,
    oldestOpenJiraAgeDays: ages.oldestOpenJiraAgeDays,
    oldestOpenCaseAgeDays: ages.oldestOpenCaseAgeDays,
    priorityNorm: clusterUrgency(cases, jiras),
    escalation: escalationOf(cases, jiras),
    sentiment: sentimentOf(cases),
    volume: volumeOf(cases, jiraKeys),
  };
}

/** Stable comparator for projected members, exported so consumers that re-sort
 *  a filtered subset stay byte-identical to the engine's ordering. */
export const byCaseNumber = (a, b) => cmpStr(String(a?.number ?? ''), String(b?.number ?? ''));
export const byJiraKey = (a, b) => cmpStr(String(a?.key ?? ''), String(b?.key ?? ''));
