// Customer Sentiment & Escalation Early-Warning engine — deterministic,
// client-side, no LLM, no network.
//
// WHY THIS SHAPE (v11 rewrite)
// The engine was rebuilt from a corpus study of two real exports (3,173 cases,
// 6,376 customer messages). What the data showed, and what this module now
// encodes:
//
//  1. CUSTOMER TEXT IS HTML INSIDE [code] BLOCKS. ~64% of customer messages
//     arrive as `[code]<p>…</p>[/code]`. The v9 engine DELETED those blocks as
//     chrome, erasing most of the customer voice before scoring. cleanBody now
//     unwraps them (strip tags, decode entities, keep the words).
//  2. POLITENESS IS PHATIC. "thank you" appears in ~1,600 messages — hotel
//     staff are professionally courteous while frustrated. Gratitude counts
//     positive ONLY when a message carries no trouble signal; real positives
//     are resolution CONFIRMATION ("works now", "you can close") and explicit
//     satisfaction.
//  3. ESCALATIONS ARE ABOUT SILENCE, NOT TONE. Journals carry literal
//     "Escalation has been requested by customer" workflow notes with
//     "Escalation Reason: Inactivity | Lack of Progress". Customers escalate
//     when they feel ignored — so unanswered messages, chase messages ("any
//     update?"), analyst staleness, and issue persistence are the top-weighted
//     factors in the escalation-risk model, ahead of raw negativity.
//  4. STRUCTURED EVENT NOTES ride the journal under customer authorship
//     (escalation requests, priority changes, "Data Access fields updated",
//     "INITIAL DESCRIPTION:" echoes). They are detected, surfaced as events,
//     and EXCLUDED from free-text tone scoring.
//  5. "Reply From: guest@hotel.com …" System notes are relayed CUSTOMER email —
//     re-attributed to the customer (1,616 such notes in the corpus).
//  6. EMAIL SIGNATURES POISON LEXICONS. Job titles ("Director of Revenue
//     Management", "Front Office Supervisor"), phone blocks and legal footers
//     ("received this message in error … notify the sender immediately") all
//     hit sentiment vocabulary, so stripQuoted cuts sign-off tails, contact
//     lines and disclaimers before any scoring.
//  7. SOLUTION-PROPOSED CASES NEED A REOPEN READ, NOT A TONE READ. After a
//     resolution event the question is: did the customer CONFIRM the fix, PUSH
//     BACK ("this does not address the issue", "keep this case open"), attach a
//     CONDITION ("will test after night audit"), or go SILENT? That
//     classification (sentiment_confirm) + reopen risk replaces plain valence
//     as the actionable signal there.
//
// VALIDATION (against the corpus): risk scored on text strictly BEFORE an
// escalation event separates escalated from never-escalated cases (mean 27 vs
// 16; a ≥40 threshold catches 24% of future escalations while flagging 6% of
// the rest). Directional, not oracular — the point is triage order, and the
// explicit event badges catch the rest.
//
// Sibling of enrich.js in spirit: pure of wall-clock (callers pass snapshotMs)
// and randomness, so the same row grades identically in the in-memory pipeline
// and the DuckDB worker. SECURITY: operates only on text already in the
// browser; nothing leaves the device.

/* ------------------------------------------------------------------ *
 * 1. Text cleaning                                                    *
 * ------------------------------------------------------------------ */

const ENTITIES = {
  "&nbsp;": " ", "&ensp;": " ", "&emsp;": " ", "&thinsp;": " ",
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&ldquo;": '"', "&rdquo;": '"', "&lsquo;": "'", "&rsquo;": "'",
  "&ndash;": "-", "&mdash;": "-", "&bull;": " ", "&middot;": " ", "&hellip;": "...",
};
const decodeEntities = (s) =>
  String(s).replace(/&[a-z]+;|&#\d+;/gi, (m) => {
    const known = ENTITIES[m.toLowerCase()];
    if (known != null) return known;
    const n = m.match(/^&#(\d+);$/);
    if (n) { const c = +n[1]; return c >= 32 && c < 65536 ? String.fromCharCode(c) : " "; }
    return " ";
  });

/** Unwrap [code] blocks (contents KEPT — the v9 bug was deleting them), strip
 *  HTML with block tags → newline (line structure feeds reply stripping),
 *  decode entities, drop URLs and inline-image cid refs. */
export function cleanBody(raw) {
  let s = String(raw || "");
  s = s.replace(/\[code\]|\[\/code\]/gi, " ");
  s = s.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?\s*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  s = s.replace(/\[cid:[^\]]*\]/gi, " ");
  return s;
}

const SIGNOFF_LINE = /^\s*(best regards|kind regards|warm regards|warmest regards|regards|many thanks|thanks|thank you|thanks again|sincerely|respectfully|cheers|mahalo|aloha|v\/r|br|cordialement|mit freundlichen gr|saludos|much appreciated)\s*[,.!]*(\s+\w+){0,3}\s*$/i;
// Legal footers carry lexicon poison ("received this message in error",
// "notify the sender immediately") — cut them even without a sign-off.
const DISCLAIMER_LINE = /^\s*(important\s+)?(disclosure|disclaimer|confidentiality notice|legal notice)|this (message|email|e-mail).{0,40}(confidential|proprietary|privileged)/i;
const CONTACT_LINE = /^\s*(\+?\d[\d ()/.-]{7,}|\S+@\S+\.\S+.{0,20}|(t|f|tel|mobile|phone|office|direct|fax|cell|ext|reservations)\s*[:.]\s.*|-{2,}.*|={3,}.*|\*{3,}.*)\s*$/i;
// A line that reads as the signature itself: a bare name ("Rossanne Cruz"), a
// job-title line ("Milja Perkovic|Director of Revenue Management"), or chrome.
const NAME_LINE = /^\s*[A-Z][\w'.-]{0,24}([ .|-][A-Z][\w'.-]{0,24}){0,4}\s*$/;
const TITLE_LINE = /^.{0,80}(director|manager|supervisor|officer|coordinator|accountant|controller|administrator|analyst|specialist|assistant|executive|president|owner|revenue|front office|guest service|reservation|sales|finance|hotel|resort|suites?|inn)\b.{0,40}$/i;
const isSigTail = (ln) => NAME_LINE.test(ln) || TITLE_LINE.test(ln) || CONTACT_LINE.test(ln);

