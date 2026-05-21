import { T } from "../../lib/theme.js";

export function Shell({ children }) {
  return (
    <div style={{ background: T.bg, color: T.ink, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        .display { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto; letter-spacing: -0.01em; }
        .body { font-family: 'DM Sans', system-ui, sans-serif; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-feature-settings: "tnum"; }
        .eyebrow { font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.14em; font-size: 10px; font-weight: 500; }
        .hairline { border-top: 1px solid ${T.border}; }
        .hoverlift { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .hoverlift:hover { transform: translateY(-1px); }
        .scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .scrollbar::-webkit-scrollbar-track { background: ${T.surfaceAlt}; }
        .scrollbar::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes indeterminate { 0% { left: -45%; } 100% { left: 100%; } }

        .print-only-header { display: none; }
        @media print {
          @page { margin: 0.5in; }
          .no-print, .no-print * { display: none !important; }
          body, .body { background: white !important; color: black !important; max-width: none !important; padding: 0 !important; }
          .print-only-header { display: block !important; }
          .print-section { page-break-before: always; break-before: page; }
          .print-section:first-of-type { page-break-before: auto; break-before: auto; }
          /* Keep individual chart/list Cards intact across page breaks where possible */
          .print-section > section > div > div[style*="border-radius"] { break-inside: avoid; page-break-inside: avoid; }
          /* Hide the live page-tabs nav */
          [role="tablist"]:not(.print-keep) { display: none !important; }
          /* Recharts: ResponsiveContainer caches dimensions on mount. When a tab
             that was previously hidden becomes visible (printMode flip), the
             container may have measured 0 in some layouts. We force a minimum
             working size in print and let the resize event from useEffect
             trigger a re-measure. */
          .recharts-responsive-container {
            width: 100% !important;
            min-width: 600px !important;
            min-height: 240px !important;
          }
          .recharts-wrapper { width: 100% !important; }
          .recharts-wrapper svg { width: 100% !important; height: 100% !important; }
          /* Print color fidelity: keep chart fills (avoid all-gray output) */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="body" style={{ maxWidth: 1600, margin: "0 auto", padding: "24px 32px 80px" }}>{children}</div>
    </div>
  );
}
