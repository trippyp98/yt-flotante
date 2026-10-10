// Utilidades para reconocer links de YouTube y armar las URLs del reproductor.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseTime(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

/**
 * Devuelve { id, start, list } o null si el texto no es un link de YouTube.
 * Acepta: youtube.com/watch?v=, youtu.be/, /shorts/, /live/, /embed/,
 * music.youtube.com, m.youtube.com, o directamente un ID de 11 caracteres.
 */
function parseYouTube(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (ID_RE.test(text)) return { id: text, start: 0, list: null };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;

  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = /^\/(shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname);
      if (m) id = m[2];
    }
  } else {
    return null;
  }

  if (!id || !ID_RE.test(id)) return null;
  return {
    id,
    start: parseTime(url.searchParams.get('t') || url.searchParams.get('start')),
    list: url.searchParams.get('list'),
  };
}

function embedUrl({ id, start, list }) {
  const p = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', modestbranding: '1' });
  if (start) p.set('start', String(start));
  if (list) p.set('list', list);
  return `https://www.youtube.com/embed/${id}?${p}`;
}

function watchUrl({ id, start, list }) {
  const p = new URLSearchParams({ v: id });
  if (start) p.set('t', `${start}s`);
  if (list) p.set('list', list);
  return `https://www.youtube.com/watch?${p}`;
}

/** Busca un link de YouTube dentro de una lista de argumentos (o de un link ytpip://). */
function findInArgs(argv) {
  for (const arg of argv || []) {
    if (typeof arg !== 'string') continue;
    if (arg.toLowerCase().startsWith('ytpip://')) {
      try {
        const u = new URL(arg);
        const inner = u.searchParams.get('url');
        const info = parseYouTube(inner);
        if (info) return info;
      } catch { /* ignorar */ }
    }
    const info = /youtu/i.test(arg) ? parseYouTube(arg) : null;
    if (info) return info;
  }
  return null;
}

module.exports = { parseYouTube, embedUrl, watchUrl, findInArgs, parseTime };