function stripSignature(text) {
  const lines = text.split(/\r?\n/);
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (DISCLAIMER_LINE.test(lines[i])) { cut = i - 1; break; }
    if (!SIGNOFF_LINE.test(lines[i])) continue;
    // A sign-off ends the message only when what FOLLOWS looks like a signature
    // block — a mid-message "Thanks!" followed by real content survives.
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length) break; // sign-off is the last line — nothing to cut
    if (isSigTail(lines[j])) { cut = i; break; }
  }
  let kept = cut >= 0 ? lines.slice(0, cut + 1) : lines;
  kept = kept.filter((ln) => !CONTACT_LINE.test(ln));
  return kept.join("\n");
}

/** Cut quoted reply chains, mail chrome, signatures and disclaimers — keep only
 *  the words this author actually wrote in this message. */
export function stripQuoted(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (const ln of lines) {
    if (/^\s*(from|sent|to|cc|subject|date)\s*:/i.test(ln)) break;
    if (/^\s*on .{5,120} wrote:\s*$/i.test(ln)) break;
    if (/^-{3,}\s*original message\s*-{3,}/i.test(ln)) break;
    if (/^_{10,}\s*$/.test(ln)) break;
    if (/^\s*>/.test(ln)) continue;
    out.push(ln);
  }
  return stripSignature(out.join("\n")).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/* ------------------------------------------------------------------ *
 * 2. Journal parsing, attribution & structured events                 *
 * ------------------------------------------------------------------ */

const ENTRY_HEADER = /^(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})\s*-\s*(.+)$/gm;
const ANALYST_AUTHOR = /\(Infor\)/i;
// "System  Automatic Reminders (Infor)" is the automated actor, not an analyst —
// same convention as enrich.js's isInforAnalyst.
const SYSTEM_AUTHOR = /^\s*System\b/i;
const TYPE_SUFFIX = /\((Additional comments|Work notes|Comments)\)\s*$/i;
const REPLY_FROM = /^\s*Reply From:\s*\S+@\S+\s*/i;

const parseTs = (s) => {
  if (!s) return null;
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d.getTime();
};

// Structured workflow notes observed in the corpus. First match wins.
const EVENT_DEFS = [
  ["escalation_request", /escalation has been requested/i],
  ["priority_change", /has changed the priority of the case to\s*(\d)/i],
  ["urgency_change", /has changed the urgency of the case/i],
  ["escalation_update", /escalation\s+ESC\d+\s+(has been approved|phase has changed|has been rejected|has been closed)/i],
  ["data_access", /the data access fields updated by/i],
  ["auto_resolved", /case automatically resolved due to/i],
  ["reminder_email", /servicenow has automatically sent/i],
  ["resolution_notes", /\bresolution notes\b/i],
  ["jira_link", /jira reference id\s+[A-Z]+-\d+/i],
];

function detectEvent(cleaned) {
  for (const [name, re] of EVENT_DEFS) {
    const m = cleaned.match(re);
    if (m) return { name, match: m };
  }
  return null;
}

/**
 * Parse a journal blob into ts-sorted, attributed, cleaned messages.
 * `who`: 'customer' | 'analyst' | 'system' | 'internal'. Work-notes-typed
 * entries are internal-only in ServiceNow — a non-Infor name there is staff
 * without the "(Infor)" tag, never the customer. System "Reply From:" notes
 * are re-attributed to the customer.
 *
 * @returns {Array<{ts:number|null, author:string, type:string|null,
 *   who:string, event:string|null, eventMatch:RegExpMatchArray|null,
 *   isInitialDesc:boolean, text:string}>}
 */
export function parseJournal(text) {
  if (!text) return [];
  const raw = String(text);
  const heads = [...raw.matchAll(ENTRY_HEADER)];
  const entries = [];
  const push = (ts, authorLine, body) => {
    const type = (authorLine.match(TYPE_SUFFIX)?.[1] || "").toLowerCase();
    const author = authorLine.replace(TYPE_SUFFIX, "").trim();
    let who = ANALYST_AUTHOR.test(author) && !SYSTEM_AUTHOR.test(author)
      ? "analyst" : SYSTEM_AUTHOR.test(author) ? "system" : "customer";
    let cleaned = cleanBody(body);
    if (who === "system" && REPLY_FROM.test(cleaned)) {
      who = "customer";
      cleaned = cleaned.replace(REPLY_FROM, "");
    }
    if (who === "customer" && /work notes/.test(type)) who = "internal";
    const event = detectEvent(cleaned);
    entries.push({
      ts, author, type: type || null, who,
      event: event ? event.name : null,
      eventMatch: event ? event.match : null,
      isInitialDesc: /^\s*initial description\s*:/i.test(cleaned),
      text: stripQuoted(cleaned),
    });
  };
  if (heads.length === 0) {
    const c = cleanBody(raw);
    if (c.trim()) push(null, "", raw);
  } else {
    for (let i = 0; i < heads.length; i++) {
      const m = heads[i];
      const start = m.index + m[0].length;
      const end = i + 1 < heads.length ? heads[i + 1].index : raw.length;
      push(parseTs(m[1]), m[2] || "", raw.slice(start, end));
    }
  }
  if (entries.every((e) => e.ts != null)) entries.sort((a, b) => a.ts - b.ts);
  return entries;
}

