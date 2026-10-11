// Control de las ventanas "Imagen en imagen" (Picture-in-Picture) de Chrome/Edge en Windows.
// Usa la API de Windows (user32/kernel32) a través de koffi para: encontrar la ventana,
// leer/mover su posición y cambiar su transparencia. En otros sistemas no hace nada.

const SIGNATURES = {
  EnumWindowsProc: 'int __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)',
  EnumWindows: 'int __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)',
  IsWindow: 'int __stdcall IsWindow(HWND hwnd)',
  IsWindowVisible: 'int __stdcall IsWindowVisible(HWND hwnd)',
  IsIconic: 'int __stdcall IsIconic(HWND hwnd)',
  GetClassNameW: 'int __stdcall GetClassNameW(HWND hwnd, _Out_ uint8_t *buf, int maxCount)',
  GetWindowTextW: 'int __stdcall GetWindowTextW(HWND hwnd, _Out_ uint8_t *buf, int maxCount)',
  GetWindowLongPtrW: 'intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int index)',
  SetWindowLongPtrW: 'intptr_t __stdcall SetWindowLongPtrW(HWND hwnd, int index, intptr_t value)',
  GetWindowRect: 'int __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)',
  SetWindowPos: 'int __stdcall SetWindowPos(HWND hwnd, HWND after, int x, int y, int cx, int cy, uint32_t flags)',
  SetLayeredWindowAttributes: 'int __stdcall SetLayeredWindowAttributes(HWND hwnd, uint32_t key, uint8_t alpha, uint32_t flags)',
  GetWindowThreadProcessId: 'uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *pid)',
  OpenProcess: 'HANDLE __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)',
  QueryFullProcessImageNameW: 'int __stdcall QueryFullProcessImageNameW(HANDLE h, uint32_t flags, _Out_ uint8_t *buf, _Inout_ uint32_t *size)',
  CloseHandle: 'int __stdcall CloseHandle(HANDLE h)',
};

const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x8;
const WS_EX_LAYERED = 0x80000;
const LWA_ALPHA = 0x2;
const SWP_NOSIZE = 0x1;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

const BROWSERS = new Set(['chrome.exe', 'msedge.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'chromium.exe']);
// Títulos conocidos de la ventana "Imagen en imagen" en distintos idiomas.
const PIP_TITLE = /yt flotante|picture.?in.?picture|imagen en imagen|pantalla en pantalla|image dans l.image|bild.im.bild|picture-in-picture/i;

let api = null;

function declareTypes(koffi) {
  koffi.pointer('HANDLE', koffi.opaque());
  koffi.alias('HWND', 'HANDLE');
  koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  koffi.proto(SIGNATURES.EnumWindowsProc);
}

function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    declareTypes(koffi);
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const f = {};
    for (const [name, sig] of Object.entries(SIGNATURES)) {
      if (name === 'EnumWindowsProc') continue;
      const lib = ['OpenProcess', 'QueryFullProcessImageNameW', 'CloseHandle'].includes(name) ? kernel32 : user32;
      f[name] = lib.func(sig);
    }
    api = { koffi, ...f };
  } catch (err) {
    console.warn('Control de Imagen en imagen no disponible:', err && err.message);
    api = false;
  }
  return api;
}

function text(fn, hwnd) {
  const buf = Buffer.alloc(512);
  const n = fn(hwnd, buf, 256);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}

const exeCache = new Map();
function processName(pid) {
  if (exeCache.has(pid)) return exeCache.get(pid);
  let name = '';
  const h = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (h) {
    const buf = Buffer.alloc(1040);
    const size = [520];
    if (api.QueryFullProcessImageNameW(h, 0, buf, size)) {
      name = buf.toString('utf16le', 0, size[0] * 2).split('\\').pop().toLowerCase();
    }
    api.CloseHandle(h);
  }
  if (exeCache.size > 200) exeCache.clear();
  exeCache.set(pid, name);
  return name;
}

