# ▶ YT Flotante

Ventana flotante de YouTube para Windows que **se queda siempre encima** de lo que estás haciendo y **se aparta sola**: si haces clic en la mitad de la pantalla donde está el video, el video salta a la otra mitad para no taparte.

```
 ┌──────────────────────────┬──────────────────────────┐
 │                          │   clic aquí  ✱           │
 │  ┌────────┐   ◀── salta  │              ┌────────┐  │
 │  │ ▶ video│              │              │ ▶ video│  │
 │  └────────┘              │              └────────┘  │
 └──────────────────────────┴──────────────────────────┘
```

## Instalar

1. Ve a **[Releases](../../releases)** y baja `YT-Flotante-Setup-x.x.x.exe` (o la versión *Portable*, que no se instala).
2. Ábrelo. Si Windows muestra "Windows protegió su PC", pulsa **Más información → Ejecutar de todas formas** (pasa porque la app no tiene firma digital paga).

## Usar

| Cómo | Qué hace |
|---|---|
| Pegar el link en la ventana y **Abrir** | Reproduce el video flotando |
| Copiar un link de YouTube y presionar **Ctrl + Shift + Y** | Lo abre al tiro, estés donde estés |
| **Ctrl + Shift + H** | Mostrar / ocultar la ventana |
| **Ctrl + Shift + M** o botón **⇄ Auto** | Activa / desactiva el movimiento automático |
| Botones **− / +** | Más o menos transparencia |
| Arrastrar la barra de arriba | Mover la ventana a mano |
| Arrastrar los bordes | Cambiar el tamaño |
| **✕** | Esconde la ventana (sigue en la bandeja, junto al reloj) |
| Icono en la bandeja → **Salir** | Cierra la app |

**Regla del movimiento:** cuando haces clic *fuera* del video, en la misma mitad de la pantalla donde está el video, este se desliza a la otra mitad (misma altura). Los clics sobre el propio video o en la mitad contraria no lo mueven. Con varios monitores, solo reacciona a clics en el monitor donde está el video. El clic igual llega a tu programa normalmente.

### Botón en el navegador (opcional)

Crea un marcador nuevo en Chrome/Edge y en la URL pega:

```
javascript:location.href='ytpip://open?url='+encodeURIComponent(location.href)
```

Estando en un video de YouTube, haz clic en el marcador y se abre en YT Flotante (la primera vez el navegador pregunta si permites abrir la app).

### Detalles

- Usa el reproductor "embed" de YouTube. Si un video no permite reproducirse incrustado, la app abre la página normal y pone el reproductor a llenar la ventana.
- Tu sesión de YouTube (si inicias sesión dentro de la ventana) se guarda aparte del navegador.
- Recuerda la posición, el tamaño, la transparencia y si el modo automático está activo.

## Cómo funciona por dentro

La app está hecha con **Electron**: un Chrome pequeño empaquetado como programa de Windows. Así puede mostrar YouTube y, al mismo tiempo, hacer cosas que una página web no puede, como quedar encima de todo o mover su propia ventana.

```
 Tú haces clic en cualquier parte
            │
            ▼
 uiohook-napi (escucha el mouse en todo Windows, sin bloquear el clic)
            │  x, y del clic
            ▼
 main.js ── convierte a píxeles lógicos (respeta el zoom 125 %, 150 %…)
            │
            ▼
 placement.js ── ¿el clic fue en la misma mitad que el video, y fuera de él?
            │ sí                          │ no
            ▼                             ▼
 animación de 180 ms a la otra mitad   no hace nada
```

| Archivo | Qué hace |
|---|---|
| `src/main.js` | El "cerebro". Crea la ventana sin bordes y siempre encima, carga el video, registra los atajos (Ctrl+Shift+Y/H/M), el icono de la bandeja, escucha los clics globales y anima el movimiento. Guarda tus ajustes en `settings.json`. |
| `src/placement.js` | La regla de esquivar, sola y sin Electron para poder probarla: recibe dónde hiciste clic, dónde está el video y el tamaño de la pantalla, y devuelve la nueva posición (o nada). |
| `src/youtube.js` | Entiende cualquier link de YouTube (`watch`, `youtu.be`, `shorts`, `live`, con tiempo `t=` o playlist) y arma la URL del reproductor. |
| `src/index.html` | La barra de arriba (arrastrar, ⇄ Auto, transparencia, cerrar) y la pantalla para pegar el link. |
| `src/preload.js` | El puente seguro entre la barra (página web) y `main.js`: expone solo las funciones necesarias. |
| `test/logic.test.js` | Pruebas automáticas de los links y de la regla de movimiento (incluye dos monitores). |
| `.github/workflows/build.yml` | En cada cambio, GitHub compila los `.exe` en una máquina Windows y, si es una versión (`v1.0.1`), los publica en *Releases*. |

**El video:** se carga el reproductor "embed" de YouTube dentro de la ventana. Si YouTube responde que ese video no se puede incrustar, la app abre la página normal del video y pone el reproductor a pantalla completa *dentro* de la ventana.

## Desarrollo

```bash
npm install
npm start          # abre la app
npm test           # pruebas de la lógica (links y movimiento)
npm run dist       # genera los .exe en dist/
```

Cada push a `main` compila los instaladores en GitHub Actions (pestaña *Actions → artefactos*). Para publicar una versión: `git tag v1.0.1 && git push --tags`, y aparece en *Releases*.

Hecho con [Electron](https://www.electronjs.org/) y [uiohook-napi](https://github.com/SnosMe/uiohook-napi) (para detectar los clics en toda la pantalla).
