import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Upload, AlertTriangle, Loader2, ListFilter, Columns3, FileSpreadsheet,
  Check, Copy, RefreshCw,
} from "lucide-react";
import { T } from "../lib/theme.js";
import { writeToClipboard } from "../lib/clipboard.js";

/* ================= Upload / first-run landing =================
 * The whole onboarding, ordered the way the work actually happens: build the
 * list in ServiceNow (three steps), THEN drop the file. The earlier version led
 * with the dropzone and explained the stakes afterwards, which meant a
 * first-time user uploaded whatever export they already had and never read the
 * part that would have made it a good one.
 *
 * The stakes themselves are stated once, in the subtitle, instead of three
 * times in three different banners. What replaces the repetition is the thing
 * that was actually missing: the specific clicks, and the column names.
 *
 * COLUMN LIST IS DERIVED FROM CODE, NOT WRITTEN FROM MEMORY. Every name below
 * is an XLSX display label that `normalizeXlsxRow` (src/lib/enrich.js) reads,
 * and the tiers reflect what the pipeline actually does without them. If you
 * add a header to that map, add it here too — this screen is the only place a
 * user is told the column exists. */

/* Tiered because "include everything" is not advice a user can act on, and
 * because the consequences genuinely differ: the first group decides whether
 * the app works at all, the second decides how many pages have content, the
 * third only adds filter dimensions. */
const ESSENTIAL = [
  ["Number", "Case identity — also how duplicates are spotted"],
  ["Created", "Every time-based metric; the default date range"],
  ["State", "Open / Solution Proposed / Closed split"],
  ["Priority", "SOP cadence and SLA thresholds"],
  ["Assigned to", "Per-analyst and team views"],
];

const RECOMMENDED = [
  ["Closed", "Resolution time, trajectory"],
  ["Additional comments", "Update Queue, SLA cadence tracking"],
  ["Work notes", "Jira links, interaction counts"],
  ["First Response Time", "First-response metrics"],
  ["Short Description", "Auto-derived categories"],
  ["Resolution notes", "Categorization, AI analysis"],
  ["Manager", "The manager filter"],
];

const OPTIONAL = [
  "Account", "Parent Account", "Product line", "Region", "Assignment group",
  "Contact", "Cause", "Case Action Summary", "Tags", "Status",
  "Made SLA", "SLA due",
];

const ALL_COLUMNS = [
  ...ESSENTIAL.map(([n]) => n),
  ...RECOMMENDED.map(([n]) => n),
  ...OPTIONAL,
];

