import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { T, alpha } from "../../lib/theme.js";
import { OUTCOME_CLASSES, aiTagSummary, unrecognizedTags } from "../../lib/ai-tags.js";
import { OUTCOME_COLOR, UNTAGGED_COLOR } from "../../lib/ai-tag-colors.js";
import { Card } from "../layout/Card.jsx";
import { Pill } from "../Pill.jsx";

/* ============== AI tagging headline (AI Assisted? tab) ==============
 * Three cards: the stat tiles, the outcome-mix share bar, and — only when it has
 * something to say — the unrecognized-tag strip.
 *
 * THE POINT OF THIS BLOCK IS THE DENOMINATORS. Three different populations are in
 * play and every number states which one it divides by:
 *
 *   total     — every case in the current view
 *   tagged    — cases carrying any tag           → tagging coverage (compliance)
 *   attempted — tagged minus "not applicable"    → the only honest denominator
 *                                                  for assist / miss rates
 *
 * Dividing assists by `total` understates them ~4x on real data; dividing by
 * `tagged` scores "I judged AI wasn't needed" as an AI failure. Both are wrong,
 * so all three are on screen at once. */
export function AiTagSummaryBlock({ rows, onSelect }) {
  const s = useMemo(() => aiTagSummary(rows || []), [rows]);
  const unknown = useMemo(() => unrecognizedTags(rows || []), [rows]);

  const pct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);
  const n = (v) => v.toLocaleString();

  // Two rows, one stack: the same segments measured against the two
  // denominators, so the shift between them is visible rather than asserted.
  const mix = useMemo(() => {
    const share = (v, d) => (d ? (v / d) * 100 : 0);
    return [
      {
        name: "Of all cases",
        denom: s.total,
        helpful: share(s.helped, s.total),
        unhelpful: share(s.unhelped, s.total),
        harmful: share(s.harmful, s.total),
        unclassified: share(s.unclassified, s.total),
        notApplicable: share(s.notApplicable, s.total),
        untagged: share(s.untagged, s.total),
        counts: {
          helpful: s.helped, unhelpful: s.unhelped, harmful: s.harmful,
          unclassified: s.unclassified, notApplicable: s.notApplicable, untagged: s.untagged,
        },
      },
      {
        name: "Of AI attempted",
        denom: s.attempted,
        helpful: share(s.helped, s.attempted),
        unhelpful: share(s.unhelped, s.attempted),
        harmful: share(s.harmful, s.attempted),
        unclassified: share(s.unclassified, s.attempted),
        notApplicable: 0,
        untagged: 0,
        counts: {
          helpful: s.helped, unhelpful: s.unhelped, harmful: s.harmful,
          unclassified: s.unclassified, notApplicable: 0, untagged: 0,
        },
      },
    ];
  }, [s]);

  const assistTone =
    s.assistRatePct == null ? T.sub : s.assistRatePct >= 70 ? T.ok : s.assistRatePct >= 50 ? T.warn : T.danger;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>AI tagging headline</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
          Every figure names its own denominator. Coverage is a <em>compliance</em> measure — how
          much of the book carries a tag at all. The rates below it describe only the cases where
          AI was actually attempted.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          <Stat
            label="Tagging coverage"
            value={pct(s.coveragePct)}
            sub={`${n(s.tagged)} of ${n(s.total)} cases in view carry a tag`}
            color={T.accent}
            onClick={onSelect ? () => onSelect("view:tagged") : undefined}
          />
          <Stat
            label="AI attempted"
            value={n(s.attempted)}
            sub={`of ${n(s.tagged)} tagged · excludes ${n(s.notApplicable)} marked not required`}
            color={T.ink}
            onClick={onSelect ? () => onSelect("view:attempted") : undefined}
          />
          <Stat
            label="Assist rate"
            value={pct(s.assistRatePct)}
            sub={`${n(s.helped)} of ${n(s.attempted)} attempted cases`}
            color={assistTone}
            onClick={onSelect ? () => onSelect("outcome:helpful") : undefined}
          />
          <Stat
            label="Didn't help"
            value={pct(s.missRatePct)}
            sub={`${n(s.unhelped)} of ${n(s.attempted)} attempted cases`}
            color={s.unhelped ? T.warn : T.sub}
            onClick={onSelect ? () => onSelect("outcome:unhelpful") : undefined}
          />
          {/* Hallucinations get a NAMED COUNT rather than living as a ~4% sliver in
              the bar below, where they'd be both unreadable and unclickable. */}
          <Stat
            label="Hallucinated"
            value={n(s.harmful)}
            sub={`${pct(s.hallucinationRatePct)} of ${n(s.attempted)} attempted cases`}
            color={s.harmful ? T.danger : T.sub}
            onClick={onSelect ? () => onSelect("outcome:harmful") : undefined}
          />
        </div>
        {s.multiTagged > 0 && (
          <div style={{ color: T.muted, fontSize: 11, marginTop: 10 }}>
            {s.multiTagged} case{s.multiTagged === 1 ? "" : "s"} carry more than one tag
            ({n(s.tagInstances)} tag uses across {n(s.tagged)} tagged cases). Counts above put each
            case in one bucket, worst signal first — a case tagged both “didn't help” and “not
            required” counts as a miss, because an attempt demonstrably happened.
          </div>
        )}
      </Card>

      <Card>
        <div className="eyebrow" style={{ color: T.muted }}>Outcome mix · both denominators</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
          The top bar is the whole book, so the untagged share is visible rather than hidden. The
          bottom bar rescales to the cases where AI was attempted — the same segments, honest
          denominator. One case, one segment.
        </div>
        <Legend counts={mix[0].counts} total={s.total} />
        <div style={{ height: 130, marginTop: 8 }}>
          <ResponsiveContainer>
            <BarChart data={mix} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barSize={26}>
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fill: T.muted, fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={110}
                tick={{ fill: T.ink, fontSize: 12 }}
                interval={0}
                axisLine={{ stroke: T.border }}
                tickLine={{ stroke: T.border }}
              />
              <Tooltip content={<MixTip />} cursor={{ fill: T.surfaceAlt }} />
              {/* 2px surface-colored gaps keep adjacent fills from reading as one
                  segment — the warn/danger pair especially. */}
              <Bar stackId="mix" dataKey="helpful" name="Helped" fill={OUTCOME_COLOR.helpful} stroke={T.surface} strokeWidth={2} />
              <Bar stackId="mix" dataKey="unhelpful" name="Didn't help" fill={OUTCOME_COLOR.unhelpful} stroke={T.surface} strokeWidth={2} />
              <Bar stackId="mix" dataKey="harmful" name="Hallucinated" fill={OUTCOME_COLOR.harmful} stroke={T.surface} strokeWidth={2} />
              <Bar stackId="mix" dataKey="unclassified" name="Other tag" fill={OUTCOME_COLOR.unclassified} stroke={T.surface} strokeWidth={2} />
              <Bar stackId="mix" dataKey="notApplicable" name="Not required" fill={OUTCOME_COLOR.notApplicable} stroke={T.surface} strokeWidth={2} />
              <Bar stackId="mix" dataKey="untagged" name="Untagged" fill={UNTAGGED_COLOR} stroke={T.surface} strokeWidth={2} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {unknown.length > 0 && (
        <Card>
          <div className="eyebrow" style={{ color: T.warn }}>Unrecognized tags</div>
          <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
            These tags are counted everywhere on this tab but not classified as a helped / didn't
            help / not-required outcome, so they sit in “Other tag”. Add them to the lexicon in{" "}
            <span className="mono">src/lib/ai-tags.js</span> to fold them into the rates.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {unknown.map((t) => (
              <span key={t.tag} title={t.tag} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Pill color={T.warn}>{t.tag}</Pill>
                <span className="mono" style={{ fontSize: 11, color: T.sub }}>{t.count}</span>
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color, onClick }) {
  const interactive = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${label}: ${value}. Show these cases` : undefined}
      className={interactive ? "hoverlift" : undefined}
      style={{
        border: `1px solid ${T.borderSoft}`,
        borderRadius: T.radiusSm,
        padding: "10px 12px",
        background: T.surfaceAlt,
        cursor: interactive ? "pointer" : "default",
      }}
    >
      <div className="eyebrow" style={{ color: T.muted }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: T.sub, marginTop: 4, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

const LEGEND_ORDER = [
  ...OUTCOME_CLASSES.map((o) => ({ id: o.id, label: o.label, color: OUTCOME_COLOR[o.id] })),
  { id: "untagged", label: "Untagged", color: UNTAGGED_COLOR },
];

function Legend({ counts }) {
  return (
    <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
      {LEGEND_ORDER.filter((l) => counts[l.id] > 0).map((l) => (
        <span key={l.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 10, background: l.color, border: `1px solid ${alpha(T.ink, 0.12)}`, borderRadius: 2 }} />
          {l.label}
          <span className="mono" style={{ color: T.muted }}>{counts[l.id].toLocaleString()}</span>
        </span>
      ))}
    </div>
  );
}

function MixTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>{d.name}</div>
      <div className="mono" style={{ color: T.muted, marginBottom: 4 }}>
        denominator: {d.denom.toLocaleString()} case{d.denom === 1 ? "" : "s"}
      </div>
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.dataKey} className="mono" style={{ color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, background: p.color, borderRadius: 2 }} />
            {p.name}: {d.counts[p.dataKey].toLocaleString()} ({p.value.toFixed(1)}%)
          </div>
        ))}
    </div>
  );
}
