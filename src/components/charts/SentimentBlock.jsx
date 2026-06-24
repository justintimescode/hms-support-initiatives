import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Smile, Meh, Frown, ChevronRight, Download } from "lucide-react";
import { T, alpha } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { Pill } from "../Pill.jsx";
import { CopyableNumber } from "../CopyableNumber.jsx";
import { EmptyState } from "../EmptyState.jsx";
import { SentimentDeepRead } from "../ai/SentimentDeepRead.jsx";
import { summarizeSentiment } from "../../lib/sentiment.js";
import { exportSentimentWorkbook } from "../../lib/sentiment-export.js";

/* ================= Case Sentiment Grader =================
 * Reproduces the structured columns of the LLM "Customer Sentiment Review"
 * with a deterministic, in-browser engine (lib/sentiment.js) — no per-case
 * model calls. Reads the baked `sentiment_*` columns (via summarizeSentiment,
 * which prefers them and only re-grades rows that lack them). Pass the SAME
 * filtered rows the rest of a page uses.
 *
 * Honest framing: exact on coverage / responsiveness / hygiene, directional on
 * tone; the coaching note is templated (structural facts), not the model's prose.
 */

// Scoped affordances. Sortable headers are real <button>s (native keyboard +
// the app's global focus ring). Rows are keyboard-activatable, so they get an
// explicit outline on :focus-visible (box-shadow rings render unreliably on
// <tr>). Motion is disabled under prefers-reduced-motion.
const BLOCK_STYLE = `
  .sentiment-th, .sentiment-expand {
    appearance: none; background: none; border: none; margin: 0;
    font: inherit; letter-spacing: inherit; color: inherit; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px;
  }
  .sentiment-th { padding: 0; }
  .sentiment-th:hover { color: ${T.ink}; }
  .sentiment-expand { padding: 2px; border-radius: 5px; color: ${T.muted}; }
  .sentiment-expand:hover { color: ${T.accent}; }
  .sentiment-row { cursor: pointer; transition: background 0.14s ease; }
  .sentiment-row:hover { background: ${alpha(T.accent, 0.045)}; }
  .sentiment-chev { transition: transform 0.15s ease; }
  @media (prefers-reduced-motion: reduce) {
    .sentiment-row, .sentiment-chev { transition: none; }
  }
`;

