// Preload bridge. Exposes a tiny, explicit API to the setup screen — the
// renderer never gets direct access to Node, ipcRenderer, or the file system.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /** Test a candidate credential set against Jira /myself (does not save). */
  test: (creds) => ipcRenderer.invoke('creds:test', creds),
  /** Persist credentials (OS-encrypted) and switch the window to the app. */
  saveAndLaunch: (creds) => ipcRenderer.invoke('creds:saveAndLaunch', creds),
  /** Current config for prefilling the form (never returns the token). */
  status: () => ipcRenderer.invoke('creds:status'),
  /** Open an https URL in the user's real browser. */
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
})
