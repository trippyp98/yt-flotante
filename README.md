# ▶ YT Flotante

Ventana flotante para Windows que **se queda siempre encima** de lo que estás haciendo y **se aparta sola**: si haces clic en la mitad de la pantalla donde está el video, el video salta a la otra mitad para no taparte. Funciona con YouTube y con **cualquier video que tengas abierto en Chrome** (clases, cursos, Vimeo, etc.).

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

Hay dos formas de poner un video a flotar:

1. **Cualquier video de Chrome** (clases, cursos con login, Vimeo, YouTube…): con la extensión instalada, en la pestaña del video presiona **Alt + Y** (o el botón ▶ de la barra de Chrome). El video sale en la ventanita "Imagen en imagen" de Chrome, y la app la maneja: la mueve, la vuelve transparente y le cambia el volumen. Funciona aunque la página pida iniciar sesión, porque el video sigue en tu Chrome. Si abres "Imagen en imagen" por tu cuenta (por ejemplo con el botón del reproductor), la app también lo detecta.
2. **YouTube en la ventana propia de la app**: pega el link en la app, copia un link y presiona **Ctrl + Shift + Y**, o en YouTube presiona **Alt + Shift + Y**.

La app tiene que estar abierta (icono rojo junto al reloj). Puedes esconder su ventana con **✕** y seguirá manejando los videos de Chrome.

| Atajo | Qué hace |
|---|---|
| **Alt + Y** (en Chrome) | Poner a flotar / dejar de flotar el video de la pestaña |
| **Rueda del mouse** sobre el video | Subir / bajar volumen |
| Pasar el mouse por encima | El video se vuelve transparente para ver lo de abajo |
| **Ctrl + Shift + T** o botón **◐** | Cambia el nivel de transparencia al pasar el mouse: apagada → suave (70 %) → media (45 %) → fuerte (20 %) |
| **Ctrl + Shift + Espacio** | Play / pausa |
| **Ctrl + Shift + ← / →** | Atrás / adelante 10 segundos |
| **Ctrl + Shift + ↑ / ↓** | Subir / bajar volumen |
| **Ctrl + Shift + RePág / AvPág** | Más rápido / más lento (útil en clases) |
| **Ctrl + Shift + M** o botón **⇄ Auto** | Activa / desactiva el movimiento automático |
| **Ctrl + Shift + Y** | Abre en la app el link de YouTube que tengas copiado |
| **Ctrl + Shift + H** | Mostrar / ocultar la ventana de la app |
| Icono en la bandeja | Más opciones: cómo se mueve, niveles de transparencia, videos de Chrome, controles, iniciar con Windows, actualizar, salir |

**Regla del movimiento:** cuando haces clic *fuera* del video, en la misma mitad de la pantalla donde está el video, este se desliza a la otra mitad. Hay dos modos (icono de la bandeja → *Cómo se mueve*):

- **Al otro lado** (por defecto): cambia de lado y mantiene la altura.
- **A la esquina contraria al clic**: si haces clic arriba se va abajo, y al revés.

Los clics sobre el propio video o en la mitad contraria no lo mueven. Con varios monitores, solo reacciona a clics en el monitor donde está el video. El clic igual llega a tu programa normalmente.

### Extensión de Chrome

1. Baja `YT-Flotante-Extension-Chrome.zip` desde [Releases](../../releases) y descomprímelo (o usa icono de la bandeja → *Extensión de Chrome…*, que abre la carpeta ya instalada).
2. En Chrome abre `chrome://extensions`, activa **Modo de desarrollador** y pulsa **Cargar extensión sin empaquetar**. Elige la carpeta.
3. En cualquier página con un video presiona **Alt + Y** (o el botón ▶ de la barra de Chrome, o clic derecho → *Poner este video a flotar*). Para mandar un video de YouTube a la ventana de la app: **Alt + Shift + Y**, o clic derecho sobre un link de YouTube → *Abrir link en la app YT Flotante*.

Si vienes de la versión 1.1, vuelve a cargar la carpeta de la extensión (botón ↻ en `chrome://extensions`). La primera vez que mandas algo a la app, Chrome pregunta si permite abrir YT Flotante: marca *Permitir siempre*.

