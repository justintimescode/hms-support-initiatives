import { Search, X, Info } from "lucide-react";
import { T, alpha } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { BANDS } from "../../lib/insight-filters.js";
import { ESCALATION_LEVELS, FLAG_STALE_JIRA_MULTI_CASE, FLAG_URGENCY_SENTIMENT_ESCALATION } from "../../lib/insight-thresholds.js";

/* View-local filters for the Operations view.
 *
 * Two things worth knowing:
 *
 *   These filters select whole CLUSTERS and never re-run correlation. A cluster
 *   survives when at least one of its members matches, and its metrics still
 *   describe the whole cluster — a Jira blocking five cases blocks five cases
 *   regardless of who is looking. Each card says "N of M match your filter" when
 *   the two differ.
 *
 *   Selections live in the URL as OPAQUE INDEX TOKENS (?od=account:3), never as
 *   names — same treatment `useFilters` gives the analyst selector, so a shared
 *   link carries no customer or personal data. Analyst and Manager are absent
 *   here on purpose: the global filter bar above already owns them.
 *
 * A dimension whose column this export lacks renders as an explicit
 * "not available" note rather than an empty chip row that reads as "no values". */

const FLAG_LABEL = {
  [FLAG_STALE_JIRA_MULTI_CASE]: "Stale Jira + multiple open",
  [FLAG_URGENCY_SENTIMENT_ESCALATION]: "Urgent + negative + escalated",
};

const chipStyle = (on, tone) => ({
  fontSize: 11.5,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
  cursor: "pointer",
  whiteSpace: "nowrap",
  border: `1px solid ${on ? tone : T.border}`,
  background: on ? alpha(tone, 0.1) : T.surface,
  color: on ? tone : T.sub,
});

function Group({ label, children, note }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="eyebrow" style={{ color: T.muted, fontSize: 9, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
      {note && <div style={{ fontSize: 10.5, color: T.muted, marginTop: 5, fontStyle: "italic" }}>{note}</div>}
    </div>
  );
}

export function OperationsFilterBar({
  dimensions, unavailable, facetsFor, selected,
  bands, escalation, flags, search,
  onToggleDimension, onToggleBand, onToggleEscalation, onToggleFlag, onSearch, onClear,
  activeCount,
}) {
  return (
    <Card style={{ background: T.surfaceSunk }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Group label="Impact band">
            {BANDS.map((b) => (
              <button key={b} type="button" onClick={() => onToggleBand(b)} aria-pressed={bands.includes(b)}
                style={chipStyle(bands.includes(b), b === "high" ? T.danger : b === "medium" ? T.warn : T.muted)}>
                {b}
              </button>
            ))}
          </Group>

          <Group label="Escalation">
            {[...ESCALATION_LEVELS].reverse().map((l) => (
              <button key={l} type="button" onClick={() => onToggleEscalation(l)} aria-pressed={escalation.includes(l)}
                style={chipStyle(escalation.includes(l), l === "escalated" ? T.danger : l === "at-risk" ? T.warn : l === "watch" ? T.accent : T.muted)}>
                {l}
              </button>
            ))}
          </Group>

          <Group label="Risk shape">
            {[FLAG_STALE_JIRA_MULTI_CASE, FLAG_URGENCY_SENTIMENT_ESCALATION].map((f) => (
              <button key={f} type="button" onClick={() => onToggleFlag(f)} aria-pressed={flags.includes(f)}
                style={chipStyle(flags.includes(f), T.danger)}>
                {FLAG_LABEL[f]}
              </button>
            ))}
          </Group>

          <Group label="Search">
            <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, padding: "3px 8px" }}>
              <Search size={13} style={{ color: T.muted }} />
              <input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="case, account, Jira key…"
                aria-label="Search clusters"
                style={{ border: "none", outline: "none", background: "transparent", color: T.ink, fontSize: 12, width: 180 }}
              />
              {search && (
                <button type="button" onClick={() => onSearch("")} aria-label="Clear search"
                  style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, padding: 0, display: "flex" }}>
                  <X size={12} />
                </button>
              )}
            </div>
          </Group>
        </div>

        {/* --- dimension facets, one group per available dimension --- */}
        {dimensions.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16, borderTop: `1px solid ${T.borderSoft}`, paddingTop: 14 }}>
            {dimensions.map((d) => {
              const facets = facetsFor(d);
              const chosen = selected[d.id] || [];
              return (
                <Group key={d.id} label={d.label}>
                  {facets.slice(0, 8).map((f) => (
                    <button key={f.value} type="button" onClick={() => onToggleDimension(d.id, f.value)} aria-pressed={chosen.includes(f.value)}
                      title={`${f.clusters} cluster${f.clusters === 1 ? "" : "s"} · ${f.cases} case${f.cases === 1 ? "" : "s"} (${f.openCases} open)`}
                      style={chipStyle(chosen.includes(f.value), T.accent)}>
                      <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", display: "inline-block", verticalAlign: "bottom" }}>
                        {f.value}
                      </span>
                      <span className="mono" style={{ marginLeft: 5, opacity: 0.7 }}>{f.clusters}</span>
                    </button>
                  ))}
                  {facets.length > 8 && (
                    <span style={{ fontSize: 10.5, color: T.muted }}>
                      +{facets.length - 8} more (narrow with search)
                    </span>
                  )}
                </Group>
              );
            })}
          </div>
        )}

        {/* --- honest absence: what this export cannot support --- */}
        {unavailable.length > 0 && (
          <div style={{ borderTop: `1px solid ${T.borderSoft}`, paddingTop: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Info size={13} style={{ color: T.muted, flex: "0 0 auto", marginTop: 2 }} />
            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
              <strong style={{ color: T.sub, fontWeight: 600 }}>Not available in this export:</strong>{" "}
              {unavailable.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && " · "}
                  <span style={{ color: T.sub }}>{d.label}</span> — needs {d.needs}
                </span>
              ))}
            </div>
          </div>
        )}

        {activeCount > 0 && (
          <div style={{ borderTop: `1px solid ${T.borderSoft}`, paddingTop: 10 }}>
            <button type="button" onClick={onClear}
              style={{ fontSize: 11.5, fontWeight: 600, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Clear {activeCount} view filter{activeCount === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
