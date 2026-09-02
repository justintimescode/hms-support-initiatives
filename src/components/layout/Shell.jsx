import { T } from "../../lib/theme.js";

export function Shell({ children }) {
  return (
    <div style={{ background: T.bg, color: T.ink, minHeight: "100vh", position: "relative" }}>
      <style>{`
        /* Fonts are self-hosted and imported in src/index.css (@fontsource
           Montserrat + Inter), not pulled from a CDN — the Electron build has
           no network. The --sans / --display / --mono stacks live there too. */

        /* ----- Typography classes -----
         * Two faces only, per the brand: Montserrat for headline ranks,
         * Inter for body and UI. */
        .display {
          font-family: var(--display);
          font-weight: 400;
          letter-spacing: -0.01em;
          font-variant-numeric: tabular-nums;
        }
        .display em { font-style: italic; }
        .body { font-family: var(--sans); font-weight: 400; }

        /* .mono is a ROLE, not a face: aligned figures and an unambiguous zero.
           Inter ships genuine tabular figures and a slashed zero, which is what
           the retired monospace face was actually chosen for — so this is both
           fully brand-compliant and the first time these columns really align
           (font-variant-numeric appeared nowhere in the app before). */
        .mono {
          font-family: var(--sans);
          font-variant-numeric: tabular-nums;
          font-feature-settings: "zero" 1;
          letter-spacing: 0;
        }

        /* The brand eyebrow is ALL CAPS at 1.5X with 50% opacity. The opacity is
         * a computed refusal, not an oversight: 50% Infor Charcoal composites to
         * #8A9397 = 3.13:1 on white and 3.05:1 on the canvas, both failing AA at
         * what is the app's smallest type across 187 sites. --t-muted gives
         * 6.13:1 light / 6.57:1 dark at essentially the same perceived
         * lightness. .eyebrow-page carries the literal 1.5X size where the
         * label sits at page rank rather than inside a card. */
        .eyebrow {
          font-family: var(--sans);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: var(--fs-eyebrow-dense);
          font-weight: 600;
          color: var(--t-muted);
        }
        .eyebrow-page {
          font-size: var(--fs-eyebrow);
          letter-spacing: 0.06em;
        }
        .hairline { border-top: 1px solid ${T.border}; }

        /* ----- Subtle global affordances -----
         * Hover changes border and background only. It used to add shadowMd and
         * a translateY, which inverted the depth hierarchy (a 10x12px tile
         * out-shadowing its parent Card) and misaligned the five
         * <tr className="hoverlift"> rows, where a <td> clips box-shadow. */
        .hoverlift {
          transition: background 0.18s ease, border-color 0.18s ease;
        }
        .hoverlift:hover {
          background: ${T.surfaceAlt};
          border-color: ${T.muted};
        }

        /* ----- Focus ring (keyboard-only) -----
         * This is the app's ONLY focus indicator, so it has to be real. The old
         * value composited to #F8D8D6 = 1.33:1 against white — invisible.
         * Full-opacity Infor Purple is 10.84:1.
         * It is an outline, not a box-shadow, deliberately: an inline
         * boxShadow on a focusable element (KpiRow spreads role="button" onto
         * the Card itself) would otherwise suppress the ring entirely. And no
         * border-radius is set here — the old rule re-rounded focused pills at
         * radius 999 and circles at 50% into a 6px rectangle. */
        :focus-visible {
          outline: 3px solid var(--t-viz-accent);
          outline-offset: 2px;
        }

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
        ::selection { background: ${T.accent}; color: ${T.onAccent}; }

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
        /* fill-mode "backwards", not "both": "both" leaves transform:translateY(0)
           applied forever, and even an identity transform makes the element the
           containing block for position:fixed descendants — which silently moved
           row menus, toasts and modal overlays inside a Section off-viewport. */
        .fade-in { animation: fade-in-up 0.32s ease backwards; }

        .print-only-header { display: none; }
        @media print {
          @page { margin: 0.5in; }
          .no-print, .no-print * { display: none !important; }
          /* Print forces the light palette via index.css, so these can stay on
             tokens rather than hardcoding white/black. */
          body, .body {
            background: var(--t-surface) !important;
            color: var(--t-ink) !important;
            max-width: none !important;
            padding: 0 !important;
          }
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
