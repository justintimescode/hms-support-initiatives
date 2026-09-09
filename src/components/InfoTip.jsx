import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import { T } from "../lib/theme.js";

/* ================= InfoTip =================
 * A small "?" affordance that explains how a calculated stat is derived.
 *
 * Why a custom component rather than a native title= tooltip: the KPI values
 * are computed (SLA compliance = met / eligible, percentiles, means…), and the
 * formula is exactly the kind of thing a native tooltip renders too slowly and
 * unstyled to be useful. This is keyboard-accessible (focusable button, opens
 * on hover AND focus, Escape/blur to dismiss) to match the app's a11y posture.
 *
 * Layout note: the bubble is rendered through a PORTAL to <body> with fixed
 * positioning, NOT as an absolutely-positioned child. The KPI cards set
 * `overflow: hidden` (to clip their top accent bar), which would otherwise crop
 * any popover that extends past the card edge — the exact bug this avoids. The
 * bubble is positioned from the trigger's on-screen rect and clamped/flipped to
 * stay within the viewport. */
const GAP = 8; // px between trigger and bubble
const MARGIN = 8; // min px from any viewport edge

export function InfoTip({ label, children, side = "right", width = 260 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // { top, left } in viewport (fixed) coords
  const wrapRef = useRef(null);
  const bubbleRef = useRef(null);
  const tipId = useId();

  const place = useCallback(() => {
    const trigger = wrapRef.current;
    const bubble = bubbleRef.current;
    if (!trigger) return;
    const t = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const bw = Math.min(width, vw - MARGIN * 2);
    const bh = bubble ? bubble.offsetHeight : 0;

    // Horizontal: "right"-aligned means the bubble's right edge lines up with
    // the trigger's right edge (bubble opens leftward); "left" opens rightward.
    let left = side === "right" ? t.right - bw : t.left;
    left = Math.max(MARGIN, Math.min(left, vw - bw - MARGIN));

    // Vertical: below the trigger by default; flip above if it would overflow
    // the bottom AND there's more room above.
    let top = t.bottom + GAP;
    if (bh && top + bh > vh - MARGIN && t.top - GAP - bh > MARGIN) {
      top = t.top - GAP - bh;
    }
    top = Math.max(MARGIN, Math.min(top, vh - bh - MARGIN));

    setPos({ top, left, width: bw });
  }, [side, width]);

  // Position before paint so the bubble never flashes in the wrong spot, then
  // keep it pinned to the trigger while open (scroll/resize move the card).
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  // Dismiss on outside click and on Escape — the two dismissals users reach for.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (
        wrapRef.current && !wrapRef.current.contains(e.target) &&
        bubbleRef.current && !bubbleRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-flex", lineHeight: 0 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label ? `How is “${label}” calculated?` : "How is this calculated?"}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={(e) => {
          // Don't trigger a parent card's onClick (e.g. the SLA drill-down).
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          // The button lives inside clickable cards; keep its keys to itself.
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          width: 18,
          height: 18,
          border: "none",
          background: "transparent",
          color: T.muted,
          cursor: "pointer",
          borderRadius: 999,
        }}
      >
        <HelpCircle size={14} strokeWidth={2} aria-hidden />
      </button>

      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            id={tipId}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos ? pos.top : -9999,
              left: pos ? pos.left : -9999,
              zIndex: 1000,
              width: pos ? pos.width : width,
              // Bubble sizes to content; clamped vertically so a tall tooltip
              // (the SLA table) can scroll rather than run off-screen.
              maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
              overflowY: "auto",
              padding: "10px 12px",
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusSm,
              boxShadow: T.shadowMd,
              color: T.sub,
              fontSize: 12,
              lineHeight: 1.5,
              fontWeight: 400,
              letterSpacing: 0,
              textTransform: "none",
              whiteSpace: "normal",
              cursor: "default",
              // Hidden until measured to avoid a first-paint flash at (0,0).
              visibility: pos ? "visible" : "hidden",
            }}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onClick={(e) => e.stopPropagation()}
          >
            {label && (
              <span
                style={{
                  display: "block",
                  color: T.ink,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {label}
              </span>
            )}
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
