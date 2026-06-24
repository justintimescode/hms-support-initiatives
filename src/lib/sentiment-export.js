// On-device regeneration of the "Customer Sentiment Review" workbook — the same
// two-sheet structure the LLM produced, rebuilt from the baked grades so the
// team never has to run a whole export through a model. No network, no model.
//
// SECURITY #7: every string cell goes through sanitizeCellForExport so a
// ServiceNow value like `=cmd|…` can't execute as a formula when opened in
// Excel. Numbers/dates are written as typed cells (no injection surface).

import { summarizeSentiment } from "./sentiment.js";
import { sanitizeCellForExport, csvTimestamp } from "./csv-export.js";

// Per-Case Detail — EXACT column order from the review spreadsheet.
export const PER_CASE_COLUMNS = [
  "Case", "Account", "Contact", "Priority", "Status", "Created", "Closed",
  "Product", "My msgs", "Cust msgs", "First reply (h)", "Valence (-5..+5)",
  "Sentiment", "Start", "End", "Arc", "Emotions", "Frustration target",
  "Representative customer quote", "Coaching note", "Auto-closed",
];

const COL_WIDTH = {
  "Case": 14, "Account": 22, "Contact": 18, "Priority": 13, "Status": 16,
  "Created": 18, "Closed": 18, "Product": 18, "My msgs": 9, "Cust msgs": 9,
  "First reply (h)": 13, "Valence (-5..+5)": 14, "Sentiment": 11, "Start": 7,
  "End": 7, "Arc": 20, "Emotions": 26, "Frustration target": 16,
  "Representative customer quote": 52, "Coaching note": 52, "Auto-closed": 11,
};

const round2 = (x) => Math.round(x * 100) / 100;
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const dateCell = (d) => (d instanceof Date && !isNaN(d.getTime()) ? d : null);
const txt = (v) => sanitizeCellForExport(v == null ? "" : String(v));
const pctStr = (x) => `${Math.round((x || 0) * 100)}%`;

/**
 * Build the two-sheet sentiment workbook for the given rows (no DOM — pure, so
 * it is unit-testable in Node). Pulls values straight from the baked grades via
 * summarizeSentiment (which prefers baked columns), plus the raw enriched row
 * for the few non-sentiment columns (Contact, Status, Product, dates, auto-closed).
 *
 * @param {object[]} rows  enriched case rows (the page's current filtered set)
 * @returns {Promise<import("exceljs").Workbook>}
 */
export async function buildSentimentWorkbook(rows) {
  const ExcelJS = (await import("exceljs")).default;
  const { graded, summary } = summarizeSentiment(rows || []);
  const byNumber = new Map((rows || []).map((r) => [r.number, r]));
  // Auto-closed = a closed case with no written customer voice. Keyed off the
  // same body-based signal as scoreability (NOT the header-count custMsgs, which
  // counts an empty-bodied customer entry), so this matches the "Phone / silent"
  // coverage line (rows − scoreable) instead of disagreeing on empty-body cases.
  const isAutoClosed = (g) => {
    const r = byNumber.get(g.number);
    return !!(r && r._isClosed && !g.scoreable);
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "KPI Analyzer";

  /* ---- Sheet 1: Headline Metrics ---- */
  const hm = wb.addWorksheet("Headline Metrics", { views: [{ state: "frozen", ySplit: 1 }] });
  hm.columns = [
    { header: "Section", key: "section", width: 16 },
    { header: "Metric", key: "metric", width: 40 },
    { header: "Value", key: "value", width: 18 },
    { header: "Detail", key: "detail", width: 52 },
  ];
  hm.getRow(1).font = { bold: true };

  const autoClosed = graded.filter(isAutoClosed).length;
  const HEADLINE = [
    ["Coverage", "Cases analyzed", summary.analyzed, ""],
    ["Coverage", "Scoreable cases", summary.scoreableCount, `${pctStr(summary.scoreableShare)} of analyzed`],
    ["Coverage", "Phone / silent (no written customer voice)", summary.silent, ""],
    ["Coverage", "Auto-closed (closed, no customer message)", autoClosed, ""],
    ["Sentiment", "Average valence", round2(summary.avgValence), "scale -5..+5"],
    ["Sentiment", "Normalized score", summary.normalized100, "0..100"],
    ["Sentiment", "Positive", summary.pos, pctStr(summary.posShare)],
    ["Sentiment", "Neutral", summary.neu, ""],
    ["Sentiment", "Negative", summary.neg, pctStr(summary.negShare)],
    ["Trajectory", "Opened frustrated", summary.openedFrustrated, ""],
    ["Trajectory", "Recovered (frustrated → positive)", summary.recovered, ""],
    ["Trajectory", "Still negative at close", summary.stillNegative, (summary.stillNegativeCases || []).join(", ")],
    ["Trajectory", "Calm → negative", summary.calmToNegative, ""],
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
      txt(r.status ?? r.state),
      dateCell(r._created),
      dateCell(r._closed),
      txt(r.product_line),
      num(g.myMsgs),
      num(g.custMsgs),
      frtH == null ? "" : round2(frtH),
      num(g.valence),
      txt(g.sentiment),
      num(g.start),
      g.end == null ? "" : num(g.end),
      txt(g.arc),
      txt(g.emotions),
      txt(g.frustrationTarget),
      txt(g.quote),
      txt(g.coachingNote),
      isAutoClosed(g) ? "Yes" : "",
    ]);
  }
  // Typed number formats: Created/Closed as dates, First reply as 1-decimal hours.
  pc.getColumn(6).numFmt = "yyyy-mm-dd hh:mm";
  pc.getColumn(7).numFmt = "yyyy-mm-dd hh:mm";
  pc.getColumn(11).numFmt = "0.0";

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
  a.download = opts.filename || `sentiment-grades-${csvTimestamp()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