export function UploadScreen({ onPick, uploading, error, inputRef }) {
  const [drag, setDrag] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <div
      className="fade-in"
      style={{
        maxWidth: 1040,
        margin: "0 auto",
        padding: "8px 0 64px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 28,
      }}
    >
      {/* ---------- Title + stakes ---------- */}
      <div style={{ maxWidth: 760 }}>
        <div
          className="display"
          style={{ fontSize: "var(--fs-h2)", lineHeight: 1.05, color: T.ink, letterSpacing: "-0.01em" }}
        >
          Import a ServiceNow export
        </div>
        <div style={{ color: T.sub, marginTop: 10, fontSize: 14, lineHeight: 1.6 }}>
          The analyzer reads nothing from ServiceNow directly — it only sees the columns present in
          the file you upload, so the list you build there decides what every page can show. Drop
          your export below, or follow the three steps to build a good one first.
        </div>
      </div>

      {/* ---------- Dropzone: first thing on the page ---------- */}
      <div
        style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}
      >
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) onPick(f);
          }}
          className="hoverlift"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 12,
            width: "100%",
            padding: "52px 32px",
            borderRadius: T.radiusLg,
            border: `1.5px dashed ${drag ? T.accent : T.border}`,
            background: drag ? T.accentTint : T.surface,
            cursor: "pointer",
            boxShadow: "none",
            transition: "border-color 0.15s ease, background 0.15s ease",
            // The hidden input carries the focus, so the ring has to be drawn
            // on the label the user can actually see. Matches the global
            // :focus-visible treatment in Shell.jsx.
            outline: focused ? `3px solid ${T.vizAccent}` : "none",
            outlineOffset: 2,
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            // NOT display:none. That took the only control on the first screen
            // out of the tab order entirely, so the app could not be started
            // from the keyboard at all. Visually hidden but still focusable
            // keeps the native label/input behaviour: Enter or Space on the
            // focused input opens the picker, with no key handling of our own.
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              clipPath: "inset(50%)",
              whiteSpace: "nowrap",
              border: 0,
            }}
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) onPick(f);
            }}
          />
          {uploading ? (
            <>
              <Loader2 size={28} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
              <div className="eyebrow" style={{ color: T.sub }}>Parsing…</div>
            </>
          ) : (
            <>
              <div style={{ color: T.accent, display: "flex" }}>
                <Upload size={28} strokeWidth={1.75} />
              </div>
              <div style={{ fontSize: "var(--fs-subhead)", fontWeight: 600, color: T.ink }}>
                Drop your export here
              </div>
              <div style={{ color: T.sub, fontSize: 13 }}>
                or click to browse · .xlsx recommended, .csv accepted · 50 MB max
              </div>
            </>
          )}
        </label>

        {error && (
          <div
            style={{
              color: T.danger,
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              background: T.dangerSoft,
              border: `1px solid ${T.danger}`,
              borderRadius: T.radiusSm,
            }}
          >
            <AlertTriangle size={14} strokeWidth={2.25} /> {error}
          </div>
        )}
      </div>

      {/* ---------- How to build a good export ---------- */}
      <div className="eyebrow" style={{ marginTop: 8 }}>How to build a good export</div>

      {/* ---------- The actual procedure ---------- */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
          <Step
            n={1}
            icon={ListFilter}
            title="Open your case list in ServiceNow and filter it"
            body="Go to the Cases list and narrow it to what you want to analyze — typically your team's assignment group over the period you care about. Every row that survives the filter becomes a case in the app; rows you filter out are simply not there."
          />

          <Step
            n={2}
            icon={Columns3}
            title="Add the columns you want analyzed"
            body={
              <>
                Open the list's column picker — the gear icon at the top-left of the list header,
                which ServiceNow labels <Kbd>Personalize Columns</Kbd> — and move these fields into
                the selected list. A column you leave out does not exist as far as the app is
                concerned, and no page can reconstruct it later.
              </>
            }
          >
            <ColumnChecklist />
          </Step>

          <Step
            n={3}
            icon={FileSpreadsheet}
            title="Export the list as Excel, not CSV"
            body={
              <>
                Right-click the list header, choose <Kbd>Export</Kbd> → <Kbd>Excel (.xlsx)</Kbd>.
                Both formats load, but only XLSX carries ServiceNow's readable column labels, which
                is what the app matches on.
              </>
            }
          >
            <Note>
              <strong style={{ color: T.ink }}>CSV loses columns.</strong> A CSV export names its
              columns with internal field names, and the app has no translation table for those — so
              anything named differently arrives empty. First-response time is affected even when
              the column is present, because only the XLSX path converts it from a timestamp into a
              duration. Choose Excel and none of this applies.
            </Note>
          </Step>
      </div>

      {/* ---------- Jira: explicitly NOT part of the export ---------- */}
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "center",
          gap: 10,
          paddingTop: 4,
          borderTop: `1px solid ${T.borderSoft}`,
        }}
      >
        <RefreshCw size={15} strokeWidth={1.9} style={{ color: T.muted, flexShrink: 0, marginTop: 12 }} />
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6, marginTop: 10, maxWidth: 720 }}>
          <strong style={{ color: T.ink, fontWeight: 600 }}>Jira needs no export.</strong>{" "}
          Linked tickets are fetched live from the Jira API, so status, assignee and fix versions
          stay current on their own. Nothing here depends on it —{" "}
          <Link to="/settings" style={{ color: T.accentDeep }}>connect it in Settings</Link>{" "}
          whenever you want the Jira pages populated.
        </div>
      </div>
    </div>
  );
}

/* One numbered step. The number is the point — it turns four disconnected
 * advisory panels into a sequence with a beginning and an end. */
function Step({ n, icon: Icon, title, body, children }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusMd,
        padding: 20,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: 999,
          background: T.accent,
          color: T.onAccent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {n}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Icon size={17} strokeWidth={1.85} style={{ color: T.accent, flexShrink: 0 }} />
          <div style={{ fontSize: "var(--fs-subhead)", fontWeight: 600, color: T.ink }}>{title}</div>
        </div>
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6, maxWidth: 760 }}>{body}</div>
        {children}
      </div>
    </div>
  );
}