const fmtH = (h) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`);
const fmtPct = (x) => `${Math.round((x || 0) * 100)}%`;
const valColor = (v) => (v == null ? T.muted : v > 0 ? T.ok : v < 0 ? T.danger : T.sub);
const sentColor = (s) => (s === "Positive" ? T.ok : s === "Negative" ? T.danger : T.sub);
const SentIcon = ({ s, size = 14 }) =>
  s === "Positive" ? <Smile size={size} /> : s === "Negative" ? <Frown size={size} /> : <Meh size={size} />;

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="eyebrow" style={{ color: T.muted, marginBottom: 6 }}>{label}</div>
      <div className="display mono" style={{ fontSize: 26, lineHeight: 1, color: color || T.ink }}>{value}</div>
      {sub && <div style={{ color: T.sub, fontSize: 11.5, marginTop: 6, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}

const COLS = [
  { key: "number", label: "Case", align: "left" },
  { key: "priority", label: "Priority", align: "left" },
  { key: "valence", label: "Valence", align: "right" },
  { key: "sentiment", label: "Sentiment", align: "left" },
  { key: "arc", label: "Arc", align: "left" },
  { key: "emotions", label: "Emotions", align: "left" },
  { key: "frustrationTarget", label: "Target", align: "left" },
];

export function SentimentBlock({ rows }) {
  const [sort, setSort] = useState({ key: "valence", dir: "asc" }); // most-negative first
  const [expanded, setExpanded] = useState(false);
  const [openCase, setOpenCase] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const { scoreable, summary } = useMemo(() => summarizeSentiment(rows || []), [rows]);

  const onExport = async () => {
    setDownloading(true);
    try {
      await exportSentimentWorkbook(rows);
    } finally {
      setDownloading(false);
    }
  };

  const dist = useMemo(
    () => [
      { name: "Negative", count: summary.neg, color: T.danger },
      { name: "Neutral", count: summary.neu, color: T.sub },
      { name: "Positive", count: summary.pos, color: T.ok },
    ],
    [summary]
  );

  const sorted = useMemo(() => {
    const arr = [...scoreable];
    arr.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return sort.dir === "asc" ? av - bv : bv - av;
      return sort.dir === "asc"
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : String(bv ?? "").localeCompare(String(av ?? ""));
    });
    return arr;
  }, [scoreable, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  // No cases in view (filters exclude everything, or no data on the page).
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No cases in view"
        message="No cases match the current filters. Adjust the filter bar above, or load a ServiceNow export to grade customer sentiment."
      />
    );
  }

  const ariaSort = (c) => (sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
  const th = (c) => (
    <th
      key={c.key}
      aria-sort={ariaSort(c)}
      style={{
        padding: "8px 12px", textAlign: c.align, fontWeight: 600, color: T.sub,
        borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap",
      }}
    >
      <button type="button" className="sentiment-th" onClick={() => toggleSort(c.key)}
        style={{ flexDirection: c.align === "right" ? "row-reverse" : "row" }}>
        {c.label}
        <span aria-hidden style={{ color: sort.key === c.key ? T.accent : "transparent" }}>
          {sort.dir === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );

  const visible = expanded ? sorted : sorted.slice(0, 12);

  const headline = (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        <div>
          <div className="eyebrow" style={{ color: T.accent }}>Customer sentiment · graded on device</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 560, lineHeight: 1.5 }}>
            Read from the customer-visible comment stream with a deterministic lexicon — no case is sent to a model.
            Sentiment is scored only where the customer actually wrote something.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="mono" style={{ fontSize: 12, color: T.sub }}>{summary.analyzed} cases</span>
          <button
            type="button"
            onClick={onExport}
            disabled={downloading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "7px 13px", background: T.surface, color: T.ink,
              border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12.5,
              fontWeight: 600, cursor: downloading ? "default" : "pointer",
              opacity: downloading ? 0.6 : 1, fontFamily: "Geist, DM Sans, sans-serif",
            }}
          >
            <Download size={14} /> {downloading ? "Preparing…" : "Download grades"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 22 }}>
        <Stat
          label="Avg valence"
          value={summary.avgValence >= 0 ? `+${summary.avgValence.toFixed(2)}` : summary.avgValence.toFixed(2)}
          color={valColor(summary.avgValence)}
          sub={summary.normalized100 != null ? `≈ ${summary.normalized100}/100 normalized` : null}
        />
        <Stat
          label="Scoreable"
          value={summary.scoreableCount}
          sub={`${fmtPct(summary.scoreableShare)} of cases · ${summary.silent} phone/silent`}
        />
        <Stat
          label="Recovery rate"
          value={summary.openedFrustrated ? `${summary.recovered}/${summary.openedFrustrated}` : "—"}
          color={T.ok}
          sub="frustrated openings that ended positive"
        />
        <Stat
          label="Still negative at close"
          value={summary.stillNegative}
          color={summary.stillNegative ? T.danger : T.sub}
          sub={summary.stillNegativeCases.slice(0, 4).join(", ") || "none"}
        />
        <Stat
          label="Median first reply"
          value={fmtH(summary.medianFrtH)}
          color={T.accent}
          sub={`${fmtPct(summary.within1hShare)} within 1 hour`}
        />
        <Stat
          label="Hygiene flags"
          value={summary.duplicatePosts + summary.piiExposure}
          color={summary.duplicatePosts + summary.piiExposure ? T.warn : T.sub}
          sub={`${summary.duplicatePosts} double-posts · ${summary.piiExposure} PII exposure`}
        />
      </div>
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{BLOCK_STYLE}</style>

      {headline}

      {summary.scoreableCount === 0 ? (
        <EmptyState
          title="No scoreable cases in view"
          message="Every case here was resolved by phone or left no written customer comment, so there is nothing to grade. Coverage is still summarized above."
        />
      ) : (
        <>
          {/* ---- Distribution ---- */}
          <Card>
            <div className="eyebrow" style={{ color: T.muted, marginBottom: 12 }}>Sentiment distribution · {summary.scoreableCount} scoreable cases</div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer>
                <BarChart data={dist} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={T.borderSoft} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: T.sub, fontSize: 12 }} axisLine={{ stroke: T.borderSoft }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: T.sub, fontSize: 12 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip
                    cursor={{ fill: alpha(T.accent, 0.06) }}
                    contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {dist.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ---- Per-case table ---- */}
          <Card>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <div className="eyebrow" style={{ color: T.muted }}>Per-case detail · activate a row for the quote &amp; coaching note</div>
              <div className="mono" style={{ fontSize: 12, color: T.sub }}>{sorted.length} scoreable</div>
            </div>
            <div style={{ overflowX: "auto" }} className="scrollbar">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }} aria-label="Per-case sentiment grades">
                <thead><tr style={{ background: T.surfaceAlt }}>{COLS.map(th)}</tr></thead>
                <tbody>
                  {visible.map((g) => (
                    <Row key={g.number} g={g} open={openCase === g.number} onToggle={() => setOpenCase((c) => (c === g.number ? null : g.number))} />
                  ))}
                </tbody>
              </table>
            </div>
            {sorted.length > 12 && (
              <button type="button" onClick={() => setExpanded((e) => !e)} style={{ marginTop: 10, background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 12, padding: "4px 2px" }}>
                {expanded ? "Show less" : `Show all ${sorted.length} cases`}
              </button>
            )}
          </Card>
        </>
      )}

      {/* ---- Optional, opt-in LLM deep-read (gated on aiClient.isConfigured) ---- */}
      <SentimentDeepRead scoreable={scoreable} rows={rows} />
    </div>
  );
}

function Row({ g, open, onToggle }) {
  // The row toggles on mouse click for convenience, but the keyboard/AT
  // affordance is a single real <button> (the chevron) — NOT a focusable <tr>.
  // That keeps one disclosure control per row and avoids nesting CopyableNumber
  // (itself a role=button) inside another button. stopPropagation so a chevron
  // click toggles exactly once and a number click only copies.
  const toggle = (e) => { e.stopPropagation(); onToggle(); };
  return (
    <>
      <tr
        className="sentiment-row"
        onClick={onToggle}
        style={{ borderBottom: `1px solid ${T.borderSoft}` }}
      >
        <td className="mono" style={{ padding: "8px 12px", color: T.accent, whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className="sentiment-expand"
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} case ${g.number} — ${g.sentiment}, valence ${g.valence}: quote and coaching note`}
              onClick={toggle}
            >
              <ChevronRight size={13} aria-hidden className="sentiment-chev" style={{ transform: open ? "rotate(90deg)" : "none" }} />
            </button>
            <span onClick={(e) => e.stopPropagation()}>
              <CopyableNumber value={g.number} />
            </span>
          </span>
        </td>
        <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{g.priority || "—"}</td>
        <td className="mono" style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: valColor(g.valence) }}>
          {g.valence > 0 ? `+${g.valence}` : g.valence}
        </td>
        <td style={{ padding: "8px 12px" }}>
          <Pill color={sentColor(g.sentiment)}><SentIcon s={g.sentiment} size={11} /> {g.sentiment}</Pill>
        </td>
        <td style={{ padding: "8px 12px", color: T.sub, whiteSpace: "nowrap" }}>{g.arc}</td>
        <td style={{ padding: "8px 12px", color: T.sub, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.emotions}</td>
        <td style={{ padding: "8px 12px", color: T.sub, whiteSpace: "nowrap" }}>{g.frustrationTarget || "—"}</td>
      </tr>
      {open && (
        <tr style={{ background: T.surfaceAlt }}>
          <td colSpan={COLS.length} style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: T.sub }}>
                <span className="eyebrow" style={{ color: T.muted, marginRight: 8 }}>Account</span>{g.account || "—"}
                <span className="mono" style={{ marginLeft: 14, color: T.muted }}>· {g.custMsgs} customer / {g.myMsgs} analyst msgs · start {g.start} → end {g.end ?? "—"}</span>
              </div>
              {g.quote && (
                <blockquote style={{ margin: 0, paddingLeft: 12, borderLeft: `3px solid ${alpha(sentColor(g.sentiment), 0.5)}`, color: T.ink, fontSize: 13, fontStyle: "italic", lineHeight: 1.5 }}>
                  “{g.quote}”
                </blockquote>
              )}
              <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>
                <span className="eyebrow" style={{ color: T.muted, marginRight: 8 }}>Coaching</span>{g.coachingNote}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
