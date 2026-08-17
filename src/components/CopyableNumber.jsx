import { useState, useRef, useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import { Check, AlertTriangle } from "lucide-react"
import { T } from "../lib/theme.js"

/* navigator.clipboard only exists in a secure context — HTTPS or localhost.
 * The dev server is reached over plain http:// on a LAN hostname (see
 * vite.config.js server.allowedHosts), where it is undefined, so the async API
 * alone silently no-ops for every user who isn't on localhost. Fall back to a
 * hidden-textarea execCommand("copy"), which has no secure-context
 * requirement. Returns whether the text actually made it to the clipboard. */
async function writeToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or a transient failure — try the fallback below.
    }
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    // Off-screen but still focusable: display:none or visibility:hidden would
    // make the selection uncopyable.
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0"
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length) // iOS Safari ignores select() alone
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/* Click a case number to copy it to the clipboard. A small "Copied" toast
 * confirms the copy. stopPropagation keeps it from triggering row clicks
 * (select / open detail) when used inside clickable rows. */
export function CopyableNumber({ value, style, className }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef(null)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false; clearTimeout(timer.current) }, [])

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
            borderRadius: 6,
            boxShadow: T.shadowMd,
          }}
        >
          {failed
            ? <><AlertTriangle size={14} /> Couldn’t copy {value} — select it and press Ctrl+C</>
            : <><Check size={14} /> Copied {value}</>}
        </div>,
        document.body,
      )}
    </>
  )
}
