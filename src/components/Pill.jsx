export function Pill({ color, children }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 100,
      background: color + "22",
      color,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      fontFamily: "JetBrains Mono, monospace",
    }}>{children}</span>
  );
}
