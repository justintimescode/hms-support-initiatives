// My Day — the pure selection layer behind the personal (analyst) and team
// (manager) triage views. No React, no DOM, no chart code: every figure the
// page renders is finished data from here.
//
// TWO RULES THIS MODULE FOLLOWS
//
//   NOW IS AN ARGUMENT. My Day is deliberately "right now" work rather than a
//   historical window, so the clock is real — but it is always injected, never
//   read here. Tests pin it; the page passes Date.now() once per render.
//
//   ONE CASE, ONE FLAG. A manager ranking their reports does not want weighted
//   scores nobody can explain. `flagged` is the count of DISTINCT case numbers
//   that tripped at least one signal (overdue update, SLA breach or <24h, stuck
//   30d+, escalation watch), so a case shouting through four signals still
//   counts once and the column means exactly what it says.
//
// The escalation watch reads the baked `sentiment_*` columns through
// summarizeSentiment (lib/sentiment.js) — the same deterministic on-device
// engine the Sentiment tab uses. Nothing is sent to a model.

import { slaRiskOf } from "./stats.js";
import { summarizeSentiment, RISK_HIGH, RISK_ELEVATED } from "./sentiment.js";

export const STUCK_DAYS = 30;
export const UNASSIGNED = "Unassigned";
export { RISK_HIGH, RISK_ELEVATED };

const DAY_MS = 864e5;

/**
 * Cases worth a conversation before they become an escalation.
 *
 * Scope is live work only. Closed cases are retrospective and belong on the
 * Sentiment tab's closed review, not on anyone's day.
 *
 * TRULY-OPEN cases make the list when the customer already escalated (a
 * workflow event in the journal — observed, never predicted) or when the
 * escalation risk reaches `minRisk`.
 *
 * SOLUTION PROPOSED cases are NOT admitted by their risk number. For an SP case
 * `sentiment_risk` is REOPEN risk, which a silent, aging proposal earns without
 * the customer having said a word — on a real export that is most of the SP
 * backlog, and folding it in buries every genuine escalation signal under it. An
 * SP case joins the watch only on an explicit customer signal: they escalated,
 * or they pushed back on the fix ("that didn't work"), which is the strongest
 * reopen signal in the corpus. The rest of the SP backlog is watched where it
 * belongs — the Solution Proposed auto-close queue.
 *
 * Ordering: already-escalated first (it happened), then risk desc, then the
 * number of unanswered customer messages, then longest wait.
 *
 * @param {object[]} rows enriched rows (any date scope)
 * @param {{minRisk?: number}} [opts]
 * @returns {{watch: object[], escalated: object[], high: object[],
 *            elevated: object[], pushback: object[], counts: object}}
 */
export function escalationWatch(rows, { minRisk = RISK_ELEVATED } = {}) {
  const { open, proposed } = summarizeSentiment(rows || []);

  const watch = [
    ...open.filter((g) => g.escalated || (g.risk ?? 0) >= minRisk),
    ...proposed.filter((g) => g.escalated || g.confirmState === "pushback"),
  ];

  watch.sort(
    (a, b) =>
      (b.escalated ? 1 : 0) - (a.escalated ? 1 : 0) ||
      (b.risk ?? -1) - (a.risk ?? -1) ||
      (b.unanswered || 0) - (a.unanswered || 0) ||
      (b.waitDays || 0) - (a.waitDays || 0),
  );

  const escalated = watch.filter((g) => g.escalated);
  const high = watch.filter((g) => !g.escalated && (g.risk ?? 0) >= RISK_HIGH);
  const elevated = watch.filter(
    (g) => !g.escalated && (g.risk ?? 0) >= RISK_ELEVATED && (g.risk ?? 0) < RISK_HIGH,
  );
  // Pushback below the elevated band: on the list for what the customer SAID,
  // not for what the risk number reads. Counted separately so the bands stay
  // honest — escalated + high + elevated + pushback === total.
  const pushback = watch.filter(
    (g) => !g.escalated && (g.risk ?? 0) < RISK_ELEVATED && g.confirmState === "pushback",
  );

  return {
    watch,
    escalated,
    high,
    elevated,
    pushback,
    counts: {
      total: watch.length,
      escalated: escalated.length,
      high: high.length,
      elevated: elevated.length,
      pushback: pushback.length,
      unanswered: open.reduce((a, g) => a + (g.unanswered || 0), 0),
    },
  };
}

/** Empty per-member accumulator. `_flagged` is a Set of case numbers (dropped
 *  from the public shape by `finalize` in favor of its size). */
function blankMember(name) {
  return {
    name,
    open: 0,
    overdue: 0,
    dueSoon: 0,
    slaBreached: 0,
    slaDue24: 0,
    slaDueWeek: 0,
    stuck: 0,
    jiraBlocked: 0,
    escalated: 0,
    highRisk: 0,
    elevatedRisk: 0,
    pushback: 0,
    unanswered: 0,
    _flagged: new Set(),
  };
}

function finalize({ _flagged, ...m }) {
  return {
    ...m,
    slaAtRisk: m.slaBreached + m.slaDue24 + m.slaDueWeek,
    escalationWatch: m.escalated + m.highRisk + m.elevatedRisk + m.pushback,
    flagged: _flagged.size,
  };
}

