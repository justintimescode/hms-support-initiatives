// On-device "Customer Sentiment & Escalation Early-Warning" workbook — rebuilt
// from the baked grades so the team never has to run an export through a model.
// No network, no model.
//
// SECURITY #7: every string cell goes through sanitizeCellForExport so a
// ServiceNow value like `=cmd|…` can't execute as a formula when opened in
// Excel. Numbers/dates are written as typed cells (no injection surface).

import { summarizeSentiment } from "./sentiment.js";
import { sanitizeCellForExport, csvTimestamp } from "./csv-export.js";

// Per-Case Detail — one row per case, triage columns first.
export const PER_CASE_COLUMNS = [
  "Case", "Account", "Contact", "Priority", "Lifecycle", "Status", "Created", "Closed",
  "Escalated", "Escalation reason", "Risk (0-100)", "Risk factors",
  "Customer response", "Chases", "Unanswered", "Waiting (d)",
  "My msgs", "Cust msgs", "First reply (h)",
  "Valence (-5..+5)", "Sentiment", "Start", "End", "Arc", "Signals",
  "Representative customer quote", "Last customer message", "Notes", "Auto-closed",
];

const COL_WIDTH = {
  "Case": 14, "Account": 22, "Contact": 18, "Priority": 13, "Lifecycle": 16, "Status": 16,
  "Created": 18, "Closed": 18, "Escalated": 10, "Escalation reason": 36,
  "Risk (0-100)": 12, "Risk factors": 52, "Customer response": 16,
  "Chases": 8, "Unanswered": 11, "Waiting (d)": 11,
  "My msgs": 9, "Cust msgs": 9, "First reply (h)": 13,
  "Valence (-5..+5)": 14, "Sentiment": 11, "Start": 7, "End": 7, "Arc": 16, "Signals": 26,
  "Representative customer quote": 52, "Last customer message": 52, "Notes": 52, "Auto-closed": 11,
};

const round2 = (x) => Math.round(x * 100) / 100;
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const dateCell = (d) => (d instanceof Date && !isNaN(d.getTime()) ? d : null);
const txt = (v) => sanitizeCellForExport(v == null ? "" : String(v));
const pctStr = (x) => `${Math.round((x || 0) * 100)}%`;

/**
 * Build the two-sheet workbook for the given rows (no DOM — pure, unit-testable
 * in Node). Values come from the baked grades via summarizeSentiment, plus the
 * raw enriched row for the non-sentiment columns.
 *
 * @param {object[]} rows  enriched case rows (the page's current filtered set)
 * @returns {Promise<import("exceljs").Workbook>}
 */
