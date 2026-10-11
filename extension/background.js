// YT Flotante — fondo de la extensión.
// - Conecta con la app de Windows (ws://127.0.0.1:47321), que mueve la ventana flotante
//   para que no te tape, la vuelve transparente al pasar el mouse y manda el volumen de la rueda.
// - Menús de clic derecho para agregar videos/páginas a tus listas.
// - Botón de la barra de Chrome = poner a flotar el video de la pestaña.
importScripts('common.js');

const APP_URL = 'ws://127.0.0.1:47321';
let ws = null;
let pip = null;          // { tabId, frameId } con la ventana flotante abierta
let lastHello = 0;

// ---------------------------------------------------------------- conexión con la app
function connect() {
  if (ws && ws.readyState <= 1) return;
  try { ws = new WebSocket(APP_URL); } catch { ws = null; return; }
  ws.onopen = () => { send({ type: 'hello', version: YTF.VERSION }); if (pip) send({ type: 'pip-open' }); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } lastHello = Date.now(); onAppMessage(m); };
  ws.onclose = () => { ws = null; setTimeout(connect, 3000); };
  ws.onerror = () => {};
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

chrome.runtime.onStartup.addListener(connect);
chrome.alarms.create('ytf-connect', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'ytf-connect') connect(); });
connect();

function flashBadge(text, color = '#ff3b30') {
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  chrome.action.setBadgeText({ text: String(text).slice(0, 4) }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), 1500);
}

// Busca un video en "Imagen en imagen" normal (abierto desde el propio reproductor).
async function findNativePip() {
  for (const tab of await chrome.tabs.query({})) {
    if (!tab.id || !/^https?:/.test(tab.url || '')) continue;
    try {
      const frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true }, func: () => !!document.pictureInPictureElement,
      });
      const f = frames.find((x) => x.result);
      if (f) return { tabId: tab.id, frameId: f.frameId };
    } catch { /* sin permiso en esa pestaña */ }
  }
  return null;
}

async function onAppMessage(m) {
  if (m.type !== 'control') return;
  if (!pip) pip = await findNativePip();
  if (!pip) return;
  try {
    const r = await chrome.tabs.sendMessage(pip.tabId, { type: 'control', cmd: m.cmd, step: m.step || 0 }, { frameId: pip.frameId });
    const label = r && r.label;
    if (label) {
      send({ type: 'label', text: label });
      const num = label.match(/\d+(\.\d+)?/);
      flashBadge(num ? num[0] : '•');
    }
  } catch { pip = null; }
}

// ---------------------------------------------------------------- poner a flotar
async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'has-pip' }, { frameId: 0 });
  } catch {
    // la página se abrió antes de instalar/recargar la extensión
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['common.js', 'content.js'] });
  }
}

async function floatTab(tab) {
  if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) { flashBadge('×', '#666'); return; }
  try {
    await ensureContent(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'float' }, { frameId: 0 });
  } catch { flashBadge('×', '#666'); }
}

// Plan B para videos dentro de iframes: Imagen en imagen normal del video más grande.
function measureVideos() {
  let best = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    let a = r.width * r.height;
    if (!a || v.readyState === 0) continue;
    if (!v.paused) a *= 2;
    best = Math.max(best, a);
  }
  return best;
}
async function nativePipBiggest() {
  const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0);
  const score = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height * (v.paused ? 1 : 2); };
  const v = vids.sort((a, b) => score(b) - score(a))[0];
  if (!v) return false;
  v.removeAttribute('disablePictureInPicture');
  try { await v.requestPictureInPicture(); return true; } catch { return false; }
}
async function floatInFrames(tabId) {
  const frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: measureVideos });
  const best = frames.filter((f) => f.result > 0).sort((a, b) => b.result - a.result)[0];
  if (!best) return false;
  const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [best.frameId] }, func: nativePipBiggest });
  if (r && r.result) { pip = { tabId, frameId: best.frameId }; send({ type: 'pip-open' }); return true; }
  return false;
}

chrome.action.onClicked.addListener(floatTab);

// ---------------------------------------------------------------- listas
async function titleFor(url, fallback) {
  if (YTF.parseYouTube(url)) {
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url));
      if (r.ok) { const j = await r.json(); if (j.title) return j.title; }
    } catch { /* sin título */ }
  }
  return fallback || url;
}

