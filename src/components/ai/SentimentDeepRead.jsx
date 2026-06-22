import { useState } from "react";
import { Info, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { T, alpha } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";
import { aiClient } from "../../lib/ai-client.js";
import { scrubForAi } from "../../lib/ai-scrub.js";
import { parseInteractionStream } from "../../lib/sentiment.js";

/* Optional, OPT-IN LLM deep-read — the hybrid's second half. The lexicon engine
 * grades the whole queue on device; this sends ONLY a hand-picked handful (the
 * negatives) through the existing aiClient proxy seam, scrubbed by scrubForAi.
 * Strictly gated on aiClient.isConfigured(); never fans out across the queue and
 * never calls a vendor directly (SECURITY #1). */

const MAX_DEEP_READ = 10; // a handful, never the whole queue

const btnPrimary = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 16px",
  background: T.accent,
  color: T.onAccent,
  border: `1px solid ${T.accentDeep}`,
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "Geist, DM Sans, sans-serif",
};

function NotConfiguredCard() {
  return (
    <Card>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Info size={18} style={{ color: T.accent, flex: "0 0 auto", marginTop: 2 }} />
        <div>
          <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>
            Claude deep-read is not configured
          </div>
          <div style={{ color: T.sub, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            The optional prose-coaching read routes a hand-picked handful of cases through the first-party AI
            proxy. Once an operator sets <span className="mono">VITE_AI_PROXY_URL</span>, it turns on
            automatically. The on-device grades above need no configuration and never leave your browser.
          </div>
        </div>
      </div>
    </Card>
  );
}

export function SentimentDeepRead({ scoreable, rows }) {
  const [state, setState] = useState({ loading: false, error: null, result: null });

  // Gate at render: when no proxy is configured, show the calm card (matching
  // AiBlock) and never offer the action.
  if (!aiClient.isConfigured()) return <NotConfiguredCard />;

  const negatives = (scoreable || []).filter((g) => g.sentiment === "Negative").slice(0, MAX_DEEP_READ);
  const n = negatives.length;

  const run = async () => {
    setState({ loading: true, error: null, result: null });
    try {
      const byNumber = new Map((rows || []).map((r) => [r.number, r]));
      const cases = negatives.map((g, i) => {
        const r = byNumber.get(g.number);
        const stream = r ? parseInteractionStream(r.work_notes || r.additional_comments || "") : [];
        const comments = stream.filter((m) => m.isCustomer).map((m) => m.body).join("  ·  ");
        // `ref` is a non-PII index so the response maps back without unmasking.
        return {
          ref: i,
          number: g.number,
          account: g.account,
          priority: g.priority,
          valence: g.valence,
          sentiment: g.sentiment,
          arc: g.arc,
          emotions: g.emotions,
          quote: g.quote,
          comments,
        };
      });
      const payload = scrubForAi({ label: "negative cases", cases });
      const result = await aiClient.reviewSentiment(payload);
      setState({ loading: false, error: null, result });
    } catch (e) {
      setState({ loading: false, error: e?.message || "Deep-read failed.", result: null });
    }
  };

  if (state.loading) {
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 0" }}>
          <Loader2 size={20} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
          <div>
            <div style={{ fontWeight: 600 }}>Deep-reading {n} negative case{n === 1 ? "" : "s"}…</div>
            <div style={{ color: T.sub, fontSize: 13, marginTop: 2 }}>Anonymized and sent through the AI proxy.</div>
          </div>
        </div>
      </Card>
    );
  }

  if (state.error) {
    return (
      <Card>
        <div style={{ color: T.danger, fontSize: 13, marginBottom: 10 }}>
          <AlertTriangle size={14} style={{ verticalAlign: "middle" }} /> {state.error}
        </div>
        <button onClick={run} style={btnPrimary}>Try again</button>
      </Card>
    );
  }

  const notes = Array.isArray(state.result?.notes) ? state.result.notes : null;

  return (
    <Card style={{ background: T.surfaceAlt, borderStyle: "dashed" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>Optional · Claude deep-read</div>
          <div style={{ color: T.sub, fontSize: 12.5, marginTop: 6, lineHeight: 1.55 }}>
            The grades above are exact on coverage, responsiveness and hygiene, and directional on tone — with a
            <em> templated</em> coaching note. For prose coaching on the cases that matter, send <strong>only
            the{n === 1 ? "" : `se ${n}`} negative case{n === 1 ? "" : "s"}</strong> (anonymized) through the
            proxy — never the whole queue.
          </div>
        </div>
        <button
          onClick={run}
          disabled={!n}
          style={{ ...btnPrimary, ...(n ? {} : { opacity: 0.5, cursor: "not-allowed" }) }}
        >
          <Sparkles size={14} /> Deep-read {n} negative{n === 1 ? "" : "s"}
        </button>
      </div>

      {!n && (
        <div style={{ marginTop: 12, color: T.muted, fontSize: 12 }}>
          No negative cases in view to deep-read.
        </div>
      )}

      {notes && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {notes.length === 0 && <div style={{ color: T.sub, fontSize: 13 }}>The proxy returned no notes.</div>}
          {notes.map((note, i) => {
            const g = negatives[note?.ref] || negatives[i];
            return (
              <div key={i} style={{ borderLeft: `3px solid ${alpha(T.accent, 0.5)}`, paddingLeft: 12 }}>
                {g && (
                  <div className="mono" style={{ fontSize: 12, color: T.accent, marginBottom: 4 }}>
                    {g.number}
                  </div>
                )}
                <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55 }}>{note?.coaching}</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
