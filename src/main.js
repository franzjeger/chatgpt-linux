'use strict'

const {
  app, BrowserWindow, Menu, MenuItem, Tray,
  clipboard, globalShortcut, nativeImage, screen, session, shell,
} = require('electron')
const path = require('node:path')

const { isInternal, isAuth, isSafeExternal } = require('./urls')

const APP_URL = 'https://chatgpt.com/'
const REPO_URL = 'https://github.com/franzjeger/chatgpt-linux'

// productName is "ChatGPT", so Electron would default userData to
// ~/.config/ChatGPT — the same directory OpenAI's own desktop build uses.
// Claim our own directory before anything reads a path.
app.setPath('userData', path.join(app.getPath('appData'), 'chatgpt-linux'))

const store = require('./store')

let win = null
let tray = null
let quitting = false

const asset = (...parts) => path.join(app.getAppPath(), 'assets', ...parts)

// Let Electron pick Wayland natively when the session is Wayland, and fall
// back to X11/XWayland otherwise. Without this, Wayland sessions get blurry
// scaling and broken window decorations.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

// chatgpt.com's identity providers refuse to sign you in from a user agent
// that advertises Electron ("this browser may not be secure"), so present as
// plain Chrome. Built from the real Chromium version we ship on.
app.userAgentFallback =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`

/* ------------------------------------------------------------------ window */

// A saved position can point at a monitor that is no longer attached, which
// leaves the window stranded off-screen with no way to drag it back.
function clampToDisplay (bounds) {
  if (bounds.x == null || bounds.y == null) return bounds
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  }
}

function createWindow () {
  const settings = store.get()

  win = new BrowserWindow({
    ...clampToDisplay(settings.bounds),
    minWidth: 420,
    minHeight: 420,
    title: 'ChatGPT',
    icon: asset('icons', '512.png'),
    autoHideMenuBar: true,
    backgroundColor: '#212121',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  if (settings.maximized) win.maximize()

  const startHidden = settings.startHidden || process.argv.includes('--hidden')
  win.once('ready-to-show', () => { if (!startHidden) win.show() })

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomLevel(store.get().zoom)
  })

  wireNavigation(win)
  wireContextMenu(win)
  wirePersistence(win)

  win.loadURL(APP_URL)
}

function wirePersistence (target) {
  const persist = () => {
    if (!target || target.isDestroyed()) return
    const maximized = target.isMaximized()
    store.set({
      maximized,
      // getBounds() reports the maximized rect while maximized, which would
      // overwrite the restore size the user actually picked.
      bounds: maximized ? store.get().bounds : target.getBounds(),
      zoom: target.webContents.getZoomLevel(),
    })
  }

  target.on('resize', persist)
  target.on('move', persist)

  target.on('close', (event) => {
    persist()
    if (quitting || !store.get().closeToTray || !tray) return
    event.preventDefault()
    target.hide()
  })

  target.on('closed', () => { win = null })
}

function wireNavigation (target) {
  const openExternally = (url) => {
    if (isSafeExternal(url)) shell.openExternal(url)
  }

  target.webContents.setWindowOpenHandler(({ url }) => {
    // Sign-in flows genuinely need a popup — give them a bare window.
    if (isAuth(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 760,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      }
    }
    if (isInternal(url)) {
      target.loadURL(url)
      return { action: 'deny' }
    }
    openExternally(url)
    return { action: 'deny' }
  })

  target.webContents.on('will-navigate', (event, url) => {
    if (isInternal(url) || isAuth(url)) return
    event.preventDefault()
    openExternally(url)
  })

  target.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED, which fires on every ordinary client-side navigation.
    if (!isMainFrame || code === -3) return
    console.warn(`load failed (${code} ${description}): ${url}`)
    target.loadFile(asset('offline.html'))
  })
}

function wireContextMenu (target) {
  target.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()
    const add = (options) => menu.append(new MenuItem(options))
    const separator = () => add({ type: 'separator' })

    for (const suggestion of params.dictionarySuggestions) {
      add({ label: suggestion, click: () => target.webContents.replaceMisspelling(suggestion) })
    }
    if (params.dictionarySuggestions.length) separator()

    if (params.misspelledWord) {
      add({
        label: 'Add to dictionary',
        click: () => session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord),
      })
      separator()
    }

    if (params.linkURL) {
      add({ label: 'Open link in browser', click: () => isSafeExternal(params.linkURL) && shell.openExternal(params.linkURL) })
      add({ label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) })
      separator()
    }

    add({ role: 'cut', enabled: params.editFlags.canCut })
    add({ role: 'copy', enabled: params.editFlags.canCopy })
    add({ role: 'paste', enabled: params.editFlags.canPaste })
    if (params.isEditable) add({ role: 'selectAll' })

    menu.popup({ window: target })
  })
}

/* ----------------------------------------------------------------- actions */

function showWindow () {
  if (!win || win.isDestroyed()) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function toggleWindow () {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.hide()
  else showWindow()
}

function newChat () {
  showWindow()
  win.loadURL(APP_URL)
}

function quit () {
  quitting = true
  app.quit()
}

/* -------------------------------------------------------------------- tray */

function createTray () {
  const image = nativeImage.createFromPath(asset('icons', '64.png'))
  if (image.isEmpty()) {
    console.warn('tray: icon missing, skipping tray')
    return
  }

  try {
    tray = new Tray(image.resize({ width: 24, height: 24 }))
  } catch (err) {
    // Desktops without a StatusNotifier host have no tray to attach to.
    console.warn('tray: unavailable —', err.message)
    return
  }

  tray.setToolTip('ChatGPT')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show ChatGPT', click: showWindow },
    { label: 'New chat', click: newChat },
    { type: 'separator' },
    { label: 'Quit', click: quit },
  ]))
  tray.on('click', toggleWindow)
}

/* -------------------------------------------------------------------- menu */

function createMenu () {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '&File',
      submenu: [
        { label: 'New chat', accelerator: 'CmdOrCtrl+N', click: newChat },
        { type: 'separator' },
        { label: 'Settings file…', click: () => shell.openPath(store.FILE) },
        { type: 'separator' },
        { label: 'Hide to tray', accelerator: 'CmdOrCtrl+W', click: () => win && win.hide() },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quit },
      ],
    },
    { label: '&Edit', role: 'editMenu' },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Project on GitHub', click: () => shell.openExternal(REPO_URL) },
        { label: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`, enabled: false },
      ],
    },
  ]))
}

