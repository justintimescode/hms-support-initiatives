import { Loader2, AlertTriangle, Sparkles, TrendingUp, Activity, Info } from "lucide-react";
import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { aiClient } from "../../lib/ai-client.js";

/* ================= AI ================= */
export function AiBlock({ state, run, hasData }) {
  // SECURITY #1: the AI feature is enabled only when a first-party proxy is
  // configured (VITE_AI_PROXY_URL). With none set, we show a calm "not
  // configured" notice rather than a disabled-with-no-reason button or, worse,
  // a red error. The browser never reaches a model vendor directly.
  const configured = aiClient.isConfigured();

  // Surfaced when a call resolved to AiNotConfiguredError (defensive — the
  // button is also disabled when unconfigured, so this is rarely hit).
  if (state.notConfigured) {
    return <AiNotConfiguredCard />;
  }
  if (state.loading) {
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 0" }}>
          <Loader2 size={18} strokeWidth={1.9} style={{ color: T.accentDeep, animation: "spin 1s linear infinite" }} />
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
          <AlertTriangle size={14} strokeWidth={2.25} style={{ verticalAlign: "middle" }} /> {state.error}
        </div>
        <button onClick={run} style={btnPrimary}>Try again</button>
      </Card>
    );
  }
  if (!state.result) {
    if (!configured) return <AiNotConfiguredCard />;
    const canRun = hasData;
    return (
      <Card>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: "var(--fs-subhead)", fontWeight: 600 }}>
              Let Claude read the notes.
            </div>
            <div style={{ color: T.sub, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Send a sampled, anonymized slice of your cases to Claude for a qualitative read — themes,
              recurring issues, KB gaps, and skill areas that would sharpen your queue.
            </div>
          </div>
          <button
            onClick={run}
            disabled={!canRun}
            style={{ ...btnPrimary, ...(canRun ? {} : { opacity: 0.5, cursor: "not-allowed" }) }}
          >
            <Sparkles size={14} strokeWidth={2.25} /> Generate insights
          </button>
        </div>
        {!canRun && (
          <div style={{ marginTop: 12, color: T.muted, fontSize: 12 }}>
            Load a dataset to enable analysis.
          </div>
        )}
      </Card>
    );
  }
  const r = state.result;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <AiList title="Themes" icon={<TrendingUp size={14} strokeWidth={2.25} />} items={r.themes?.map((t) => ({ h: t.title, b: t.description }))} />
      <AiList title="Recurring issues" icon={<Activity size={14} strokeWidth={2.25} />} items={r.recurring_issues?.map((t) => ({ h: t.issue, b: t.evidence }))} />
      <AiList title="Skill opportunities" icon={<Sparkles size={14} strokeWidth={2.25} />} items={r.skill_opportunities?.map((t) => ({ h: t.area, b: t.why }))} />
      <AiList title="Knowledge base gaps" icon={<Info size={14} strokeWidth={2.25} />} items={r.kb_gaps?.map((t) => ({ h: t.gap, b: t.why }))} />
      {r.watch_outs?.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Card>
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} strokeWidth={2.25} /> Watch-outs
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

function AiNotConfiguredCard() {
  return (
    <Card>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Info size={18} strokeWidth={1.9} style={{ color: T.accentDeep, flex: "0 0 auto", marginTop: 2 }} />
        <div>
          <div style={{ fontSize: "var(--fs-subhead)", fontWeight: 600 }}>
            AI insights are not configured
          </div>
          <div style={{ color: T.sub, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            This feature routes case data through a first-party AI proxy that hasn't been set up in this
            environment yet. Once an operator configures <span className="mono">VITE_AI_PROXY_URL</span> to
            point at the backend service, analysis turns on automatically. Case data is never sent to a model
            vendor directly from your browser.
          </div>
        </div>
      </div>
    </Card>
  );
}

function AiList({ title, icon, items }) {
  return (
    <Card>
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
  borderRadius: T.radiusSm,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  marginTop: 8,
};
