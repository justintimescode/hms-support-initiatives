import { T } from "../../lib/theme.js";

export function Shell({ children }) {
  return (
    <div style={{ background: T.bg, color: T.ink, minHeight: "100vh", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :root {
          --ink: ${T.ink};
          --sub: ${T.sub};
          --muted: ${T.muted};
          --bg: ${T.bg};
          --surface: ${T.surface};
          --border: ${T.border};
          --accent: ${T.accent};
          --accent-deep: ${T.accentDeep};
          --ring: ${T.ring};
        }

        /* ----- Typography classes ----- */
        .display {
          font-family: 'Instrument Serif', 'Fraunces', Georgia, serif;
          font-weight: 400;
          letter-spacing: -0.012em;
          font-feature-settings: "ss01", "liga";
        }
        .display em { font-style: italic; }
        .body { font-family: 'Geist', 'DM Sans', system-ui, -apple-system, sans-serif; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, Consolas, monospace; font-feature-settings: "tnum", "zero"; }
        .eyebrow {
          font-family: 'JetBrains Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          font-size: 10px;
          font-weight: 500;
        }
        .hairline { border-top: 1px solid ${T.border}; }

        /* ----- Subtle global affordances ----- */
        .hoverlift {
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }
        .hoverlift:hover {
          transform: translateY(-1px);
          box-shadow: ${T.shadowMd};
          border-color: ${T.border};
        }

        /* ----- Focus ring (keyboard-only) ----- */
        :focus-visible {
          outline: none;
          box-shadow: ${T.ring};
          border-radius: 6px;
        }
        button, select, input, textarea, a { outline: none; }
        button:focus-visible, select:focus-visible, input:focus-visible,
        textarea:focus-visible, a:focus-visible { box-shadow: ${T.ring}; }

        /* ----- Scrollbars: subtle, modern ----- */
        .scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
        .scrollbar::-webkit-scrollbar-track { background: transparent; }
        .scrollbar::-webkit-scrollbar-thumb {
          background: ${T.border};
          border-radius: 999px;
          border: 2px solid ${T.bg};
        }
        .scrollbar::-webkit-scrollbar-thumb:hover { background: ${T.muted}; }
        body { scrollbar-width: thin; scrollbar-color: ${T.border} transparent; }

        /* ----- Selection ----- */
        ::selection { background: ${T.accent}; color: #fff; }

        /* ----- Animations ----- */
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes indeterminate { 0% { left: -45%; } 100% { left: 100%; } }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.9); }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-in { animation: fade-in-up 0.32s ease both; }

        /* ----- Background micro-texture: a very subtle radial wash ----- */
        .app-canvas::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(900px 600px at 100% 0%, rgba(218, 41, 28, 0.035), transparent 60%),
            radial-gradient(700px 500px at 0% 100%, rgba(14, 14, 16, 0.025), transparent 55%);
          z-index: 0;
        }

        .print-only-header { display: none; }
        @media print {
          @page { margin: 0.5in; }
          .no-print, .no-print * { display: none !important; }
          body, .body { background: white !important; color: black !important; max-width: none !important; padding: 0 !important; }
          .app-canvas::before { display: none !important; }
          .print-only-header { display: block !important; }
          .print-section { page-break-before: always; break-before: page; }
          .print-section:first-of-type { page-break-before: auto; break-before: auto; }
          .print-section > section > div > div[style*="border-radius"] { break-inside: avoid; page-break-inside: avoid; }
          [role="tablist"]:not(.print-keep) { display: none !important; }
          .recharts-responsive-container {
            width: 100% !important;
            min-width: 600px !important;
            min-height: 240px !important;
          }
          .recharts-wrapper { width: 100% !important; }
          .recharts-wrapper svg { width: 100% !important; height: 100% !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="app-canvas" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      <div
        className="body"
        style={{
          maxWidth: 2000,
          margin: "0 auto",
          padding: "28px 36px 96px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}