/* ----------------------------------------------------------------- session */

function configureSession () {
  const ses = session.defaultSession

  // Voice mode needs the microphone; everything else stays denied, and only
  // for pages we actually host.
  const ALLOWED = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen'])
  const permitted = (permission, url) => ALLOWED.has(permission) && isInternal(url)

  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permitted(permission, (details && details.requestingUrl) || contents.getURL()))
  })
  ses.setPermissionCheckHandler((_contents, permission, origin) => permitted(permission, origin))

  try {
    ses.setSpellCheckerLanguages(store.get().spellcheckLanguages)
  } catch (err) {
    // An unsupported locale in settings.json throws — fall back rather than die.
    console.warn('spellchecker:', err.message)
    try {
      ses.setSpellCheckerLanguages(['en-US'])
    } catch { /* no dictionary available at all */ }
  }
}

function registerShortcut () {
  const accelerator = store.get().toggleShortcut
  globalShortcut.unregisterAll()
  if (!accelerator) return
  try {
    if (!globalShortcut.register(accelerator, toggleWindow)) {
      console.warn(`shortcut: ${accelerator} is already taken by another app`)
    }
  } catch (err) {
    console.warn(`shortcut: ${accelerator} is not a valid accelerator —`, err.message)
  }
}

/* -------------------------------------------------------------- lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(() => {
    configureSession()
    createMenu()
    createTray()
    createWindow()
    registerShortcut()
  })

  app.on('activate', showWindow)

  app.on('window-all-closed', () => {
    // With a tray we deliberately keep running in the background.
    if (!tray || !store.get().closeToTray) quit()
  })

  app.on('before-quit', () => { quitting = true })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    store.flush()
  })
}
