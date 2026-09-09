export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/* ---------- date-range filters ----------
 * Rolling look-back windows anchored on today, plus "older90" which looks
 * the other direction (everything before the 90d cutoff) so the full set
 * covers <=7d, >7d, >30d, >60d, and >90d spans. */
export const PRESETS = [
  { key: "all", label: "All-time" },
  { key: "ytd", label: "YTD" },
  { key: "older90", label: "Older than 90 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "60d", label: "Last 60 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "7d", label: "Last 7 days" },
  { key: "custom", label: "Custom" },
];

export const PAGE_KEYS = ["overview", "sla", "trends", "mix", "team", "ai", "cases"];

export const AGING_BUCKETS = [
  { name: "0–7d", min: 0, max: 7 },
  { name: "8–30d", min: 8, max: 30 },
  { name: "31–90d", min: 31, max: 90 },
  { name: "90d+", min: 91, max: Infinity },
];

// First-response-time histogram buckets. `max` is the exclusive upper bound in
// ms; a value falls in the first bucket whose `max` it is below.
export const FRT_BUCKETS = [
  { name: "<1h",   max: 36e5 },
  { name: "1–2h",  max: 2 * 36e5 },
  { name: "2–4h",  max: 4 * 36e5 },
  { name: "4–8h",  max: 8 * 36e5 },
  { name: "8–24h", max: 24 * 36e5 },
  { name: "1–3d",  max: 3 * 24 * 36e5 },
  { name: "3d+",   max: Infinity },
];

/* SLA risk ramp. Red is reserved for the terminal "Breached" state, where it
 * carries meaning; everything else is the Infor Purple ladder plus achromatic
 * neutrals, so the set is two color families plus a residual rather than the
 * five (red + orange + yellow + green + olive) it used to be. `color` is read
 * straight through by the charts (SlaRiskBlock), so the values are theme tokens
 * resolved by src/index.css and follow the light/dark palette automatically.
 * The two neutral steps sit under 3:1 on the plot ground and need
 * `stroke={T.vizStroke}` at the chart callsite. */
export const SLA_RISK_BUCKETS = [
  { key: "breached", label: "Breached", desc: "SLA already passed", color: "var(--t-risk-breached)" },
  { key: "due24", label: "Due < 24h", desc: "SLA within next 24h", color: "var(--t-risk-due24)" },
  { key: "dueWeek", label: "Due this week", desc: "SLA within 1–7 days", color: "var(--t-risk-dueweek)" },
  { key: "comfortable", label: "Comfortable", desc: "SLA more than 7 days out", color: "var(--t-risk-comfortable)" },
  { key: "noSla", label: "No SLA", desc: "No SLA deadline recorded", color: "var(--t-risk-none)" },
];
