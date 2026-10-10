// Administrador de listas de YT Flotante.
const $ = (id) => document.getElementById(id);
let data = null;

async function titleFor(url) {
  if (YTF.parseYouTube(url)) {
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url));
      if (r.ok) { const j = await r.json(); if (j.title) return j.title; }
    } catch { /* sin título */ }
  }
  try { return new URL(url).hostname + new URL(url).pathname; } catch { return url; }
}

function kindOf(url) {
  const yt = YTF.parseYouTube(url);
  if (!yt) return 'página';
  return yt.id ? 'YouTube' : 'lista YouTube';
}

function render() {
  const sel = $('list');
  sel.innerHTML = '';
  for (const name of Object.keys(data.lists)) {
    const o = document.createElement('option');
    o.value = o.textContent = name;
    if (name === data.active) o.selected = true;
    sel.appendChild(o);
  }
  $('shuffle').checked = !!data.shuffle;
  $('loop').checked = !!data.loop;
  const items = data.lists[data.active];
  const ol = $('items');
  ol.innerHTML = '';
  $('empty').style.display = items.length ? 'none' : '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="t"></span><span class="k"></span>' +
      '<button class="small" data-a="up">↑</button><button class="small" data-a="down">↓</button><button class="small" data-a="rm">✕</button>';
    li.querySelector('.t').textContent = it.title || it.url;
    li.querySelector('.t').title = it.url;
    li.querySelector('.k').textContent = kindOf(it.url);
    li.querySelectorAll('button').forEach((b) => {
      b.onclick = async () => {
        const a = b.dataset.a;
        if (a === 'rm') items.splice(i, 1);
        if (a === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
        if (a === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
        await YTF.save(data); render();
      };
    });
    ol.appendChild(li);
  });
}

async function init() {
  data = await YTF.load();
  $('ver').textContent = YTF.VERSION;
  render();
  chrome.runtime.sendMessage({ type: 'status' }).then((s) => {
    $('dot').className = 'dot ' + (s && s.app ? 'ok' : 'bad');
    $('app').textContent = s && s.app ? 'Conectada con la app YT Flotante' : 'La app YT Flotante no está abierta (sin ella no se aparta ni se vuelve transparente)';
  }).catch(() => {});
}

$('list').onchange = async (e) => { data.active = e.target.value; await YTF.save(data); render(); };
$('shuffle').onchange = async (e) => { data.shuffle = e.target.checked; await YTF.save(data); };
$('loop').onchange = async (e) => { data.loop = e.target.checked; await YTF.save(data); };
$('new').onclick = async () => {
  const name = (prompt('Nombre de la nueva lista (por ejemplo "Música" o "Clases de Finanzas"):') || '').trim();
  if (!name || data.lists[name]) return;
  data.lists[name] = []; data.active = name; await YTF.save(data); render();
};
$('rename').onclick = async () => {
  const name = (prompt('Nuevo nombre:', data.active) || '').trim();
  if (!name || data.lists[name]) return;
  data.lists[name] = data.lists[data.active]; delete data.lists[data.active]; data.active = name;
  await YTF.save(data); render();
};
$('del').onclick = async () => {
  if (Object.keys(data.lists).length === 1) { data.lists[data.active] = []; }
  else if (confirm(`¿Borrar la lista "${data.active}"?`)) { delete data.lists[data.active]; data.active = Object.keys(data.lists)[0]; }
  await YTF.save(data); render();
};
$('add').onclick = async () => {
  const urls = $('paste').value.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
  if (!urls.length) { $('addMsg').textContent = 'Pega al menos un link que empiece con https://'; return; }
  $('addMsg').textContent = 'Agregando…';
  for (const url of urls) data.lists[data.active].push({ url, title: await titleFor(url) });
  await YTF.save(data);
  $('paste').value = '';
  $('addMsg').textContent = `✓ ${urls.length} agregado(s)`;
  render();
};

init();
