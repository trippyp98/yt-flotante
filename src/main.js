const {
  app, BrowserWindow, WebContentsView, screen, globalShortcut,
  clipboard, Tray, Menu, ipcMain, nativeImage, shell, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { parseYouTube, watchUrl, findInArgs } = require('./youtube');
const { dodgeTarget, inside } = require('./placement');
const { controlScript, rejectConsentScript, fillPlayerScript } = require('./inject');

let uIOhook = null;
try {
  ({ uIOhook } = require('uiohook-napi'));
} catch (err) {
  console.error('No se pudo cargar uiohook-napi; el movimiento automático queda desactivado.', err);
}

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* en desarrollo puede faltar */ }

const BAR = 30;          // alto de la barra superior
const MARGIN = 16;       // separación con el borde de la pantalla
const ANIM_MS = 180;     // duración de la animación al moverse
const GHOST_OPACITY = 0.25;

// Autoplay sin gesto previo y un user agent de Chrome normal (YouTube trata mejor a Chrome).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}\\/\\S+`), '');

// ---------- Ajustes persistentes ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { autoMove: true, opacity: 1, bounds: null, mode: 'lados', ghost: false };
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
let ghosted = false;
let playerOrigin = null;   // http://localhost:<puerto>
let readyTimer = null;     // si el reproductor no arranca a tiempo, se usa la página normal

// ---------- Servidor local para el reproductor ----------
// YouTube exige que el video incrustado venga de una página web "real" (con origen http/https).
// La app sirve player.html desde localhost y ahí dentro va el reproductor oficial.
function startPlayerServer() {
  const html = fs.readFileSync(path.join(__dirname, 'player.html'));
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/player.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      } else {
        res.writeHead(404); res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      playerOrigin = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
}

function playerUrl({ id, start, list }) {
  const p = new URLSearchParams({ id, start: String(start || 0) });
  if (list) p.set('list', list);
  return `${playerOrigin}/player.html?${p}`;
}

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
    ghost: settings.ghost,
    mode: settings.mode,
  });
}

function toast(msg) {
  if (win && msg) win.webContents.send('toast', msg);
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
  const wc = view.webContents;
  // Los links que se abran desde el video van al navegador normal.
  wc.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // Mensajes desde player.html (vía el título de la página).
  wc.on('page-title-updated', (_e, title) => {
    const m = /^YTF:(\w+):([^:]*):/.exec(title);
    if (!m || !current) return;
    if (m[1] === 'ready') clearTimeout(readyTimer);
    if (m[1] === 'error') {
      clearTimeout(readyTimer);
      console.warn('Reproductor incrustado falló con código', m[2], '→ usando la página normal');
      loadWatchFallback(current);
    }
  });

  // Página normal de YouTube: rechazar cookies y llenar la ventana con el reproductor.
  const onYouTubePage = () => {
    let host = '';
    try { host = new URL(wc.getURL()).hostname; } catch { return; }
    if (/(^|\.)consent\.(youtube|google)\.com$/.test(host)) {
      wc.executeJavaScript(rejectConsentScript, true).catch(() => {});
    } else if (/(^|\.)youtube\.com$/.test(host) && wc.getURL().includes('/watch')) {
      wc.insertCSS('#masthead-container, ytd-masthead, #secondary, #below { display: none !important; }').catch(() => {});
      wc.executeJavaScript(rejectConsentScript, true).catch(() => {});
      wc.executeJavaScript(fillPlayerScript, true).catch(() => {});
    }
  };
  wc.on('did-finish-load', onYouTubePage);
  wc.on('did-navigate-in-page', onYouTubePage);
  return view;
}

function loadWatchFallback(info) {
  if (!view) return;
  view.webContents.loadURL(watchUrl(info));
}

function openVideo(info) {
  if (!info) return false;
  if (!win || !playerOrigin) { pendingInfo = info; return true; }
  current = info;
  ensureView();
  clearTimeout(readyTimer);
  readyTimer = setTimeout(() => { if (current === info) loadWatchFallback(info); }, 12000);
  view.webContents.loadURL(playerUrl(info));
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
  clearTimeout(readyTimer);
  if (view) {
    win.contentView.removeChildView(view);
    view.webContents.close();
    view = null;
  }
  sendState();
}

