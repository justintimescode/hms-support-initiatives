import { useState, useMemo } from "react"
import {
  FileSpreadsheet, Upload, Loader2, AlertTriangle, MoreVertical,
  Check, Pencil, RotateCcw, Trash2, CircleDot, Circle,
} from "lucide-react"
import { T, alpha } from "../../lib/theme.js"
import { fmtFullDateTime } from "../../lib/format.js"
import { Card } from "../layout/Card.jsx"
import { Pill } from "../Pill.jsx"

const fmtBytes = (n) => {
  if (!n) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

const SORT_OPTIONS = [
  { key: "uploadedAt", label: "Upload date" },
  { key: "rowCount", label: "Row count" },
  { key: "displayName", label: "Name" },
]

/* The ServiceNow import file manager (Connections page). Lists every persistent
 * import; lets the user upload, activate, rename, rebuild, and delete. */
export function ImportsCard(ctx) {
  const {
    imports = [], activeImportUuid, storageBytes, schemaVersion,
    uploading, uploadError, inputRef, handleFile, restoringCount, persistence,
    activateImport, renameImport, deleteImport, rebuildImport, clearAllImports,
  } = ctx

  const [drag, setDrag] = useState(false)
  const [menuFor, setMenuFor] = useState(null)
  const [editing, setEditing] = useState(null) // { uuid, value }
  const [confirmDelete, setConfirmDelete] = useState(null) // import obj
  const [busy, setBusy] = useState(null) // uuid being rebuilt/activated
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState("uploadedAt")
  const [toast, setToast] = useState(null)

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200)
  }

  const showControls = imports.length >= 5
  // storageBytes is measured from OPFS (every stored source file); indexedBytes
  // is what the listed imports account for. A gap means files are stranded in
  // OPFS with no index row — they still count against "used", so name them
  // rather than letting the two numbers silently disagree.
  const indexedBytes = imports.reduce((s, i) => s + (i.fileSize || 0), 0)
  const totalBytes = storageBytes || indexedBytes
  const orphanBytes = storageBytes ? Math.max(0, storageBytes - indexedBytes) : 0
  const orphanNote = orphanBytes > 65536
    ? `${fmtBytes(orphanBytes)} of stored files aren't linked to any import listed above — left behind by earlier sessions. "Clear ${imports.length > 0 ? "all imports" : "orphaned files"}" reclaims them.`
    : null

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = imports.filter((i) => !q || i.displayName?.toLowerCase().includes(q) || i.filename?.toLowerCase().includes(q))
    list = [...list].sort((a, b) => {
      if (sort === "displayName") return String(a.displayName).localeCompare(String(b.displayName))
      if (sort === "rowCount") return (b.rowCount || 0) - (a.rowCount || 0)
      return (b.uploadedAt || 0) - (a.uploadedAt || 0)
    })
    // Active import sticky at top.
    return list.sort((a, b) => (a.uuid === activeImportUuid ? -1 : b.uuid === activeImportUuid ? 1 : 0))
  }, [imports, query, sort, activeImportUuid])

  const onPick = (f) => { if (f) handleFile(f) }

  const doActivate = async (uuid) => {
    setMenuFor(null); setBusy(uuid)
    const name = imports.find((i) => i.uuid === uuid)?.displayName
    try { await activateImport(uuid); flash(`Activated ${name}`) } finally { setBusy(null) }
  }
  const doRebuild = async (uuid) => {
    setMenuFor(null); setBusy(uuid)
    try { await rebuildImport(uuid) } catch (e) { alert(e.message) } finally { setBusy(null) }
  }
  const submitRename = async () => {
    if (editing) { await renameImport(editing.uuid, editing.value); setEditing(null) }
  }

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileSpreadsheet size={16} style={{ color: T.accent }} />
          <span className="display" style={{ fontSize: 16, fontWeight: 600 }}>ServiceNow imports</span>
          <span style={{ fontSize: 12, color: T.sub }}>
            {imports.length} {imports.length === 1 ? "import" : "imports"} · {fmtBytes(totalBytes)} used
          </span>
        </div>
        <label className="hoverlift" style={uploadBtn}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
            onChange={(e) => onPick(e.target.files?.[0])} />
          {uploading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={13} />}
          {uploading ? "Uploading…" : "Upload new"}
        </label>
      </div>

      {persistence && !persistence.opfsAvailable && (
        <div style={{ ...warnBanner, borderColor: T.danger, color: T.ink }}>
          <AlertTriangle size={14} style={{ color: T.danger, flexShrink: 0 }} />
          <span>
            <strong>Imports will not survive a reload.</strong> This browser isn&apos;t giving the app persistent
            storage (OPFS), so uploads live in memory only. Export anything you need before closing the tab.
          </span>
        </div>
      )}
      {orphanNote && (
        <div style={warnBanner}>
          <AlertTriangle size={14} style={{ color: T.warn, flexShrink: 0 }} />
          <span>{orphanNote}</span>
        </div>
      )}
      {totalBytes > 500 * 1048576 && (
        <div style={warnBanner}>
          <AlertTriangle size={14} style={{ color: T.warn, flexShrink: 0 }} />
          <span>Local storage is over 500 MB. Delete old imports you no longer need.</span>
        </div>
      )}
      {uploadError && (
        <div style={{ color: T.danger, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} /> {uploadError}
        </div>
      )}
      {restoringCount != null && restoringCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.sub, background: T.surfaceAlt, border: `1px solid ${T.borderSoft}`, borderRadius: 6, padding: "10px 12px" }}>
          <Loader2 size={14} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />
          Restoring {restoringCount} {restoringCount === 1 ? "import" : "imports"} from local storage…
        </div>
      )}

      {showControls && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search imports…"
            style={{ fontSize: 12, padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.ink, minWidth: 200, fontFamily: "DM Sans, sans-serif" }} />
          <select value={sort} onChange={(e) => setSort(e.target.value)}
            style={{ fontSize: 12, padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.ink, fontFamily: "DM Sans, sans-serif" }}>
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
          </select>
        </div>
      )}

      {imports.length === 0 ? (
        <DropTarget drag={drag} setDrag={setDrag} uploading={uploading} inputRef={inputRef} onPick={onPick} />
      ) : (
        <div style={{ border: `1px solid ${T.borderSoft}`, borderRadius: 6, overflow: "hidden" }}>
          {sorted.map((imp, idx) => {
            const isActive = imp.uuid === activeImportUuid
            const stale = imp.schemaVersion !== schemaVersion
            const isEditing = editing?.uuid === imp.uuid
            return (
              <div key={imp.uuid} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                borderTop: idx === 0 ? "none" : `1px solid ${T.borderSoft}`,
                background: isActive ? T.surfaceAlt : "transparent",
              }}>
                {isActive ? <CircleDot size={15} style={{ color: T.accent, flexShrink: 0 }} /> : <Circle size={15} style={{ color: T.muted, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input autoFocus value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setEditing(null) }}
                        style={{ fontSize: 13, padding: "4px 8px", border: `1px solid ${T.accent}`, borderRadius: 4, background: T.surface, color: T.ink, fontFamily: "DM Sans, sans-serif", minWidth: 240 }} />
                      <button onClick={submitRename} style={iconBtn} title="Save"><Check size={14} /></button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }} title={imp.displayName}>{imp.displayName}</span>
                      <Pill color={isActive ? T.ok : T.muted}>{isActive ? "active" : "available"}</Pill>
                      {stale && <Pill color={T.warn}>rebuild needed</Pill>}
                      {busy === imp.uuid && <Loader2 size={12} style={{ color: T.accent, animation: "spin 1s linear infinite" }} />}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>
                    {(imp.rowCount || 0).toLocaleString()} rows · {fmtBytes(imp.fileSize)} · uploaded {imp.uploadedAt ? fmtFullDateTime(imp.uploadedAt) : "—"}
                  </div>
                </div>
                <RowMenu
                  open={menuFor === imp.uuid}
                  onToggle={() => setMenuFor(menuFor === imp.uuid ? null : imp.uuid)}
                  isActive={isActive}
                  hasBlob={imp.fileSize > 0}
                  onActivate={() => doActivate(imp.uuid)}
                  onRename={() => { setMenuFor(null); setEditing({ uuid: imp.uuid, value: imp.displayName }) }}
                  onRebuild={() => doRebuild(imp.uuid)}
                  onDelete={() => { setMenuFor(null); setConfirmDelete(imp) }}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Also shown with an empty list when orphaned bytes exist — otherwise
          there is no way to reclaim storage the index no longer knows about. */}
      {(imports.length > 0 || orphanBytes > 0) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>
            Data is stored locally in your browser (OPFS) and persists across reloads
            {persistence && persistence.opfsAvailable && !persistence.dbDurable
              ? " — the import list is rebuilt from your stored files at startup."
              : "."}
          </span>
          <button
            onClick={() => setConfirmDelete({
              all: true,
              orphanOnly: imports.length === 0,
              orphanLabel: fmtBytes(orphanBytes),
            })}
            style={clearAllBtn}
          >
            <Trash2 size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {imports.length > 0 ? "Clear all imports" : "Clear orphaned files"}
          </button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          target={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const t = confirmDelete
            setConfirmDelete(null)
            if (t.all) { await clearAllImports(); flash("Cleared all imports") }
            else {
              const wasActive = t.uuid === activeImportUuid
              await deleteImport(t.uuid)
              flash(wasActive ? `Deleted ${t.displayName} · activated most recent` : `Deleted ${t.displayName}`)
            }
          }}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 60,
          display: "inline-flex", alignItems: "center", gap: 6,
          background: T.ink, color: T.surface, fontSize: 12, fontWeight: 600,
          padding: "8px 14px", borderRadius: 6, boxShadow: T.shadowMd,
        }}>
          <Check size={14} /> {toast}
        </div>
      )}
    </Card>
  )
}

