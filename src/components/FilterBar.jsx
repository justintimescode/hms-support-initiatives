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
    borderRadius: T.radiusSm,
    padding: "6px 10px",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  };

  return (
    <div
      className="no-print"
      style={{
        marginTop: 14,
        padding: "11px 16px",
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusMd,
        background: T.surface,
        boxShadow: T.shadowSm,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 14,
        fontSize: 12,
      }}
    >
      <span className="eyebrow">Filter</span>

      <select
        value={range.preset}
        onChange={(e) => setPreset(e.target.value)}
        style={{
          ...inputStyle,
          padding: "6px 12px",
          cursor: "pointer",
          fontWeight: 500,
        }}
      >
        {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: T.muted }}>from</span>
        <input type="date" value={isoFromMs(range.from)} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
        <span style={{ color: T.muted }}>to</span>
        <input type="date" value={isoFromMs(range.to)} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
      </div>

      <div
        style={{
          display: "inline-flex",
          background: T.surfaceAlt,
          border: `1px solid ${T.borderSoft}`,
          borderRadius: T.radiusMd,
          padding: 2,
        }}
      >
        {[{ k: "_created", label: "by Created" }, { k: "_closed", label: "by Closed" }].map((opt) => {
          const active = range.field === opt.k;
          return (
            <button
              key={opt.k}
              onClick={() => setField(opt.k)}
              style={{
                padding: "5px 12px",
                background: active ? T.surface : "transparent",
                color: active ? T.ink : T.sub,
                border: "none",
                borderRadius: T.radiusSm,
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                boxShadow: active ? T.shadowSm : "none",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          color: compareDisabled ? T.muted : T.ink,
          cursor: compareDisabled ? "not-allowed" : "pointer",
          fontSize: 12,
        }}
      >
        <input
          type="checkbox"
          checked={compareOn && !compareDisabled}
          disabled={compareDisabled}
          onChange={(e) => onCompareChange(e.target.checked)}
          style={{ accentColor: T.accent, cursor: "inherit" }}
        />
        <span>Compare to previous period</span>
      </label>

      {compareOn && compareLabel && (
        <span className="mono" style={{ color: T.sub, fontSize: 11 }}>{compareLabel}</span>
      )}

      <div
        style={{
          marginLeft: "auto",
          color: T.sub,
          fontSize: 11,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: T.accent,
          }}
        />
        <span className="mono" style={{ fontWeight: 600, color: T.ink }}>
          {sliceCount.toLocaleString()}
        </span>
        <span>cases in slice</span>
      </div>
    </div>
  );
}
