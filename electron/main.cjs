// Electron main process.
//
// Boot sequence:
//   1. Start the local server (server.cjs) on a random loopback port.
//   2. Open a window on the app. There is deliberately NO credential gate —
//      Jira is an optional data source, so the app opens straight to the
//      dashboard where the user can drop a ServiceNow export.
//   3. If they want the Jira pages, they connect from Settings → Jira
//      connection, which talks back here over IPC (test / save / clear).

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const { startServer } = require('./server.cjs')
const { DEFAULT_BASE_URL, loadCreds, saveCreds, clearCreds, toAuthHeader } = require('./creds.cjs')

// Stable, human-friendly userData path: %APPDATA%\KPI Analyzer
app.setName('KPI Analyzer')

let mainWindow = null
let serverInfo = null // { url, port, close }
let currentCreds = null // { baseUrl, email, token } | null

/** What the server reads on every request — re-evaluated so a credential
 *  change takes effect without a restart. */
function getCredsForServer() {
  return {
    baseUrl: currentCreds?.baseUrl || DEFAULT_BASE_URL,
    auth: toAuthHeader(currentCreds),
  }
}

function loadApp(route = '/') {
  if (mainWindow && serverInfo) mainWindow.loadURL(serverInfo.url + route)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#15262E',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // External links (e.g. the Atlassian token page) open in the real browser,
  // never in an app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  loadApp()
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          // Credential entry lives in the app itself now — one place for it,
          // whether you launched the installer or `npm run dev`.
          label: 'Jira connection…',
          click: () => loadApp('/settings'),
        },
        {
          label: 'Clear saved Jira credentials',
          click: async () => {
            const { response } = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              buttons: ['Cancel', 'Clear'],
              defaultId: 0,
              cancelId: 0,
              message: 'Remove your saved Jira credentials?',
              detail: 'ServiceNow imports and every non-Jira page keep working. Re-connect any time from Settings.',
            })
            if (response === 1) {
              clearCreds()
              currentCreds = null
              loadApp('/settings')
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* --------------------------------- IPC ----------------------------------- */

// Validate a candidate credential set against /myself without saving it.
ipcMain.handle('creds:test', async (_e, { baseUrl, email, token }) => {
  if (!email || !token) return { ok: false, message: 'Email and API token are required.' }
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
  try {
    const res = await fetch(`${base}/rest/api/3/myself`, {
      headers: { Authorization: auth, Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: 'Authentication failed — check your email and API token.' }
    }
    if (!res.ok) return { ok: false, status: res.status, message: `Jira returned HTTP ${res.status}.` }
    const me = await res.json()
    return { ok: true, displayName: me.displayName || me.emailAddress || 'your account' }
  } catch (err) {
    return { ok: false, message: `Could not reach ${base} — ${err.message}` }
  }
})

// Persist credentials. Does NOT reload the window: the caller is the running
// app's Settings page, and the local server re-reads currentCreds per request,
// so the next Jira call just starts working.
ipcMain.handle('creds:save', async (_e, { baseUrl, email, token }) => {
  if (!email || !token) return { ok: false, message: 'Email and API token are required.' }
  try {
    saveCreds({ baseUrl, email, token })
    currentCreds = { baseUrl: baseUrl || DEFAULT_BASE_URL, email, token }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Could not save credentials: ${err.message}` }
  }
})

ipcMain.handle('creds:clear', async () => {
  try {
    clearCreds()
    currentCreds = null
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Could not remove credentials: ${err.message}` }
  }
})

// Prefill the Settings form (token deliberately NOT returned).
ipcMain.handle('creds:status', () => ({
  configured: Boolean(currentCreds),
  baseUrl: currentCreds?.baseUrl || DEFAULT_BASE_URL,
  email: currentCreds?.email || '',
  source: currentCreds ? 'keystore' : null,
  storage: 'keystore',
}))

ipcMain.handle('open:external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url)
})

/* ------------------------------- lifecycle ------------------------------- */

// Single-instance: focus the existing window instead of opening a second app.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    currentCreds = loadCreds()
    serverInfo = await startServer({
      distDir: path.join(app.getAppPath(), 'dist'),
      userDataDir: app.getPath('userData'),
      getCreds: getCredsForServer,
    })
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (serverInfo) serverInfo.close()
    if (process.platform !== 'darwin') app.quit()
  })
}
