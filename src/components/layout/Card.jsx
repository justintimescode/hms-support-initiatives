import { T } from "../../lib/theme.js";

export function Card({ children, style, className = "" }) {
  return (
    <div
      className={className}
      style={{
        background: T.surface,
        border: `1px solid ${T.borderSoft}`,
        borderRadius: 6,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
