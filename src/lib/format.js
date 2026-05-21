import { priorityRank } from "./enrich.js";
import { T } from "./theme.js";

export const fmtDuration = (ms) => {
  if (ms == null || isNaN(ms)) return "—";
  const h = ms / 36e5;
  if (h < 1) return `${Math.round(ms / 6e4)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

export const priorityColor = (p) => {
  const r = priorityRank(p);
  return [null, T.priorityCritical, T.priorityMajor, T.priorityMedium, T.priorityStandard][r] || T.muted;
};

export const isoFromMs = (ms) => {
  if (ms == null) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const msFromIso = (iso, endOfDay = false) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return endOfDay ? dt.getTime() + 864e5 - 1 : dt.getTime();
};

export const SLA_COLOR = (rate) =>
  rate == null ? T.muted : rate >= 95 ? T.ok : rate >= 85 ? T.warn : T.danger;

// "higher is better" by default. For metrics where lower is better, color flips.
export const deltaColor = (diff, betterDir = "up") => {
  if (diff == null || diff === 0) return T.muted;
  const positive = diff > 0;
  const good = betterDir === "up" ? positive : !positive;
  return good ? T.ok : T.danger;
};

export const fmtDeltaCount = (cur, prev) => {
  if (prev == null || cur == null) return null;
  const d = cur - prev;
  return `${d > 0 ? "+" : ""}${d.toLocaleString()} vs prev`;
};

export const fmtDeltaPct = (cur, prev) => {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}pp vs prev`;
};

export const fmtDeltaDuration = (cur, prev) => {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (d === 0) return "no change vs prev";
  const sign = d > 0 ? "+" : "−";
  return `${sign}${fmtDuration(Math.abs(d))} vs prev`;
};

export const fmtDate = (d) => {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export const fmtDateTime = (d) => {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
};

export const ageDays = (d) => {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 864e5);
};

export const fmtAxisDate = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};
export const fmtWeekLabel = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
export const fmtFullDate = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
export const fmtFullDateTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};
