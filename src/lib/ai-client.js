// SECURITY #1 — AI request seam.
//
// The app must NEVER call a third-party LLM API (e.g. api.anthropic.com)
// directly from the browser: doing so ships an API key into client code and
// exfiltrates raw customer data to a vendor with no server-side control. The
// previous inline `fetch('https://api.anthropic.com/...')` did exactly that.
//
// Instead, all AI traffic goes through a first-party backend proxy whose URL
// is supplied at build time via `VITE_AI_PROXY_URL`. The proxy holds the API
// key, re-scrubs PII, and talks to the model vendor. This module is the only
// place the client knows how to reach that proxy.
//
// When `VITE_AI_PROXY_URL` is empty/unset (the default — no backend exists
// yet), every call throws `AiNotConfiguredError`. Callers translate that into
// a calm "AI not configured" UI state rather than a network error.

/** Thrown when no AI proxy URL is configured. Callers branch on this. */
export class AiNotConfiguredError extends Error {
  constructor(message = "AI insights are not configured in this environment.") {
    super(message)
    this.name = "AiNotConfiguredError"
  }
}

const PROXY_URL = (import.meta.env?.VITE_AI_PROXY_URL || "").trim().replace(/\/+$/, "")

export const aiClient = {
  /** Is an AI proxy configured? Lets the UI decide whether to offer the feature. */
  isConfigured() {
    return PROXY_URL.length > 0
  },

  /**
   * Send an already-scrubbed payload to the AI proxy and return parsed
   * insights. The proxy is responsible for building the model prompt and
   * returning JSON in the shape the UI expects
   * ({ themes, recurring_issues, skill_opportunities, kb_gaps, watch_outs }).
   *
   * @param {object} payload  scrubbed via scrubForAi() — never raw case data
   * @throws {AiNotConfiguredError} when VITE_AI_PROXY_URL is unset
   */
  async analyzeCases(payload) {
    if (!PROXY_URL) throw new AiNotConfiguredError()
    const res = await fetch(`${PROXY_URL}/api/insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new Error(`AI proxy returned ${res.status} ${res.statusText}`)
    }
    return res.json()
  },
}
