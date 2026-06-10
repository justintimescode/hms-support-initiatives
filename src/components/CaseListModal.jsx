import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { T } from "../lib/theme.js";
import { CaseTable } from "./CaseTable.jsx";

/* ============================================================================
 * Case-list modal — a drill-down overlay that shows the individual cases
 * behind an aggregate number (e.g. clicking the SLA compliance KPI card).
 * Same shell behavior as AnalystProfileModal: overlay click / Escape to
 * close, background scroll locked while open.
 * ========================================================================== */
export function CaseListModal({ title, subtitle, rows, onClose }) {
  const closeRef = useRef(null);

  // Escape to close + lock background scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="no-print"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(14,14,16,0.55)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 20px", overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="fade-in"
        style={{
          width: "100%", maxWidth: 1080, background: T.bg,
          border: `1px solid ${T.border}`, borderRadius: T.radiusLg || 12,
          boxShadow: T.shadowLg, maxHeight: "calc(100vh - 80px)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", background: T.surface, borderBottom: `1px solid ${T.border}`, borderRadius: `${T.radiusLg || 12}px ${T.radiusLg || 12}px 0 0` }}>
          <div style={{ minWidth: 0 }}>
            <div className="display" style={{ fontSize: 24, color: T.ink, letterSpacing: "-0.015em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            {subtitle && <div style={{ color: T.sub, fontSize: 12.5, marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "transparent", color: T.sub, border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer", flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div className="scrollbar" style={{ padding: 18, overflowY: "auto" }}>
          <CaseTable rows={rows} />
        </div>
      </div>
    </div>
  );
}