/* The thing the old screen never gave anyone: the actual field names, ranked by
 * what breaks without them, next to a button that puts them on the clipboard so
 * they can be checked off against the ServiceNow picker. */
function ColumnChecklist() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);

  const copy = useCallback(() => {
    writeToClipboard(ALL_COLUMNS.join("\n")).then((ok) => {
      if (!alive.current) return;
      setCopied(ok);
      setFailed(!ok);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!alive.current) return;
        setCopied(false);
        setFailed(false);
      }, ok ? 1600 : 2600);
    });
  }, []);

  return (
    <div
      style={{
        width: "100%",
        textAlign: "left",
        background: T.surfaceSunk,
        border: `1px solid ${T.borderSoft}`,
        borderRadius: T.radiusSm,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div className="eyebrow">Columns to select</div>
        <button
          type="button"
          onClick={copy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: T.radiusSm,
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            color: failed ? T.danger : copied ? T.accentDeep : T.sub,
            cursor: "pointer",
          }}
        >
          {failed
            ? <><AlertTriangle size={13} strokeWidth={2.25} /> Couldn’t copy</>
            : copied
              ? <><Check size={13} strokeWidth={2.25} /> Copied {ALL_COLUMNS.length} names</>
              : <><Copy size={13} strokeWidth={2} /> Copy all {ALL_COLUMNS.length} names</>}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 18,
          alignItems: "start",
        }}
      >
        <Tier
          label="Essential"
          tone={T.accentDeep}
          blurb="Leave one of these out and the app loads but reads wrong."
          rows={ESSENTIAL}
        />
        <Tier
          label="Strongly recommended"
          tone={T.ink}
          blurb="Each one is a set of metrics that stays empty without it."
          rows={RECOMMENDED}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <TierHead
            label="Nice to have"
            tone={T.sub}
            blurb="Extra filters and detail. Nothing breaks if you skip them."
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {OPTIONAL.map((name) => <Chip key={name}>{name}</Chip>)}
          </div>
          <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
            Made SLA and SLA due are stored but no longer drive SLA — that comes from the SOP update
            cadence — so omitting them costs no metrics.
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.5, borderTop: `1px solid ${T.borderSoft}`, paddingTop: 10 }}>
        The standard case layout carries <Chip inline>Number</Chip> twice — the case number and,
        further right, the account number. Both can stay; the app keeps the first, which is the case
        number.
      </div>
    </div>
  );
}

function Tier({ label, tone, blurb, rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <TierHead label={label} tone={tone} blurb={blurb} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(([name, why]) => (
          <div key={name} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Chip>{name}</Chip>
            <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.45 }}>{why}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TierHead({ label, tone, blurb }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: tone }}>{label}</div>
      <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.45 }}>{blurb}</div>
    </div>
  );
}

/* A literal column name. Rendered as a tinted chip rather than in a monospace
 * face because --mono resolves to Inter in this app (see index.css) — the chip
 * is what makes "this is a string you will see in ServiceNow" legible. */
function Chip({ children, inline }) {
  return (
    <span
      style={{
        display: "inline-block",
        alignSelf: inline ? undefined : "flex-start",
        background: T.surfaceAlt,
        border: `1px solid ${T.borderSoft}`,
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: 12,
        fontWeight: 600,
        color: T.ink,
        lineHeight: 1.5,
      }}
    >
      {children}
    </span>
  );
}

/* A ServiceNow menu label the user is looking for on their own screen. */
function Kbd({ children }) {
  return (
    <span
      style={{
        background: T.surfaceAlt,
        border: `1px solid ${T.border}`,
        borderRadius: 4,
        padding: "1px 5px",
        fontSize: 12,
        fontWeight: 600,
        color: T.ink,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* Inline caution, scoped to the step it belongs to. Deliberately not a
 * full-width page banner: as its own section it competed with the instruction
 * it was meant to qualify. */
function Note({ children }) {
  return (
    <div
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        background: T.warnSoft,
        border: `1px solid ${T.warn}`,
        borderRadius: T.radiusSm,
        padding: "10px 14px",
      }}
    >
      <AlertTriangle size={15} strokeWidth={2} style={{ color: T.warn, flexShrink: 0, marginTop: 2 }} />
      <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}
