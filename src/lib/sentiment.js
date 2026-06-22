// Case Sentiment Grader — deterministic, client-side, no LLM, no network.
//
// WHY THIS EXISTS
// The "Customer Sentiment Review" spreadsheet was produced by reading every
// customer message through an LLM. That is accurate but slow and costly to run
// across an entire export. This module reproduces the *structured* columns of
// that review — valence, sentiment label, start/end, arc, emotions, frustration
// target, a representative quote, and a templated coaching note — with a pure
// lexicon-and-heuristic engine that runs over the parsed journal in the browser.
//
// It is a sibling of enrich.js in spirit: a single source of truth, pure of
// wall-clock and randomness, so the same row always grades to the same result.
// It deliberately does NOT call the AI proxy. The LLM stays available for an
// optional "deep read" of a handful of cases (see SentimentBlock), not the
// whole queue.
//
// HONEST LIMITS (measured against the LLM review's representative quotes):
//   - Valence direction agrees with the LLM ~2/3 of the time on a single line,
//     and better across a full message stream where start/end/arc are visible.
//   - The free-text coaching prose and the parenthetical qualifiers the LLM
//     adds ("product (UTC display confusion)") are NOT reproduced — this engine
//     emits the base category plus a templated note. Context-only tone
//     (sarcasm, "is it fixed by now?") is the main miss.
//
// SECURITY: operates only on text already in the browser; emits no identifiers
// it was not given. Nothing here leaves the device.

/* ------------------------------------------------------------------ *
 * 1. Journal parsing — ordered, attributed message stream            *
 * ------------------------------------------------------------------ */

// Matches a ServiceNow journal entry header:
//   "2026-05-31 10:30:29 - Jane Doe (Infor) (Additional comments)"
// Capture 1 = timestamp, capture 2 = the rest of the header line (author + type).
// Mirrors WORK_NOTE_HEADER in enrich.js so attribution stays consistent.
const ENTRY_HEADER = /^(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})\s*-\s*(.+)$/gm;
// An entry whose author line contains "(Infor)" is analyst-authored; otherwise
// it is the customer (or a relayed customer voice).
const ANALYST_AUTHOR = /\(Infor\)/i;

const parseTs = (s) => {
  if (!s) return null;
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d.getTime();
};

const stripEntryChrome = (s) =>
  String(s || "")
    .replace(/\[code\][\s\S]*?\[\/code\]/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\((Additional comments|Work notes|Comments)\)\s*$/i, "")
    .trim();

/**
 * Split a journal blob into an ordered list of attributed messages.
 * Each entry's body is the text between its header and the next header.
 *
 * @param {string} text  the work_notes / additional_comments journal
 * @returns {Array<{ts:number|null, author:string, isCustomer:boolean, body:string}>}
 *          in chronological order as written (journals export newest-first or
 *          oldest-first depending on the instance; we sort by timestamp when we
 *          have them, else preserve file order).
 */
export function parseInteractionStream(text) {
  if (!text) return [];
  const raw = String(text);
  const heads = [...raw.matchAll(ENTRY_HEADER)];
  if (heads.length === 0) {
    // No recognizable headers — treat the whole blob as one untyped block.
    const body = stripEntryChrome(raw);
    return body ? [{ ts: null, author: "", isCustomer: true, body }] : [];
  }
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const m = heads[i];
    const start = m.index + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : raw.length;
    const body = stripEntryChrome(raw.slice(start, end));
    const authorLine = m[2] || "";
    out.push({
      ts: parseTs(m[1]),
      author: authorLine.replace(/\((Additional comments|Work notes|Comments)\)\s*$/i, "").trim(),
      isCustomer: !ANALYST_AUTHOR.test(authorLine),
      body,
    });
  }
  // Sort chronologically when every entry has a timestamp; otherwise keep order.
  if (out.every((e) => e.ts != null)) out.sort((a, b) => a.ts - b.ts);
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. Lexicon — tuned to support / hospitality-PMS vocabulary          *
 * ------------------------------------------------------------------ */

