// Theme-token colors for the AI-assistance outcome classes (the "AI Assisted?"
// tab). Kept out of lib/ai-tags.js so that module stays UI-free and testable
// under `node --test`, and out of the chart files so the five blocks can't drift
// apart. Plain constants only — no components, so react-refresh is happy.
//
// Every value is an existing theme token (see theme.js / index.css): already
// tuned for light and dark, so nothing here needs a new CSS variable.
//
// THE EMPHASIS THIS PALETTE BUYS: the outcomes now run down the Infor Purple
// data-viz ladder (helped = full purple, didn't help = Purple Tint 02) with the
// non-judgement classes achromatic, which leaves T.dangerFill on "hallucinated"
// as the ONLY red anywhere on the page. The page's most consequential
// distinction — a tool that fails vs. a tool that invents an answer — is
// therefore carried by a change of color FAMILY rather than by two neighbouring
// hues, which is what the old T.warn / T.danger pairing could never do.
//
// THE BLOCK SPECS STILL DEPEND ON ALL THREE OF THESE, so keep them: wherever
// two outcomes sit next to each other in a stack the blocks must (a) separate
// segments with a `stroke={T.surface} strokeWidth={2}` gap, (b) carry counts in
// the legend or a direct label, and (c) give hallucinations their own named
// stat, so the finding never depends on telling two adjacent fills apart. Those
// are information channels, not decoration — removing any of them is a
// functionality regression. The light neutral steps also sit under 3:1 against
// the plot ground and want a `stroke={T.vizStroke}` outline.

import { T } from "./theme.js";

export const OUTCOME_COLOR = {
  helpful: T.vizAccent,         // Infor Purple — the duotone lead
  unhelpful: T.categorical[5],  // Purple Tint 02 — the duotone companion
  harmful: T.dangerFill,        // Infor Red — the page's only red, by design
  notApplicable: T.surfaceSunk, // achromatic: not an outcome judgement at all
  unclassified: T.vizCat,       // achromatic charcoal — recorded but unjudged
};

// "Untagged" is not an outcome — it is the absence of data. It gets the plot
// ground itself rather than a categorical step, so a chart's colored area
// always means "someone recorded something". (PIE_SPEC's surface-colored stroke
// is what keeps an untagged slice legible against that ground.)
export const UNTAGGED_COLOR = T.vizWell;

export const outcomeColor = (id) => OUTCOME_COLOR[id] || T.muted;
