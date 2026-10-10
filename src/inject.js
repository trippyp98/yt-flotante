// Trozos de JavaScript que la app ejecuta dentro de la página del video.

// Controles: funcionan con el reproductor incrustado (YT IFrame API), con la página normal
// de YouTube y con cualquier <video> (la extensión usa la misma función en otras páginas).
function ytfControl(cmd, step) {
  const pct = (x) => `${Math.round(x)} %`;
  const p = window.ytfPlayer;
  if (p && typeof p.getPlayerState === 'function') {
    switch (cmd) {
      case 'toggle':
        if (p.getPlayerState() === 1) { p.pauseVideo(); return 'Pausa'; }
        p.playVideo(); return 'Play';
      case 'seek': p.seekTo(Math.max(0, p.getCurrentTime() + step), true); return `${step > 0 ? '+' : '−'}${Math.abs(step)} s`;
      case 'volume': { const v = Math.max(0, Math.min(100, p.getVolume() + step * 100)); p.unMute(); p.setVolume(v); return `Volumen ${pct(v)}`; }
      case 'speed': {
        const rates = p.getAvailablePlaybackRates ? p.getAvailablePlaybackRates() : [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
        const r = Math.max(rates[0], Math.min(rates[rates.length - 1], Math.round((p.getPlaybackRate() + step) * 100) / 100));
        p.setPlaybackRate(r); return `Velocidad ${r}x`;
      }
      default: return '';
    }
  }
  const v = document.pictureInPictureElement ||
    [...document.querySelectorAll('video')].sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  if (!v) return '';
  switch (cmd) {
    case 'toggle': if (v.paused) { v.play(); return 'Play'; } v.pause(); return 'Pausa';
    case 'seek': v.currentTime = Math.max(0, v.currentTime + step); return `${step > 0 ? '+' : '−'}${Math.abs(step)} s`;
    case 'volume': v.muted = false; v.volume = Math.max(0, Math.min(1, v.volume + step)); return `Volumen ${pct(v.volume * 100)}`;
    case 'speed': v.playbackRate = Math.max(0.25, Math.min(4, Math.round((v.playbackRate + step) * 100) / 100)); return `Velocidad ${v.playbackRate}x`;
    default: return '';
  }
}

const controlScript = (cmd, step = 0) => `(${ytfControl.toString()})(${JSON.stringify(cmd)}, ${Number(step)})`;

// Rechaza solo el aviso de cookies de YouTube/Google (la opción más privada).
const rejectConsentScript = `(() => {
  const re = /^(rechazar todo|rechazar|reject all|reject)$/i;
  let n = 0;
  const t = setInterval(() => {
    n++;
    const b = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .find(el => re.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
    if (b) { b.click(); clearInterval(t); }
    if (n > 40) clearInterval(t);
  }, 250);
})()`;

// En la página normal de YouTube: pone el reproductor a llenar la ventana.
const fillPlayerScript = `(async () => {
  for (let i = 0; i < 80; i++) {
    const p = document.querySelector('#movie_player');
    const v = document.querySelector('video');
    if (p && v) {
      if (!document.fullscreenElement) { try { await p.requestFullscreen(); } catch (e) {} }
      try { await v.play(); } catch (e) {}
      return true;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
})()`;

module.exports = { ytfControl, controlScript, rejectConsentScript, fillPlayerScript };