// Weights are on a roughly -3..+3 per-term scale; a message's raw sum is
// clamped to -5..+5. Tuned from the vocabulary the LLM reacted to in the
// review (gratitude & closure read positive; persistence & breakage read
// negative; business-impact language reads anxious-negative).
const POS = {
  thank: 2, thanks: 2, "thank you": 2.5, appreciate: 2, appreciated: 2, appreciation: 2,
  resolved: 2, resolve: 1.5, works: 2, working: 1.5, worked: 2, fixed: 1.8, fix: 1,
  perfect: 3, excellent: 3, awesome: 3, great: 2, wonderful: 2.5, fantastic: 3,
  helpful: 2, "good to go": 2.5, "all set": 2.5, sorted: 2, success: 2, successful: 2,
  successfully: 2, confirmed: 1, confirm: 0.8, glad: 1.5, happy: 2, pleased: 2,
  smoothly: 1.5, smooth: 1.5, "no issues": 1.5, "no longer": 1, finalise: 1, finalize: 1,
};
const NEG = {
  still: -1.5, again: -1, "once again": -1.5, problem: -1.5, problems: -1.5, issue: -1,
  issues: -1, error: -1.5, errors: -1.5, unable: -2, "can't": -1.5, cannot: -1.5,
  "won't": -1.2, broken: -2, break: -1.5, breaking: -1.8, fail: -2, failed: -2,
  failing: -2, failure: -2, down: -1.5, outage: -2.5, crash: -2, crashed: -2,
  crashing: -2.2, frozen: -1.8, stuck: -1.5, slow: -1.5, lag: -1.2, hang: -1.5,
  urgent: -1.5, asap: -1.2, critical: -1.5, wrong: -1.5, missing: -1.5, "not working": -2.2,
  "doesn't work": -2.2, "not able": -1.8, frustrated: -2.5, frustrating: -2.5,
  disappointed: -2, disappointing: -2, unacceptable: -3, ridiculous: -3,
  irrelevant: -2.5, "kicked down": -3, delay: -1.5, delayed: -1.5, waiting: -1,
  concerned: -1.5, worried: -1.5, complaint: -2, escalate: -1.5, escalated: -1.2,
  "no update": -2, "no response": -2.2, "no substantive": -2,
};
// Business-impact terms: mildly negative AND flag the "anxious" emotion.
const IMPACT = ["guests", "guest", "front desk", "check in", "check-in", "checkout",
  "affecting", "impact", "impacting", "calls", "callers", "live", "production",
  "go live", "go-live", "month end", "month-end", "night audit"];
const INTENS = { very: 1.4, really: 1.3, extremely: 1.6, "so": 1.2, terribly: 1.5, totally: 1.4 };
const NEGATORS = new Set(["not", "no", "don't", "didn't", "never", "without", "isn't", "wasn't"]);

const normalize = (s) =>
  String(s || "").toLowerCase().replace(/[\u2019']/g, "'").replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim();

// Build a combined phrase+word matcher. Multi-word keys are checked as
// substrings; single words are matched on token boundaries with negation +
// intensifier handling. Returns hits deduped BY KEY (a term repeated within one
// message counts once — repetition is not extra signal) in scan order: phrases
// first, then single words left-to-right. That order is what scoreText()'s
// diminishing-returns cap consumes as "the first 3".
//
// Dedup is by key, NOT by character span: a phrase ("not working") and a
// constituent word it negates ("working") are different keys and BOTH contribute
// on the same span. That reinforcement is intentional and bounded by the tanh
// compression — valence MAGNITUDE is directional only (see HONEST LIMITS), and
// both pipelines double-count identically so parity/determinism are unaffected.
function lexHits(text, table) {
  const t = ` ${normalize(text)} `;
  const seen = new Set();
  const hits = []; // [{ key, value }]
  for (const key of Object.keys(table)) {
    if (!key.includes(" ")) continue;
    if (t.includes(` ${key} `) || t.includes(`${key} `) || t.includes(` ${key}`)) {
      if (!seen.has(key)) { seen.add(key); hits.push({ key, value: table[key] }); }
    }
  }
  const words = t.trim().split(" ");
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!(w in table) || seen.has(w)) continue;
    let v = table[w];
    const prev = words[i - 1];
    if (prev && INTENS[prev]) v *= INTENS[prev];
    if (prev && NEGATORS.has(prev)) v = -0.5 * v; // negation flips & damps
    seen.add(w);
    hits.push({ key: w, value: v });
  }
  return hits;
}

// Soft compression. Raw lexicon sums stack quickly (an effusive "perfect,
// thank you so much!" can clear +6), but the review's human-graded valences sat
// mostly in -2..+3. tanh maps the unbounded raw sum onto [-5,+5] while keeping
// typical gratitude/single-complaint lines around ±2 — matching the LLM band.
// K tuned against the review's representative quotes (see tune step).
const COMPRESS_K = 8;
const compress = (raw) => 5 * Math.tanh(raw / COMPRESS_K);

