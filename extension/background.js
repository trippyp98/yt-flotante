// YT Flotante — extensión de Chrome
//
// Alt+Y (o el botón ▶): pone a flotar el video principal de la pestaña, en CUALQUIER página
// (YouTube, plataformas de clases, Vimeo, etc.), usando el "Imagen en imagen" de Chrome.
// Así el video sigue usando tu sesión (cursos con login funcionan) y la app YT Flotante se
// encarga de moverlo para que no te tape, de volverlo transparente al pasar el mouse y del volumen.
//
// La app y la extensión hablan por ws://127.0.0.1:47321 (solo en tu computador).

const APP_URL = 'ws://127.0.0.1:47321';
let ws = null;
let pipFrame = null;      // { tabId, frameId } donde está el video flotando
let keepAlive = null;

// ---------- Conexión con la app ----------
function connect() {
  if (ws && ws.readyState <= 1) return;
  try { ws = new WebSocket(APP_URL); } catch { ws = null; return; }
  ws.onopen = () => { if (pipFrame) send({ type: 'pip-open' }); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onAppMessage(m); };
  ws.onclose = () => { ws = null; setTimeout(connect, 5000); };
  ws.onerror = () => {};
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// Mientras haya un video flotando se mantiene la conexión viva (y el service worker despierto).
function setFloating(frame) {
  pipFrame = frame;
  clearInterval(keepAlive);
  if (frame) {
    connect();
    keepAlive = setInterval(() => { connect(); send({ type: 'ping' }); }, 20000);
    send({ type: 'pip-open' });
  } else {
    send({ type: 'pip-closed' });
  }
}

// Busca en todas las pestañas el video que está en "Imagen en imagen"
// (por si se abrió desde el propio reproductor y no con Alt+Y).
async function findPipFrame() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !/^https?:/.test(tab.url || '')) continue;
    try {
      const frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true }, func: () => !!document.pictureInPictureElement,
      });
      const f = frames.find((x) => x.result);
      if (f) return { tabId: tab.id, frameId: f.frameId };
    } catch { /* pestaña sin permiso */ }
  }
  return null;
}

async function onAppMessage(m) {
  if (m.type !== 'control') return;
  if (!pipFrame) {
    const found = await findPipFrame();
    if (!found) return;
    pipFrame = found;
  }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: pipFrame.tabId, frameIds: [pipFrame.frameId] },
      func: videoControl, args: [m.cmd, m.step || 0],
    });
    const label = res && res.result;
    if (label) {
      send({ type: 'label', text: label });
      flashBadge(label.match(/\d+(\.\d+)?/) ? label.match(/\d+(\.\d+)?/)[0] : '•');
    }
  } catch { pipFrame = null; }
}

// ---------- Funciones que se ejecutan dentro de la página ----------

// Busca el video más grande de este frame (los que se están reproduciendo cuentan doble).
function measureVideos() {
  let best = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    let a = r.width * r.height;
    if (!a || v.readyState === 0) continue;
    if (!v.paused) a *= 2;
    best = Math.max(best, a);
  }
  return { area: best, inPip: !!document.pictureInPictureElement };
}

async function floatBiggestVideo() {
  const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0);
  const score = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height * (v.paused ? 1 : 2); };
  const v = vids.sort((a, b) => score(b) - score(a))[0];
  if (!v) return 'sin-video';
  v.removeAttribute('disablePictureInPicture');   // algunos sitios lo bloquean
  try {
    await v.requestPictureInPicture();
  } catch (e) {
    return 'error:' + e.message;
  }
  v.addEventListener('leavepictureinpicture', () => {
    chrome.runtime.sendMessage({ type: 'pip-closed' });
  }, { once: true });
  return 'ok';
}

async function exitPip() {
  if (document.pictureInPictureElement) await document.exitPictureInPicture();
  return true;
}

