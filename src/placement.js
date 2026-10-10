// Lógica pura de "esquivar": decide a dónde mover la ventana según el clic.
// Se mantiene separada de Electron para poder probarla con `npm test`.

function inside(p, b) {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

/**
 * @param click     {x,y} punto del clic (en píxeles lógicos / DIP)
 * @param win       {x,y,width,height} posición actual del video
 * @param workArea  {x,y,width,height} área útil del monitor donde se hizo el clic
 * @param sameDisplay true si el video está en el mismo monitor que el clic
 * @param margin    separación con el borde de la pantalla
 * @returns nuevos {x,y} o null si no hay que moverse
 */
function dodgeTarget(click, win, workArea, sameDisplay, margin = 16) {
  if (inside(click, win)) return null;   // clic sobre el propio video
  if (!sameDisplay) return null;          // clic en otro monitor

  const mid = workArea.x + workArea.width / 2;
  const clickRight = click.x >= mid;
  const videoRight = win.x + win.width / 2 >= mid;
  if (clickRight !== videoRight) return null; // ya está en el lado contrario

  const x = clickRight
    ? workArea.x + margin                                 // pasar a la izquierda
    : workArea.x + workArea.width - win.width - margin;   // pasar a la derecha
  const maxY = workArea.y + workArea.height - win.height - margin;
  const y = Math.min(Math.max(win.y, workArea.y + margin), Math.max(maxY, workArea.y));
  return { x: Math.round(x), y: Math.round(y) };
}

module.exports = { dodgeTarget, inside };