export async function buildSentimentWorkbook(rows) {
  const ExcelJS = (await import("exceljs")).default;
  const { graded, summary } = summarizeSentiment(rows || []);
  const byNumber = new Map((rows || []).map((r) => [r.number, r]));
  // Auto-closed = a closed case with no written customer voice — matches the
  // "silent" coverage line (body-based, not header-count based).
  const isAutoClosed = (g) => {
    const r = byNumber.get(g.number);
    return !!(r && r._isClosed && !g.scoreable);
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "KPI Analyzer";

  /* ---- Sheet 1: Headline Metrics ---- */
  const hm = wb.addWorksheet("Headline Metrics", { views: [{ state: "frozen", ySplit: 1 }] });
  hm.columns = [
    { header: "Section", key: "section", width: 18 },
    { header: "Metric", key: "metric", width: 44 },
    { header: "Value", key: "value", width: 18 },
    { header: "Detail", key: "detail", width: 56 },
  ];
  hm.getRow(1).font = { bold: true };

  const autoClosed = graded.filter(isAutoClosed).length;
  const HEADLINE = [
    ["Coverage", "Cases analyzed", summary.analyzed, ""],
    ["Coverage", "Scoreable cases (customer wrote something)", summary.scoreableCount, `${pctStr(summary.scoreableShare)} of analyzed`],
    ["Coverage", "Phone / silent (no written customer voice)", summary.silent, ""],
    ["Coverage", "Auto-closed (closed, no customer message)", autoClosed, ""],
    ["Early warning", "Escalation events in open cases", summary.escalatedOpen, (summary.escalatedOpenCases || []).join(", ")],
    ["Early warning", "High escalation risk (≥50, not yet escalated)", summary.highRisk, (summary.highRiskCases || []).join(", ")],
    ["Early warning", "Elevated escalation risk (30–49)", summary.elevatedRisk, ""],
    ["Early warning", "Customer messages awaiting a reply", summary.unansweredTotal, "trailing unanswered, open cases"],
    ["Solution proposed", "Awaiting customer confirmation", summary.spTotal, ""],
    ["Solution proposed", "Pushback (says it isn't fixed)", summary.spPushback, "reopen risk — respond first"],
    ["Solution proposed", "Verifying (holding case open to test)", summary.spConditional, ""],
    ["Solution proposed", "No confirmation (silent)", summary.spSilent, ""],
    ["Solution proposed", "Confirmed fixed", summary.spConfirmed, ""],
    ["Sentiment", "Average valence", round2(summary.avgValence), "scale -5..+5"],
    ["Sentiment", "Normalized score", summary.normalized100, "0..100"],
    ["Sentiment", "Positive", summary.pos, pctStr(summary.posShare)],
    ["Sentiment", "Neutral", summary.neu, ""],
    ["Sentiment", "Negative", summary.neg, pctStr(summary.negShare)],
    ["Closed review", "Closed with written dialogue", summary.closedScoreable, `of ${summary.closedTotal} closed`],
    ["Closed review", "Ended negative", summary.closedNegative, ""],
    ["Closed review", "Recovered (frustrated → positive)", summary.recovered, ""],
    ["Closed review", "Declined (tone worsened)", summary.declined, ""],
    ["Closed review", "Customer confirmed fix before close", summary.confirmedClose, pctStr(summary.confirmedCloseShare)],
    ["Responsiveness", "Median first reply (h)", summary.medianFrtH == null ? "" : round2(summary.medianFrtH), ""],
    ["Responsiveness", "Within 1 hour", pctStr(summary.within1hShare), ""],
    ["Hygiene", "Duplicate double-posts", summary.duplicatePosts, ""],
    ["Hygiene", "PII exposure", summary.piiExposure, (summary.piiCases || []).join(", ")],
  ];
  for (const [section, metric, value, detail] of HEADLINE) {
    hm.addRow({
      section: txt(section),
      metric: txt(metric),
      value: typeof value === "number" ? value : txt(value),
      detail: txt(detail),
    });
  }

  /* ---- Sheet 2: Per-Case Detail ---- */
  const pc = wb.addWorksheet("Per-Case Detail", { views: [{ state: "frozen", ySplit: 1 }] });
  pc.columns = PER_CASE_COLUMNS.map((h) => ({ header: h, width: COL_WIDTH[h] || 16 }));
  pc.getRow(1).font = { bold: true };

  for (const g of graded) {
    const r = byNumber.get(g.number) || {};
    const frtH = r._frtMs != null ? r._frtMs / 3.6e6 : null;
    pc.addRow([
      txt(g.number),
      txt(g.account),
      txt(r.contact),
      txt(g.priority),
      txt(g.lifecycle),
      txt(r.status ?? r.state),
      dateCell(r._created),
      dateCell(r._closed),
      g.escalated ? "Yes" : "",
      txt(g.escReason),
      g.risk == null ? "" : num(g.risk),
      txt(g.riskFactors),
      txt(g.confirmState),
      num(g.chases),
      num(g.unanswered),
      g.waitDays == null ? "" : num(g.waitDays),
      num(g.myMsgs),
      num(g.custMsgs),
      frtH == null ? "" : round2(frtH),
      g.valence == null ? "" : num(g.valence),
      txt(g.sentiment),
      g.start == null ? "" : num(g.start),
      g.end == null ? "" : num(g.end),
      txt(g.arc),
      txt(g.signals),
      txt(g.quote),
      txt(g.lastQuote),
      txt(g.coachingNote),
      isAutoClosed(g) ? "Yes" : "",
    ]);
  }
  // Typed number formats: Created/Closed as dates, First reply as 1-decimal hours.
  pc.getColumn(7).numFmt = "yyyy-mm-dd hh:mm";
  pc.getColumn(8).numFmt = "yyyy-mm-dd hh:mm";
  pc.getColumn(19).numFmt = "0.0";

  return wb;
}

/**
 * Build the workbook and trigger a browser download.
 * @param {object[]} rows  enriched case rows
 * @param {{ filename?: string }} [opts]
 */
export async function exportSentimentWorkbook(rows, opts = {}) {
  const wb = await buildSentimentWorkbook(rows);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.filename || `sentiment-early-warning-${csvTimestamp()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
