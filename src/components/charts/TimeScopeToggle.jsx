import { T, alpha } from "../../lib/theme.js";
import { SCOPE_ALL, SCOPE_RANGE } from "../../lib/time-axis.js";
import { fmtFullDate } from "../../lib/format.js";

/* ============== Range / All time chip pair for time-series cards ==============
 * Charts now ZOOM to the active date filter instead of shading it (see
 * time-axis.js). That trade loses longitudinal context — "is this month's number
 * unusual?" needs the arc — so every zoomed chart carries an escape hatch back
 * to the full series.
 *
 * Renders NOTHING when no date filter is active: with nothing to zoom to, the
 * two chips would show identical charts, and a control that does nothing is
 * worse than no control. */

export function TimeScopeToggle({ scope, onScopeChange, range, label = "View" }) {
  const active = range && (range.from != null || range.to != null);
  if (!active) return null;

  const rangeTitle = `Zoom to the active date filter${
    range.from != null && range.to != null
      ? ` (${fmtFullDate(range.from)} – ${fmtFullDate(range.to)})`
      : ""
  }`;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className="eyebrow" style={{ color: T.muted, fontSize: 11 }}>{label}</span>
      <div
        role="group"
        aria-label="Chart time scope"
        style={{
          display: "inline-flex",
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <Chip
          on={scope === SCOPE_RANGE}
          onClick={() => onScopeChange(SCOPE_RANGE)}
          title={rangeTitle}
        >
          Range
        </Chip>
        <Chip
          on={scope === SCOPE_ALL}
          onClick={() => onScopeChange(SCOPE_ALL)}
          title="Show the full series, ignoring the date filter"
        >
          All time
        </Chip>
      </div>
    </div>
  );
}

function Chip({ on, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      style={{
        fontSize: 11,
        fontWeight: on ? 600 : 500,
        padding: "3px 10px",
        border: "none",
        // alpha() rather than hex concatenation — T tokens are var(--t-*) refs,
        // so appending "22" produces an invalid color.
        background: on ? alpha(T.accent, 0.16) : "transparent",
        color: on ? T.accent : T.sub,
        cursor: "pointer",
        lineHeight: 1.6,
      }}
    >
      {children}
    </button>
  );
}

/* Footnote for a zoomed chart: says plainly how many buckets are off-screen so
 * a clipped view can't be mistaken for the whole story. */
export function TimeScopeNote({ win, unit = "bucket", scope }) {
  if (!win?.clipped || scope !== SCOPE_RANGE) return null;
  const hidden = win.hiddenBefore + win.hiddenAfter;
  if (hidden <= 0) return null;
  return (
    <div style={{ color: T.muted, fontSize: 11, marginTop: 8 }}>
      Zoomed to the active date filter — {win.data.length} {unit}
      {win.data.length === 1 ? "" : "s"} shown, {hidden} outside the range
      {win.hiddenBefore > 0 && win.hiddenAfter > 0
        ? ` (${win.hiddenBefore} before, ${win.hiddenAfter} after)`
        : ""}
      . Switch to <em>All time</em> for the full arc.
    </div>
  );
}
