const {
  app, BrowserWindow, WebContentsView, screen, globalShortcut,
  clipboard, Tray, Menu, ipcMain, nativeImage, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { parseYouTube, embedUrl, watchUrl, findInArgs } = require('./youtube');
const { dodgeTarget } = require('./placement');

let uIOhook = null;
try {
  ({ uIOhook } = require('uiohook-napi'));
} catch (err) {
  console.error('No se pudo cargar uiohook-napi; el movimiento automático queda desactivado.', err);
}

const BAR = 30;        // alto de la barra superior
const MARGIN = 16;     // separación con el borde de la pantalla
const ANIM_MS = 180;   // duración de la animación al moverse

// Autoplay sin gesto previo y un user agent de Chrome normal (YouTube trata mejor a Chrome).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}\\/\\S+`), '');

// ---------- Ajustes persistentes ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { autoMove: true, opacity: 1, bounds: null };
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* primera vez */ }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* sin drama */ }
}

let win = null;
let view = null;
let tray = null;
let current = null;    // video actual {id,start,list}
let animTimer = null;
let pendingInfo = null;

// ---------- Ventana ----------
function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 480;
  const height = Math.round(width * 9 / 16) + BAR;
  return { width, height, x: wa.x + wa.width - width - MARGIN, y: wa.y + wa.height - height - MARGIN };
}

function boundsAreVisible(b) {
  return screen.getAllDisplays().some(d => {
    const wa = d.workArea;
    return b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y;
  });
}

function createWindow() {
  const b = settings.bounds && boundsAreVisible(settings.bounds) ? settings.bounds : defaultBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: 240,
    minHeight: 135 + BAR,
    frame: false,
    alwaysOnTop: true,
    fullscreenable: false,   // el "pantalla completa" del video llena la ventana, no el monitor
    skipTaskbar: false,
    backgroundColor: '#0b0b0b',
    title: 'YT Flotante',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setOpacity(settings.opacity);
  win.loadFile(path.join(__dirname, 'index.html'));

  win.on('resize', layoutView);
  const remember = () => { if (!animTimer) { settings.bounds = win.getBounds(); saveSettings(); } };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('close', (e) => {
    // Cerrar = esconder (la app sigue en la bandeja). Salir desde la bandeja.
    if (!app.isQuitting) { e.preventDefault(); closeVideo(); win.hide(); }
  });
  win.webContents.on('did-finish-load', () => {
    sendState();
    if (pendingInfo) { const i = pendingInfo; pendingInfo = null; openVideo(i); }
  });
}

function layoutView() {
  if (!win || !view) return;
  const [w, h] = win.getContentSize();
  view.setBounds({ x: 0, y: BAR, width: w, height: Math.max(0, h - BAR) });
}

function sendState() {
  if (!win) return;
  win.webContents.send('state', {
    autoMove: settings.autoMove,
    hookOk: !!uIOhook,
    playing: !!current,
    opacity: settings.opacity,
  });
}

// ---------- Video ----------
function ensureView() {
  if (view) return view;
  view = new WebContentsView({
    webPreferences: { partition: 'persist:youtube', contextIsolation: true, nodeIntegration: false },
  });
  view.setBackgroundColor('#000000');
  win.contentView.addChildView(view);
  layoutView();
  // Los links que se abran desde el video van al navegador normal.
  view.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return view;
}

async function playerHasError() {
  try {
    return await view.webContents.executeJavaScript(
      `!!document.querySelector('.ytp-error, .ytp-embed-error')`);
  } catch { return false; }
}

// Plan B: algunos videos no permiten "embed". Se abre la página normal y se pone el reproductor
// en pantalla completa dentro de la ventana (que no es "fullscreenable", así que no tapa el monitor).
function loadWatchFallback(info) {
  const wc = view.webContents;
  wc.once('did-finish-load', () => {
    wc.executeJavaScript(`(async () => {
      for (let i = 0; i < 60; i++) {
        const p = document.querySelector('#movie_player');
        const v = document.querySelector('video');
        if (p && v) {
          try { await p.requestFullscreen(); } catch (e) {}
          try { await v.play(); } catch (e) {}
          return true;
        }
        await new Promise(r => setTimeout(r, 250));
      }
      return false;
    })()`, true).catch(() => {});
  });
  wc.loadURL(watchUrl(info));
}

function openVideo(info) {
  if (!info) return false;
  if (!win) { pendingInfo = info; return true; }
  current = info;
  ensureView();
  const wc = view.webContents;
  wc.once('did-finish-load', () => {
    setTimeout(async () => {
      if (current === info && view && await playerHasError()) loadWatchFallback(info);
    }, 3500);
  });
  wc.loadURL(embedUrl(info), { httpReferrer: 'https://www.youtube.com/' });
  if (!win.isVisible()) win.showInactive();
  sendState();
  return true;
}

