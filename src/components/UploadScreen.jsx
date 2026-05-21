import { useState } from "react";
import { Upload, AlertTriangle, Loader2 } from "lucide-react";
import { T } from "../lib/theme.js";

/* ================= Upload ================= */
export function UploadScreen({ onPick, uploading, error, inputRef }) {
  const [drag, setDrag] = useState(false);
  return (
    <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 32 }}>
      <div style={{ textAlign: "center", maxWidth: 560 }}>
        <div className="eyebrow" style={{ color: T.accent, marginBottom: 12 }}>Product Support · KPI Analyzer</div>
        <div className="display" style={{ fontSize: 56, fontWeight: 500, lineHeight: 1.02, letterSpacing: "-0.025em" }}>
          Your ServiceNow cases,<br/><em style={{ fontStyle: "italic", color: T.accent }}>read clearly</em>.
        </div>
        <div style={{ color: T.sub, marginTop: 16, fontSize: 15, lineHeight: 1.5 }}>
          Drop a ServiceNow case export and get an analyst-grade breakdown of SLA performance, priority mix,
          and the kinds of problems you are actually solving.
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
          gap: 12,
          width: 520,
          maxWidth: "90vw",
          padding: "48px 32px",
          borderRadius: 8,
          border: `1.5px dashed ${drag ? T.accent : T.border}`,
          background: drag ? T.accentSoft + "55" : T.surface,
          cursor: "pointer",
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
            <Loader2 size={28} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
            <div className="eyebrow" style={{ color: T.sub }}>Parsing…</div>
          </>
        ) : (
          <>
            <Upload size={28} style={{ color: T.accent }} />
            <div className="display" style={{ fontSize: 18, fontWeight: 500 }}>Drop a CSV or Excel file here</div>
            <div style={{ color: T.sub, fontSize: 13 }}>or click to browse · .csv, .xlsx</div>
          </>
        )}
      </label>

      {error && (
        <div style={{ color: T.danger, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Format disclaimer */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        background: T.warnSoft,
        border: `1px solid ${T.warn}`,
        borderRadius: 6,
        padding: "12px 16px",
        maxWidth: 520,
        width: "100%",
      }}>
        <AlertTriangle size={15} style={{ color: T.warn, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.55 }}>
          <strong>XLSX format is strongly recommended.</strong> CSV exports from ServiceNow use internal field names that may not map correctly — some columns (e.g. SLA due date, first response time, resolution notes) can fail to populate. Export via <em>Excel → .xlsx</em> for the most complete results.
        </div>
      </div>

      <div style={{ display: "flex", gap: 32, color: T.muted, fontSize: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <span>• Expects ServiceNow `case` table export</span>
        <span>• Data stays in your browser</span>
      </div>
    </div>
  );
}
