import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Users } from "lucide-react";
import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { Pill } from "../Pill.jsx";
import { CaseRecordList, JiraRecordList } from "./ClusterRecordList.jsx";
import { AliasNote } from "../AliasNote.jsx";
import {
  BAND_HIGH, BAND_MEDIUM,
  ESC_ESCALATED, ESC_AT_RISK, ESC_WATCH,
  FLAG_STALE_JIRA_MULTI_CASE, FLAG_URGENCY_SENTIMENT_ESCALATION,
} from "../../lib/insight-thresholds.js";

/* One correlated Jira+ServiceNow ecosystem, ranked by real customer impact.
 *
 * Everything rendered here is finished data from insight-rank.js — this file
 * computes no metric. The score is never shown alone: its named contributions
 * ride alongside as chips, so "why is this #1" is answerable on sight rather
 * than by trusting a number. */

const JIRA_BROWSE_URL = "https://infor.atlassian.net/browse/";

const BAND_COLOR = { [BAND_HIGH]: T.danger, [BAND_MEDIUM]: T.warn };
const bandColor = (band) => BAND_COLOR[band] || T.muted;

/* Escalation in TEXT positions (pill label, "Why" eyebrow). Purple carries the
 * base stop, Infor Yellow the middle and Infor Red the terminal one, so "watch"
 * and "escalated" are no longer the same red. */
const ESC_COLOR = {
  [ESC_ESCALATED]: T.danger,
  [ESC_AT_RISK]: T.warn,
  [ESC_WATCH]: T.ok,
};
const escColor = (level) => ESC_COLOR[level] || T.muted;

const FLAG_LABEL = {
  [FLAG_STALE_JIRA_MULTI_CASE]: "Stale Jira, multiple open cases",
  [FLAG_URGENCY_SENTIMENT_ESCALATION]: "Urgent + negative + escalated",
};

function Stat({ label, value, hint, tone }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 600, marginTop: 2, color: tone || T.ink }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

