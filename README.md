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
| Botón **▶** de la extensión en Chrome o **Alt + Y** | Pasa el video de la pestaña a la app, en el mismo minuto, y pausa la pestaña |
| **Ctrl + Shift + Espacio** | Play / pausa |
| **Ctrl + Shift + ← / →** | Atrás / adelante 10 segundos |
| **Ctrl + Shift + ↑ / ↓** | Subir / bajar volumen |
| **Ctrl + Shift + H** | Mostrar / ocultar la ventana |
| **Ctrl + Shift + M** o botón **⇄ Auto** | Activa / desactiva el movimiento automático |
| Botón **◐** | Modo fantasma: el video se vuelve casi transparente cuando pasas el mouse encima |
| Botones **− / +** | Más o menos transparencia |
| Arrastrar la barra de arriba | Mover la ventana a mano |
| Arrastrar los bordes | Cambiar el tamaño |
| **✕** | Esconde la ventana (sigue en la bandeja, junto al reloj) |
| Icono en la bandeja | Más opciones: cómo se mueve, transparencia, controles, iniciar con Windows, actualizar, salir |

**Regla del movimiento:** cuando haces clic *fuera* del video, en la misma mitad de la pantalla donde está el video, este se desliza a la otra mitad. Hay dos modos (icono de la bandeja → *Cómo se mueve*):

- **Al otro lado** (por defecto): cambia de lado y mantiene la altura.
- **A la esquina contraria al clic**: si haces clic arriba se va abajo, y al revés.

Los clics sobre el propio video o en la mitad contraria no lo mueven. Con varios monitores, solo reacciona a clics en el monitor donde está el video. El clic igual llega a tu programa normalmente.

### Extensión de Chrome

1. Baja `YT-Flotante-Extension-Chrome.zip` desde [Releases](../../releases) y descomprímelo (o usa icono de la bandeja → *Extensión de Chrome…*, que abre la carpeta ya instalada).
2. En Chrome abre `chrome://extensions`, activa **Modo de desarrollador** y pulsa **Cargar extensión sin empaquetar**. Elige la carpeta.
3. En cualquier video de YouTube aprieta el botón ▶ de la barra de Chrome (o **Alt + Y**). También puedes hacer clic derecho sobre un link de YouTube → *Abrir en YT Flotante*.

La primera vez Chrome pregunta si permite abrir YT Flotante: marca *Permitir siempre*.

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
| `src/main.js` | El "cerebro". Crea la ventana sin bordes y siempre encima, carga el video, registra los atajos, el icono de la bandeja, escucha el mouse en todo Windows (clics para esquivar, movimiento para el modo fantasma), anima el movimiento y revisa actualizaciones. Guarda tus ajustes en `settings.json`. |
| `src/placement.js` | La regla de esquivar, sola y sin Electron para poder probarla: recibe dónde hiciste clic, dónde está el video y el tamaño de la pantalla, y devuelve la nueva posición (o nada). |
| `src/player.html` | La página del reproductor. La app la sirve desde `http://localhost` para que YouTube la trate como un sitio normal que incrusta un video. Avisa a la app si el video cargó o dio error. |
| `src/inject.js` | Pequeños scripts que la app ejecuta dentro del video: play/pausa, ±10 s, volumen, rechazar cookies y llenar la ventana con el reproductor. |
| `src/youtube.js` | Entiende cualquier link de YouTube (`watch`, `youtu.be`, `shorts`, `live`, con tiempo `t=` o playlist). |
| `src/index.html` | La barra de arriba (arrastrar, ⇄ Auto, ◐ fantasma, transparencia, cerrar), los avisos y la pantalla para pegar el link. |
| `src/preload.js` | El puente seguro entre la barra (página web) y `main.js`: expone solo las funciones necesarias. |
| `extension/` | La extensión de Chrome: pausa la pestaña, toma el minuto y abre `ytpip://open?url=…`, que Windows entrega a la app. |
| `test/logic.test.js` | Pruebas automáticas de los links, de la regla de movimiento (lados, esquinas, dos monitores) y de los scripts. |
| `.github/workflows/build.yml` | En cada cambio, GitHub compila en una máquina Windows. Si es una versión (`v1.1.0`), publica en *Releases* el instalador, la versión portable, la extensión y el archivo `latest.yml` que usan las actualizaciones automáticas. |

**El video:** la app sirve `player.html` desde localhost y ahí carga el reproductor oficial de YouTube. Si YouTube dice que ese video no se puede incrustar (o no responde en 12 segundos), la app abre la página normal del video, rechaza el aviso de cookies y pone el reproductor a pantalla completa *dentro* de la ventana.

## Desarrollo

```bash
npm install
npm start          # abre la app
npm test           # pruebas de la lógica (links y movimiento)
npm run dist       # genera los .exe en dist/
```

Cada push a `main` compila los instaladores en GitHub Actions (pestaña *Actions → artefactos*). Para publicar una versión: `git tag v1.0.1 && git push --tags`, y aparece en *Releases*.

Hecho con [Electron](https://www.electronjs.org/) y [uiohook-napi](https://github.com/SnosMe/uiohook-napi) (para detectar los clics en toda la pantalla).
