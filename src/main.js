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
const pip = require('./pip-win');

let uIOhook = null;
try {
  ({ uIOhook } = require('uiohook-napi'));
} catch (err) {
  console.error('No se pudo cargar uiohook-napi; el movimiento automático queda desactivado.', err);
}

let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); } catch { /* sin puente con la extensión */ }

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* en desarrollo puede faltar */ }

const BAR = 30;          // alto de la barra superior
const MARGIN = 16;       // separación con el borde de la pantalla
const ANIM_MS = 180;     // duración de la animación al moverse
const EXT_PORT = 47321;   // puerto fijo donde la extensión de Chrome se conecta a la app
// Transparencia al pasar el mouse por encima (tres niveles + apagado).
const HOVER_LEVELS = { off: null, suave: 0.7, media: 0.45, fuerte: 0.2 };
const HOVER_NAMES = { off: 'apagada', suave: 'suave (70 %)', media: 'media (45 %)', fuerte: 'fuerte (20 %)' };
const HOVER_ORDER = ['off', 'suave', 'media', 'fuerte'];

// Autoplay sin gesto previo y un user agent de Chrome normal (YouTube trata mejor a Chrome).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}\\/\\S+`), '');

// ---------- Ajustes persistentes ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { autoMove: true, opacity: 1, bounds: null, mode: 'lados', hover: 'media', pipControl: true };
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* primera vez */ }
  if ('ghost' in settings) { if (settings.ghost) settings.hover = 'media'; delete settings.ghost; }
  if (!(settings.hover in HOVER_LEVELS)) settings.hover = 'media';
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* sin drama */ }
}

let win = null;
let view = null;
let tray = null;
let current = null;    // video actual {id,start,list}
let pendingInfo = null;
let pipHwnd = null;        // ventana "Imagen en imagen" de Chrome que estamos controlando
let extSocket = null;      // conexión con la extensión de Chrome
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
  const remember = () => { if (!anim.has('app')) { settings.bounds = win.getBounds(); saveSettings(); } };
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
    hover: settings.hover,
    mode: settings.mode,
    pip: !!pipHwnd,
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

// Controles del video: van a la ventana flotante de Chrome si hay una (vía la extensión),
// si no, al video de la app.
async function control(cmd, step = 0) {
  if (pipHwnd && sendExt({ type: 'control', cmd, step })) return;
  if (!view || !current) return;
  try {
    const msg = await view.webContents.executeJavaScript(controlScript(cmd, step), true);
    toast(msg);
  } catch { /* el video aún no carga */ }
}

// ---------- Puente con la extensión de Chrome ----------
function startExtensionBridge() {
  if (!WebSocketServer) return;
  const wss = new WebSocketServer({ host: '127.0.0.1', port: EXT_PORT });
  wss.on('error', (err) => console.warn('Puente con la extensión no disponible:', err.message));
  wss.on('connection', (sock, req) => {
    // Solo se aceptan conexiones de extensiones del navegador, no de páginas web.
    if (!/^(chrome|moz)-extension:\/\//.test(req.headers.origin || '')) { sock.close(); return; }
    extSocket = sock;
    sock.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'pip-open') watchForPip(3000);
      else if (msg.type === 'pip-closed') forgetPip();
      else if (msg.type === 'label') toast(msg.text);
    });
    sock.on('close', () => { if (extSocket === sock) extSocket = null; });
  });
}

function sendExt(obj) {
  if (!extSocket || extSocket.readyState !== 1) return false;
  extSocket.send(JSON.stringify(obj));
  return true;
}

// ---------- Ventanas que se controlan (la de la app y la "Imagen en imagen" de Chrome) ----------
const dipRect = (r) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r);
const physRect = (r) => (process.platform === 'win32' ? screen.dipToScreenRect(null, r) : r);

const targets = {
  app: {
    alive: () => !!(win && !win.isDestroyed() && win.isVisible()),
    bounds: () => win.getBounds(),
    move: (x, y, w, h) => win.setBounds({ x, y, width: w, height: h }),
    alpha: (a) => win.setOpacity(a),
    base: () => settings.opacity,
    done: () => { settings.bounds = win.getBounds(); saveSettings(); },
  },
  pip: {
    alive: () => !!(settings.pipControl && pipHwnd && pip.isAlive(pipHwnd)),
    bounds: () => { const r = pip.getRect(pipHwnd); return r ? dipRect(r) : { x: 0, y: 0, width: 0, height: 0 }; },
    move: (x, y, w, h) => { const r = physRect({ x, y, width: w, height: h }); pip.moveTo(pipHwnd, r.x, r.y); },
    alpha: (a) => pip.setOpacity(pipHwnd, a),
    base: () => 1,
    done: () => {},
  },
};

