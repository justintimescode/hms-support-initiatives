import { useMemo } from "react";
import { T } from "../../lib/theme.js";
import { percentile } from "../../lib/stats.js";
import { fmtDuration } from "../../lib/format.js";
import { rowOutcome, isTagged } from "../../lib/ai-tags.js";
import { OUTCOME_COLOR } from "../../lib/ai-tag-colors.js";
import { Card } from "../layout/Card.jsx";

/* ============== Did AI-assisted cases go better? (AI Assisted? tab) ==============
 * The block that has to be honest about what it can't know.
 *
 * Three cohorts — AI helped / AI attempted and missed / no AI tag — compared on
 * whatever derived measures the active export actually supports. Each measure
 * renders ONLY when at least two cohorts have MIN_N or more cases carrying that
 * field; otherwise it says which ServiceNow column is missing. A zero here would
 * read as "AI made no difference", which is a claim, not an absence of data.
 *
 * Why measures drop out: the derived fields come from journal columns that not
 * every ServiceNow report layout includes. Resolution time needs `Closed`;
 * interaction counts need `Work notes`; SOP-SLA compliance needs the
 * `Additional comments` journal and `First Response Time`. An export carrying a
 * single merged "Comments and Work notes" column has none of them, so on that
 * layout this block correctly shows only case age.
 *
 * AND THE BIGGER CAVEAT, stated in the card: analysts choose which cases to tag.
 * The untagged cohort is not a control group, so nothing here is causal. */
const MIN_N = 8;

const COHORTS = [
  {
    id: "helped",
    label: "AI helped",
    color: OUTCOME_COLOR.helpful,
    match: (r) => rowOutcome(r) === "helpful",
  },
  {
    id: "missed",
    label: "AI missed",
    color: OUTCOME_COLOR.unhelpful,
    match: (r) => ["unhelpful", "harmful"].includes(rowOutcome(r)),
  },
  {
    id: "untagged",
    label: "No AI tag",
    color: T.muted,
    match: (r) => !isTagged(r),
  },
];

const MEASURES = [
  {
    id: "age",
    label: "Case age",
    hint: "days since creation, open cases",
    needs: "case creation dates",
    value: (r) => (r._isOpen && r._created ? Math.floor((Date.now() - r._created.getTime()) / 864e5) : null),
    format: (v) => `${Math.round(v)}d`,
    lowerIsBetter: true,
  },
  {
    id: "resolution",
    label: "Time to close",
    hint: "creation to close, closed cases",
    needs: "a `Closed` timestamp column",
    value: (r) => (r._isClosed && r._resolvedMs != null ? r._resolvedMs : null),
    format: (v) => fmtDuration(v),
    lowerIsBetter: true,
  },
  {
    id: "interactions",
    label: "Interaction turns",
    hint: "analyst + customer journal turns",
    needs: "a `Work notes` journal column",
    value: (r) => (r._interactionCount ? r._interactionCount : null),
    format: (v) => v.toFixed(1),
    lowerIsBetter: true,
  },
];