async function addItem(url, title, tab) {
  const name = await YTF.addToActive({ url, title: await titleFor(url, title) });
  flashBadge('+', '#2e7d32');
  if (tab && tab.id) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id }, args: [name],
      func: (n) => {
        const d = document.createElement('div');
        d.textContent = `✓ Agregado a "${n}"  ·  Alt+L para reproducir`;
        d.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#141414;color:#eee;' +
          'font:14px Segoe UI,sans-serif;padding:10px 14px;border-radius:10px;border:1px solid #333';
        document.documentElement.appendChild(d);
        setTimeout(() => d.remove(), 2500);
      },
    }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // Poner la versión nueva en las pestañas que ya estaban abiertas (sin tener que recargarlas).
  chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).then((tabs) => {
    for (const t of tabs) {
      chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['common.js', 'content.js'] }).catch(() => {});
    }
  }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ytf-float', title: 'Poner este video a flotar (Alt+Y)', contexts: ['page', 'video'] });
    chrome.contextMenus.create({ id: 'ytf-add-page', title: 'Agregar esta página a mi lista', contexts: ['page', 'video'] });
    chrome.contextMenus.create({ id: 'ytf-add-link', title: 'Agregar este link a mi lista', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'ytf-play', title: 'Reproducir mi lista (Alt+L)', contexts: ['page', 'video', 'link'] });
    chrome.contextMenus.create({ id: 'ytf-manage', title: 'Administrar listas…', contexts: ['page', 'video', 'link', 'action'] });
    chrome.contextMenus.create({
      id: 'ytf-app-link', title: 'Abrir este link en la app YT Flotante', contexts: ['link'],
      targetUrlPatterns: ['*://*.youtube.com/*', '*://youtu.be/*'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'ytf-float': floatTab(tab); break;
    case 'ytf-add-page': addItem(tab.url, tab.title, tab).catch(() => {}); break;
    case 'ytf-add-link': addItem(info.linkUrl, info.selectionText || '', tab).catch(() => {}); break;
    case 'ytf-play':
      await ensureContent(tab.id).catch(() => {});
      chrome.tabs.sendMessage(tab.id, { type: 'start-list' }, { frameId: 0 }).catch(() => {});
      break;
    case 'ytf-manage': chrome.runtime.openOptionsPage(); break;
    case 'ytf-app-link': chrome.tabs.update(tab.id, { url: 'ytpip://open?url=' + encodeURIComponent(info.linkUrl) }); break;
    default: break;
  }
});

// ---------------------------------------------------------------- mensajes de las páginas
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const tabId = sender.tab && sender.tab.id;
  switch (m.type) {
    case 'pip-open':
      pip = { tabId, frameId: sender.frameId };
      connect(); send({ type: 'pip-open' }); flashBadge('▶');
      break;
    case 'pip-closed':
      if (pip && pip.tabId === tabId) { pip = null; send({ type: 'pip-closed' }); }
      break;
    case 'float-in-frames':
      floatInFrames(tabId).then((ok) => reply({ ok })).catch(() => reply({ ok: false }));
      return true;
    case 'start-list-top':
      chrome.tabs.sendMessage(tabId, { type: 'start-list' }, { frameId: 0 }).catch(() => {});
      break;
    case 'open-queue-page':
      chrome.storage.session.set({ ['pending_' + tabId]: m.queue }).then(() => chrome.tabs.update(tabId, { url: m.url })).catch(() => {});
      break;
    case 'get-pending': {
      const key = 'pending_' + tabId;
      chrome.storage.session.get(key).then((r) => { chrome.storage.session.remove(key); reply({ queue: r[key] || null }); }).catch(() => reply({ queue: null }));
      return true;
    }
    case 'yt-main':
      // funciones del reproductor de YouTube de la página (loadVideoById, nextVideo…)
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [sender.frameId] }, world: 'MAIN', args: [m.fn, m.args || []],
        func: (fn, args) => {
          const p = document.getElementById('movie_player');
          if (p && typeof p[fn] === 'function') { p[fn](...args); return true; }
          return false;
        },
      }).then((r) => reply({ ok: !!(r && r[0] && r[0].result) })).catch(() => reply({ ok: false }));
      return true;
    case 'yt-go':
      // navegar dentro de YouTube (sin recargar) a un video o a una playlist
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] }, world: 'MAIN', args: [m.yt],
        func: async (yt) => {
          let vid = yt.id;
          if (!vid && yt.list) {
            const h = await fetch('/playlist?list=' + encodeURIComponent(yt.list)).then((r) => r.text());
            vid = (h.match(/"videoId":"([\w-]{11})"/) || [])[1];
          }
          const app = document.querySelector('ytd-app');
          if (!vid || !app) return false;
          const url = `/watch?v=${vid}` + (yt.list ? `&list=${yt.list}` : '') + (yt.start ? `&t=${yt.start}s` : '');
          const we = { videoId: vid };
          if (yt.list) we.playlistId = yt.list;
          if (yt.start) we.startTimeSeconds = yt.start;
          app.dispatchEvent(new CustomEvent('yt-navigate', {
            bubbles: true, composed: true,
            detail: { endpoint: { commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } }, watchEndpoint: we } },
          }));
          return true;
        },
      }).then((r) => reply({ ok: !!(r && r[0] && r[0].result) })).catch(() => reply({ ok: false }));
      return true;
    case 'status':
      reply({ app: !!(ws && ws.readyState === 1), version: YTF.VERSION, floating: !!pip });
      break;
    default: break;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => { if (pip && pip.tabId === tabId) { pip = null; send({ type: 'pip-closed' }); } });
