// Trozos de JavaScript que la app ejecuta dentro de la página del video.

// Controles de teclado: funcionan con el reproductor incrustado (YT IFrame API)
// y también con la página normal de YouTube (elemento <video>).
function ytfControl(cmd) {
  const p = window.ytfPlayer;
  if (p && typeof p.getPlayerState === 'function') {
    switch (cmd) {
      case 'toggle':
        if (p.getPlayerState() === 1) { p.pauseVideo(); return 'Pausa'; }
        p.playVideo(); return 'Play';
      case 'back': p.seekTo(Math.max(0, p.getCurrentTime() - 10), true); return '−10 s';
      case 'fwd': p.seekTo(p.getCurrentTime() + 10, true); return '+10 s';
      case 'volup': p.unMute(); p.setVolume(Math.min(100, p.getVolume() + 10)); return `Volumen ${Math.min(100, p.getVolume() + 10)} %`;
      case 'voldown': { const v = Math.max(0, p.getVolume() - 10); p.setVolume(v); return `Volumen ${v} %`; }
      default: return '';
    }
  }
  const v = document.querySelector('video');
  if (!v) return '';
  switch (cmd) {
    case 'toggle': if (v.paused) { v.play(); return 'Play'; } v.pause(); return 'Pausa';
    case 'back': v.currentTime = Math.max(0, v.currentTime - 10); return '−10 s';
    case 'fwd': v.currentTime += 10; return '+10 s';
    case 'volup': v.muted = false; v.volume = Math.min(1, v.volume + 0.1); return `Volumen ${Math.round(v.volume * 100)} %`;
    case 'voldown': v.volume = Math.max(0, v.volume - 0.1); return `Volumen ${Math.round(v.volume * 100)} %`;
    default: return '';
  }
}

const controlScript = (cmd) => `(${ytfControl.toString()})(${JSON.stringify(cmd)})`;

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

module.exports = { controlScript, rejectConsentScript, fillPlayerScript };
