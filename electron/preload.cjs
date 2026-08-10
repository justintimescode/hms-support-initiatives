// Preload bridge. Exposes a tiny, explicit API to the renderer — the app never
// gets direct access to Node, ipcRenderer, or the file system.
//
// Consumed by src/lib/jira-creds.js, which falls back to the dev server's
// /api/creds/jira endpoints when this bridge is absent (i.e. in the browser).

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /** Test a candidate credential set against Jira /myself (does not save). */
  test: (creds) => ipcRenderer.invoke('creds:test', creds),
  /** Persist credentials, OS-encrypted. Does not reload the window. */
  save: (creds) => ipcRenderer.invoke('creds:save', creds),
  /** Forget the saved credentials. Jira pages go back to "not connected". */
  clear: () => ipcRenderer.invoke('creds:clear'),
  /** Current config for prefilling the form (never returns the token). */
  status: () => ipcRenderer.invoke('creds:status'),
  /** Open an https URL in the user's real browser. */
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
})
