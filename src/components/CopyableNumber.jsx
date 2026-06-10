import { useState, useRef, useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import { Check } from "lucide-react"
import { T } from "../lib/theme.js"

/* Click a case number to copy it to the clipboard. A small "Copied" toast
 * confirms the copy. stopPropagation keeps it from triggering row clicks
 * (select / open detail) when used inside clickable rows. */
export function CopyableNumber({ value, style, className }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback((e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!value || !navigator.clipboard) return
    navigator.clipboard.writeText(String(value)).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1400)
    }).catch(() => {})
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
      {copied && createPortal(
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 1000,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: T.ink,
            color: T.surface,
            fontSize: 12,
            fontWeight: 600,
            padding: "8px 12px",
            borderRadius: 6,
            boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
          }}
        >
          <Check size={14} /> Copied {value}
        </div>,
        document.body,
      )}
    </>
  )
}
