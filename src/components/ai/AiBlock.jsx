import { Loader2, AlertTriangle, Sparkles, TrendingUp, Activity, Info } from "lucide-react";
import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";

/* ================= AI ================= */
export function AiBlock({ state, run, hasData }) {
  if (state.loading) {
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 0" }}>
          <Loader2 size={20} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
          <div>
            <div style={{ fontWeight: 600 }}>Reading resolution notes…</div>
            <div style={{ color: T.sub, fontSize: 13, marginTop: 2 }}>Sampling cases, detecting themes, surfacing gaps.</div>
          </div>
        </div>
      </Card>
    );
  }
  if (state.error) {
    return (
      <Card>
        <div style={{ color: T.danger, fontSize: 13 }}>
          <AlertTriangle size={14} style={{ verticalAlign: "middle" }} /> {state.error}
        </div>
        <button onClick={run} style={btnPrimary}>Try again</button>
      </Card>
    );
  }
  if (!state.result) {
    return (
      <Card>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div className="display" style={{ fontSize: 20, fontWeight: 500 }}>
              Let Claude read the notes.
            </div>
            <div style={{ color: T.sub, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Send a sampled, anonymized slice of your cases to Claude Sonnet for a qualitative read — themes,
              recurring issues, KB gaps, and skill areas that would sharpen your queue.
            </div>
          </div>
          <button disabled style={{ ...btnPrimary, opacity: 0.5, cursor: "not-allowed" }}>
            <Sparkles size={14} /> Generate insights
          </button>
        </div>
        <div style={{ marginTop: 12, padding: "10px 14px", border: `1px dashed ${T.warn}`, borderRadius: 4, background: T.warnSoft + "55", color: T.sub, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} style={{ color: T.warn, flex: "0 0 auto" }} />
          <span><strong style={{ color: T.ink }}>This feature is not yet enabled.</strong> AI insights will turn on once the Claude API integration is wired up in this environment.</span>
        </div>
      </Card>
    );
  }
  const r = state.result;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <AiList title="Themes" icon={<TrendingUp size={13} />} items={r.themes?.map((t) => ({ h: t.title, b: t.description }))} />
      <AiList title="Recurring issues" icon={<Activity size={13} />} items={r.recurring_issues?.map((t) => ({ h: t.issue, b: t.evidence }))} />
      <AiList title="Skill opportunities" icon={<Sparkles size={13} />} items={r.skill_opportunities?.map((t) => ({ h: t.area, b: t.why }))} />
      <AiList title="Knowledge base gaps" icon={<Info size={13} />} items={r.kb_gaps?.map((t) => ({ h: t.gap, b: t.why }))} />
      {r.watch_outs?.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Card>
            <div className="eyebrow" style={{ color: T.muted, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={13} /> Watch-outs
            </div>
            <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              {r.watch_outs.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function AiList({ title, icon, items }) {
  return (
    <Card>
      <div className="eyebrow" style={{ color: T.muted, display: "flex", alignItems: "center", gap: 6 }}>
        {icon} {title}
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {(items || []).map((it, i) => (
          <div key={i} style={{ paddingBottom: 12, borderBottom: i < items.length - 1 ? `1px solid ${T.borderSoft}` : "none" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{it.h}</div>
            <div style={{ color: T.sub, fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{it.b}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const btnPrimary = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "10px 18px",
  background: T.ink,
  color: T.surface,
  border: "none",
  borderRadius: 6,
  fontFamily: "DM Sans, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  marginTop: 8,
};