/**
 * Score a single message body to a valence in [-5, +5].
 * @returns {{valence:number, raw:number, pos:string[], neg:string[], impact:boolean}}
 *          `raw` is the pre-compression lexicon sum; `pos`/`neg` are the matched
 *          lexicon keys grouped by final (post-negation) polarity.
 */
export function scoreText(text) {
  if (!text || !text.trim()) return { valence: 0, raw: 0, pos: [], neg: [], impact: false };
  // Gather distinct lexicon hits, then apply a diminishing-returns cap: within a
  // single message, once 3 distinct hits of one polarity have landed at full
  // weight, every further same-polarity hit counts at 0.5×. Without this a
  // multi-cue rant ("broken, frozen, crashing, failing, stuck…") stacks well
  // past the band the LLM review stayed in (~±2–3 on a line); the cap keeps the
  // dominant cues but damps the pile-on. Polarity is the SIGN of each
  // contribution AFTER negation, so a negated positive ("not working") counts
  // as negative.
  const hits = [...lexHits(text, POS), ...lexHits(text, NEG)];
  let posN = 0, negN = 0, sum = 0;
  const pos = [], neg = [];
  for (const { key, value } of hits) {
    if (value > 0) {
      posN += 1;
      sum += posN > 3 ? value * 0.5 : value;
      pos.push(key);
    } else if (value < 0) {
      negN += 1;
      sum += negN > 3 ? value * 0.5 : value;
      neg.push(key);
    }
  }
  const tt = normalize(text);
  const impact = IMPACT.some((k) => tt.includes(k));
  const raw = sum + (impact ? -0.6 : 0);
  return { valence: compress(raw), raw, pos, neg, impact };
}

/* ------------------------------------------------------------------ *
 * 3. Emotions & frustration target — controlled vocabularies          *
 * ------------------------------------------------------------------ */

// Controlled emotion labels, mirroring the review's vocabulary. First matches
// win; defaults to neutral/transactional. Returns up to two labels.
const EMOTION_RULES = [
  ["angry/hostile", ["unacceptable", "ridiculous", "kicked down", "irrelevant", "fed up"]],
  ["frustrated", ["frustrat", "still not", "again", "still having", "yet again", "third time"]],
  ["confused", ["confused", "not sure", "don't understand", "unclear", "how do i", "how can i", "what does"]],
  ["disappointed", ["disappointed", "expected better", "let down"]],
  ["anxious (business impact)", IMPACT],
  ["grateful", ["thank", "appreciate", "appreciated"]],
  ["relieved", ["resolved", "fixed", "works now", "working now", "all set", "good to go", "no longer"]],
  ["satisfied", ["great", "perfect", "excellent", "works", "smoothly", "pleased"]],
  ["reassured", ["understood", "makes sense", "got it", "noted", "good to know", "that helps"]],
];

export function detectEmotions(text) {
  const t = normalize(text);
  if (!t) return ["neutral/transactional"];
  const hits = [];
  for (const [label, kws] of EMOTION_RULES) {
    if (kws.some((k) => t.includes(k))) hits.push(label);
    if (hits.length === 2) break;
  }
  return hits.length ? hits : ["neutral/transactional"];
}

// Base frustration-target category. The review adds parenthetical color
// ("product (UTC display confusion)"); this engine emits the base bucket only.
const TARGET_RULES = [
  ["third-party", ["shift4", "liaison", "vault", "vendor", "duetto", "synxis", "profitsword", "channel manager"]],
  ["service", ["no update", "no response", "no substantive", "kicked down", "irrelevant", "still waiting",
    "callback", "called back", "response time", "days with no", "ignored"]],
  ["product", ["bug", "defect", "error", "not working", "doesn't work", "broken", "crash", "slow",
    "report", "screen", "feature", "system", "interface", "freeze", "frozen", "outage"]],
];

export function detectFrustrationTarget(text, valence) {
  const t = normalize(text);
  if (!t) return null;
  if (valence >= 1) {
    // Positive overall: only flag a target if a clear negative cue survives.
    for (const [label, kws] of TARGET_RULES) if (kws.some((k) => t.includes(k))) return label;
    return "none";
  }
  for (const [label, kws] of TARGET_RULES) if (kws.some((k) => t.includes(k))) return label;
  return valence < 0 ? "product" : "n/a";
}

