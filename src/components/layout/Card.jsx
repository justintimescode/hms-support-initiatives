import { T } from "../../lib/theme.js";

export function Card({ children, style, className = "" }) {
  return (
    <div
      className={className}
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusMd,
        padding: 22,
        boxShadow: T.shadowSm,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