function forgetPip() {
  if (!pipHwnd) return;
  pipHwnd = null;
  hovered.delete('pip');
  sendState();
}

function scanPip() {
  if (!settings.pipControl) { if (pipHwnd) forgetPip(); return; }
  if (pipHwnd && pip.isAlive(pipHwnd)) return;
  if (pipHwnd) forgetPip();
  const h = pip.findPipWindow(process.pid);
  if (h) {
    pipHwnd = h;
    hovered.delete('pip');
    sendState();
    toast('Video flotante de Chrome detectado');
  }
}

// Tras un aviso de la extensión, revisa seguido unos segundos (la ventana tarda un poco en aparecer).
function watchForPip(ms) {
  const until = Date.now() + ms;
  const t = setInterval(() => { scanPip(); if (pipHwnd || Date.now() > until) clearInterval(t); }, 150);
}

// ---------- Esquivar el clic ----------
const anim = new Map();   // animaciones en curso por ventana

function animateTo(name, target) {
  const t = targets[name];
  if (anim.has(name)) clearInterval(anim.get(name));
  const start = t.bounds();
  const t0 = Date.now();
  anim.set(name, setInterval(() => {
    if (!t.alive()) { clearInterval(anim.get(name)); anim.delete(name); return; }
    const k = Math.min(1, (Date.now() - t0) / ANIM_MS);
    const e = 1 - Math.pow(1 - k, 3); // ease-out
    t.move(
      Math.round(start.x + (target.x - start.x) * e),
      Math.round(start.y + (target.y - start.y) * e),
      start.width, start.height,
    );
    if (k >= 1) { clearInterval(anim.get(name)); anim.delete(name); t.done(); }
  }, 15));
}

// En Windows el hook entrega píxeles físicos; se convierten a píxeles lógicos (escala de pantalla).
function toDip(e) {
  const p = { x: e.x, y: e.y };
  return process.platform === 'win32' ? screen.screenToDipPoint(p) : p;
}

function aliveTargets() {
  return Object.keys(targets).filter((n) => { try { return targets[n].alive(); } catch { return false; } });
}

function onGlobalMouseDown(e) {
  if (!settings.autoMove) return;
  const p = toDip(e);
  const names = aliveTargets();
  const rects = Object.fromEntries(names.map((n) => [n, targets[n].bounds()]));
  // Un clic sobre cualquiera de los videos no mueve nada (lo estás usando o arrastrando).
  if (names.some((n) => inside(p, rects[n]))) return;
  const clickDisplay = screen.getDisplayNearestPoint(p);
  for (const n of names) {
    if (anim.has(n)) continue;
    const sameDisplay = screen.getDisplayMatching(rects[n]).id === clickDisplay.id;
    const target = dodgeTarget(p, rects[n], clickDisplay.workArea, sameDisplay, MARGIN, settings.mode);
    if (target) animateTo(n, target);
  }
}

// Al pasar el mouse por encima, el video se vuelve transparente según el nivel elegido.
const hovered = new Set();
let lastMove = 0;
function onGlobalMouseMove(e) {
  const now = Date.now();
  if (now - lastMove < 50) return;
  lastMove = now;
  const level = HOVER_LEVELS[settings.hover];
  const p = toDip(e);
  for (const n of aliveTargets()) {
    const t = targets[n];
    const over = level !== null && inside(p, t.bounds());
    if (over !== hovered.has(n)) {
      if (over) hovered.add(n); else hovered.delete(n);
      t.alpha(over ? Math.min(level, t.base()) : t.base());
    }
  }
}