/**
 * A manager's day: one rollup row per analyst who reports into the current
 * scope, plus the team totals.
 *
 * `rows` must already be manager-scoped (the app's `enrichedManagerAll`, which
 * ignores the analyst filter on purpose — a manager view narrowed to one report
 * is not a team view). `queue` is a getUpdateQueue() result, or null while it is
 * still loading / when there is no snapshot to anchor it to: overdue counts then
 * read 0 and the page shows them as pending rather than as good news.
 *
 * @param {object[]} rows enriched, manager-scoped, ALL dates
 * @param {{overdue?: object[], dueSoon?: object[]}|null} queue
 * @param {{now?: number, stuckDays?: number}} [opts]
 * @returns {{members: object[], totals: object, memberCount: number}}
 */
export function teamDay(rows, queue, { now = Date.now(), stuckDays = STUCK_DAYS } = {}) {
  const byName = new Map();
  const ensure = (raw) => {
    const name = raw || UNASSIGNED;
    let m = byName.get(name);
    if (!m) {
      m = blankMember(name);
      byName.set(name, m);
    }
    return m;
  };

  const stuckCutoff = stuckDays * DAY_MS;

  // Every analyst holding live work gets a row, even a completely calm one.
  for (const r of rows || []) {
    if (!r._isOpen) continue;
    const m = ensure(r.assigned_to);
    m.open += 1;
    const risk = slaRiskOf(r, now);
    if (risk === "breached") {
      m.slaBreached += 1;
      m._flagged.add(r.number);
    } else if (risk === "due24") {
      m.slaDue24 += 1;
      m._flagged.add(r.number);
    } else if (risk === "dueWeek") {
      m.slaDueWeek += 1;
    }
    if ((r._jiraActiveTickets?.length || 0) > 0) m.jiraBlocked += 1;
    if (r._created && now - r._created.getTime() >= stuckCutoff) {
      m.stuck += 1;
      m._flagged.add(r.number);
    }
  }

  // Escalation watch spans open + Solution Proposed, so an SP case can add a
  // row for an analyst who holds no truly-open work at all.
  for (const g of escalationWatch(rows).watch) {
    const m = ensure(g.assignee);
    if (g.escalated) m.escalated += 1;
    else if ((g.risk ?? 0) >= RISK_HIGH) m.highRisk += 1;
    else if ((g.risk ?? 0) >= RISK_ELEVATED) m.elevatedRisk += 1;
    else m.pushback += 1;
    m.unanswered += g.unanswered || 0;
    m._flagged.add(g.number);
  }

  // Cadence buckets come from the SQL queue (snapshot-anchored), not from the
  // in-memory rows, so My Day and the Update Queue can never disagree.
  for (const q of queue?.overdue || []) {
    const m = ensure(q.assignedTo);
    m.overdue += 1;
    m._flagged.add(q.number);
  }
  for (const q of queue?.dueSoon || []) {
    ensure(q.assignedTo).dueSoon += 1;
  }

  const members = [...byName.values()].map(finalize);
  // Most work needing attention first; open volume breaks ties so a quiet
  // 40-case analyst still outranks a quiet 3-case one.
  members.sort((a, b) => b.flagged - a.flagged || b.open - a.open || a.name.localeCompare(b.name));

  const totals = members.reduce(
    (acc, m) => {
      for (const k of [
        "open", "overdue", "dueSoon", "slaBreached", "slaDue24", "slaDueWeek",
        "stuck", "jiraBlocked", "escalated", "highRisk", "elevatedRisk", "pushback",
        "unanswered", "slaAtRisk", "escalationWatch", "flagged",
      ]) acc[k] += m[k];
      return acc;
    },
    {
      open: 0, overdue: 0, dueSoon: 0, slaBreached: 0, slaDue24: 0, slaDueWeek: 0,
      stuck: 0, jiraBlocked: 0, escalated: 0, highRisk: 0, elevatedRisk: 0,
      pushback: 0, unanswered: 0, slaAtRisk: 0, escalationWatch: 0, flagged: 0,
    },
  );

  return { members, totals, memberCount: members.length };
}

/**
 * SLA pressure on one analyst's open work, bucketed and due-soonest first.
 * Lifted out of the page so the analyst and team views share one definition.
 * @param {object[]} openRows rows already filtered to `_isOpen`
 * @param {number} now injected clock
 */
export function slaPressure(openRows, now = Date.now()) {
  const breached = [], due24 = [], dueWeek = [];
  for (const r of openRows || []) {
    const k = slaRiskOf(r, now);
    if (k === "breached") breached.push(r);
    else if (k === "due24") due24.push(r);
    else if (k === "dueWeek") dueWeek.push(r);
  }
  const byDue = (a, b) => (a._slaDueSop?.getTime() || 0) - (b._slaDueSop?.getTime() || 0);
  breached.sort(byDue);
  due24.sort(byDue);
  dueWeek.sort(byDue);
  return { breached, due24, dueWeek, atRisk: [...breached, ...due24, ...dueWeek] };
}
