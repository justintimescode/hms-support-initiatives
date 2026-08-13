import { useMemo, useState } from "react";
import {
  BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { T, alpha } from "../../lib/theme.js";
import { OUTCOME_LABEL, aiTagSummary, tagCatalog, outcomeByPriority, rowsWithTag } from "../../lib/ai-tags.js";
import { OUTCOME_COLOR, UNTAGGED_COLOR } from "../../lib/ai-tag-colors.js";
import { Card } from "../layout/Card.jsx";
import { CaseDrilldown } from "../CaseDrilldown.jsx";

/* ============== Tag distribution + priority cross-cut (AI Assisted? tab) ==============
 * Left: which tags analysts actually apply. Right: whether tagging (and AI use)
 * reaches the higher-priority work or clusters in routine cases.
 *
 * Both charts are HORIZONTAL: the tag names are long sentences ("Kiro Not Required
 * / Not Applicable"), which would rotate or clip as column labels. Bars are
 * colored by OUTCOME rather than by tool family — the outcome is what a manager
 * acts on, and it keeps the page to one color language. Every bar carries a direct
 * count label, which is also what makes the muted "not required" fill legible. */
export function AiTagDistributionBlock({ rows }) {
  // Memoized so the aggregations below keep a stable dependency across renders.
  const list = useMemo(() => rows || [], [rows]);
  const catalog = useMemo(() => tagCatalog(list), [list]);
  const summary = useMemo(() => aiTagSummary(list), [list]);
  const priorities = useMemo(() => outcomeByPriority(list), [list]);
  const [selectedTag, setSelectedTag] = useState(null);

  const drilldownRows = useMemo(
    () => (selectedTag ? rowsWithTag(list, selectedTag) : []),
    [list, selectedTag],
  );

  // A single priority holding nearly all the tagged cases means the cross-cut
  // can't support a comparison — say so rather than letting the chart imply one.
  const concentration = useMemo(() => {
    if (!summary.tagged) return null;
    const top = [...priorities].sort((a, b) => b.tagged - a.tagged)[0];
    if (!top || top.tagged / summary.tagged < 0.8) return null;
    return top.priority;
  }, [priorities, summary.tagged]);

  if (!summary.tagged) {
    return (
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Tag distribution</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No cases in the current view carry an AI tag, so there is no distribution to show.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <div className="eyebrow" style={{ color: T.muted }}>Which tags analysts apply</div>
          <div className="mono" style={{ fontSize: 12, color: T.sub }}>
            {summary.tagged.toLocaleString()} tagged
          </div>
        </div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          Share of the {summary.tagged.toLocaleString()} tagged cases in view
          {summary.multiTagged > 0 && ` (${summary.tagInstances.toLocaleString()} tag uses — ${summary.multiTagged} case${summary.multiTagged === 1 ? " carries" : "s carry"} two)`}
          . Colored by outcome; click a bar for its cases.
        </div>
        <OutcomeKey ids={[...new Set(catalog.map((t) => t.outcome))]} />
        <div style={{ height: Math.max(200, catalog.length * 34 + 40), marginTop: 8 }}>
          <ResponsiveContainer>
            <BarChart data={catalog} layout="vertical" margin={{ top: 4, right: 64, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="tag"
                width={225}
                interval={0}
                tick={{ fill: T.ink, fontSize: 11 }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
              />
              <Tooltip content={<TagTip />} cursor={{ fill: T.surfaceAlt }} />
              <Bar
                dataKey="count"
                radius={[0, 3, 3, 0]}
                cursor="pointer"
                onClick={(d) => setSelectedTag((prev) => (prev === d.tag ? null : d.tag))}
              >
                {catalog.map((t) => (
                  <Cell key={t.tag} fill={OUTCOME_COLOR[t.outcome]} />
                ))}
                <LabelList
                  dataKey="count"
                  position="right"
                  style={{ fill: T.sub, fontSize: 11, fontFamily: "JetBrains Mono" }}
                  formatter={(v) => `${v} · ${((v / summary.tagged) * 100).toFixed(0)}%`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {selectedTag && (
          <CaseDrilldown
            title={selectedTag}
            rows={drilldownRows}
            onClose={() => setSelectedTag(null)}
          />
        )}
      </Card>

      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Tagging reach by priority</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          Is AI use being recorded on the harder work, or only on routine cases? Bars are all cases
          at that priority, split tagged vs untagged; the label is the tagged share.
        </div>
        <div style={{ height: Math.max(200, priorities.length * 40 + 40), marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={priorities} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={T.borderSoft} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="priority"
                width={140}
                interval={0}
                tick={{ fill: T.ink, fontSize: 11 }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
              />
              <Tooltip content={<PriorityTip />} cursor={{ fill: T.surfaceAlt }} />
              <Bar stackId="p" dataKey="tagged" name="tagged" fill={T.accent} stroke={T.surface} strokeWidth={1} />
              <Bar stackId="p" dataKey="untagged" name="untagged" fill={UNTAGGED_COLOR} stroke={T.surface} strokeWidth={1} radius={[0, 3, 3, 0]}>
                <LabelList
                  dataKey="coveragePct"
                  position="right"
                  style={{ fill: T.sub, fontSize: 11, fontFamily: "JetBrains Mono" }}
                  formatter={(v) => (v == null ? "—" : `${v.toFixed(0)}%`)}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {concentration && (
          <div style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>
            Tagging is concentrated in {concentration} — the other priorities hold too few tagged
            cases in this view to compare outcomes across them.
          </div>
        )}
      </Card>
    </div>
  );
}

function OutcomeKey({ ids }) {
  return (
    <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
      {ids.map((id) => (
        <span key={id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 10, background: OUTCOME_COLOR[id], border: `1px solid ${alpha(T.ink, 0.12)}`, borderRadius: 2 }} />
          {OUTCOME_LABEL[id]}
        </span>
      ))}
    </div>
  );
}

function TagTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12, maxWidth: 300 }}>
      <div style={{ fontWeight: 600 }}>{d.tag}</div>
      <div className="mono" style={{ color: T.sub }}>
        {d.count} case{d.count === 1 ? "" : "s"}
      </div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>
        {d.pctOfTagged == null ? "—" : `${d.pctOfTagged.toFixed(1)}% of tagged`} ·{" "}
        {d.pctOfAll == null ? "—" : `${d.pctOfAll.toFixed(1)}% of all cases`}
      </div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>
        {d.familyLabel} · {OUTCOME_LABEL[d.outcome]}
      </div>
    </div>
  );
}

function PriorityTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.priority}</div>
      <div className="mono" style={{ color: T.sub }}>
        {d.tagged} of {d.total} tagged{d.coveragePct == null ? "" : ` · ${d.coveragePct.toFixed(0)}%`}
      </div>
      <div className="mono" style={{ color: T.muted, marginTop: 4 }}>
        {d.attempted} AI attempted · {d.helpful} helped · {d.unhelpful} didn't · {d.harmful} hallucinated
      </div>
    </div>
  );
}
