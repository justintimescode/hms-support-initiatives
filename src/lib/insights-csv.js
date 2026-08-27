// CSV builders for the Operations (impact clusters) view.
//
// SECURITY #7 — every cell goes through `rowsToCsv`, which passes each value to
// `sanitizeCellForExport` before RFC-4180 quoting. There is deliberately NO local
// escape helper here: a previous feature wrote its own `escapeCsv` that only did
// quoting, and shipped a live formula-injection hole. A ServiceNow value like
// `=cmd|'/c calc'!A1` is inert in the browser and executes in Excel.
//
// Pure: no DOM, no wall clock. The caller supplies the download and the filename
// stamp. Two shapes, because they answer different questions:
//   * cluster rows  — one line per ecosystem, for triage and ranking
//   * case rows     — one line per case, for pivoting and hand-off
//
// "Not linked" is written as the WORD, never as 0 (invariant 4).

import { rowsToCsv } from './csv-export.js';

const nz = (v) => (v == null ? '' : v);
/** Days-linked cell: the literal "Not linked" when there is no System link note,
 *  so a spreadsheet reader cannot mistake it for "linked today". */
const daysLinkedCell = (d) => (d == null ? 'Not linked' : d);
const list = (a) => (a && a.length ? a.join(' | ') : '');

export const CLUSTER_COLUMNS = [
  'Cluster', 'Impact score', 'Band', 'Risk flags',
  'Jira keys', 'Jira count', 'ServiceNow refs', 'Case numbers', 'Cases', 'Open cases',
  'Accounts affected', 'Distinct accounts',
  'Urgency (0-100)', 'Escalation', 'Escalation reasons',
  'Worst escalation risk', 'Negative cases', 'Escalated cases',
  'Oldest Jira (days)', 'Median Jira age (days)',
  'Oldest case (days)', 'Median case age (days)', 'Case vs Jira age delta (days)',
  'SLA breached cases', 'Mentioned-only keys', 'Summary', 'Why it ranks here',
];

/** One row per cluster. */
export function clusterCsvRows(clusters) {
  return (clusters || []).map((c) => {
    const m = c.metrics;
    return [
      c.id,
      c.score,
      c.band,
      list(c.clusterFlags),
      list(c.jiraKeys),
      c.jiraKeys.length,
      // The `RN-` refs that resolved onto those keys. Traceability only: they are
      // the same tickets, so they are deliberately NOT counted in 'Jira count'.
      list([...new Set(c.jira.flatMap((j) => j.aliasedFrom || []))].sort()),
      list(c.caseNumbers),
      m.volume.totalCases,
      m.volume.openCases,
      list([...new Set(c.cases.map((x) => x.account).filter(Boolean))].sort()),
      m.volume.distinctAccounts,
      nz(m.priorityNorm),
      m.escalation.level,
      list(m.escalation.reasons),
      nz(m.sentiment.worstRisk),
      m.sentiment.negativeCount,
      m.sentiment.escalatedCount,
      nz(m.jiraAgeDays.max),
      nz(m.jiraAgeDays.median),
      nz(m.caseAgeDays.max),
      nz(m.caseAgeDays.median),
      nz(m.ageDelta),
      c.cases.filter((x) => x.slaBreached).length,
      list(c.mentionedOnlyKeys),
      c.summary,
      // The explainable score, spelled out — the same chips the UI shows.
      c.factors.map((f) => `${f.label} +${f.weight} (${f.detail})`).join(' | '),
    ];
  });
}

export const CASE_COLUMNS = [
  'Case', 'Description', 'Account', 'Parent account', 'Region', 'Assignment group',
  'Product line', 'Analyst', 'Manager', 'Priority', 'Urgency (0-100)', 'Category',
  'Lifecycle', 'Age (days)', 'Age bucket', 'Days linked',
  'SLA breached', 'SLA breach reason',
  'Escalation risk', 'Escalated', 'Escalation reason', 'Sentiment', 'Signals',
  'Last customer message',
  'Linked Jira keys', 'Mentioned-only keys',
  'Cluster', 'Cluster impact score', 'Cluster band',
];

/** One row per (cluster, case) pair. A case linked into two clusters appears
 *  twice — that is the honest shape for a pivot table, and cannot happen for
 *  connected components anyway (a case belongs to exactly one). */
export function caseCsvRows(clusters) {
  const rows = [];
  for (const c of clusters || []) {
    // Which Jira keys THIS case is actually linked to, not the whole cluster's.
    const keysByCase = new Map();
    for (const e of c.edges) {
      if (!keysByCase.has(e.caseNumber)) keysByCase.set(e.caseNumber, []);
      keysByCase.get(e.caseNumber).push(e.jiraKey);
    }
    const mentionsByCase = new Map();
    for (const e of c.mentionEdges) {
      if (!mentionsByCase.has(e.caseNumber)) mentionsByCase.set(e.caseNumber, []);
      mentionsByCase.get(e.caseNumber).push(e.jiraKey);
    }
    for (const k of c.cases) {
      rows.push([
        k.number, nz(k.shortDescription), nz(k.account), nz(k.parentAccount),
        nz(k.region), nz(k.assignmentGroup), nz(k.productLine),
        nz(k.assignedTo), nz(k.manager), nz(k.priority), nz(k.priorityNorm), nz(k.category),
        nz(k.lifecycle), nz(k.ageDays), nz(k.ageBucket), daysLinkedCell(k.daysLinked),
        k.slaBreached ? 'yes' : 'no', nz(k.slaBreachReason),
        nz(k.sentimentRisk), k.sentimentEscalated ? 'yes' : 'no', nz(k.sentimentEscReason),
        nz(k.sentimentLabel), nz(k.sentimentSignals), nz(k.sentimentQuote),
        list((keysByCase.get(k.number) || []).slice().sort()),
        list((mentionsByCase.get(k.number) || []).slice().sort()),
        c.id, c.score, c.band,
      ]);
    }
  }
  return rows;
}

/** Complete cluster-level CSV document. */
export const clustersToCsv = (clusters) => rowsToCsv(CLUSTER_COLUMNS, clusterCsvRows(clusters));

/** Complete case-level CSV document. */
export const casesToCsv = (clusters) => rowsToCsv(CASE_COLUMNS, caseCsvRows(clusters));