function DropTarget({ drag, setDrag, uploading, inputRef, onPick }) {
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onPick(e.dataTransfer.files?.[0]) }}
      className="hoverlift"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8,
        padding: "40px 16px", borderRadius: 6,
        border: `1.5px dashed ${drag ? T.accent : T.border}`,
        background: drag ? alpha(T.accentSoft, 0.33) : T.surfaceAlt, cursor: "pointer",
      }}>
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files?.[0])} />
      {uploading ? (
        <><Loader2 size={24} style={{ color: T.accent, animation: "spin 1s linear infinite" }} /><div style={{ fontSize: 12, color: T.sub }}>Parsing…</div></>
      ) : (
        <>
          <Upload size={24} style={{ color: T.accent }} />
          <div style={{ fontSize: 13, fontWeight: 500 }}>Drop a CSV or Excel file</div>
          <div style={{ fontSize: 12, color: T.sub }}>or click to browse · .csv, .xlsx</div>
        </>
      )}
    </label>
  )
}

function RowMenu({ open, onToggle, isActive, hasBlob, onActivate, onRename, onRebuild, onDelete }) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={onToggle} style={iconBtn} title="Actions" aria-label="Actions"><MoreVertical size={16} /></button>
      {open && (
        <>
          <div onClick={onToggle} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
          <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, minWidth: 190, boxShadow: T.shadowMd, zIndex: 11, overflow: "hidden" }}>
            {!isActive && <MenuItem icon={CircleDot} label="Activate" onClick={onActivate} />}
            <MenuItem icon={Pencil} label="Rename" onClick={onRename} />
            <MenuItem icon={RotateCcw} label="Rebuild from source" onClick={onRebuild} disabled={!hasBlob}
              title={hasBlob ? "Re-parse the stored source file with current logic" : "No stored source — re-upload instead"} />
            <MenuItem icon={Trash2} label="Delete" onClick={onDelete} danger />
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled, title }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} title={title}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
        padding: "9px 12px", background: "transparent", border: "none",
        borderBottom: `1px solid ${T.borderSoft}`, fontFamily: "DM Sans, sans-serif", fontSize: 13,
        color: disabled ? T.muted : danger ? T.danger : T.ink, cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = T.surfaceAlt)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      <Icon size={13} /> {label}
    </button>
  )
}