// Rueda del mouse sobre un video = volumen.
let lastWheel = 0;
function onGlobalWheel(e) {
  if (e.direction !== undefined && e.direction !== 3) return;  // solo rueda vertical
  const now = Date.now();
  if (now - lastWheel < 60) return;
  lastWheel = now;
  const step = e.rotation < 0 ? 0.05 : -0.05;                  // hacia arriba = más volumen
  const p = toDip(e);
  if (targets.pip.alive() && inside(p, targets.pip.bounds())) {
    sendExt({ type: 'control', cmd: 'volume', step });
  } else if (targets.app.alive() && current && inside(p, targets.app.bounds()) && view) {
    view.webContents.executeJavaScript(controlScript('volume', step), true).then(toast).catch(() => {});
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

function setHover(level) {
  settings.hover = level;
  // devolver la opacidad normal a lo que esté transparente ahora
  for (const n of [...hovered]) { try { targets[n].alpha(targets[n].base()); } catch { /* ya no existe */ } }
  hovered.clear();
  saveSettings(); sendState(); rebuildTrayMenu();
  toast(`Al pasar el mouse: ${HOVER_NAMES[level]}`);
}

function cycleHover() {
  const i = HOVER_ORDER.indexOf(settings.hover);
  setHover(HOVER_ORDER[(i + 1) % HOVER_ORDER.length]);
}

function setPipControl(on) {
  settings.pipControl = on;
  if (!on) forgetPip(); else scanPip();
  saveSettings(); sendState(); rebuildTrayMenu();
}

function setOpacity(v) {
  settings.opacity = Math.min(1, Math.max(0.3, Math.round(v * 100) / 100));
  if (win && !hovered.has('app')) win.setOpacity(settings.opacity);
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
    message: 'Instalar la extensión YT Flotante en Chrome',
    detail:
      '1. En Chrome abre una pestaña y pega (Ctrl+V) chrome://extensions — ya está copiado.\n' +
      '2. Activa "Modo de desarrollador" (arriba a la derecha).\n' +
      '3. Pulsa "Cargar extensión sin empaquetar" y elige la carpeta que se acaba de abrir:\n   ' + dir + '\n\n' +
      'Si ya la tenías, aprieta ↻ (recargar) en su tarjeta.\n\n' +
      'Listo: en cualquier página con un video presiona Alt+Y para ponerlo a flotar.',
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
    {
      label: 'Transparencia al pasar el mouse  (Ctrl+Shift+T)',
      enabled: !!uIOhook,
      submenu: HOVER_ORDER.map((k) => ({
        label: k === 'off' ? 'Apagada' : HOVER_NAMES[k][0].toUpperCase() + HOVER_NAMES[k].slice(1),
        type: 'radio', checked: settings.hover === k, click: () => setHover(k),
      })),
    },
    {
      label: 'Videos flotantes de Chrome (Imagen en imagen)',
      type: 'checkbox', checked: settings.pipControl, enabled: !!uIOhook && process.platform === 'win32',
      click: (i) => setPipControl(i.checked),
    },
    {
      label: 'Transparencia fija de la app',
      submenu: [1, 0.85, 0.7, 0.5].map(v => ({
        label: `${Math.round(v * 100)} %`, type: 'radio', checked: settings.opacity === v, click: () => setOpacity(v),
      })),
    },
    {
      label: 'Controles del video',
      submenu: [
        { label: 'Play / pausa  (Ctrl+Shift+Espacio)', click: () => control('toggle') },
        { label: 'Atrás 10 s  (Ctrl+Shift+←)', click: () => control('seek', -10) },
        { label: 'Adelante 10 s  (Ctrl+Shift+→)', click: () => control('seek', 10) },
        { label: 'Subir volumen  (Ctrl+Shift+↑ o rueda del mouse)', click: () => control('volume', 0.1) },
        { label: 'Bajar volumen  (Ctrl+Shift+↓ o rueda del mouse)', click: () => control('volume', -0.1) },
        { label: 'Más rápido  (Ctrl+Shift+RePág)', click: () => control('speed', 0.25) },
        { label: 'Más lento  (Ctrl+Shift+AvPág)', click: () => control('speed', -0.25) },
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
ipcMain.on('cycle-hover', () => cycleHover());
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
      'CommandOrControl+Shift+Left': () => control('seek', -10),
      'CommandOrControl+Shift+Right': () => control('seek', 10),
      'CommandOrControl+Shift+Up': () => control('volume', 0.1),
      'CommandOrControl+Shift+Down': () => control('volume', -0.1),
      'CommandOrControl+Shift+PageUp': () => control('speed', 0.25),
      'CommandOrControl+Shift+PageDown': () => control('speed', -0.25),
      'CommandOrControl+Shift+T': cycleHover,
    };
    for (const [k, fn] of Object.entries(keys)) {
      if (!globalShortcut.register(k, fn)) console.warn('Atajo ocupado por otra app:', k);
    }

    if (uIOhook) {
      uIOhook.on('mousedown', onGlobalMouseDown);
      uIOhook.on('mousemove', onGlobalMouseMove);
      uIOhook.on('wheel', onGlobalWheel);
      uIOhook.start();
    }

    startExtensionBridge();
    setInterval(scanPip, 800);   // detecta videos en "Imagen en imagen" aunque no se usen con la extensión

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
