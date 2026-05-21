import { T } from "../lib/theme.js";
import { PRESETS } from "../lib/constants.js";
import { isoFromMs, msFromIso } from "../lib/format.js";
import { presetRange } from "../lib/stats.js";

/* ================= Filter Bar ================= */
export function FilterBar({ range, onRangeChange, compareOn, onCompareChange, compareWindow, sliceCount }) {
  const setPreset = (key) => {
    if (key === "custom") {
      onRangeChange({ ...range, preset: "custom" });
      return;
    }
    const r = presetRange(key);
    onRangeChange({ preset: key, from: r.from, to: r.to, field: range.field });
  };
  const setField = (field) => onRangeChange({ ...range, field });
  const setFrom = (iso) => {
    const ms = msFromIso(iso, false);
    onRangeChange({ ...range, preset: "custom", from: ms });
  };
  const setTo = (iso) => {
    const ms = msFromIso(iso, true);
    onRangeChange({ ...range, preset: "custom", to: ms });
  };
  const compareDisabled = range.from == null || range.to == null;
  const compareLabel = compareWindow && compareWindow.from != null
    ? `vs. ${isoFromMs(compareWindow.from)} → ${isoFromMs(compareWindow.to)}`
    : null;

  const inputStyle = {
    border: `1px solid ${T.border}`,
    background: T.surface,
    color: T.ink,
    borderRadius: 4,
    padding: "5px 8px",
    fontSize: 12,
    fontFamily: "JetBrains Mono, monospace",
  };

  return (
    <div className="no-print" style={{ marginTop: 14, padding: "10px 14px", border: `1px solid ${T.borderSoft}`, borderRadius: 6, background: T.surface, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
      <span className="eyebrow" style={{ color: T.muted }}>Filter</span>

      <select
        value={range.preset}
        onChange={(e) => setPreset(e.target.value)}
        style={{ ...inputStyle, fontFamily: "DM Sans, sans-serif", padding: "5px 10px", cursor: "pointer" }}
      >
        {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: T.muted }}>from</span>
        <input type="date" value={isoFromMs(range.from)} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
        <span style={{ color: T.muted }}>to</span>
        <input type="date" value={isoFromMs(range.to)} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
      </div>

      <div style={{ display: "inline-flex", background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 4, padding: 2 }}>
        {[{ k: "_created", label: "by Created" }, { k: "_closed", label: "by Closed" }].map((opt) => {
          const active = range.field === opt.k;
          return (
            <button
              key={opt.k}
              onClick={() => setField(opt.k)}
              style={{
                padding: "4px 10px",
                background: active ? T.ink : "transparent",
                color: active ? T.surface : T.sub,
                border: "none",
                borderRadius: 3,
                fontFamily: "DM Sans, sans-serif",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: compareDisabled ? T.muted : T.ink, cursor: compareDisabled ? "not-allowed" : "pointer" }}>
        <input
          type="checkbox"
          checked={compareOn && !compareDisabled}
          disabled={compareDisabled}
          onChange={(e) => onCompareChange(e.target.checked)}
        />
        <span>Compare to previous period</span>
      </label>

      {compareOn && compareLabel && (
        <span className="mono" style={{ color: T.sub, fontSize: 11 }}>{compareLabel}</span>
      )}

      <div style={{ marginLeft: "auto", color: T.sub, fontSize: 11 }} className="mono">
        {sliceCount.toLocaleString()} cases in slice
      </div>
    </div>
  );
}