/* ------------------------------------------------------------------ *
 * 4. Representative quote & arc                                       *
 * ------------------------------------------------------------------ */

const QUOTE_MAX = 140;

// Split a body into candidate sentences for quoting.
const sentences = (body) =>
  String(body || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 220);

// Pick the most characteristic customer line. Negative-overall cases surface
// the most-negative line (most actionable); positive cases surface the warmest
// closure line; neutral cases take the strongest-magnitude line.
function representativeQuote(customerMsgs, overall) {
  let best = null;
  let bestScore = -Infinity;
  for (const m of customerMsgs) {
    for (const s of sentences(m.body)) {
      const v = scoreText(s).valence;
      const score = overall < 0 ? -v : overall > 0 ? v : Math.abs(v);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
  }
  if (!best) return null;
  return best.length > QUOTE_MAX ? best.slice(0, QUOTE_MAX - 1).trimEnd() + "…" : best;
}

// Base arc from first vs last customer-message valence.
function arc(start, end, customerCount) {
  if (customerCount <= 1) return "single touchpoint";
  if (end == null || start == null) return "stable";
  const delta = end - start;
  if (delta >= 1) return start < 0 && end > 0 ? "improved (recovery)" : "improved";
  if (delta <= -1) return "declined";
  return "stable";
}

/* ------------------------------------------------------------------ *
 * 5. Per-case grade                                                   *
 * ------------------------------------------------------------------ */

const roundInt = (x) => Math.round(x);
const sentimentLabel = (v) => (v >= 1 ? "Positive" : v <= -1 ? "Negative" : "Neutral");

/**
 * Grade one enriched case row. Reads the comment stream from `work_notes`
 * (falling back to `additional_comments`) — the same field enrich.js uses to
 * count customer vs analyst turns.
 *
 * @param {object} row  an enriched case row from the app's pipeline
 * @returns {object} sentiment grade, scoreable flag, and the columns that
 *          mirror the review spreadsheet's Per-Case Detail sheet.
 */
export function gradeCase(row) {
  const journal = row.work_notes || row.additional_comments || "";
  const stream = parseInteractionStream(journal);
  const customer = stream.filter((m) => m.isCustomer && m.body && m.body.trim());
  const analyst = stream.filter((m) => !m.isCustomer && m.body && m.body.trim());

  // Hygiene is structural and exact — derive it for EVERY case (scoreable or
  // not) from the same parsed stream, so the bake carries it and the portfolio
  // summary never re-parses the journal. A silent case can still hide an analyst
  // double-post or a pasted credential, so this must run before the gate below.
  const streamText = stream.map((m) => m.body).join("\n");
  const pii = PII_RE.test(streamText);
  const dup = hasDuplicatePost(stream);

  const base = {
    number: row.number,
    account: row.account,
    priority: row.priority || null,
    myMsgs: analyst.length,
    custMsgs: customer.length,
    pii,
    dup,
  };

  // Not scoreable: customer never wrote anything (phone-resolved / silent).
  if (customer.length === 0) {
    return {
      ...base,
      scoreable: false,
      valence: null,
      sentiment: null,
      start: null,
      end: null,
      arc: null,
      emotions: null,
      frustrationTarget: null,
      quote: null,
      coachingNote: analyst.length
        ? "No written customer dialogue to score — handled by phone or silent close."
        : "No customer or analyst text in the journal.",
    };
  }

  const perMsg = customer.map((m) => scoreText(m.body).valence);
  // Overall valence = mean of customer messages, weighted slightly toward the
  // last message (closure tone carries the most signal for a support case).
  const mean = perMsg.reduce((a, b) => a + b, 0) / perMsg.length;
  const last = perMsg[perMsg.length - 1];
  const overallRaw = perMsg.length > 1 ? 0.6 * mean + 0.4 * last : mean;
  const valence = roundInt(overallRaw);

  const start = roundInt(perMsg[0]);
  const end = perMsg.length > 1 ? roundInt(last) : null;
  // Compute the arc once and reuse it for both the column and the coaching note.
  const caseArc = arc(start, end ?? start, customer.length);
  const allCustomerText = customer.map((m) => m.body).join("\n");

  return {
    ...base,
    scoreable: true,
    valence,
    sentiment: sentimentLabel(valence),
    start,
    end,
    arc: caseArc,
    emotions: detectEmotions(allCustomerText).join(", "),
    frustrationTarget: detectFrustrationTarget(allCustomerText, valence),
    quote: representativeQuote(customer, overallRaw),
    coachingNote: buildCoachingNote(row, { valence, start, end, arc: caseArc, analyst: analyst.length }),
  };
}

// Templated coaching note from structural signals. NOT the LLM's prose — it
// states the facts the LLM would open with (responsiveness, arc, closure) so
// the column is useful at a glance; deep prose is the optional LLM read.
function buildCoachingNote(row, g) {
  const bits = [];
  const frtH = row._frtMs != null ? row._frtMs / 3.6e6 : (row.first_response_time ?? null);
  if (typeof frtH === "number" && isFinite(frtH)) {
    bits.push(frtH <= 1 ? `Fast first reply (${frtH.toFixed(1)}h)` : `First reply ${frtH.toFixed(1)}h`);
  }
  if (g.arc === "improved (recovery)") bits.push("recovered a frustrated opening to a positive close");
  else if (g.arc === "improved") bits.push("tone improved over the case");
  else if (g.arc === "declined") bits.push("tone declined — review the close-out");
  else if (g.arc === "single touchpoint") bits.push("single customer touchpoint");
  if (g.end != null && g.end < 0) bits.push("still negative at close");
  if (g.analyst === 0) bits.push("no written analyst reply in the journal");
  return bits.length ? bits.join("; ") + "." : "Transactional exchange, neutral throughout.";
}

/* ------------------------------------------------------------------ *
 * 5b. Bake adapter — the snake_case columns enrich.js persists        *
 * ------------------------------------------------------------------ */

/**
 * Map a raw case row to the flat, snake_case sentiment columns baked by BOTH
 * enrichRow and enrichForSql (one parse per row, via gradeCase). The two
 * pipelines call this with identical inputs, so the returned values are
 * identical — that equality is exactly what the enrich parity test asserts.
 *
 * `frtMs` is the already-parsed first-response time in ms; both pipelines
 * compute it the same way (parseFirstResponse) and pass it here so the coaching
 * note can report responsiveness deterministically (the raw `first_response_time`
 * is a non-numeric ServiceNow string, which the note would otherwise skip).
 *
 * Values are plain JS (number | string | boolean | null) to match the worker's
 * DDL column types: sentiment_valence / _start / _end → BIGINT (plain Number |
 * null, like priority_rank / interaction_count); sentiment_scoreable / _pii /
 * _dup → BOOLEAN; everything else → VARCHAR. Never `undefined` — a missing key
 * would reach the Arrow builder as undefined and muddle column type inference.
 *
 * @param {object} row          raw case row (work_notes / additional_comments…)
 * @param {number|null} [frtMs] parsed first-response time in ms
 * @returns {object} the 12 `sentiment_*` columns
 */
export function gradeFromRow(row, frtMs) {
  const g = gradeCase(frtMs == null ? row : { ...row, _frtMs: frtMs });
  return {
    sentiment_scoreable: g.scoreable,
    sentiment_valence: g.valence,
    sentiment_label: g.sentiment,
    sentiment_start: g.start,
    sentiment_end: g.end,
    sentiment_arc: g.arc,
    sentiment_emotions: g.emotions,
    sentiment_target: g.frustrationTarget,
    sentiment_quote: g.quote,
    sentiment_coaching: g.coachingNote,
    sentiment_pii: g.pii,
    sentiment_dup: g.dup,
  };
}

/* ------------------------------------------------------------------ *
 * 6. Hygiene flags (structural — exact, no LLM)                       *
 * ------------------------------------------------------------------ */

// Duplicate double-posts: same analyst body posted twice within 60s.
function hasDuplicatePost(stream) {
  for (let i = 1; i < stream.length; i++) {
    const a = stream[i - 1], b = stream[i];
    if (!a.isCustomer && !b.isCustomer && a.body && a.body === b.body) {
      if (a.ts == null || b.ts == null || Math.abs(b.ts - a.ts) <= 60_000) return true;
    }
  }
  return false;
}

// AnyDesk / password exposure in the customer-visible stream.
const PII_RE = /\b(anydesk|teamviewer)\b|\bpass(word|wd)\b\s*[:=]/i;

/* ------------------------------------------------------------------ *
 * 7. Portfolio summary — mirrors the review's Headline Metrics        *
 * ------------------------------------------------------------------ */

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d ? n / d : 0);

