// Theme-token colors for the AI-assistance outcome classes (the "AI Assisted?"
// tab). Kept out of lib/ai-tags.js so that module stays UI-free and testable
// under `node --test`, and out of the chart files so the five blocks can't drift
// apart. Plain constants only — no components, so react-refresh is happy.
//
// Every value is an existing semantic token (see theme.js / index.css): already
// tuned for light and dark, so nothing here needs a new CSS variable.
//
// READABILITY CAVEAT that shapes the block specs: T.warn ("didn't help") and
// T.danger ("hallucinated") are close in the light palette, and that pair carries
// the page's most consequential distinction — a tool that fails vs. a tool that
// invents an answer. Wherever the two sit next to each other in a stack, the
// blocks must (a) separate segments with a `stroke={T.surface} strokeWidth={2}`
// gap, (b) carry counts in the legend or a direct label, and (c) give
// hallucinations their own named stat so the finding never depends on
// distinguishing two adjacent fills.

import { T, alpha } from "./theme.js";

export const OUTCOME_COLOR = {
  helpful: T.ok,
  unhelpful: T.warn,
  harmful: T.danger,
  notApplicable: T.muted,
  unclassified: T.accent,
};

// "Untagged" is not an outcome — it is the absence of data. It gets the
// de-emphasis wash rather than a categorical hue, so a chart's colored area
// always means "someone recorded something".
export const UNTAGGED_COLOR = alpha(T.muted, 0.22);

export const outcomeColor = (id) => OUTCOME_COLOR[id] || T.muted;
