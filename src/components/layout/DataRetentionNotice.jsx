import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { T } from "../../lib/theme.js";

/* SECURITY #4 — persistent reminder that case data is stored locally in the
 * browser (OPFS), plus a one-click clear. Pairs with the worker's 24h auto-TTL:
 * the worker drops stale data on its own, this makes the storage visible and
 * lets the user clear on demand. Hidden entirely when no data is loaded. */

function agoLabel(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DataRetentionNotice({ snapshotMs, onClear }) {
  // Re-tick the relative label once a minute so "loaded 3m ago" stays honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (snapshotMs == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [snapshotMs]);

  if (snapshotMs == null) return null;

  return (
    <div
      style={{
        margin: "8px 10px 0",
        padding: "10px 12px",
        borderRadius: 6,
        background: T.surfaceAlt,
        border: `1px solid ${T.borderSoft}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: T.sub, fontSize: 11 }}>
        <Database size={12} />
        <span style={{ fontWeight: 600 }}>Data stored locally</span>
      </div>
      <div style={{ color: T.muted, fontSize: 11, marginTop: 4 }}>
        loaded <span className="mono">{agoLabel(snapshotMs)}</span> · auto-clears after 24h
      </div>
      <button
        onClick={onClear}
        style={{
          marginTop: 8,
          width: "100%",
          padding: "5px 10px",
          background: "transparent",
          color: T.sub,
          border: `1px solid ${T.border}`,
          borderRadius: 4,
          fontFamily: "DM Sans, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Clear data
      </button>
    </div>
  );
}
