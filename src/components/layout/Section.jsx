import { T } from "../../lib/theme.js";

export function Section({ title, subtitle, children }) {
  return (
    <section style={{ marginTop: title ? 48 : 24 }} className={title ? "fade-in" : undefined}>
      {title && (
        <div style={{ marginBottom: 18 }}>
          <div
            className="display"
            style={{
              fontSize: 36,
              lineHeight: 1.05,
              color: T.ink,
              letterSpacing: "-0.018em",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                color: T.sub,
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.5,
                maxWidth: 720,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