/** Back-compat adapter for consumers of the v9 stream shape (SentimentDeepRead):
 *  ordered messages as {ts, author, isCustomer, body}. */
export function parseInteractionStream(text) {
  return parseJournal(text).map((e) => ({
    ts: e.ts,
    author: e.author,
    isCustomer: e.who === "customer",
    body: e.text,
  }));
}

/* ------------------------------------------------------------------ *
 * 3. Signal clusters (data-derived) & message scoring                 *
 * ------------------------------------------------------------------ */

// Vocabulary mined from the corpus (phrase census + log-odds vs escalation
// ground truth). Counted as DISTINCT matches per message (repetition within a
// message is not extra signal).
const RX = {
  breakage: /\b(not work(s|ing)?|(doesn'?t|does not|won'?t|will not|stopped|isn'?t|is not) work(s|ing)?|broken|error(s)?|fail(s|ed|ing|ure)?|crash(es|ed|ing)?|(is|are|system('s)?|server) down|freez(e|es|ing)|frozen|stuck|unable to|can'?t \w+|cannot \w+|not able to|kicked out|logged out|missing|incorrect(ly)?|wrong(ly)?|discrepanc|mismatch|not receiv(ed|ing)|no data|blank|empty report)\b/gi,
  persistence: /\b(still (not|no|isn'?t|doesn'?t|having|see(ing)?|show(s|ing)?|happen(s|ing)?|occur(s|ring)?|getting|waiting|broken|wrong|the same|an? issue|unable)|again|once again|yet again|same (issue|problem|error|thing)|keeps? (happening|crashing|failing|freezing|occurring|coming back)|happen(s|ing|ed)? (again|every)|every (day|night|time|morning)|everyday|recurring|reoccur|not (yet )?(been )?(fixed|resolved|solved|addressed)|no resolution|unresolved|persist(s|ing|ent)?)\b/gi,
  neglect: /\b(any update(s)?|any news|an update|no update(s)?|no response|no reply|not heard (back|anything)|haven'?t heard|no one (has )?(responded|replied|contacted|called|reached)|nobody (has )?(responded|replied|contacted)|still waiting|waiting (for|on|since|over)|been waiting|follow(ing)? up|chas(e|ing)|remind(er)?|left hanging|ignored|without (a )?(response|reply|update)|(days|weeks|a week|a month|months) (with)?out|it('s| has) been (\d+|a|two|three|several) (day|week|month)|take(s|n)? (so|too|this) long|taking (so|too|forever)|how (much )?long(er)?|dragging|drag(s|ged) on|slow (response|progress)|lack of (progress|response|communication)|status of (this|the|my))\b/gi,
  dissatisfaction: /\b(frustrat(ed|ing|ion)|disappoint(ed|ing|ment)|unacceptable|not acceptable|ridiculous|terrible|horrible|awful|worst|useless|pointless|annoy(ed|ing)|unhappy|not happy|dissatisf|fed up|sick of|tired of|had enough|poor (service|support|communication)|bad (service|support|experience)|complain(t|ts|ing)?|this is (not|no) (good|acceptable|ok)|not impressed|losing (faith|confidence|patience)|serious(ly)? concern|major concern|escalat(e|ing|ion)|(speak|talk|meeting) (to|with) (a |your |the |my )?(manager|supervisor|management)|manager (contact )?(has been |is )?(requested|informed|involved|aware|asking|chasing|pressing|upset)|my (manager|boss|gm|general manager|director) (is|has|wants|needs|asked|keeps)|management (is|are) (asking|pressing|involved|aware|upset|not happy)|under (significant |a lot of )?pressure|cancel (the |our |this )?(contract|subscription|service)|switch(ing)? (to another|provider|vendor|system))\b/gi,
  urgency: /\b(urgent(ly)?|asap|as soon as possible|immediately|right away|straight away|critical|emergency|time.?sensitive|high priority|top priority|prompt(ly)?|without (further )?delay|today|by (end of|tomorrow|monday|tuesday|wednesday|thursday|friday)|deadline|cut.?off|no later than|running out of time)\b/gi,
  impact: /\b(guest(s)? (are|is|was|were|waiting|cannot|can'?t|complain|standing|checking|in front)|in front of (a |the )?guest|front desk|check.?in(s)?|check.?out(s)?|checkout|night audit|audit(ors)?|revenue|month.?end|year.?end|go.?live|went live|live (site|system|environment|property|hotel)|production|operational(ly)?|(entire|whole|all) (hotel|propert\w*|team|staff)|propert(y|ies) (are|is) (affected|impacted|down)|affect(s|ing|ed)|impact(s|ing|ed)|losing (money|revenue|bookings|business)|cannot (check|process|post|run|bill|invoice|charge|close the day)|blocking|blocked|stopping us|at a standstill)\b/gi,
  confirmation: /\b(works? (now|fine|great|well|perfectly|as expected)|working (now|fine|great|well|correctly|as expected)|(is|are|has been|it'?s|its|issue( is)?|this is) (now )?(fixed|resolved|sorted|solved|corrected|working)|(that|this|which) (resolved|fixed|sorted|solved) (it|this|the)|(resolved|fixed|solved|sorted) (it|the (issue|problem|error))|no longer (an issue|happening|occurring|a problem)|(you|u) (can|may) close|(please |go ahead and )?close (this|the|my|it)( case| ticket)?|(case|ticket|this) can be closed|ok(ay)? to close|good to close|all (good|set|sorted|fine|working)|looks good|look(s)? correct|problem solved|issue (is )?(gone|cleared)|back (up|online|to normal)|confirm(ed)? (it|this|that|the fix|resolved|working|fixed)|tested (and|ok|successfully)|verif(y|ied) (it )?(works|working|fixed))\b/gi,
  satisfaction: /\b(perfect|excellent|awesome|fantastic|wonderful|amazing|brilliant|great (job|work|help|support|service)|really help(ed|ful)|very help(ed|ful)|much appreciated|life.?saver|you('re| are) the best|superb|outstanding|well done)\b/gi,
  gratitude: /\b(thank(s| you)?|thankyou|appreciat(e|ed|ion)|grateful|mahalo|cheers)\b/gi,
  conditionalOpen: /\b(keep (this |the |it |case )*open|remain(s)? open|leave (this |the |it |case )*open|(don'?t|do not|please don'?t) close|not (be )?closed? (yet|until)|hold (off|the case)|until (we|i|they|it)('ve| have| has)? (test|confirm|verif|check|hear)|(will|need to|have to|going to|want to) (test|check|verify|confirm|monitor|observe)|wait(ing)? (for|until|to see)|monitor(ing)? (it|this|the)|observe|next (audit|month.?end|night)|once (we|i|they|the)|after (we|i|they|the) (test|check|run|confirm))\b/gi,
  pushback: /\b(does(n'?t| not) (address|fix|solve|resolve|answer|help)|not (the |an? )?(answer|solution|fix)|didn'?t (fix|solve|resolve|address|work)|not what (i|we) (asked|meant|need)|misunderst(ood|anding)|you (misunderstood|didn'?t understand)|(re-?open|reopen)(ed|ing)?( the| this)?( case| ticket)?|why (is|are|was|does|did|has|have|can'?t|won'?t|isn'?t)|makes no sense|doesn'?t make sense)\b/gi,
};

// A chase: a short message that adds no new information and exists to prod for
// a response — the observed precursor to "Escalation Reason: Inactivity".
const CHASE_RE = /\b(any update(s)?|any news|any progress|any word|an update|update please|please update|status\??|checking in|just (checking|following)|follow(ing)? up|bump(ing)?|gentle reminder|remind(er)?|still waiting|hello\?+|are you there|did you (get|see|receive)|have you (had|seen|looked)|when (will|can) (i|we) (expect|hear|get)|eta\??|any eta|time ?frame|how('s| is) (it|this) (going|coming))\b/i;

// Domain acronyms that are NOT shouting.
const KNOWN_ACRONYMS = new Set(["HMS", "PMS", "POS", "CRS", "OTA", "API", "SSO", "VPN", "URL", "PDF", "CSV", "XML", "BEO", "IRD", "GDS", "IBE", "EMV", "FYI", "EOD", "EOM", "ETA", "ASAP", "HTTP", "HTTPS", "HTML", "SFTP", "FTP", "AWS", "UAT", "QA", "MOHG", "IHG", "VAT", "GST", "USA", "NYC"]);

/** Distinct-match feature counts + emphasis features for one message. */
export function textFeatures(text) {
  const t = String(text || "");
  const counts = {};
  for (const k of Object.keys(RX)) {
    const m = t.match(RX[k]);
    counts[k] = m ? new Set(m.map((x) => x.toLowerCase())).size : 0;
  }
  const bangRuns = (t.match(/!{2,}/g) || []).length;
  const qRuns = (t.match(/\?{2,}/g) || []).length;
  const capsWords = (t.match(/\b[A-Z]{3,}\b/g) || []).filter((w) => !KNOWN_ACRONYMS.has(w)).length;
  const isChase = CHASE_RE.test(t) && t.replace(/\s+/g, " ").length < 320;
  return { ...counts, bangRuns, qRuns, capsWords, isChase };
}

/**
 * Score one customer message to a valence in [-5, +5].
 * Gratitude is phatic (see header): counts only when no trouble signal is
 * present. Urgency/impact are AMPLIFIERS — they add weight only when real
 * trouble (breakage/persistence/neglect/dissatisfaction/pushback) exists, so a
 * neutral workflow request ("please map this payment code") stays neutral.
 */
export function scoreMessage(text) {
  const f = textFeatures(text);
  const trouble = f.breakage + f.persistence + f.neglect + f.dissatisfaction + f.pushback;
  const negUnits =
    1.6 * f.breakage + 2.0 * f.persistence + 2.2 * f.neglect + 2.6 * f.dissatisfaction +
    2.0 * f.pushback +
    (trouble > 0 ? 1.0 * f.urgency + 0.7 * Math.min(f.impact, 3) : 0) +
    0.8 * f.bangRuns + 0.8 * f.qRuns + 0.4 * Math.min(f.capsWords, 5);
  const posUnits =
    2.6 * f.confirmation + 2.2 * f.satisfaction +
    (trouble === 0 ? 1.0 * Math.min(f.gratitude, 2) : 0);
  const raw = posUnits - negUnits;
  return { valence: 5 * Math.tanh(raw / 6), raw, features: f };
}

/** v9-compat alias used by older tests/tools: {valence} for a text snippet. */
export function scoreText(text) {
  return scoreMessage(text);
}

/* ------------------------------------------------------------------ *
 * 4. Case-level analysis                                              *
 * ------------------------------------------------------------------ */

const DAY = 86400000;

// Escalation-risk factor weights. Ordered to mirror the observed escalation
// reasons: Inactivity (unanswered/waiting/staleness) and Lack of Progress
// (chases/persistence) dominate; tone and urgency modulate.
function escalationRisk({ trailingUnanswered, waitDays, chases, persistenceMsgs, recentTone, agg, staleDays, scoredCount }) {
  const factors = [];
  let risk = 0;
  if (trailingUnanswered >= 1) {
    const pts = Math.min(24, trailingUnanswered * 12);
    risk += pts;
    factors.push(`${trailingUnanswered} customer message${trailingUnanswered > 1 ? "s" : ""} awaiting a reply (+${pts})`);
  }
  if (waitDays != null && waitDays >= 3) {
    const pts = waitDays >= 7 ? 11 : 6;
    risk += pts;
    factors.push(`waiting ${Math.floor(waitDays)}d since last customer message (+${pts})`);
  }
  if (chases) {
    const pts = Math.min(20, chases * 7);
    risk += pts;
    factors.push(`${chases} follow-up chase${chases > 1 ? "s" : ""} (+${pts})`);
  }
  if (persistenceMsgs >= 1) {
    const pts = Math.min(15, persistenceMsgs * 6);
    risk += pts;
    factors.push(`issue recurring/unresolved in ${persistenceMsgs} message${persistenceMsgs > 1 ? "s" : ""} (+${pts})`);
  }
  if (recentTone != null && recentTone < 0) {
    const pts = recentTone <= -2 ? 15 : recentTone <= -1 ? 10 : 5;
    risk += pts;
    factors.push(`recent tone negative (${recentTone.toFixed(1)}) (+${pts})`);
  }
  if (agg.urgency) { risk += 5; factors.push("urgency language (+5)"); }
  if (agg.impact >= 2) { risk += 5; factors.push("business impact cited (+5)"); }
  if (agg.dissatisfaction) {
    const pts = Math.min(15, 8 + (agg.dissatisfaction - 1) * 4);
    risk += pts;
    factors.push(`explicit dissatisfaction / escalation language (+${pts})`);
  }
  if (scoredCount && staleDays != null && staleDays >= 10) {
    const pts = staleDays >= 21 ? 10 : 6;
    risk += pts;
    factors.push(`no analyst reply in ${Math.floor(staleDays)}d (+${pts})`);
  }
  return { risk: Math.min(100, Math.round(risk)), factors };
}

// AnyDesk / password exposure in the stream (hygiene, unchanged from v9).
const PII_RE = /\b(anydesk|teamviewer)\b|\bpass(word|wd)\b\s*[:=]/i;

// Analyst double-post: same analyst body twice within 60s (hygiene, v9).
function hasDuplicatePost(entries) {
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1], b = entries[i];
    if (a.who === "analyst" && b.who === "analyst" && a.text && a.text === b.text) {
      if (a.ts == null || b.ts == null || Math.abs(b.ts - a.ts) <= 60_000) return true;
    }
  }
  return false;
}

const QUOTE_MAX = 160;
const sentencesOf = (body) =>
  String(body || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 240);

// The most characteristic customer line: most-negative for negative cases (the
// actionable line), warmest for positive, strongest-magnitude for neutral.
function representativeQuote(customerMsgs, overall) {
  let best = null, bestScore = -Infinity;
  for (const m of customerMsgs) {
    for (const s of sentencesOf(m.text)) {
      const v = scoreMessage(s).valence;
      const score = overall < 0 ? -v : overall > 0 ? v : Math.abs(v);
      if (score > bestScore) { bestScore = score; best = s; }
    }
  }
  if (!best) return null;
  return best.length > QUOTE_MAX ? best.slice(0, QUOTE_MAX - 1).trimEnd() + "…" : best;
}

/**
 * Analyze one case journal end-to-end. The single source of truth both
 * pipelines bake from and the UI reads through.
 *
 * @param {string} journal       additional_comments (falling back to work_notes)
 * @param {object} opts
 * @param {'open'|'solution_proposed'|'closed'} opts.lifecycle
 * @param {number|null} opts.snapshotMs   data-as-of anchor (wait/staleness)
 * @param {number|null} opts.resolvedAtMs resolution-notes save time (reopen anchor)
 */
export function analyzeJournal(journal, { lifecycle = "open", snapshotMs = null, resolvedAtMs = null } = {}) {
  const entries = parseJournal(journal);

  // Hygiene runs over the whole stream, scoreable or not (v9 behavior).
  const pii = PII_RE.test(entries.map((e) => e.text).join("\n"));
  const dup = hasDuplicatePost(entries);

  // Structured events.
  const escalationRequests = entries.filter((e) => e.event === "escalation_request");
  const priorityRaises = entries.filter((e) => e.event === "priority_change" && e.eventMatch && +e.eventMatch[1] <= 2);
  const escalated = escalationRequests.length > 0 || priorityRaises.length > 0;
  let escReason = null;
  for (const e of [...escalationRequests, ...priorityRaises]) {
    const r = e.text.match(/Escalation Reason:\s*([^:]{2,60}?)(?=\s*Escalation Justification|\s*$)/i);
    const j = e.text.match(/Escalation Justification:\s*([\s\S]{2,240})/i) ||
      e.text.match(/The reason for the change is:\s*([\s\S]{2,240})/i);
    if (!escReason && (r || j)) {
      escReason = [r ? r[1].trim() : null, j ? j[1].trim() : null].filter(Boolean).join(" — ").slice(0, 240);
    }
  }

  // Conversation stream: structural noise out, humans in.
  const NOISE = new Set(["data_access", "reminder_email", "jira_link", "urgency_change", "escalation_update"]);
  const conv = entries.filter((e) => !NOISE.has(e.event) && (e.who === "customer" || e.who === "analyst") && e.text);
  const customerMsgs = conv.filter((e) => e.who === "customer" && !e.event && !e.isInitialDesc);
  const analystMsgs = conv.filter((e) => e.who === "analyst" && e.event !== "auto_resolved" && e.event !== "resolution_notes");

  const scored = customerMsgs.map((e) => ({ e, s: scoreMessage(e.text) }));

  // Inactivity signals.
  const chases = scored.filter(({ s }) => s.features.isChase).length;
  let trailingUnanswered = 0;
  for (let i = conv.length - 1; i >= 0; i--) {
    const e = conv[i];
    if (e.who === "analyst") break;
    if (e.who === "customer" && !e.isInitialDesc && !e.event) trailingUnanswered++;
  }
  const lastAnalyst = [...conv].reverse().find((e) => e.who === "analyst");
  const lastCustomer = customerMsgs[customerMsgs.length - 1] || null;
  const waitingSince =
    lastCustomer && (!lastAnalyst || (lastCustomer.ts ?? 0) > (lastAnalyst.ts ?? 0)) ? lastCustomer.ts : null;
  const waitDays = waitingSince != null && snapshotMs != null ? Math.max(0, (snapshotMs - waitingSince) / DAY) : null;
  const staleDays = lastAnalyst && lastAnalyst.ts != null && snapshotMs != null
    ? (snapshotMs - lastAnalyst.ts) / DAY : null;

  // Tone aggregates.
  const vals = scored.map(({ s }) => s.valence);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const last = vals.length ? vals[vals.length - 1] : null;
  const overall = vals.length ? 0.55 * mean + 0.45 * last : null;
  const lastTwo = vals.slice(-2);
  const recentTone = lastTwo.length ? lastTwo.reduce((a, b) => a + b, 0) / lastTwo.length : null;

  const agg = { breakage: 0, persistence: 0, neglect: 0, dissatisfaction: 0, urgency: 0, impact: 0, pushback: 0, confirmation: 0, conditionalOpen: 0 };
  let persistenceMsgs = 0;
  for (const { s } of scored) {
    for (const k of Object.keys(agg)) agg[k] += s.features[k] || 0;
    if (s.features.persistence) persistenceMsgs++;
  }
  // Dominant signal clusters (for the baked `sentiment_signals` column).
  const signals = Object.entries(agg)
    .filter(([k, v]) => v > 0 && k !== "confirmation" && k !== "conditionalOpen")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  // Escalation risk — meaningful for open work; still computed for solution
  // proposed (as context) but the reopen classifier is the headline there.
  const { risk, factors } = escalationRisk({
    trailingUnanswered, waitDays, chases, persistenceMsgs, recentTone, agg, staleDays,
    scoredCount: scored.length,
  });

  // Reopen classification (solution proposed; also summarizes closed closure).
  // Anchor: the journal's own resolution event, else caller's resolvedAtMs,
  // else the last analyst note.
  const resEvent = entries.find((e) => e.event === "resolution_notes" || e.event === "auto_resolved");
  const anchor = (resEvent && resEvent.ts) ?? resolvedAtMs ?? (lastAnalyst ? lastAnalyst.ts : null);
  const postScored = anchor != null ? scored.filter(({ e }) => e.ts != null && e.ts > anchor) : [];
  // Recency wins: walk the pool newest-first and return on the first decisive
  // message — a confirmation AFTER earlier frustration is a confirmed fix, and
  // a fresh complaint AFTER an earlier thanks is a pushback.
  const classify = (pool) => {
    for (let i = pool.length - 1; i >= 0; i--) {
      const { s } = pool[i];
      if (s.features.confirmation && s.valence >= 0) return "confirmed";
      if (s.features.pushback || s.features.persistence || s.features.breakage || s.valence <= -1) return "pushback";
      if (s.features.conditionalOpen) return "conditional";
    }
    return "silent";
  };
  let confirmState = null, reopenRisk = null;
  if (lifecycle === "solution_proposed") {
    confirmState = classify(postScored);
    reopenRisk =
      confirmState === "pushback" ? 85 :
      confirmState === "conditional" ? 55 :
      confirmState === "confirmed" ? 10 :
      recentTone != null && recentTone <= -2 ? 50 : 35;
  } else if (lifecycle === "closed" && scored.length) {
    // For the retrospective: did the customer sign off on the fix?
    confirmState = classify(scored.slice(-2));
  }

  // Arc.
  const start = vals.length ? vals[0] : null;
  const end = vals.length > 1 ? last : null;
  const arc = !vals.length ? null :
    vals.length === 1 ? "single touchpoint" :
    end - start >= 1 ? (start < 0 && end > 0 ? "recovered" : "improved") :
    end - start <= -1 ? "declined" : "stable";

  const lastQuoteRaw = lastCustomer ? lastCustomer.text.replace(/\s+/g, " ").trim() : null;

  return {
    scoreable: scored.length > 0,
    nCustomer: customerMsgs.length,
    nAnalyst: analystMsgs.length,
    valence: overall != null ? Math.round(overall) : null,
    start: start != null ? Math.round(start) : null,
    end: end != null ? Math.round(end) : null,
    arc,
    signals,
    risk: lifecycle === "closed" ? null : lifecycle === "solution_proposed" ? reopenRisk : risk,
    factors: lifecycle === "open" ? factors : lifecycle === "solution_proposed" ? factors : [],
    escalated,
    escReason,
    confirmState,
    chases,
    trailingUnanswered,
    waitDays: waitDays != null ? Math.floor(waitDays) : null,
    quote: representativeQuote(customerMsgs, overall ?? 0),
    lastQuote: lastQuoteRaw ? (lastQuoteRaw.length > 200 ? lastQuoteRaw.slice(0, 199) + "…" : lastQuoteRaw) : null,
    pii,
    dup,
  };
}

/* ------------------------------------------------------------------ *
 * 5. Row adapters — gradeCase / gradeFromRow (baked columns)          *
 * ------------------------------------------------------------------ */

const lifecycleOfState = (state) => {
  const s = String(state || "").toLowerCase();
  return s === "closed" ? "closed" : s === "resolved" ? "solution_proposed" : "open";
};
const sentimentLabel = (v) => (v == null ? null : v >= 1 ? "Positive" : v <= -1 ? "Negative" : "Neutral");

/**
 * Grade one case row. Reads the customer-visible journal
 * (`additional_comments`, falling back to `work_notes` — merged-layout exports
 * carry entry types in the headers, so internal notes are filtered either way).
 *
 * Optional row fields used when present: `_snapshotMs` (data-as-of),
 * `_resolvedAtMs` (resolution-notes save time), `_frtMs` (first response, ms).
 */
export function gradeCase(row) {
  const r = row || {};
  const journal = r.additional_comments || r.work_notes || "";
  const lifecycle = lifecycleOfState(r.state);
  const a = analyzeJournal(journal, {
    lifecycle,
    snapshotMs: r._snapshotMs ?? null,
    resolvedAtMs: r._resolvedAtMs ?? null,
  });
  return {
    number: r.number,
    account: r.account,
    priority: r.priority || null,
    lifecycle,
    myMsgs: a.nAnalyst,
    custMsgs: a.nCustomer,
    scoreable: a.scoreable,
    valence: a.valence,
    sentiment: sentimentLabel(a.valence),
    start: a.start,
    end: a.end,
    arc: a.arc,
    signals: a.signals.join(", ") || null,
    risk: a.risk,
    riskFactors: a.factors.join("; ") || null,
    escalated: a.escalated,
    escReason: a.escReason,
    confirmState: a.confirmState,
    chases: a.chases,
    unanswered: a.trailingUnanswered,
    waitDays: a.waitDays,
    quote: a.quote,
    lastQuote: a.lastQuote,
    coachingNote: buildCoachingNote(r, a),
    pii: a.pii,
    dup: a.dup,
  };
}

// Templated coaching note from structural facts (not model prose).
function buildCoachingNote(row, a) {
  const bits = [];
  const frtH = row._frtMs != null ? row._frtMs / 3.6e6 : null;
  if (typeof frtH === "number" && isFinite(frtH)) {
    bits.push(frtH <= 1 ? `fast first reply (${frtH.toFixed(1)}h)` : `first reply ${frtH.toFixed(1)}h`);
  }
  if (!a.scoreable) {
    bits.push(a.nAnalyst ? "no written customer dialogue — phone-handled or silent" : "no customer or analyst text in the journal");
    return cap(bits);
  }
  if (a.escalated) bits.push(`customer escalated${a.escReason ? ` (${a.escReason.split(" — ")[0]})` : ""}`);
  if (a.chases >= 2) bits.push(`customer chased ${a.chases}×`);
  if (a.trailingUnanswered >= 1) bits.push(`${a.trailingUnanswered} message${a.trailingUnanswered > 1 ? "s" : ""} still unanswered`);
  if (a.arc === "recovered") bits.push("recovered a frustrated opening to a positive close");
  else if (a.arc === "declined") bits.push("tone declined — review the close-out");
  if (a.confirmState === "confirmed") bits.push("customer confirmed the fix");
  else if (a.confirmState === "pushback") bits.push("customer pushed back after the proposed solution");
  else if (a.confirmState === "conditional") bits.push("customer holding the case open to verify");
  else if (a.confirmState === "silent") bits.push("no customer confirmation");
  if (a.end != null && a.end < 0) bits.push("still negative at last contact");
  if (!a.nAnalyst) bits.push("no written analyst reply in the journal");
  return cap(bits) || "Transactional exchange, neutral throughout.";
}
const cap = (bits) => (bits.length ? bits.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : "");

/**
 * Bake adapter: the flat snake_case sentiment columns persisted by BOTH
 * enrichRow and enrichForSql. Identical inputs ⇒ identical values — that
 * equality is what the enrich parity test asserts. Values are plain JS
 * (number | string | boolean | null), never undefined, so the worker's Arrow
 * column build types them cleanly.
 *
 * @param {object} row            raw case row
 * @param {number|null} frtMs     parsed first-response ms (both pipelines share it)
 * @param {number|null} snapshotMs data-as-of anchor (wait/staleness factors)
 * @param {number|null} resolvedAtMs resolution-notes save time (reopen anchor)
 */
export function gradeFromRow(row, frtMs, snapshotMs = null, resolvedAtMs = null) {
  const g = gradeCase({
    ...row,
    _frtMs: frtMs ?? null,
    _snapshotMs: snapshotMs ?? null,
    _resolvedAtMs: resolvedAtMs ?? null,
  });
  return {
    sentiment_scoreable: g.scoreable,
    sentiment_valence: g.valence,
    sentiment_label: g.sentiment,
    sentiment_start: g.start,
    sentiment_end: g.end,
    sentiment_arc: g.arc,
    sentiment_signals: g.signals,
    sentiment_quote: g.quote,
    sentiment_coaching: g.coachingNote,
    sentiment_pii: g.pii,
    sentiment_dup: g.dup,
    sentiment_risk: g.risk,
    sentiment_risk_factors: g.riskFactors,
    sentiment_escalated: g.escalated,
    sentiment_esc_reason: g.escReason,
    sentiment_confirm: g.confirmState,
    sentiment_chases: g.chases,
    sentiment_unanswered: g.unanswered,
    sentiment_wait_days: g.waitDays,
    sentiment_last_quote: g.lastQuote,
  };
}

/* ------------------------------------------------------------------ *
 * 6. Portfolio summary                                                *
 * ------------------------------------------------------------------ */

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d ? n / d : 0);

// Risk bands (validated: ≥50 flags ~2% of never-escalated open cases, ≥30 ~15%).
export const RISK_HIGH = 50;
export const RISK_ELEVATED = 30;

// Prefer the baked v11 columns; live-grade only rows from older imports (they
// show "Rebuild needed" in the file manager).
function resolveGrade(row) {
  if (!row || row.sentiment_scoreable == null || row.sentiment_risk === undefined) {
    return gradeCase(row || {});
  }
  const num = (v) => (v == null ? null : Number(v)); // BIGINT may arrive as BigInt
  return {
    number: row.number,
    account: row.account,
    priority: row.priority || null,
    lifecycle: row._lifecycle ?? row.lifecycle ?? lifecycleOfState(row.state),
    myMsgs: row._analystTurns ?? (row.analyst_turns == null ? null : Number(row.analyst_turns)),
    custMsgs: row._customerTurns ?? (row.customer_turns == null ? null : Number(row.customer_turns)),
    scoreable: !!row.sentiment_scoreable,
    valence: num(row.sentiment_valence),
    sentiment: row.sentiment_label ?? null,
    start: num(row.sentiment_start),
    end: num(row.sentiment_end),
    arc: row.sentiment_arc ?? null,
    signals: row.sentiment_signals ?? null,
    risk: num(row.sentiment_risk),
    riskFactors: row.sentiment_risk_factors ?? null,
    escalated: !!row.sentiment_escalated,
    escReason: row.sentiment_esc_reason ?? null,
    confirmState: row.sentiment_confirm ?? null,
    chases: num(row.sentiment_chases) ?? 0,
    unanswered: num(row.sentiment_unanswered) ?? 0,
    waitDays: num(row.sentiment_wait_days),
    quote: row.sentiment_quote ?? null,
    lastQuote: row.sentiment_last_quote ?? null,
    coachingNote: row.sentiment_coaching ?? null,
    pii: !!row.sentiment_pii,
    dup: !!row.sentiment_dup,
  };
}

/**
 * Grade a list of enriched rows and roll up the tab's headline metrics,
 * segmented by lifecycle (the three views of the Sentiment tab).
 * @returns {{ graded:object[], open:object[], proposed:object[], closed:object[], summary:object }}
 */
export function summarizeSentiment(rows) {
  const graded = (rows || []).map(resolveGrade);
  const open = graded.filter((g) => g.lifecycle === "open");
  const proposed = graded.filter((g) => g.lifecycle === "solution_proposed");
  const closed = graded.filter((g) => g.lifecycle === "closed");
  const scoreable = graded.filter((g) => g.scoreable);

  const valences = scoreable.map((g) => g.valence).filter((v) => v != null);
  const pos = scoreable.filter((g) => g.valence > 0).length;
  const neu = scoreable.filter((g) => g.valence === 0).length;
  const neg = scoreable.filter((g) => g.valence < 0).length;

  // Early warning (open work).
  const openScoreable = open.filter((g) => g.scoreable);
  const escalatedOpen = open.filter((g) => g.escalated);
  const highRisk = openScoreable.filter((g) => !g.escalated && (g.risk ?? 0) >= RISK_HIGH);
  const elevatedRisk = openScoreable.filter((g) => !g.escalated && (g.risk ?? 0) >= RISK_ELEVATED && (g.risk ?? 0) < RISK_HIGH);
  const unansweredTotal = open.reduce((a, g) => a + (g.unanswered || 0), 0);

  // Solution proposed (reopen watch).
  const spBy = { pushback: 0, conditional: 0, silent: 0, confirmed: 0 };
  for (const g of proposed) if (g.confirmState) spBy[g.confirmState] = (spBy[g.confirmState] || 0) + 1;

  // Closed retrospective.
  const closedScoreable = closed.filter((g) => g.scoreable);
  const closedNeg = closedScoreable.filter((g) => (g.end ?? g.valence) < 0).length;
  const recovered = closedScoreable.filter((g) => g.arc === "recovered").length;
  const declined = closedScoreable.filter((g) => g.arc === "declined").length;
  const confirmedClose = closedScoreable.filter((g) => g.confirmState === "confirmed").length;

  // Responsiveness (from the enriched FRT).
  const frtHours = (rows || [])
    .map((r) => (r._frtMs != null ? r._frtMs / 3.6e6 : r.frt_ms != null ? Number(r.frt_ms) / 3.6e6 : null))
    .filter((h) => typeof h === "number" && isFinite(h));
  const within1h = frtHours.filter((h) => h <= 1).length;

  let dupPosts = 0, piiExposure = 0;
  const piiCases = [];
  for (const g of graded) {
    if (g.dup) dupPosts++;
    if (g.pii) { piiExposure++; piiCases.push(g.number); }
  }

  return {
    graded,
    open,
    proposed,
    closed,
    scoreable,
    summary: {
      analyzed: graded.length,
      scoreableCount: scoreable.length,
      scoreableShare: pct(scoreable.length, graded.length),
      silent: graded.length - scoreable.length,
      avgValence: valences.length ? valences.reduce((a, b) => a + b, 0) / valences.length : 0,
      normalized100: valences.length
        ? Math.round(((valences.reduce((a, b) => a + b, 0) / valences.length) + 5) / 10 * 100)
        : null,
      pos, neu, neg,
      posShare: pct(pos, scoreable.length),
      negShare: pct(neg, scoreable.length),
      openTotal: open.length,
      openScoreable: openScoreable.length,
      escalatedOpen: escalatedOpen.length,
      escalatedOpenCases: escalatedOpen.map((g) => g.number),
      highRisk: highRisk.length,
      highRiskCases: highRisk.map((g) => g.number),
      elevatedRisk: elevatedRisk.length,
      unansweredTotal,
      spTotal: proposed.length,
      spPushback: spBy.pushback,
      spConditional: spBy.conditional,
      spSilent: spBy.silent,
      spConfirmed: spBy.confirmed,
      closedTotal: closed.length,
      closedScoreable: closedScoreable.length,
      closedNegative: closedNeg,
      recovered,
      declined,
      confirmedClose,
      confirmedCloseShare: pct(confirmedClose, closedScoreable.length),
      medianFrtH: median(frtHours),
      within1hShare: pct(within1h, frtHours.length),
      duplicatePosts: dupPosts,
      piiExposure,
      piiCases,
    },
  };
}
