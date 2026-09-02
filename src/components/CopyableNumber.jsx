import { useState, useRef, useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import { Check, AlertTriangle } from "lucide-react"
import { T } from "../lib/theme.js"
// Shared with the upload screen's "copy the column list" affordance, which needs
// the same non-secure-context fallback. Kept in lib/ because a component module
// that also exports a plain function breaks Fast Refresh.
import { writeToClipboard } from "../lib/clipboard.js"

/* Click a case number to copy it to the clipboard. A small "Copied" toast
 * confirms the copy. stopPropagation keeps it from triggering row clicks
 * (select / open detail) when used inside clickable rows. */
export function CopyableNumber({ value, style, className }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef(null)
  const alive = useRef(true)

  // Set alive on mount, not just at useRef init: StrictMode mounts, unmounts and
  // remounts in dev, so a cleanup-only effect would leave alive false forever
  // and swallow every toast.
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [])

  const copy = useCallback((e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!value) return
    writeToClipboard(String(value)).then((ok) => {
      if (!alive.current) return
      // Always surface the outcome. A silently-dead click is what made the
      // original secure-context failure so hard to spot.
      setCopied(ok)
      setFailed(!ok)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (!alive.current) return
        setCopied(false)
        setFailed(false)
      }, ok ? 1400 : 2600)
    })
  }, [value])

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={copy}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") copy(e) }}
        title="Click to copy"
        className={className}
        // ServiceNow green — these are ServiceNow case numbers (CS…). Applied
        // after `...style` so it wins over the per-call-site color overrides
        // (T.accent / T.sub / inherited) and every case number reads green.
        style={{ cursor: "pointer", fontWeight: 600, ...style, color: T.snGreen }}
      >
        {value || "—"}
      </span>
      {(copied || failed) && createPortal(
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 1000,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: failed ? T.danger : T.ink,
            color: T.surface,
            fontSize: 12,
            fontWeight: 600,
            padding: "8px 12px",
            borderRadius: T.radiusSm,
            boxShadow: T.shadowMd,
          }}
        >
          {failed
            ? <><AlertTriangle size={14} strokeWidth={2.25} /> Couldn’t copy {value} — select it and press Ctrl+C</>
            : <><Check size={14} strokeWidth={2.25} /> Copied {value}</>}
        </div>,
        document.body,
      )}
    </>
  )
}
