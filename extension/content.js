// YT Flotante — se ejecuta dentro de cada página (y de cada iframe).
//
// Alt+Y        → pone a flotar el video de la página en una ventana propia que siempre queda encima
//                (Document Picture-in-Picture), con barra de controles y lista.
// Alt+L        → reproduce tu lista activa (música, clases…) en la ventana flotante.
// Alt+Shift+Y  → (en YouTube) manda el video a la app YT Flotante.
//
// La tecla se escucha aquí mismo, en la página: así funciona aunque Chrome no le haya
// asignado el atajo a la extensión, y cuenta como "gesto del usuario" (Chrome lo exige
// para abrir ventanas flotantes).

(() => {
  // Si la extensión se actualiza, la copia vieja que quedó en las pestañas abiertas se retira
  // sola para que no choque con la nueva (antes había que recargar cada pestaña con F5).
  let retired = false;
  const alive = () => { if (retired) return false; try { return !!chrome.runtime.id; } catch { retired = true; return false; } };
  const prev = window.__ytfInstance;
  if (prev && prev.alive()) return;          // ya hay una copia funcionando en esta página
  if (prev) prev.retire();
  window.__ytfInstance = { alive, retire: () => { retired = true; } };
  document.dispatchEvent(new Event('ytf-retire'));
  document.addEventListener('ytf-retire', () => { retired = true; });

  const TOP = window === window.top;
  const BAR_H = 36;
  if (TOP && document.documentElement) document.documentElement.dataset.ytFlotante = YTF.VERSION;   // para diagnóstico

  let session = null;        // ventana flotante abierta desde esta página
  let pendingQueue = null;   // si esta pestaña es "la siguiente clase" de una lista

  // ---------------------------------------------------------------- utilidades
  const isYouTubePage = () => /(^|\.)youtube\.com$/.test(location.hostname) && !!YTF.parseYouTube(location.href);

  function biggestVideo(doc = document) {
    const score = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height * (v.paused ? 1 : 2); };
    return [...doc.querySelectorAll('video')]
      .filter((v) => v.readyState > 0 || v.currentSrc)
      .sort((a, b) => score(b) - score(a))[0] || null;
  }

  function send(msg) {
    // .catch evita errores en la consola cuando la extensión se recarga o no hay quien responda
    try { return chrome.runtime.sendMessage(msg).catch(() => undefined); } catch { return Promise.resolve(); }
  }

  // Aviso / botón que aparece en la página (por ejemplo "▶ Flotar esta clase").
  function pageBubble(text, buttonText, onClick, ms = 0) {
    const old = document.getElementById('ytf-bubble');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = 'ytf-bubble';
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .b{font:14px "Segoe UI",system-ui,sans-serif;background:#141414;color:#eee;border:1px solid #333;border-radius:12px;
         padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.4);display:flex;gap:10px;align-items:center;max-width:360px}
      button{font:inherit;font-weight:600;background:#ff3b30;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}
      .x{background:transparent;color:#999;padding:4px 6px}</style>
      <div class="b"><span></span>${buttonText ? '<button class="go"></button>' : ''}<button class="x">✕</button></div>`;
    root.querySelector('span').textContent = text;
    if (buttonText) {
      const go = root.querySelector('.go');
      go.textContent = buttonText;
      go.onclick = () => { host.remove(); onClick(); };
    }
    root.querySelector('.x').onclick = () => host.remove();
    (document.body || document.documentElement).appendChild(host);
    if (ms) setTimeout(() => host.remove(), ms);
  }

  // ---------------------------------------------------------------- reproductores
  // Reproductor sobre un <video> de la página.
  function videoPlayer(v) {
    return {
      kind: 'video',
      toggle: () => { if (v.paused) { v.play(); return 'Play'; } v.pause(); return 'Pausa'; },
      seek: (d) => { v.currentTime = Math.max(0, v.currentTime + d); return `${d > 0 ? '+' : '−'}${Math.abs(d)} s`; },
      volume: (d) => { v.muted = false; v.volume = Math.max(0, Math.min(1, v.volume + d)); return `Volumen ${Math.round(v.volume * 100)} %`; },
      setVolume: (x) => { v.muted = false; v.volume = x; },
      getVolume: () => v.volume,
      speed: (d) => { v.playbackRate = Math.max(0.25, Math.min(4, Math.round((v.playbackRate + d) * 100) / 100)); return `Velocidad ${v.playbackRate}x`; },
      getSpeed: () => v.playbackRate,
      onEnded: (fn) => v.addEventListener('ended', fn),
      title: () => document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, ''),
    };
  }

  // En YouTube se usa el reproductor de la propia página, sin incrustar (así no aparece el
  // "Error de configuración del reproductor" y sigues con tu sesión y tus preferencias).
  // Sus funciones (cargar otro video, siguiente, anterior) viven en la página, así que se
  // llaman a través del fondo de la extensión.
  const onYouTube = () => /(^|\.)youtube\.com$/.test(location.hostname);
  const ytMain = (fn, args = []) => send({ type: 'yt-main', fn, args });
  // Cambia de video (o a una playlist) navegando DENTRO de YouTube, como si hicieras clic en un
  // video: el reproductor sigue siendo el mismo, así que continúa en la ventana flotante.
  const ytLoad = (yt) => send({ type: 'yt-go', yt });

  // ---------------------------------------------------------------- ventana flotante
  const CSS = `
    *{box-sizing:border-box} html,body{margin:0;height:100%;background:#000;color:#eee;overflow:hidden;
      font:12px/1.3 "Segoe UI",system-ui,sans-serif;user-select:none}
    #stage{position:absolute;inset:0 0 ${BAR_H}px 0;background:#000}
    #stage video,#stage iframe{width:100%;height:100%;border:0;object-fit:contain;background:#000;display:block}
    #bar{position:absolute;left:0;right:0;bottom:0;height:${BAR_H}px;display:flex;align-items:center;gap:2px;
      padding:0 6px;background:#141414;border-top:1px solid #222}
    button{background:transparent;color:#eee;border:0;border-radius:6px;height:26px;min-width:26px;padding:0 5px;
      font:inherit;font-size:13px;cursor:pointer} button:hover{background:#2a2a2a} button.on{color:#ff6b61}
    #title{flex:1;min-width:30px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#9a9a9a;padding:0 6px}
    input[type=range]{width:70px;accent-color:#ff3b30}
    #list{position:absolute;inset:0 0 ${BAR_H}px 0;background:rgba(10,10,10,.96);overflow:auto;display:none;padding:6px}
    #list.show{display:block} .it{display:flex;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;align-items:center}
    .it:hover{background:#222} .it.cur{background:#3a1210;color:#ffb3ae} .n{color:#777;width:20px;text-align:right}
    .t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    #note{position:absolute;left:50%;top:10px;transform:translateX(-50%);background:rgba(20,20,20,.92);padding:6px 10px;
      border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap}
    #note.show{opacity:1}
    #next{position:absolute;inset:0 0 ${BAR_H}px 0;display:none;align-items:center;justify-content:center;flex-direction:column;
      gap:10px;background:rgba(0,0,0,.85);text-align:center;padding:12px}
    #next.show{display:flex} #next b{color:#fff} .big{background:#ff3b30;color:#fff;font-weight:600;padding:6px 14px;height:auto}`;

  function buildWindow(pipWin) {
    const d = pipWin.document;
    d.title = 'YT Flotante';
    const style = d.createElement('style'); style.textContent = CSS; d.head.appendChild(style);
    d.body.innerHTML = `
      <div id="stage"></div>
      <div id="list"></div>
      <div id="next"><div>Siguiente:</div><b id="nextTitle"></b><div id="nextCount"></div>
        <div><button class="big" id="nextGo">Abrir ahora</button> <button id="nextCancel">Cancelar</button></div></div>
      <div id="note"></div>
      <div id="bar">
        <button id="prev" title="Anterior">⏮</button>
        <button id="back" title="Atrás 10 s">⟲</button>
        <button id="play" title="Play / pausa">⏯</button>
        <button id="fwd" title="Adelante 10 s">⟳</button>
        <button id="nextBtn" title="Siguiente">⏭</button>
        <span id="title"></span>
        <button id="spd" title="Velocidad">1x</button>
        <input id="vol" type="range" min="0" max="100" title="Volumen">
        <button id="listBtn" title="Lista">☰</button>
      </div>`;
    return (id) => d.getElementById(id);
  }

  function note($, text) {
    const n = $('note'); n.textContent = text; n.classList.add('show');
    clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('show'), 1600);
  }

  async function openWindow() {
    if (!('documentPictureInPicture' in window)) return null;
    const pipWin = await window.documentPictureInPicture.requestWindow({ width: 480, height: 270 + BAR_H });
    return pipWin;
  }

  // Abre la ventana flotante. source = { video } | { yt } ; queue = { items, index, name } opcional
  async function startSession(source, queue = null) {
    if (session) closeSession();
    let pipWin;
    try { pipWin = await openWindow(); } catch (e) { pipWin = null; }
    if (!pipWin) return false;

    const $ = buildWindow(pipWin);
    session = { pipWin, $, queue, player: null, video: null, placeholder: null, iframe: null };

    pipWin.addEventListener('pagehide', () => {
      if (session) { clearInterval(session.timer); clearInterval(session.countdown); }
      restoreVideo(); session = null; send({ type: 'pip-closed' });
    });

    // controles
    const p = () => session && session.player;
    $('play').onclick = () => p() && note($, p().toggle());
    $('back').onclick = () => p() && note($, p().seek(-10));
    $('fwd').onclick = () => p() && note($, p().seek(10));
    $('vol').oninput = (e) => p() && p().setVolume(e.target.value / 100);
    $('spd').onclick = () => {
      if (!p()) return;
      const r = p().getSpeed() >= 2 ? 1 : p().getSpeed() + 0.25;
      p().speed(r - p().getSpeed());
      $('spd').textContent = `${r}x`;
    };
    $('prev').onclick = () => step(-1);
    $('nextBtn').onclick = () => step(1);
    $('listBtn').onclick = () => { renderList(); $('list').classList.toggle('show'); };
    $('nextCancel').onclick = () => { clearInterval(session.countdown); $('next').classList.remove('show'); };
    pipWin.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
      if (e.code === 'ArrowLeft') $('back').click();
      if (e.code === 'ArrowRight') $('fwd').click();
      if (e.code === 'ArrowUp' && p()) { note($, p().volume(0.05)); syncBar(); }
      if (e.code === 'ArrowDown' && p()) { note($, p().volume(-0.05)); syncBar(); }
    });

    attachVideo(source.video);
    syncBar();
    session.timer = setInterval(syncBar, 1000);
    send({ type: 'pip-open' });
    return true;
  }

  function syncBar() {
    if (!session || !session.player) return;
    const { $, player, queue } = session;
    $('title').textContent = player.title();
    const vol = $('vol');
    if (session.pipWin.document.activeElement !== vol) vol.value = Math.round(player.getVolume() * 100);
    $('spd').textContent = `${player.getSpeed()}x`;
    const hasList = !!queue || onYouTube();
    $('prev').style.display = $('nextBtn').style.display = hasList ? '' : 'none';
    $('listBtn').style.display = queue ? '' : 'none';
  }

  function attachVideo(v) {
    const { $ } = session;
    const ph = document.createElement('div');
    const r = v.getBoundingClientRect();
    ph.style.cssText = `width:${r.width}px;height:${r.height}px;background:#000;display:flex;align-items:center;justify-content:center;color:#888;font:14px sans-serif`;
    ph.textContent = 'Reproduciendo en YT Flotante';
    v.parentNode.insertBefore(ph, v);
    $('stage').appendChild(v);
    session.video = v; session.placeholder = ph;
    session.player = videoPlayer(v);
    session.player.onEnded(() => onItemEnded());
    if (v.paused) v.play().catch(() => {});
  }

  function restoreVideo() {
    if (session && session.video && session.placeholder && session.placeholder.isConnected) {
      session.placeholder.replaceWith(session.video);
    }
  }

  function closeSession() {
    if (!session) return;
    const w = session.pipWin;
    restoreVideo();
    session = null;
    try { w.close(); } catch { /* ya cerrada */ }
  }

  // ---------------------------------------------------------------- listas
  function renderList() {
    const { $, queue } = session;
    const box = $('list');
    box.innerHTML = '';
    if (!queue) return;
    const h = session.pipWin.document.createElement('div');
    h.style.cssText = 'padding:4px 8px 8px;color:#9a9a9a';
    h.textContent = `Lista: ${queue.name} (${queue.items.length})`;
    box.appendChild(h);
    queue.items.forEach((it, i) => {
      const row = session.pipWin.document.createElement('div');
      row.className = 'it' + (i === queue.index ? ' cur' : '');
      row.innerHTML = '<span class="n"></span><span class="t"></span>';
      row.querySelector('.n').textContent = i + 1;
      row.querySelector('.t').textContent = it.title || it.url;
      row.onclick = () => { box.classList.remove('show'); playIndex(i); };
      box.appendChild(row);
    });
  }

  function step(dir) {
    if (!session) return;
    const { queue } = session;
    if (!queue) { if (onYouTube()) ytMain(dir > 0 ? 'nextVideo' : 'previousVideo'); return; }
    // dentro de una lista de YouTube (playlist) primero se avanza dentro de ella
    const it = queue.items[queue.index];
    const yt = it && YTF.parseYouTube(it.url);
    if (yt && yt.list && onYouTube()) { ytMain(dir > 0 ? 'nextVideo' : 'previousVideo'); return; }
    playIndex(queue.index + dir);
  }

  function onItemEnded() {
    if (!session || !session.queue) return;
    const q = session.queue;
    const yt = q.items[q.index] && YTF.parseYouTube(q.items[q.index].url);
    if (yt && yt.list && onYouTube()) {
      // una playlist de YouTube sigue sola; solo se pasa al siguiente de tu lista cuando termina
      const v = session.video;
      setTimeout(() => { if (session && v && v.ended) playIndex(q.index + 1, true); }, 4000);
      return;
    }
    playIndex(q.index + 1, true);
  }

  // Reproduce el elemento i de la lista dentro de la ventana flotante.
  function playIndex(i, auto = false) {
    const { queue, $ } = session;
    const n = queue.items.length;
    if (!n) return;
    if (i >= n) { if (!queue.loop) { note($, 'Fin de la lista'); return; } i = 0; }
    if (i < 0) i = queue.loop ? n - 1 : 0;
    queue.index = i;
    send({ type: 'queue-pos', queue: { name: queue.name, items: queue.items, index: i, loop: queue.loop } });
    const it = queue.items[i];
    const yt = YTF.parseYouTube(it.url);
    if (yt && onYouTube() && session.video) { $('next').classList.remove('show'); ytLoad(yt); syncBar(); return; }

    // Página normal (una clase) o un YouTube estando en otra página: se abre en esta pestaña.
    $('nextTitle').textContent = it.title || it.url;
    $('next').classList.add('show');
    const go = () => {
      clearInterval(session.countdown);
      send({ type: 'open-queue-page', url: it.url, queue: { name: queue.name, items: queue.items, index: i, loop: queue.loop } });
    };
    $('nextGo').onclick = go;
    if (auto) {
      let s = 8;
      $('nextCount').textContent = `Se abre en ${s} s`;
      session.countdown = setInterval(() => { s -= 1; $('nextCount').textContent = `Se abre en ${s} s`; if (s <= 0) go(); }, 1000);
    } else { $('nextCount').textContent = ''; }
  }

  async function startList() {
    const data = await YTF.load();
    let items = [...(data.lists[data.active] || [])];
    if (!items.length) { pageBubble(`Tu lista "${data.active}" está vacía. Agrega videos con clic derecho → YT Flotante.`, '', null, 5000); return; }
    if (data.shuffle) items = items.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const queue = { name: data.active, items, index: 0, loop: data.loop };
    const yt = YTF.parseYouTube(items[0].url);
    const v = biggestVideo();
    if (yt && onYouTube() && v) {
      // ya estamos en YouTube: se pone a flotar este reproductor y se carga el primero de la lista
      if (!(await startSession({ video: v }, queue))) { failBubble(); return; }
      ytLoad(yt);
      send({ type: 'queue-pos', queue });
    } else {
      // se abre el primero en esta pestaña y ahí se ofrece flotar (Chrome pide un clic o Alt+Y)
      send({ type: 'open-queue-page', url: items[0].url, queue });
    }
  }

  // ---------------------------------------------------------------- acciones
  function failBubble() {
    pageBubble('Chrome necesita un clic para abrir la ventana flotante.', '▶ Flotar video', () => floatHere());
  }

  async function floatHere(queue = null) {
    if (session) { closeSession(); return true; }
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return true; }

    const v = biggestVideo();
    if (v) {
      if (TOP && 'documentPictureInPicture' in window && (await startSession({ video: v }, queue))) return true;
      // en iframes (reproductores de cursos) se usa el Imagen en imagen normal del video
      try {
        v.removeAttribute('disablePictureInPicture');
        await v.requestPictureInPicture();
        v.addEventListener('leavepictureinpicture', () => send({ type: 'pip-closed' }), { once: true });
        send({ type: 'pip-open' });
        return true;
      } catch { return false; }
    }
    if (TOP) {
      // El video puede estar dentro de un iframe: le pedimos al fondo que lo busque ahí.
      const r = await send({ type: 'float-in-frames' });
      if (r && r.ok) return true;
      pageBubble('No encontré un video en esta página. Dale play primero y vuelve a intentar.', '', null, 4000);
    }
    return false;
  }

  function sendToApp() {
    const v = biggestVideo();
    const u = new URL(location.href);
    if (v) { u.searchParams.set('t', Math.floor(v.currentTime) + 's'); v.pause(); }
    location.href = 'ytpip://open?url=' + encodeURIComponent(u.toString());
  }

  // Teclas (se escuchan antes que la página, en fase de captura)
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || !alive()) return;
    if (e.code === 'KeyY' && e.shiftKey) {
      if (TOP && isYouTubePage()) { e.preventDefault(); e.stopPropagation(); sendToApp(); }
      return;
    }
    if (e.code === 'KeyY') {
      e.preventDefault(); e.stopPropagation();
      floatHere(pendingQueue).then((ok) => { if (!ok && biggestVideo()) failBubble(); });
    } else if (e.code === 'KeyL') {
      e.preventDefault(); e.stopPropagation();
      if (TOP) startList(); else send({ type: 'start-list-top' });
    }
  }, true);

  // Mensajes desde el fondo (botón de la barra, menú contextual, controles que manda la app)
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (retired) return false;
    if (m.type === 'float') {
      floatHere(pendingQueue).then((ok) => { if (!ok && TOP) failBubble(); reply({ ok }); });
      return true;
    }
    if (m.type === 'start-list' && TOP) { startList(); return false; }
    if (m.type === 'send-to-app' && TOP) { sendToApp(); return false; }
    if (m.type === 'control') {
      let p = session && session.player;
      if (!p && document.pictureInPictureElement) p = videoPlayer(document.pictureInPictureElement);
      if (!p) { reply({ label: '' }); return false; }
      const fn = { toggle: () => p.toggle(), seek: () => p.seek(m.step), volume: () => p.volume(m.step), speed: () => p.speed(m.step) }[m.cmd];
      const label = fn ? fn() : '';
      if (session) { note(session.$, label); syncBar(); }
      reply({ label });
      return false;
    }
    if (m.type === 'has-pip') { reply({ yes: !!session || !!document.pictureInPictureElement }); return false; }
    return false;
  });

  // ¿Esta pestaña viene de una lista? (la clase siguiente): ofrecer flotar con un clic.
  if (TOP) {
    send({ type: 'get-pending' }).then((r) => {
      if (!r || !r.queue) return;
      const q = r.queue;
      pendingQueue = q;
      const offer = () => pageBubble(`Lista "${q.name}" · ${q.index + 1}/${q.items.length}`, '▶ Flotar (Alt+Y)', () => floatHere(q));
      const wait = () => (biggestVideo() ? offer() : setTimeout(wait, 1000));
      setTimeout(wait, 800);
    }).catch(() => {});
  }
})();