function ConfirmDialog({ target, onCancel, onConfirm }) {
  const isAll = !!target.all
  const [typed, setTyped] = useState("")
  const needsType = isAll
  const canConfirm = !needsType || typed.trim().toUpperCase() === "DELETE"
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 20, maxWidth: 420, boxShadow: T.shadowLg }}>
        <div className="display" style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          {isAll ? (target.orphanOnly ? "Clear orphaned files?" : "Clear all imports?") : `Delete ${target.displayName}?`}
        </div>
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 14 }}>
          {isAll
            ? target.orphanOnly
              // Nothing is listed, so "every import" would read as a no-op and
              // leave the user unsure what the button actually does.
              ? `This removes ${target.orphanLabel} of stored files that are no longer linked to any import. This cannot be undone.`
              : "This permanently removes every import and its data from this browser. This cannot be undone."
            : <>This removes its data permanently.{target.isActive ? " It is the active import — the most recent remaining import will be activated." : ""}</>}
        </div>
        {needsType && (
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type DELETE to confirm"
            style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.ink, marginBottom: 14, fontFamily: "DM Sans, sans-serif" }} />
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ ...iconBtn, padding: "8px 14px", border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13 }}>Cancel</button>
          <button onClick={canConfirm ? onConfirm : undefined} disabled={!canConfirm}
            style={{ padding: "8px 14px", background: canConfirm ? T.danger : T.surfaceAlt, color: canConfirm ? T.onAccent : T.muted, border: `1px solid ${canConfirm ? T.danger : T.border}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: canConfirm ? "pointer" : "not-allowed", fontFamily: "DM Sans, sans-serif" }}>
            {isAll ? "Clear all" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  )
}

const uploadBtn = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
  background: T.ink, color: T.surface, border: `1px solid ${T.ink}`, borderRadius: 6,
  fontSize: 13, fontWeight: 500, cursor: "pointer",
}
const iconBtn = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px",
  background: "transparent", color: T.sub, border: "none", borderRadius: 4,
  cursor: "pointer", fontFamily: "DM Sans, sans-serif",
}
const clearAllBtn = {
  display: "inline-flex", alignItems: "center", padding: "6px 12px",
  background: "transparent", color: T.danger, border: `1px solid ${T.danger}`,
  borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif",
}
const warnBanner = {
  display: "flex", alignItems: "flex-start", gap: 8,
  background: T.warnSoft, border: `1px solid ${T.warn}`,
  borderRadius: 6, padding: "10px 12px", fontSize: 12, color: T.ink,
}
