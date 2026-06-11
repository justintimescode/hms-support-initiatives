import { alpha } from "../lib/theme.js";

export function Pill({ color, children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        background: alpha(color, 0.08),
        color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "JetBrains Mono, monospace",
        border: `1px solid ${alpha(color, 0.15)}`,
        lineHeight: 1.4,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: color,
        }}
      />
      {children}
    </span>
  );
}
