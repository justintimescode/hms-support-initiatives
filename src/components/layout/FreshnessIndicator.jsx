import { useEffect, useState } from "react";
import { FileSpreadsheet, Cloud } from "lucide-react";
import { T } from "../../lib/theme.js";
import { fmtAgo } from "../../lib/format.js";

/* Always-visible top-right indicator showing the freshness of the two data
 * sources that feed the app: the active ServiceNow import and the cached Jira
 * project sync. Lives in TopBar so every routed page gets the same header.
 * Re-ticks once a minute so "3m ago" stays honest. */

const DAY_MS = 24 * 60 * 60 * 1000;

function Pill({ icon: Icon, label, ts, now, missingLabel, missingTone }) {
  const ago = fmtAgo(ts);
  const isMissing = ago == null;
  const stale = !isMissing && (now - ts) > DAY_MS;
  const color = isMissing ? missingTone : stale ? T.warn : T.sub;
  const text = isMissing ? missingLabel : ago;
  return (
    <div
      title={ts ? new Date(ts).toLocaleString() : undefined}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 10px",
        background: T.surfaceAlt, border: `1px solid ${T.borderSoft}`,
        borderRadius: 12, fontSize: 11, color: T.sub, whiteSpace: "nowrap",
      }}
    >
      <Icon size={12} style={{ color }} />
      <span style={{ color: T.muted }}>{label}</span>
      <span className="mono" style={{ color, fontWeight: 600 }}>{text}</span>
    </div>
  );
}

export function FreshnessIndicator({ activeImport, jiraState }) {
  // `now` is held in state and updated only via the interval effect, so the
  // freshness math stays out of the render-purity rule. Re-ticks every minute
  // so "3m ago" / "stale" stay honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const snTs = activeImport?.uploadedAt ?? null;
  const jiraTs = jiraState?.meta?.fetchedAt ?? null;
  const jiraNeverSynced =
    jiraTs == null && (jiraState?.status === "unconfigured" ? "not connected" : "never synced");

  return (
    <div
      className="no-print"
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <Pill
        icon={FileSpreadsheet}
        label="ServiceNow"
        ts={snTs}
        now={now}
        missingLabel="not loaded"
        missingTone={T.muted}
      />
      <Pill
        icon={Cloud}
        label="Jira"
        ts={jiraTs}
        now={now}
        missingLabel={jiraNeverSynced || "never synced"}
        missingTone={T.muted}
      />
    </div>
  );
}
