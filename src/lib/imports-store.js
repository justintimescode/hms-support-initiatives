// OPFS storage for ServiceNow imports. Pure browser storage — no React, no
// DuckDB. Each import owns a directory under `imports/{uuid}/` holding the raw
// source file (`source.{ext}`) and a metadata mirror (`meta.json`). The raw
// blob lets us re-derive the in-memory `rows` pipeline on activation/reload and
// "Rebuild from source" with current enrichment logic.
//
// All functions degrade gracefully (return null / no-op) when OPFS is
// unavailable, so callers don't need to feature-detect.

const ROOT_DIR = 'imports'

async function opfsRoot() {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
  try {
    return await navigator.storage.getDirectory()
  } catch {
    return null
  }
}

async function importsDir(create = false) {
  const root = await opfsRoot()
  if (!root) return null
  try {
    return await root.getDirectoryHandle(ROOT_DIR, { create })
  } catch {
    return null
  }
}

async function importDir(uuid, create = false) {
  const dir = await importsDir(create)
  if (!dir) return null
  try {
    return await dir.getDirectoryHandle(uuid, { create })
  } catch {
    return null
  }
}

/** Write the raw uploaded file to imports/{uuid}/source.{ext}. */
export async function storeImportBlob(uuid, file, ext) {
  const dir = await importDir(uuid, true)
  if (!dir) throw new Error('OPFS unavailable — cannot persist import source file.')
  const handle = await dir.getFileHandle(`source.${ext}`, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
}

/** Read back the stored source file as a File (name preserved from meta if any). */
export async function readImportBlob(uuid) {
  const dir = await importDir(uuid)
  if (!dir) return null
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.startsWith('source.')) {
      return await handle.getFile()
    }
  }
  return null
}

export async function storeImportMeta(uuid, meta) {
  const dir = await importDir(uuid, true)
  if (!dir) return
  const handle = await dir.getFileHandle('meta.json', { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(meta))
  await writable.close()
}

export async function readImportMeta(uuid) {
  const dir = await importDir(uuid)
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle('meta.json')
    const file = await handle.getFile()
    return JSON.parse(await file.text())
  } catch {
    return null
  }
}

/** Remove the entire imports/{uuid}/ directory. */
export async function deleteImportFiles(uuid) {
  const dir = await importsDir()
  if (!dir) return
  try {
    await dir.removeEntry(uuid, { recursive: true })
  } catch {
    /* already gone — fine */
  }
}

/** uuids that have an OPFS directory — used to detect orphans vs the index. */
export async function listImportDirectories() {
  const dir = await importsDir()
  if (!dir) return []
  const out = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') out.push(name)
    }
  } catch {
    /* ignore */
  }
  return out
}

/** Total bytes of all stored source blobs (the user-facing "storage used"). */
export async function getTotalStorageBytes() {
  const dir = await importsDir()
  if (!dir) return 0
  let total = 0
  try {
    for await (const [, importHandle] of dir.entries()) {
      if (importHandle.kind !== 'directory') continue
      for await (const [name, fileHandle] of importHandle.entries()) {
        if (fileHandle.kind === 'file' && name.startsWith('source.')) {
          const f = await fileHandle.getFile()
          total += f.size
        }
      }
    }
  } catch {
    /* ignore */
  }
  return total
}