function rectOf(hwnd) {
  const r = {};
  if (!api.GetWindowRect(hwnd, r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/** Busca la ventana "Imagen en imagen" del navegador. Devuelve el HWND o null. */
function findPipWindow(excludePid) {
  if (!load()) return null;
  let best = null;
  let bestScore = 0;
  api.EnumWindows((hwnd) => {
    try {
      if (!api.IsWindowVisible(hwnd) || api.IsIconic(hwnd)) return 1;
      const ex = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      if (!(ex & WS_EX_TOPMOST)) return 1;                       // la ventana PiP siempre está encima
      if (text(api.GetClassNameW, hwnd) !== 'Chrome_WidgetWin_1') return 1;
      const title = text(api.GetWindowTextW, hwnd);
      if (!title) return 1;
      const pid = [0];
      api.GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === excludePid) return 1;                       // nuestra propia ventana
      if (!BROWSERS.has(processName(pid[0]))) return 1;
      const r = rectOf(hwnd);
      if (!r || r.width < 120 || r.height < 70) return 1;
      const score = PIP_TITLE.test(title) ? 2 : 1;
      if (score > bestScore) { bestScore = score; best = hwnd; }
    } catch { /* ventana que desapareció a mitad de camino */ }
    return 1;
  }, 0);
  return best;
}

/** Todas las ventanas visibles de navegadores (para diagnóstico y para buscar por posición). */
function listBrowserWindows(excludePid) {
  if (!load()) return [];
  const out = [];
  api.EnumWindows((hwnd) => {
    try {
      if (!api.IsWindowVisible(hwnd) || api.IsIconic(hwnd)) return 1;
      const pid = [0];
      api.GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === excludePid) return 1;
      const exe = processName(pid[0]);
      if (!BROWSERS.has(exe)) return 1;
      const r = rectOf(hwnd);
      if (!r || r.width < 80 || r.height < 50) return 1;
      const ex = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      out.push({ hwnd, exe, rect: r, topmost: !!(ex & WS_EX_TOPMOST),
        cls: text(api.GetClassNameW, hwnd), title: text(api.GetWindowTextW, hwnd) });
    } catch { /* ventana que desapareció */ }
    return 1;
  }, 0);
  return out;
}

/**
 * Busca la ventana del navegador que está en esa posición (la extensión manda dónde abrió
 * su ventana flotante). Es más seguro que adivinar por el título.
 * rect en píxeles físicos {x,y,width,height}.
 */
function findWindowByRect(rect, excludePid, tolerance = 24) {
  let best = null;
  let bestD = Infinity;
  for (const w of listBrowserWindows(excludePid)) {
    const d = Math.abs(w.rect.x - rect.x) + Math.abs(w.rect.y - rect.y) +
      Math.abs(w.rect.width - rect.width) + Math.abs(w.rect.height - rect.height);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best && bestD <= tolerance * 4 ? best.hwnd : null;
}

function isAlive(hwnd) {
  return !!(hwnd && load() && api.IsWindow(hwnd) && api.IsWindowVisible(hwnd));
}

/** Rectángulo en píxeles físicos {x,y,width,height}. */
function getRect(hwnd) {
  if (!load()) return null;
  return rectOf(hwnd);
}

function moveTo(hwnd, x, y) {
  if (!load()) return;
  api.SetWindowPos(hwnd, null, Math.round(x), Math.round(y), 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

/** alpha entre 0 y 1. */
function setOpacity(hwnd, alpha) {
  if (!load()) return;
  const ex = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  if (!(ex & WS_EX_LAYERED)) api.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED);
  api.SetLayeredWindowAttributes(hwnd, 0, Math.max(10, Math.min(255, Math.round(alpha * 255))), LWA_ALPHA);
}

function sameWindow(a, b) {
  if (!a || !b || !load()) return false;
  return api.koffi.address(a) === api.koffi.address(b);
}

module.exports = { findPipWindow, findWindowByRect, listBrowserWindows, isAlive, getRect, moveTo, setOpacity, sameWindow, SIGNATURES, declareTypes, PIP_TITLE };