// Prefer the baked sentiment columns (enrich.js v9) over a live grade — that is
// the whole point of baking: the UI must not re-parse every journal on every
// filter change. Falls back to gradeCase for a row from a pre-v9 import that has
// not been rebuilt yet (defensive — the in-memory pipeline always bakes). Always
// returns the gradeCase shape so the summary + table are source-agnostic.
function resolveGrade(row) {
  if (!row || row.sentiment_scoreable === undefined || row.sentiment_scoreable === null) {
    return gradeCase(row || {});
  }
  const num = (v) => (v == null ? null : Number(v)); // BIGINT may arrive as BigInt from SQL
  return {
    number: row.number,
    account: row.account,
    priority: row.priority || null,
    myMsgs: row._analystTurns ?? row.analyst_turns ?? null,
    custMsgs: row._customerTurns ?? row.customer_turns ?? null,
    pii: !!row.sentiment_pii,
    dup: !!row.sentiment_dup,
    scoreable: !!row.sentiment_scoreable,
    valence: num(row.sentiment_valence),
    sentiment: row.sentiment_label ?? null,
    start: num(row.sentiment_start),
    end: num(row.sentiment_end),
    arc: row.sentiment_arc ?? null,
    emotions: row.sentiment_emotions ?? null,
    frustrationTarget: row.sentiment_target ?? null,
    quote: row.sentiment_quote ?? null,
    coachingNote: row.sentiment_coaching ?? null,
  };
}