export function AiEffectivenessBlock({ rows }) {
  // Memoized so the aggregations below keep a stable dependency across renders.
  const list = useMemo(() => rows || [], [rows]);

  const cohorts = useMemo(
    () => COHORTS.map((c) => ({ ...c, rows: list.filter(c.match) })),
    [list],
  );

  const measures = useMemo(
    () =>
      MEASURES.map((m) => {
        const stats = cohorts.map((c) => {
          const vals = c.rows.map(m.value).filter((v) => v != null).sort((a, b) => a - b);
          return { id: c.id, n: vals.length, p50: percentile(vals, 50), p90: percentile(vals, 90) };
        });
        return { ...m, stats, available: stats.filter((s) => s.n >= MIN_N).length >= 2 };
      }),
    [cohorts],
  );

  // SOP-SLA compliance is a rate, not a distribution, so it gets its own row shape.
  //
  // The extra gate matters: `_slaEligible` is derived from priority alone, so it is
  // true on EVERY case even in an export with no journal — and with no journal the
  // cadence check finds no analyst updates and breaches almost everything. That
  // yields a confident-looking "1% cadence met", which is worse than useless. So
  // require evidence the journal actually parsed: at least one case anywhere in the
  // view with a counted Infor update.
  const journalPresent = useMemo(() => list.some((r) => r._inforUpdateCount > 0), [list]);
  const sla = useMemo(() => {
    const stats = cohorts.map((c) => {
      const eligible = c.rows.filter((r) => r._slaEligible);
      const met = eligible.filter((r) => !r._slaBreached).length;
      return { id: c.id, n: eligible.length, pct: eligible.length ? (met / eligible.length) * 100 : null, met };
    });
    return {
      stats,
      available: journalPresent && stats.filter((s) => s.n >= MIN_N).length >= 2,
    };
  }, [cohorts, journalPresent]);

  const anyCohort = cohorts.some((c) => c.rows.length >= MIN_N);
  const available = measures.filter((m) => m.available);
  const nothing = !available.length && !sla.available;

  return (
    <Card>
      <div className="eyebrow">Did AI-assisted cases go better?</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
        Median (and 90th-percentile) outcomes for the three cohorts, on whatever measures this
        export supports. <strong>Correlation only.</strong> Analysts pick which cases to try AI on
        and which to tag, so the untagged cohort is not a control group — a difference here is a
        hypothesis worth a conversation, not evidence that AI caused it.
      </div>

      {!anyCohort ? (
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          No cohort in the current view has {MIN_N} or more cases, so there is nothing to compare.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, color: T.sub, flexWrap: "wrap" }}>
            {cohorts.map((c) => (
              <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 10, background: c.color, border: `1px solid ${T.border}`, borderRadius: T.radiusChart }} />
                {c.label}
                <span className="mono" style={{ color: T.muted }}>{c.rows.length.toLocaleString()}</span>
              </span>
            ))}
          </div>

          <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt }}>
                  <th className="eyebrow" style={th}>Measure</th>
                  {cohorts.map((c) => (
                    <th key={c.id} className="eyebrow" style={th}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 12, height: 12, background: c.color, border: `1px solid ${T.border}`, borderRadius: T.radiusChart }} />
                        {c.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MEASURES.map((m) => {
                  const row = measures.find((x) => x.id === m.id);
                  return (
                    <tr key={m.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 600, color: T.ink }}>{m.label}</div>
                        <div style={{ fontSize: 11, color: T.muted }}>{m.hint}</div>
                      </td>
                      {row.available ? (
                        row.stats.map((s) => (
                          <td key={s.id} style={td}>
                            {s.n < MIN_N ? (
                              <span style={{ color: T.muted }}>
                                — <span className="mono" style={{ fontSize: 11 }}>n={s.n}</span>
                              </span>
                            ) : (
                              <>
                                <span className="mono" style={{ fontWeight: 600, color: T.ink }}>{m.format(s.p50)}</span>
                                <span className="mono" style={{ fontSize: 11, color: T.muted }}>
                                  {" "}· p90 {m.format(s.p90)} · n={s.n}
                                </span>
                              </>
                            )}
                          </td>
                        ))
                      ) : (
                        <td colSpan={cohorts.length} style={{ ...td, color: T.sub, fontStyle: "italic" }}>
                          Not available in this export — needs {m.needs}.
                        </td>
                      )}
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 600, color: T.ink }}>SOP response cadence met</div>
                    <div style={{ fontSize: 11, color: T.muted }}>of SLA-eligible cases</div>
                  </td>
                  {sla.available ? (
                    sla.stats.map((s) => (
                      <td key={s.id} style={td}>
                        {s.n < MIN_N ? (
                          <span style={{ color: T.muted }}>
                            — <span className="mono" style={{ fontSize: 11 }}>n={s.n}</span>
                          </span>
                        ) : (
                          <>
                            <span className="mono" style={{ fontWeight: 600, color: T.ink }}>{s.pct.toFixed(0)}%</span>
                            <span className="mono" style={{ fontSize: 11, color: T.muted }}>
                              {" "}· {s.met}/{s.n}
                            </span>
                          </>
                        )}
                      </td>
                    ))
                  ) : (
                    <td colSpan={cohorts.length} style={{ ...td, color: T.sub, fontStyle: "italic" }}>
                      Not available in this export — needs the `Additional comments` journal and
                      `First Response Time`. Without them the cadence check sees no analyst updates
                      and breaches everything, so the rate would be near-zero for every cohort
                      regardless of AI.
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          {nothing && (
            <div style={{ color: T.sub, fontSize: 12, marginTop: 10 }}>
              This export layout carries none of the columns these measures are derived from. Case
              age is the only comparison available; import an export that includes{" "}
              <span className="mono">Work notes</span>, <span className="mono">Additional comments</span>,{" "}
              <span className="mono">Closed</span> and <span className="mono">First Response Time</span>{" "}
              to unlock the rest.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const th = {
  textAlign: "left",
  padding: "8px 12px",
  color: T.vizCat,
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: "nowrap",
};

const td = { padding: "10px 12px", verticalAlign: "top" };