async function control(cmd) {
  if (!view || !current) return;
  try {
    const msg = await view.webContents.executeJavaScript(controlScript(cmd), true);
    toast(msg);
  } catch { /* el video aún no carga */ }
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

// En Windows el hook entrega píxeles físicos; se convierten a píxeles lógicos (escala de pantalla).
function toDip(e) {
  const p = { x: e.x, y: e.y };
  return process.platform === 'win32' ? screen.screenToDipPoint(p) : p;
}

function onGlobalMouseDown(e) {
  if (!settings.autoMove || !win || win.isDestroyed() || !win.isVisible() || animTimer) return;
  const p = toDip(e);
  const b = win.getBounds();
  const clickDisplay = screen.getDisplayNearestPoint(p);
  const winDisplay = screen.getDisplayMatching(b);
  const target = dodgeTarget(p, b, clickDisplay.workArea, clickDisplay.id === winDisplay.id, MARGIN, settings.mode);
  if (target) animateTo(target);
}

// Modo fantasma: cuando el mouse pasa sobre el video, este se vuelve casi transparente.
let lastMove = 0;
function onGlobalMouseMove(e) {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const now = Date.now();
  if (now - lastMove < 60) return;
  lastMove = now;
  const over = settings.ghost && inside(toDip(e), win.getBounds());
  if (over !== ghosted) {
    ghosted = over;
    win.setOpacity(over ? Math.min(GHOST_OPACITY, settings.opacity) : settings.opacity);
  }
}

function setAutoMove(on) {
  settings.autoMove = on;
  saveSettings(); sendState(); rebuildTrayMenu();
}

function setMode(mode) {
  settings.mode = mode;
  saveSettings(); sendState(); rebuildTrayMenu();
}

function setGhost(on) {
  settings.ghost = on;
  if (!on && ghosted) { ghosted = false; win.setOpacity(settings.opacity); }
  saveSettings(); sendState(); rebuildTrayMenu();
  toast(on ? 'Modo fantasma: se aclara al pasar el mouse' : 'Modo fantasma desactivado');
}

function setOpacity(v) {
  settings.opacity = Math.min(1, Math.max(0.3, Math.round(v * 100) / 100));
  if (win && !ghosted) win.setOpacity(settings.opacity);
  saveSettings(); sendState();
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else win.showInactive();
}

function openFromClipboard() {
  if (!openFromText(clipboard.readText())) {
    if (win) { win.show(); toast('No hay un link de YouTube en el portapapeles'); }
  }
}

function extensionDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, '..', 'extension');
}

async function showExtensionHelp() {
  const dir = extensionDir();
  shell.openPath(dir);
  clipboard.writeText('chrome://extensions');
  await dialog.showMessageBox({
    type: 'info',
    title: 'Extensión de Chrome',
    message: 'Instalar el botón "Abrir en YT Flotante" en Chrome',
    detail:
      '1. En Chrome abre una pestaña y pega (Ctrl+V) chrome://extensions — ya está copiado.\n' +
      '2. Activa "Modo de desarrollador" (arriba a la derecha).\n' +
      '3. Pulsa "Cargar extensión sin empaquetar" y elige la carpeta que se acaba de abrir:\n   ' + dir + '\n\n' +
      'Listo: en un video de YouTube aprieta el botón ▶ de la barra de Chrome o Alt+Y.',
  });
}

