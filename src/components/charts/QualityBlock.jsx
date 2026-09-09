import { useMemo } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { T } from "../../lib/theme.js";
import { Card } from "../layout/Card.jsx";

/* ================= Resolution Quality =================
 * First-Contact Resolution (closed in ≤1 analyst touch) and Reopen rate (cases
 * that were resolved but bounced back open). Both are derived from data the
 * app already parses; managers weight these above raw volume. Team headline +
 * per-analyst comparison. */

// Heuristic bands (support norms): FCR higher is better, reopens lower is better.
// The status triad: T.ok is Infor Purple, so the good end of these ramps is
// never green beside red. Each headline pairs the color with a tint chip and a
// worded hint, so the status never rides on hue alone.
const fcrColor = (r) => (r == null ? T.muted : r >= 60 ? T.ok : r >= 40 ? T.warn : T.danger);
const reopenColor = (r) => (r == null ? T.muted : r <= 5 ? T.ok : r <= 12 ? T.warn : T.danger);
const pct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);

export function QualityBlock({ members }) {
  const { team, rows } = useMemo(() => {
    let closed = 0, fcr = 0, everClosed = 0, reopened = 0;
    const perAnalyst = [];
    for (const m of members || []) {
      const q = m.quality || {};
      closed += q.closed || 0;
      fcr += q.fcr || 0;
      everClosed += q.everClosed || 0;
      reopened += q.reopened || 0;
      if ((q.closed || 0) > 0) perAnalyst.push({ name: m.name, ...q });
    }
    perAnalyst.sort((a, b) => (b.closed || 0) - (a.closed || 0));
    return {
      team: {
        closed, fcr, everClosed, reopened,
        fcrRate: closed ? (fcr / closed) * 100 : null,
        reopenRate: everClosed ? (reopened / everClosed) * 100 : null,
      },
      rows: perAnalyst,
    };
  }, [members]);

  if (!rows.length) {
    return (
      <Card>
        <div className="eyebrow">Resolution quality</div>
        <div style={{ color: T.sub, fontSize: 13, fontStyle: "italic", marginTop: 12 }}>No resolved cases in this view yet.</div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Headline
          icon={CheckCircle2}
          label="First-contact resolution"
          value={pct(team.fcrRate)}
          color={fcrColor(team.fcrRate)}
          sub={`${team.fcr} of ${team.closed} closed cases resolved in ≤1 analyst touch`}
          hint="Higher is better — fewer round-trips to a fix."
        />
        <Headline
          icon={RotateCcw}
          label="Reopen rate"
          value={pct(team.reopenRate)}
          color={reopenColor(team.reopenRate)}
          sub={`${team.reopened} of ${team.everClosed} resolved cases bounced back open`}
          hint="Lower is better — resolutions that stuck."
        />
      </div>

      <Card>
        <div className="eyebrow">By analyst</div>
        <div style={{ color: T.sub, fontSize: 12, marginTop: 4 }}>
          FCR and reopen rate per analyst, busiest first. FCR is approximated from Infor-authored journal turns; reopen = a case with a prior resolution that is open again.
        </div>
        <div style={{ marginTop: 12, overflowX: "auto" }} className="scrollbar">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surfaceAlt }}>
                <th style={TH}>Analyst</th>
                <th style={{ ...TH, textAlign: "right" }}>Closed</th>
                <th style={{ ...TH, textAlign: "right" }}>FCR</th>
                <th style={{ ...TH, textAlign: "right" }}>Reopened</th>
                <th style={{ ...TH, textAlign: "right" }}>Reopen rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.name} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td style={{ ...TD, fontWeight: 600 }}>{m.name}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right" }}>{m.closed}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: fcrColor(m.fcrRate), fontWeight: 600 }}>{pct(m.fcrRate)}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: m.reopened ? T.danger : T.muted }}>{m.reopened}</td>
                  <td className="mono" style={{ ...TD, textAlign: "right", color: reopenColor(m.reopenRate), fontWeight: 600 }}>{pct(m.reopenRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const TH = { textAlign: "left", padding: "8px 12px", color: T.sub, fontWeight: 600, borderBottom: `1px solid ${T.borderSoft}`, whiteSpace: "nowrap" };
/* Icon chip ground: the matching approved Tint 01 for whichever status color the
 * headline resolved to — the brand's "core color on Tint 01" colorway, and a
 * real token rather than a composited alpha of the ink. */
const CHIP_TINT = {
  [T.ok]: T.okSoft,
  [T.warn]: T.warnSoft,
  [T.danger]: T.dangerSoft,
  [T.muted]: T.surfaceAlt,
};
const TD = { padding: "8px 12px", whiteSpace: "nowrap" };

function Headline({ icon: Icon, label, value, color, sub, hint }) {
  return (
    <Card style={{ position: "relative", overflow: "hidden", padding: "20px 22px 22px" }}>
      <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="eyebrow">{label}</div>
        <span style={{ color, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: T.radiusSm, background: CHIP_TINT[color] || T.surfaceAlt }}>
          <Icon size={14} strokeWidth={2.25} />
        </span>
      </div>
      <div className="display" style={{ fontSize: 44, lineHeight: 1.02, marginTop: 12, color, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ color: T.sub, fontSize: 12, marginTop: 10, lineHeight: 1.45 }}>{sub}</div>
      <div style={{ color: T.muted, fontSize: 11, marginTop: 6, fontStyle: "italic" }}>{hint}</div>
    </Card>
  );
}
