import { T } from "../../lib/theme.js";

export function Section({ title, subtitle, children }) {
  return (
    <section style={{ marginTop: title ? 48 : 24 }}>
      {title && (
        <div style={{ marginBottom: 16 }}>
          <div className="display" style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.1 }}>{title}</div>
          {subtitle && <div style={{ color: T.sub, marginTop: 6, fontSize: 14, maxWidth: 680 }}>{subtitle}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
