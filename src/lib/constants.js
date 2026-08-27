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

export const SLA_RISK_BUCKETS = [
  { key: "breached", label: "Breached", desc: "SLA already passed", color: "#A23220" },
  { key: "due24", label: "Due < 24h", desc: "SLA within next 24h", color: "#B8452C" },
  { key: "dueWeek", label: "Due this week", desc: "SLA within 1–7 days", color: "#B8801C" },
  { key: "comfortable", label: "Comfortable", desc: "SLA more than 7 days out", color: "#3D6340" },
  { key: "noSla", label: "No SLA", desc: "No SLA deadline recorded", color: "#8A8270" },
];
