const test = require('node:test');
const assert = require('node:assert');
const { parseYouTube, findInArgs, embedUrl } = require('../src/youtube');
const { dodgeTarget } = require('../src/placement');

test('reconoce los distintos formatos de link', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `youtube.com/watch?v=${id}&feature=share`,
    `https://youtu.be/${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?si=abc`,
    `https://www.youtube.com/embed/${id}`,
    id,
  ]) assert.equal(parseYouTube(url)?.id, id, url);
});

test('lee el tiempo de inicio y la playlist', () => {
  assert.equal(parseYouTube('https://youtu.be/dQw4w9WgXcQ?t=90').start, 90);
  assert.equal(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s').start, 90);
  assert.equal(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123').list, 'PL123');
  assert.match(embedUrl(parseYouTube('https://youtu.be/dQw4w9WgXcQ?t=90')), /start=90/);
});

test('rechaza lo que no es YouTube', () => {
  for (const t of ['', 'hola', 'https://vimeo.com/123', 'https://youtube.com/', 'https://evil.com/watch?v=dQw4w9WgXcQ'])
    assert.equal(parseYouTube(t), null, t);
});

test('acepta links ytpip:// y argumentos de línea de comandos', () => {
  const u = 'ytpip://open?url=' + encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(findInArgs(['app.exe', u]).id, 'dQw4w9WgXcQ');
  assert.equal(findInArgs(['app.exe', '--x', 'https://youtu.be/dQw4w9WgXcQ']).id, 'dQw4w9WgXcQ');
  assert.equal(findInArgs(['app.exe']), null);
});

const wa = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1424, y: 734, width: 480, height: 290 };
const left = { x: 16, y: 734, width: 480, height: 290 };

test('clic en la mitad derecha mueve el video de la derecha a la izquierda', () => {
  assert.deepEqual(dodgeTarget({ x: 1500, y: 200 }, right, wa, true), { x: 16, y: 734 });
});

test('clic en la mitad izquierda mueve el video de la izquierda a la derecha', () => {
  assert.deepEqual(dodgeTarget({ x: 300, y: 200 }, left, wa, true), { x: 1424, y: 734 });
});

test('no se mueve si el clic es en el lado contrario, sobre el video o en otro monitor', () => {
  assert.equal(dodgeTarget({ x: 300, y: 200 }, right, wa, true), null);
  assert.equal(dodgeTarget({ x: 1500, y: 800 }, right, wa, true), null);
  assert.equal(dodgeTarget({ x: 1500, y: 200 }, right, wa, false), null);
});

test('funciona con un segundo monitor a la derecha', () => {
  const wa2 = { x: 1920, y: 0, width: 1920, height: 1040 };
  const v = { x: 3344, y: 100, width: 480, height: 290 };
  assert.deepEqual(dodgeTarget({ x: 3000, y: 600 }, v, wa2, true), { x: 1936, y: 100 });
});

test('modo esquinas: va a la esquina contraria al clic', () => {
  // clic arriba a la derecha → video (abajo derecha) se va abajo a la izquierda
  assert.deepEqual(dodgeTarget({ x: 1500, y: 200 }, right, wa, true, 16, 'esquinas'), { x: 16, y: 734 });
  // clic abajo a la derecha (fuera del video) → se va arriba a la izquierda
  assert.deepEqual(dodgeTarget({ x: 1000, y: 900 }, right, wa, true, 16, 'esquinas'), { x: 16, y: 16 });
});

test('los scripts de control se pueden evaluar', () => {
  const { controlScript, rejectConsentScript, fillPlayerScript } = require('../src/inject');
  for (const s of [controlScript('toggle'), rejectConsentScript, fillPlayerScript]) new Function(s);
});

test('las firmas de la API de Windows son válidas', () => {
  const koffi = require('koffi');
  const { SIGNATURES, declareTypes, PIP_TITLE } = require('../src/pip-win');
  declareTypes(koffi);
  for (const [name, sig] of Object.entries(SIGNATURES)) koffi.proto(sig.replace(name, name + '_test'));
  assert.equal(koffi.sizeof('RECT'), 16);
  assert.ok(PIP_TITLE.test('Imagen en imagen') && PIP_TITLE.test('Picture in picture'));
});

test('los controles funcionan sobre un <video> cualquiera', () => {
  const { ytfControl } = require('../src/inject');
  const v = { paused: true, currentTime: 50, volume: 0.5, muted: true, playbackRate: 1, play() { this.paused = false; }, pause() { this.paused = true; } };
  global.window = {};
  global.document = { pictureInPictureElement: v, querySelectorAll: () => [v] };
  assert.equal(ytfControl('toggle', 0), 'Play');
  assert.equal(ytfControl('seek', -10), '−10 s'); assert.equal(v.currentTime, 40);
  assert.equal(ytfControl('volume', 0.05), 'Volumen 55 %'); assert.equal(v.muted, false);
  assert.equal(ytfControl('speed', 0.25), 'Velocidad 1.25x');
  delete global.window; delete global.document;
});