function openFromText(text) {
  const info = parseYouTube(text);
  if (!info) return false;
  return openVideo(info);
}

function closeVideo() {
  current = null;
  if (view) {
    win.contentView.removeChildView(view);
    view.webContents.close();
    view = null;
  }
  sendState();
}

// ---------- Esquivar el clic ----------
function animateTo(target) {
  if (animTimer) clearInterval(animTimer);
  const start = win.getBounds();
  const t0 = Date.now();
  animTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(animTimer); animTimer = null; return; }
    const k = Math.min(1, (Date.now() - t0) / ANIM_MS);
    const e = 1 - Math.pow(1 - k, 3); // ease-out
    win.setBounds({
      x: Math.round(start.x + (target.x - start.x) * e),
      y: Math.round(start.y + (target.y - start.y) * e),
      width: start.width,
      height: start.height,
    });
    if (k >= 1) {
      clearInterval(animTimer); animTimer = null;
      settings.bounds = win.getBounds(); saveSettings();
    }
  }, 15);
}

function onGlobalMouseDown(e) {
  if (!settings.autoMove || !win || win.isDestroyed() || !win.isVisible() || animTimer) return;
  let p = { x: e.x, y: e.y };
  // En Windows el hook entrega píxeles físicos; se convierten a píxeles lógicos (escala de pantalla).
  if (process.platform === 'win32') p = screen.screenToDipPoint(p);
  const b = win.getBounds();
  const clickDisplay = screen.getDisplayNearestPoint(p);
  const winDisplay = screen.getDisplayMatching(b);
  const target = dodgeTarget(p, b, clickDisplay.workArea, clickDisplay.id === winDisplay.id, MARGIN);
  if (target) animateTo(target);
}

function setAutoMove(on) {
  settings.autoMove = on;
  saveSettings();
  sendState();
  rebuildTrayMenu();
}

function setOpacity(v) {
  settings.opacity = Math.min(1, Math.max(0.3, Math.round(v * 100) / 100));
  if (win) win.setOpacity(settings.opacity);
  saveSettings();
  sendState();
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else win.showInactive();
}

function openFromClipboard() {
  if (!openFromText(clipboard.readText())) {
    if (win) { win.show(); win.webContents.send('toast', 'No hay un link de YouTube en el portapapeles'); }
  }
}

// ---------- Bandeja ----------
function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir link copiado  (Ctrl+Shift+Y)', click: openFromClipboard },
    { label: 'Mostrar / ocultar  (Ctrl+Shift+H)', click: toggleVisible },
    { type: 'separator' },
    { label: 'Moverse solo al hacer clic  (Ctrl+Shift+M)', type: 'checkbox', checked: settings.autoMove, enabled: !!uIOhook, click: (i) => setAutoMove(i.checked) },
    {
      label: 'Transparencia',
      submenu: [1, 0.85, 0.7, 0.5].map(v => ({
        label: `${Math.round(v * 100)} %`, type: 'radio', checked: settings.opacity === v, click: () => setOpacity(v),
      })),
    },
    { label: 'Volver a la esquina inferior derecha', click: () => { if (win) win.setBounds(defaultBounds()); } },
    { label: 'Iniciar con Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Salir', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('YT Flotante');
  tray.on('click', toggleVisible);
  rebuildTrayMenu();
}

// ---------- IPC desde la barra ----------
ipcMain.handle('open', (_e, text) => openFromText(text));
ipcMain.on('close-video', () => closeVideo());
ipcMain.on('hide', () => { if (win) win.hide(); });
ipcMain.on('toggle-auto', () => setAutoMove(!settings.autoMove));
ipcMain.on('opacity', (_e, delta) => setOpacity(settings.opacity + delta));
ipcMain.on('paste-open', () => openFromClipboard());

// ---------- Arranque ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Links ytpip://open?url=... (para el marcador del navegador)
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('ytpip', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('ytpip');
  }

  app.on('second-instance', (_e, argv) => {
    const info = findInArgs(argv);
    if (info) openVideo(info);
    else if (win) win.show();
  });

  app.whenReady().then(() => {
    loadSettings();
    createWindow();
    createTray();

    globalShortcut.register('CommandOrControl+Shift+Y', openFromClipboard);
    globalShortcut.register('CommandOrControl+Shift+H', toggleVisible);
    globalShortcut.register('CommandOrControl+Shift+M', () => { if (uIOhook) setAutoMove(!settings.autoMove); });

    if (uIOhook) {
      uIOhook.on('mousedown', onGlobalMouseDown);
      uIOhook.start();
    }

    const info = findInArgs(process.argv);
    if (info) openVideo(info);
  });

  app.on('window-all-closed', (e) => e.preventDefault());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (uIOhook) { try { uIOhook.stop(); } catch { /* nada */ } }
  });
}