### Detalles

- El video se reproduce con el reproductor oficial de YouTube. Si un video no permite reproducirse incrustado, la app abre la página normal, **rechaza sola el aviso de cookies** y pone el reproductor a llenar la ventana.
- Tu sesión de YouTube (si inicias sesión dentro de la ventana) se guarda aparte del navegador.
- Recuerda la posición, el tamaño, la transparencia y tus opciones.
- **Se actualiza sola** (versión instalada, no la portable): cuando hay una versión nueva en Releases la baja en segundo plano y la instala al salir.

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
| `src/main.js` | El "cerebro". Crea la ventana sin bordes y siempre encima, carga el video, registra los atajos, el icono de la bandeja, escucha el mouse en todo Windows (clics para esquivar, movimiento para la transparencia, rueda para el volumen), mueve tanto su ventana como la de Chrome, habla con la extensión y revisa actualizaciones. Guarda tus ajustes en `settings.json`. |
| `src/pip-win.js` | Habla con Windows (user32) para encontrar la ventana "Imagen en imagen" de Chrome/Edge, leer y cambiar su posición y su transparencia. |
| `src/placement.js` | La regla de esquivar, sola y sin Electron para poder probarla: recibe dónde hiciste clic, dónde está el video y el tamaño de la pantalla, y devuelve la nueva posición (o nada). |
| `src/player.html` | La página del reproductor. La app la sirve desde `http://localhost` para que YouTube la trate como un sitio normal que incrusta un video. Avisa a la app si el video cargó o dio error. |
| `src/inject.js` | Pequeños scripts que la app ejecuta dentro del video: play/pausa, ±10 s, volumen, rechazar cookies y llenar la ventana con el reproductor. |
| `src/youtube.js` | Entiende cualquier link de YouTube (`watch`, `youtu.be`, `shorts`, `live`, con tiempo `t=` o playlist). |
| `src/index.html` | La barra de arriba (arrastrar, ⇄ Auto, ◐ fantasma, transparencia, cerrar), los avisos y la pantalla para pegar el link. |
| `src/preload.js` | El puente seguro entre la barra (página web) y `main.js`: expone solo las funciones necesarias. |
| `extension/` | La extensión de Chrome: busca el video más grande de la pestaña (también dentro de iframes, como los reproductores de cursos) y lo pone en "Imagen en imagen". Se conecta con la app por `ws://127.0.0.1:47321` para recibir volumen, pausa, saltos y velocidad. Para YouTube también puede mandar el video a la app con `ytpip://open?url=…`. |
| `test/logic.test.js` | Pruebas automáticas de los links, de la regla de movimiento (lados, esquinas, dos monitores) y de los scripts. |
| `.github/workflows/build.yml` | En cada cambio, GitHub compila en una máquina Windows. Si es una versión (`v1.1.0`), publica en *Releases* el instalador, la versión portable, la extensión y el archivo `latest.yml` que usan las actualizaciones automáticas. |

**Videos de Chrome:** la app revisa cada momento si hay una ventana "Imagen en imagen" de Chrome abierta. Cuando la encuentra, la trata igual que a su propia ventana: la esquiva de tus clics, la aclara cuando pasas el mouse y le manda a la extensión los cambios de volumen. El puente con la extensión solo acepta conexiones de extensiones del navegador, no de páginas web.

**El video de YouTube en la app:** la app sirve `player.html` desde localhost y ahí carga el reproductor oficial de YouTube. Si YouTube dice que ese video no se puede incrustar (o no responde en 12 segundos), la app abre la página normal del video, rechaza el aviso de cookies y pone el reproductor a pantalla completa *dentro* de la ventana.

## Desarrollo

```bash
npm install
npm start          # abre la app
npm test           # pruebas de la lógica (links y movimiento)
npm run dist       # genera los .exe en dist/
```

Cada push a `main` compila los instaladores en GitHub Actions (pestaña *Actions → artefactos*). Para publicar una versión: `git tag v1.0.1 && git push --tags`, y aparece en *Releases*.

Hecho con [Electron](https://www.electronjs.org/) y [uiohook-napi](https://github.com/SnosMe/uiohook-napi) (para detectar los clics en toda la pantalla).
