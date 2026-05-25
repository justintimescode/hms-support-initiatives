import { useState } from "react";
import { Upload, AlertTriangle, Loader2 } from "lucide-react";
import { T } from "../lib/theme.js";

/* ================= Upload ================= */
export function UploadScreen({ onPick, uploading, error, inputRef }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      className="fade-in"
      style={{
        minHeight: "80vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 36,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 620 }}>
        <div
          className="eyebrow"
          style={{
            color: T.accent,
            marginBottom: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              background: T.accent,
              borderRadius: "50%",
            }}
          />
          Infor Product Support · KPI Analyzer
        </div>
        <div
          className="display"
          style={{
            fontSize: 68,
            lineHeight: 1.0,
            letterSpacing: "-0.028em",
            color: T.ink,
          }}
        >
          Your ServiceNow cases,
          <br />
          <em style={{ color: T.accent }}>read clearly</em>.
        </div>
        <div
          style={{
            color: T.sub,
            marginTop: 20,
            fontSize: 15.5,
            lineHeight: 1.6,
            maxWidth: 540,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          Drop a ServiceNow case export and get an analyst-grade breakdown of SLA performance,
          priority mix, and the kinds of problems you are actually solving.
        </div>
      </div>

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
          gap: 14,
          width: 560,
          maxWidth: "92vw",
          padding: "56px 32px",
          borderRadius: T.radiusLg,
          border: `1.5px dashed ${drag ? T.accent : T.border}`,
          background: drag ? T.accentTint : T.surface,
          cursor: "pointer",
          boxShadow: drag ? T.shadowLg : T.shadowMd,
          transition: "all 0.2s ease",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files[0];
            if (f) onPick(f);
          }}
        />
        {uploading ? (
          <>
            <Loader2 size={32} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
            <div className="eyebrow" style={{ color: T.sub }}>Parsing…</div>
          </>
        ) : (
          <>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: T.accentTint,
                color: T.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${T.accent}26`,
              }}
            >
              <Upload size={26} strokeWidth={1.75} />
            </div>
            <div className="display" style={{ fontSize: 22, color: T.ink }}>
              Drop a CSV or Excel file here
            </div>
            <div style={{ color: T.sub, fontSize: 13 }}>or click to browse · .csv, .xlsx</div>
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
            border: `1px solid ${T.danger}33`,
            borderRadius: 8,
          }}
        >
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Format disclaimer */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          background: T.warnSoft,
          border: `1px solid ${T.warn}33`,
          borderRadius: T.radiusMd,
          padding: "14px 18px",
          maxWidth: 560,
          width: "100%",
        }}
      >
        <AlertTriangle size={16} style={{ color: T.warn, flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.6 }}>
          <strong>XLSX format is strongly recommended.</strong> CSV exports from ServiceNow use internal
          field names that may not map correctly — some columns (e.g. SLA due date, first response time,
          resolution notes) can fail to populate. Export via <em>Excel → .xlsx</em> for the most complete
          results.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 28,
          color: T.muted,
          fontSize: 12,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <span>• Expects ServiceNow `case` table export</span>
        <span>• Data stays in your browser</span>
      </div>
    </div>
  );
}