export function ClusterCard({ cluster, matchedCaseNumbers, filterActive }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("cases");

  const c = cluster;
  const m = c.metrics;
  const band = bandColor(c.band);
  const matched = matchedCaseNumbers || [];
  const partial = filterActive && matched.length > 0 && matched.length < c.cases.length;

  return (
    <Card style={{ padding: 0, overflow: "hidden", borderLeft: `3px solid ${band}` }}>
      {/* -------- header: what it is, and how hard it hits -------- */}
      <div style={{ padding: "14px 18px", display: "flex", gap: 16, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 420px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {c.jira.map((j) => (
              <span key={j.key} className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                {j.isAtlassian ? (
                  <a href={JIRA_BROWSE_URL + j.key} target="_blank" rel="noopener noreferrer" style={{ color: T.jiraBlue, textDecoration: "none" }}>
                    {j.key}
                  </a>
                ) : (
                  <span style={{ color: T.jiraBlue }} title="ServiceNow Resolution Notes reference — a real engineering link, but not an Atlassian ticket">
                    {j.key}
                  </span>
                )}
                <AliasNote keys={j.aliasedFrom} />
              </span>
            ))}
            <Pill color={band}>{c.band}</Pill>
            {m.escalation.level !== "none" && (
              <Pill color={escColor(m.escalation.level)}>{m.escalation.level}</Pill>
            )}
          </div>

          {/* Deterministic narrative, composed from the structural facts. */}
          <div style={{ fontSize: 13, color: T.ink, marginTop: 8, lineHeight: 1.5, maxWidth: 760 }}>
            {c.summary}
          </div>

          {c.clusterFlags.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {c.clusterFlags.map((f) => (
                <span key={f} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: T.onAccentSoft, background: T.accentTint, border: `1px solid ${T.accentSoft}`, borderRadius: T.radiusSm, padding: "3px 8px" }}>
                  <AlertTriangle size={14} strokeWidth={2.25} />
                  {FLAG_LABEL[f] || f}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div className="eyebrow">Impact</div>
          <div className="display" style={{ fontSize: 34, fontWeight: 500, color: band, lineHeight: 1 }}>{c.score}</div>
          <div style={{ fontSize: 10, color: T.muted }}>of 100</div>
        </div>
      </div>

      {/* -------- the score, spelled out -------- */}
      <div style={{ padding: "0 18px 14px", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {c.factors.map((f) => (
          <span
            key={f.label}
            title={f.detail}
            style={{ display: "inline-flex", alignItems: "baseline", gap: 5, fontSize: 11, color: T.sub, background: T.surfaceAlt, border: `1px solid ${T.borderSoft}`, borderRadius: T.radiusSm, padding: "3px 8px" }}
          >
            {f.label}
            <span className="mono" style={{ fontWeight: 700, color: T.ink }}>+{f.weight}</span>
          </span>
        ))}
      </div>

      {/* -------- the numbers behind it -------- */}
      <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.borderSoft}`, background: T.surfaceAlt, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))", gap: 14 }}>
        <Stat
          label="Open cases"
          value={m.volume.openCases}
          hint={`of ${m.volume.totalCases} linked`}
          tone={m.volume.openCases > 0 ? T.ink : T.muted}
        />
        <Stat label="Accounts" value={m.volume.distinctAccounts} hint="affected" />
        <Stat
          label="Oldest case"
          value={m.caseAgeDays.max == null ? "—" : `${m.caseAgeDays.max}d`}
          hint={m.caseAgeDays.oldestNumber || ""}
        />
        <Stat
          label="Oldest Jira"
          value={m.jiraAgeDays.max == null ? "—" : `${m.jiraAgeDays.max}d`}
          hint={m.jiraAgeDays.oldestKey || ""}
        />
        <Stat
          label="Age delta"
          value={m.ageDelta == null ? "—" : `${m.ageDelta > 0 ? "+" : ""}${m.ageDelta}d`}
          hint={m.ageDelta == null ? "unknown" : m.ageDelta > 0 ? "case waited longer" : "Jira is older"}
          tone={m.ageDelta != null && m.ageDelta > 0 ? T.warn : T.ink}
        />
        <Stat
          label="Urgency"
          value={m.priorityNorm == null ? "—" : m.priorityNorm}
          hint={m.priorityNorm == null ? "not known" : "of 100"}
          tone={m.priorityNorm == null ? T.muted : T.ink}
        />
        <Stat
          label="Worst risk"
          value={m.sentiment.worstRisk == null ? "—" : m.sentiment.worstRisk}
          hint={m.sentiment.worstRisk == null ? "not scored" : `${m.sentiment.negativeCount} negative`}
          tone={m.sentiment.worstRisk == null ? T.muted : T.ink}
        />
      </div>

      {/* -------- worst customer quote, when there is one -------- */}
      {m.sentiment.worstQuote && (
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${T.borderSoft}`, fontSize: 12, color: T.sub, fontStyle: "italic" }}>
          “{m.sentiment.worstQuote}”
          {m.sentiment.worstNumber && (
            <span className="mono" style={{ fontStyle: "normal", color: T.muted, marginLeft: 8 }}>{m.sentiment.worstNumber}</span>
          )}
        </div>
      )}

      {/* -------- escalation reasons -------- */}
      {m.escalation.reasons.length > 0 && (
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${T.borderSoft}`, fontSize: 12, color: T.sub }}>
          <span className="eyebrow" style={{ color: escColor(m.escalation.level), marginRight: 8 }}>Why</span>
          {m.escalation.reasons.join(" · ")}
        </div>
      )}

      {/* -------- mentions, tagged and never counted as blockers -------- */}
      {c.mentionedOnlyKeys.length > 0 && (
        <div style={{ padding: "8px 18px", borderTop: `1px solid ${T.borderSoft}`, fontSize: 11, color: T.muted }}>
          Also name-dropped in prose (not counted as blocking):{" "}
          <span className="mono">{c.mentionedOnlyKeys.join(", ")}</span>
        </div>
      )}

      {/* -------- drill-down -------- */}
      <div style={{ padding: "10px 18px 14px", borderTop: `1px solid ${T.borderSoft}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: T.accentDeep, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "2px 0" }}
          >
            {open ? <ChevronDown size={14} strokeWidth={2.25} /> : <ChevronRight size={14} strokeWidth={2.25} />}
            {open ? "Hide records" : `Show ${c.cases.length} case${c.cases.length === 1 ? "" : "s"} and ${c.jira.length} ticket${c.jira.length === 1 ? "" : "s"}`}
          </button>
          {partial && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: T.sub }}>
              <Users size={14} strokeWidth={2.25} />
              {matched.length} of {c.cases.length} cases match your filter — the numbers above describe the whole cluster
            </span>
          )}
        </div>

        {open && (
          <>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {[
                { k: "cases", label: `Cases (${c.cases.length})` },
                { k: "jira", label: `Jira (${c.jira.length})` },
              ].map((t) => (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setTab(t.k)}
                  aria-pressed={tab === t.k}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: T.radiusSm, cursor: "pointer",
                    border: `1px solid ${tab === t.k ? T.accent : T.border}`,
                    background: tab === t.k ? T.accentTint : T.surface,
                    color: tab === t.k ? T.onAccentSoft : T.sub,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "cases"
              ? <CaseRecordList title="Cases in this cluster" cases={c.cases} highlight={matched} />
              : <JiraRecordList title="Tickets in this cluster" jira={c.jira} />}
          </>
        )}
      </div>
    </Card>
  );
}