// ---------- Actualizaciones ----------
function setupUpdates() {
  if (!autoUpdater || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    toast(`Versión ${info.version} lista: se instala al salir`);
    rebuildTrayMenu(info.version);
  });
  autoUpdater.on('error', (err) => console.warn('Actualización falló:', err && err.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

// ---------- Bandeja ----------
let readyVersion = null;
function rebuildTrayMenu(version) {
  if (version) readyVersion = version;
  if (!tray) return;
  const items = [
    { label: 'Abrir link copiado  (Ctrl+Shift+Y)', click: openFromClipboard },
    { label: 'Mostrar / ocultar  (Ctrl+Shift+H)', click: toggleVisible },
    { type: 'separator' },
    { label: 'Moverse solo al hacer clic  (Ctrl+Shift+M)', type: 'checkbox', checked: settings.autoMove, enabled: !!uIOhook, click: (i) => setAutoMove(i.checked) },
    {
      label: 'Cómo se mueve',
      enabled: !!uIOhook,
      submenu: [
        { label: 'Al otro lado (misma altura)', type: 'radio', checked: settings.mode !== 'esquinas', click: () => setMode('lados') },
        { label: 'A la esquina contraria al clic', type: 'radio', checked: settings.mode === 'esquinas', click: () => setMode('esquinas') },
      ],
    },
    { label: 'Modo fantasma (transparente al pasar el mouse)', type: 'checkbox', checked: settings.ghost, enabled: !!uIOhook, click: (i) => setGhost(i.checked) },
    {
      label: 'Transparencia',
      submenu: [1, 0.85, 0.7, 0.5].map(v => ({
        label: `${Math.round(v * 100)} %`, type: 'radio', checked: settings.opacity === v, click: () => setOpacity(v),
      })),
    },
    {
      label: 'Controles del video',
      submenu: [
        { label: 'Play / pausa  (Ctrl+Shift+Espacio)', click: () => control('toggle') },
        { label: 'Atrás 10 s  (Ctrl+Shift+←)', click: () => control('back') },
        { label: 'Adelante 10 s  (Ctrl+Shift+→)', click: () => control('fwd') },
        { label: 'Subir volumen  (Ctrl+Shift+↑)', click: () => control('volup') },
        { label: 'Bajar volumen  (Ctrl+Shift+↓)', click: () => control('voldown') },
      ],
    },
    { label: 'Volver a la esquina inferior derecha', click: () => { if (win) win.setBounds(defaultBounds()); } },
    { type: 'separator' },
    { label: 'Extensión de Chrome…', click: showExtensionHelp },
    { label: 'Iniciar con Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
  ];
  if (readyVersion) {
    items.push({ label: `Reiniciar para actualizar a ${readyVersion}`, click: () => { app.isQuitting = true; autoUpdater.quitAndInstall(); } });
  } else if (autoUpdater && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) {
    items.push({ label: 'Buscar actualizaciones', click: () => { autoUpdater.checkForUpdates().then(r => { if (!r || !r.isUpdateAvailable) toast('Ya tienes la última versión'); }).catch(() => toast('No se pudo revisar')); } });
  }
  items.push({ label: `Versión ${app.getVersion()}`, enabled: false });
  items.push({ type: 'separator' }, { label: 'Salir', click: () => { app.isQuitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
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
ipcMain.on('toggle-ghost', () => setGhost(!settings.ghost));
ipcMain.on('opacity', (_e, delta) => setOpacity(settings.opacity + delta));
ipcMain.on('paste-open', () => openFromClipboard());

// ---------- Arranque ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Links ytpip://open?url=... (extensión de Chrome y marcador del navegador)
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

  app.whenReady().then(async () => {
    loadSettings();
    await startPlayerServer();
    createWindow();
    createTray();

    const keys = {
      'CommandOrControl+Shift+Y': openFromClipboard,
      'CommandOrControl+Shift+H': toggleVisible,
      'CommandOrControl+Shift+M': () => { if (uIOhook) setAutoMove(!settings.autoMove); },
      'CommandOrControl+Shift+Space': () => control('toggle'),
      'CommandOrControl+Shift+Left': () => control('back'),
      'CommandOrControl+Shift+Right': () => control('fwd'),
      'CommandOrControl+Shift+Up': () => control('volup'),
      'CommandOrControl+Shift+Down': () => control('voldown'),
    };
    for (const [k, fn] of Object.entries(keys)) {
      if (!globalShortcut.register(k, fn)) console.warn('Atajo ocupado por otra app:', k);
    }

    if (uIOhook) {
      uIOhook.on('mousedown', onGlobalMouseDown);
      uIOhook.on('mousemove', onGlobalMouseMove);
      uIOhook.start();
    }

    setupUpdates();

    const info = findInArgs(process.argv);
    if (info) openVideo(info);
  });

  app.on('window-all-closed', (e) => e.preventDefault());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (uIOhook) { try { uIOhook.stop(); } catch { /* nada */ } }
  });
}