function videoControl(cmd, step) {
  const v = document.pictureInPictureElement ||
    [...document.querySelectorAll('video')].sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  if (!v) return '';
  switch (cmd) {
    case 'toggle': if (v.paused) { v.play(); return 'Play'; } v.pause(); return 'Pausa';
    case 'seek': v.currentTime = Math.max(0, v.currentTime + step); return `${step > 0 ? '+' : '−'}${Math.abs(step)} s`;
    case 'volume': v.muted = false; v.volume = Math.max(0, Math.min(1, v.volume + step)); return `Volumen ${Math.round(v.volume * 100)} %`;
    case 'speed': v.playbackRate = Math.max(0.25, Math.min(4, Math.round((v.playbackRate + step) * 100) / 100)); return `Velocidad ${v.playbackRate}x`;
    default: return '';
  }
}

// Para YouTube: mandar el video a la ventana propia de la app (en el mismo minuto).
function sendToApp(linkUrl) {
  let target = linkUrl;
  if (!target) {
    const v = document.querySelector('video');
    const u = new URL(location.href);
    if (v) { u.searchParams.set('t', Math.floor(v.currentTime) + 's'); v.pause(); }
    target = u.toString();
  }
  location.href = 'ytpip://open?url=' + encodeURIComponent(target);
}

// ---------- Acciones ----------
function flashBadge(text, color = '#ff3b30') {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: String(text).slice(0, 4) });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

async function toggleFloat(tab) {
  if (!tab || !tab.id || /^(chrome|edge|about):/.test(tab.url || '')) return;
  let frames;
  try {
    frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: measureVideos });
  } catch { flashBadge('×', '#666'); return; }

  // Si ya hay un video flotando en esta pestaña, se cierra.
  const floating = frames.find((f) => f.result && f.result.inPip);
  if (floating) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [floating.frameId] }, func: exitPip });
    setFloating(null);
    return;
  }

  const best = frames.filter((f) => f.result && f.result.area > 0).sort((a, b) => b.result.area - a.result.area)[0];
  if (!best) { flashBadge('—', '#666'); return; }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [best.frameId] }, func: floatBiggestVideo,
  });
  if (res && res.result === 'ok') {
    setFloating({ tabId: tab.id, frameId: best.frameId });
    flashBadge('▶');
  } else {
    flashBadge('×', '#666');
    console.warn('No se pudo poner a flotar:', res && res.result);
  }
}

const isYouTube = (url) => /^https?:\/\/([a-z]+\.)?(youtube\.com|youtu\.be)\//i.test(url || '');

chrome.action.onClicked.addListener(toggleFloat);

// Conectarse con la app apenas Chrome parte, y revisar la conexión cada minuto.
// (La app manda un "ping" cada 20 s, lo que mantiene despierta a la extensión.)
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.create('ytf-connect', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'ytf-connect') connect(); });
connect();

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'send-to-app' && tab && isYouTube(tab.url)) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: sendToApp, args: [null] });
  }
});

chrome.runtime.onMessage.addListener((m, sender) => {
  if (m.type === 'pip-closed' && pipFrame && sender.tab && sender.tab.id === pipFrame.tabId) setFloating(null);
});

chrome.tabs.onRemoved.addListener((tabId) => { if (pipFrame && pipFrame.tabId === tabId) setFloating(null); });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'ytf-float', title: 'Poner este video a flotar (Alt+Y)', contexts: ['page', 'video'] });
  chrome.contextMenus.create({
    id: 'ytf-app-page', title: 'Abrir en la app YT Flotante (Alt+Shift+Y)', contexts: ['page', 'video'],
    documentUrlPatterns: ['*://*.youtube.com/*'],
  });
  chrome.contextMenus.create({
    id: 'ytf-app-link', title: 'Abrir link en la app YT Flotante', contexts: ['link'],
    targetUrlPatterns: ['*://*.youtube.com/*', '*://youtu.be/*'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === 'ytf-float') toggleFloat(tab);
  if (info.menuItemId === 'ytf-app-page') chrome.scripting.executeScript({ target: { tabId: tab.id }, func: sendToApp, args: [null] });
  if (info.menuItemId === 'ytf-app-link') chrome.scripting.executeScript({ target: { tabId: tab.id }, func: sendToApp, args: [info.linkUrl] });
});
