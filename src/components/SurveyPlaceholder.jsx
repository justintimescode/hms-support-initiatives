import { Mailbox } from "lucide-react";
import { T } from "../lib/theme.js";
import { Card } from "./layout/Card.jsx";

/* ================= Survey placeholder ================= */
export function SurveyPlaceholder() {
  return (
    <Card style={{ background: T.surfaceAlt, borderStyle: "dashed" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ padding: 10, background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusSm }}>
          <Mailbox size={18} strokeWidth={1.9} style={{ color: T.muted }} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="eyebrow">Coming online</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 4 }}>
            Customer survey responses — not yet exposed in ServiceNow
          </div>
          <div style={{ color: T.sub, fontSize: 13, marginTop: 6, lineHeight: 1.55, maxWidth: 720 }}>
            Your manager grades the CSAT surveys manually today. Once survey results become a queryable ServiceNow
            table or view, this panel will plot score distribution, correlate CSAT against SLA and category,
            and flag accounts whose sentiment diverges from their ticket behavior. For now, drop survey exports
            here when you get them and the pipeline is ready.
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 14, fontSize: 12, color: T.muted, flexWrap: "wrap" }}>
            <span>· Score distribution</span>
            <span>· CSAT vs SLA correlation</span>
            <span>· Sentiment vs ticket volume</span>
            <span>· Comments themes</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
