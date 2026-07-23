import { useEffect, useState } from "react";
import { FileSpreadsheet, Cloud, Loader2 } from "lucide-react";
import { T, alpha } from "../../lib/theme.js";
import { fmtAgo } from "../../lib/format.js";

/* Always-visible top-right indicator showing the freshness of the two data
 * sources that feed the app. Lives in TopBar so every routed page gets the
 * same header. Re-ticks once a minute so "3m ago" stays honest. */

const DAY_MS = 24 * 60 * 60 * 1000;

function Pill({ icon: Icon, label, ts, now, missingLabel, missingTone, busy }) {
  const ago = fmtAgo(ts);
  const isMissing = ago == null;
  const stale = !isMissing && (now - ts) > DAY_MS;
  const fresh = !isMissing && !stale;
  const color = isMissing ? missingTone : stale ? T.warn : T.ok;
  const text = isMissing ? missingLabel : ago;
  return (
    <div
      title={ts ? new Date(ts).toLocaleString() : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 11px 5px 9px",
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        fontSize: 11,
        color: T.sub,
        whiteSpace: "nowrap",
        boxShadow: T.shadowSm,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          boxShadow: fresh ? `0 0 0 3px ${alpha(color, 0.13)}` : "none",
          animation: fresh ? "pulse-dot 2.4s ease-in-out infinite" : "none",
          flexShrink: 0,
        }}
      />
      <Icon size={12} style={{ color: T.muted }} />
      <span style={{ color: T.muted, fontWeight: 500 }}>{label}</span>
      <span
        className="mono"
        style={{ color: isMissing ? missingTone : T.ink, fontWeight: 600 }}
      >
        {text}
      </span>
      {busy && (
        <Loader2
          size={11}
          aria-label="syncing"
          style={{ color: T.muted, animation: "spin 0.8s linear infinite", flexShrink: 0 }}
        />
      )}
    </div>
  );
}

export function FreshnessIndicator({ activeImport, jiraState, jiraAutoSyncing }) {
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
        busy={jiraAutoSyncing}
      />
    </div>
  );
}