/**
 * Grade a list of rows and roll up the headline metrics. Reads baked
 * `sentiment_*` columns when present (via resolveGrade); falls back to a live
 * grade per row only for rows missing them.
 * @param {object[]} rows  enriched case rows
 * @returns {{ graded:object[], scoreable:object[], summary:object }}
 */
export function summarizeSentiment(rows) {
  const graded = rows.map(resolveGrade);
  const scoreable = graded.filter((g) => g.scoreable);

  const valences = scoreable.map((g) => g.valence);
  const pos = scoreable.filter((g) => g.valence > 0).length;
  const neu = scoreable.filter((g) => g.valence === 0).length;
  const neg = scoreable.filter((g) => g.valence < 0).length;

  const openedFrustrated = scoreable.filter((g) => g.start < 0);
  const recovered = openedFrustrated.filter((g) => g.end != null && g.end > 0).length;
  const stillNeg = openedFrustrated.filter((g) => g.end != null && g.end < 0);
  const calmToNeg = scoreable.filter((g) => g.start >= 0 && g.end != null && g.end < 0).length;

  // Responsiveness from the enriched FRT (hours).
  const frtHours = rows
    .map((r) => (r._frtMs != null ? r._frtMs / 3.6e6 : typeof r.first_response_time === "number" ? r.first_response_time : null))
    .filter((h) => typeof h === "number" && isFinite(h));
  const within1h = frtHours.filter((h) => h <= 1).length;

  // Hygiene flags (structural) — read straight off the per-case grades so we
  // never parse a journal twice. gradeCase derives `pii` / `dup` for every row.
  let dupPosts = 0, piiExposure = 0;
  const piiCases = [];
  for (const g of graded) {
    if (g.dup) dupPosts++;
    if (g.pii) { piiExposure++; piiCases.push(g.number); }
  }

  return {
    graded,
    scoreable,
    summary: {
      analyzed: rows.length,
      scoreableCount: scoreable.length,
      scoreableShare: pct(scoreable.length, rows.length),
      silent: rows.length - scoreable.length,
      avgValence: valences.length ? valences.reduce((a, b) => a + b, 0) / valences.length : 0,
      // 0..100 normalization of a -5..+5 mean, matching the review's "57/100" idea.
      normalized100: valences.length
        ? Math.round(((valences.reduce((a, b) => a + b, 0) / valences.length) + 5) / 10 * 100)
        : null,
      pos, neu, neg,
      posShare: pct(pos, scoreable.length),
      negShare: pct(neg, scoreable.length),
      openedFrustrated: openedFrustrated.length,
      recovered,
      stillNegative: stillNeg.length,
      stillNegativeCases: stillNeg.map((g) => g.number),
      calmToNegative: calmToNeg,
      medianFrtH: median(frtHours),
      within1hShare: pct(within1h, frtHours.length),
      duplicatePosts: dupPosts,
      piiExposure,
      piiCases,
    },
  };
}
