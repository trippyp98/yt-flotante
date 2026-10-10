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
