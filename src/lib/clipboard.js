/* Clipboard write with a non-secure-context fallback.
 *
 * navigator.clipboard only exists in a secure context — HTTPS or localhost. The
 * dev server is reached over plain http:// on a LAN hostname (see
 * vite.config.js server.allowedHosts), where it is undefined, so the async API
 * alone silently no-ops for every user who isn't on localhost. Fall back to a
 * hidden-textarea execCommand("copy"), which has no secure-context requirement.
 *
 * Returns whether the text actually made it to the clipboard, so callers can
 * report the outcome instead of showing an unconditional "Copied" — a silently
 * dead click is what made the original secure-context failure so hard to spot.
 *
 * Lives in lib/ rather than beside its first caller because a component module
 * that also exports a plain function breaks React Fast Refresh
 * (react-refresh/only-export-components). */
export async function writeToClipboard(text) {
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
