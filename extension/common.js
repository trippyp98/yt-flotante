// Utilidades compartidas por la extensión (página, fondo y administrador de listas).
/* exported YTF */
var YTF = globalThis.YTF || (() => {
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function parseTime(t) {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
  }

  /** Link de YouTube → { id, list, start } (id puede ser null si es solo una lista). */
  function parseYouTube(input) {
    let url;
    try { url = new URL(String(input).trim()); } catch { return null; }
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else {
        const m = /^\/(shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname);
        if (m) id = m[2];
      }
    } else return null;
    const list = url.searchParams.get('list');
    if (id && !ID_RE.test(id)) id = null;
    if (!id && !list) return null;
    return { id, list, start: parseTime(url.searchParams.get('t') || url.searchParams.get('start')) };
  }

  const DEFAULT = { lists: { 'Mi lista': [] }, active: 'Mi lista', shuffle: false, loop: false };

  async function load() {
    const s = await chrome.storage.local.get(['lists', 'active', 'shuffle', 'loop']);
    const data = { ...DEFAULT, ...s };
    if (!data.lists || !Object.keys(data.lists).length) data.lists = { 'Mi lista': [] };
    if (!data.lists[data.active]) data.active = Object.keys(data.lists)[0];
    return data;
  }

  async function save(data) {
    await chrome.storage.local.set({ lists: data.lists, active: data.active, shuffle: !!data.shuffle, loop: !!data.loop });
  }

  async function addToActive(item) {
    const data = await load();
    data.lists[data.active].push({ url: item.url, title: item.title || item.url });
    await save(data);
    return data.active;
  }

  return { VERSION: '2.0.1', parseYouTube, load, save, addToActive };
})();
globalThis.YTF = YTF;
