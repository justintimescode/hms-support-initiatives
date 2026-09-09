// Thresholds, weights and enums for the unified Jira ↔ ServiceNow insight
// layer. Mirrors the role of sop-thresholds.js: edit the values HERE when the
// model changes. correlate.js / insight-metrics.js / insight-rank.js /
// insight-filters.js read them via imports, so no magic number appears in
// logic or in JSX.
//
// Every weight carries the reason it has the value it has. A ranking a manager
// cannot interrogate is a ranking they cannot act on.

import { STALE_DAYS } from './jira-enrich.js'

/* ------------------------------- staleness ------------------------------- */

// A Jira with no activity in this many days has gone quiet. Re-exported from
// jira-enrich.js rather than redeclared, so "stale" means exactly one thing
// across the standalone Jira pages and this layer.
//
// NOTE a deliberate boundary difference: `enrichIssue` tests staleness with
// `>` on raw milliseconds, this layer tests `>=` on floored whole days —
// matching `staleWithImpact`, which is the blast-radius side these clusters
// project onto. The two agree everywhere except the exact 30-day instant.
export const JIRA_STALE_DAYS = STALE_DAYS

/* --------------------------- urgency (0..100) ---------------------------- */

// The single normalized urgency scale both sources map onto. Kept as named
// steps rather than raw numbers so the mapping tables in insight-metrics.js
// read as intent ("this Jira priority is HIGH") instead of arithmetic.
export const URGENCY_CRITICAL = 100;
export const URGENCY_HIGH = 75;
export const URGENCY_MEDIUM = 50;
export const URGENCY_LOW = 25;
export const URGENCY_LOWEST = 10;

// "High urgency" for the risk-cluster predicate and the interaction term.
// Set at HIGH so both P1/Critical and P2/Major qualify: in this queue a P2 with
// a long-unresolved blocker is the same conversation as a P1.
export const URGENCY_HIGH_MIN = URGENCY_HIGH;

/* ---------------------------- escalation enum ---------------------------- */

// ServiceNow has no native escalation field, so this enum is DERIVED — see
// `escalationOf` in insight-metrics.js for the exact signals behind each level.
// Listed ascending by severity; `escalationRank` indexes into it.
export const ESC_NONE = 'none';
export const ESC_WATCH = 'watch';
export const ESC_AT_RISK = 'at-risk';
export const ESC_ESCALATED = 'escalated';
export const ESCALATION_LEVELS = [ESC_NONE, ESC_WATCH, ESC_AT_RISK, ESC_ESCALATED];

// Cap on how many contributing reasons ride along with a level. A 20-case
// cluster would otherwise emit 20 near-identical lines; the overflow is
// summarized as "+N more" by the caller so nothing is silently dropped.
export const MAX_ESCALATION_REASONS = 4;

/* ----------------------------- ranking weights --------------------------- */
//
// score = clamp(SCORE_MIN, SCORE_MAX, Σ factor weights). Every term is capped
// so no single signal can dominate — that was the failure mode of the formula
// this replaces (`cases.length * 2 + …`), where raw case count swamped
// escalation, sentiment and age combined.

// Truly-open affected cases. The headline term: this is "real customer impact"
// rather than ticket age, which is the whole premise of the ranking.
export const W_OPEN_CASE = 6;
export const CAP_OPEN_CASE = 30;

// Each distinct account beyond the first. Breadth beats depth — four accounts
// with one case each is a worse story than one account with four cases, because
// it is four separate customer relationships.
export const W_DISTINCT_ACCOUNT = 5;
export const CAP_DISTINCT_ACCOUNT = 20;

// Engineering dwell on the oldest unresolved Jira, per week open. Age was the
// only real signal in the old formula; it is kept, but demoted to one term
// among several rather than the tiebreak that decided everything.
export const W_JIRA_AGE_PER_WEEK = 1;
export const CAP_JIRA_AGE = 15;

// The oldest open case's age, per week. Tracked SEPARATELY from Jira age
// because a Jira raised last week can sit under a case that has been open for
// eight months — the Jira's age hides the customer's actual wait.
export const W_CASE_AGE_PER_WEEK = 1;
export const CAP_CASE_AGE = 15;

// Derived escalation level. Weighted above any plausible volume contribution
// for `escalated`: an explicit customer escalation outranks a pile of quiet
// cases, because someone has already picked up the phone.
export const W_ESCALATION = {
  [ESC_NONE]: 0,
  [ESC_WATCH]: 7,
  [ESC_AT_RISK]: 15,
  [ESC_ESCALATED]: 25,
};

// Negative-sentiment pressure. Reads the VALIDATED bands from sentiment.js
// (RISK_HIGH / RISK_ELEVATED) rather than inventing new cut points — those two
// numbers were tuned against a corpus study and this layer has no standing to
// second-guess them.
export const W_SENTIMENT_HIGH = 10;
export const W_SENTIMENT_ELEVATED = 5;
export const W_SENTIMENT_PER_ESCALATED = 5;
export const CAP_SENTIMENT = 15;

// The named interaction from the brief: high urgency AND long-unresolved is
// worse than the sum of its parts, because it is the combination that produces
// an escalation rather than either signal alone.
export const W_URGENCY_AGE_INTERACTION = 12;
export const URGENCY_AGE_MIN_DAYS = 30;

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/* --------------------------------- bands --------------------------------- */

export const BAND_HIGH = 'high';
export const BAND_MEDIUM = 'medium';
export const BAND_LOW = 'low';

// Inclusive lower bounds: score >= BAND_HIGH_MIN is 'high'. Chosen so 'high'
// cannot be reached by volume alone (CAP_OPEN_CASE + CAP_DISTINCT_ACCOUNT = 50)
// — a cluster only lands in 'high' when escalation, sentiment or age also fire.
export const BAND_HIGH_MIN = 60;
export const BAND_MEDIUM_MIN = 35;

/* --------------------------- risk-cluster shapes -------------------------- */

// Cluster flag ids. Strings are the contract the UI and CSV read.
export const FLAG_STALE_JIRA_MULTI_CASE = 'stale-jira-multi-case';
export const FLAG_URGENCY_SENTIMENT_ESCALATION = 'urgency-sentiment-escalation';

// "Multiple unresolved cases" for the first named risk cluster. Two is the
// smallest number that makes a fix worth sequencing ahead of a single-case one.
export const MULTI_CASE_MIN = 2;

/* -------------------------------- utility -------------------------------- */

export const DAYS_PER_WEEK = 7;
export const MS_PER_DAY = 864e5;
