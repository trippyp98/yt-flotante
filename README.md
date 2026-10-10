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

Todo se hace desde Chrome con la **extensión** (ver abajo cómo instalarla). La **app** queda junto al reloj, sin ventana, y se encarga de lo que Chrome no permite: apartar la ventana flotante de tus clics y volverla transparente.

| Atajo (en cualquier página) | Qué hace |
|---|---|
| **Alt + Y** | Pone a flotar el video de la página en una ventana con controles (⏮ ⟲ ⏯ ⟳ ⏭, velocidad, volumen, lista). Otra vez Alt + Y la cierra |
| **Alt + L** | Reproduce tu **lista activa** en la ventana flotante |
| **Alt + Shift + Y** | (En YouTube) abre el video en la ventana propia de la app |
| Clic derecho → *Agregar esta página / este link a mi lista* | Suma videos o clases a la lista activa |
| Clic derecho → *Administrar listas…* | Crear listas ("Música", "Clases de X"), ordenar, aleatorio, repetir, pegar varios links |

Con la app abierta:

| | Qué hace |
|---|---|
| Clic en la mitad de la pantalla donde está el video | El video se va a la otra mitad |
| Pasar el mouse por encima | Se vuelve transparente: suave 70 %, media 45 % o fuerte 20 % (**Ctrl + Shift + T** cambia el nivel) |
| **Rueda del mouse** sobre el video | Volumen |
| **Ctrl + Shift + Espacio / ← → / ↑ ↓ / RePág AvPág** | Play-pausa / ±10 s / volumen / velocidad, desde cualquier programa |
| Icono rojo junto al reloj | Muestra si la extensión está conectada, y todas las opciones |

### Listas

- **Música de YouTube:** pega una lista de YouTube (`…/playlist?list=…`) o varios videos. Pasan solos de uno al siguiente dentro de la ventana flotante.
- **Clases de una plataforma:** agrega la página de cada clase (clic derecho → *Agregar esta página a mi lista*). Cuando termina una, la ventana te avisa y abre la siguiente clase en la misma pestaña; ahí aparece un botón **▶ Flotar** (o Alt + Y). Sigue usando tu sesión de Chrome, así que funcionan los cursos con login.
- Puedes mezclar los dos tipos en una misma lista.

### Instalar la extensión (modo desarrollador)

1. Baja `YT-Flotante-Extension-Chrome.zip` desde [Releases](../../releases) y descomprímelo en una carpeta que no vayas a borrar (o usa icono rojo → *Extensión de Chrome…*, que abre la carpeta ya instalada con la app).
2. En Chrome abre `chrome://extensions`, activa **Modo de desarrollador** (arriba a la derecha) y pulsa **Cargar extensión sin empaquetar**. Elige la carpeta.
3. **Recarga las pestañas** que ya tenías abiertas (F5) para que tomen la extensión.
4. Si actualizas a una versión nueva: reemplaza la carpeta y aprieta **↻** en la tarjeta de la extensión.

Los atajos Alt + Y / Alt + L los escucha la propia página, así que no hace falta configurar nada en `chrome://extensions/shortcuts`. No funcionan en páginas internas de Chrome (`chrome://…`) ni en la Chrome Web Store.

### Detalles

- La ventana flotante usa *Document Picture-in-Picture* (Chrome 116 o más nuevo). Si un video está dentro de un reproductor incrustado de otro sitio (común en plataformas de cursos), se usa el "Imagen en imagen" normal de Chrome; la app igual lo mueve y lo hace transparente.
- La app se actualiza sola (versión instalada). La extensión se actualiza reemplazando la carpeta.

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
| `extension/content.js` | Corre en cada página: escucha Alt + Y / Alt + L, arma la ventana flotante con sus controles, mueve el `<video>` de la página adentro (o pone el reproductor de YouTube), y avanza por la lista. |
| `extension/background.js` | Fondo de la extensión: conexión con la app (`ws://127.0.0.1:47321`), menús de clic derecho, abrir la siguiente clase de una lista, y plan B de "Imagen en imagen" para videos dentro de iframes. |
| `extension/lists.html` / `lists.js` | Administrador de listas. |
| `extension/common.js` | Lectura de links de YouTube y guardado de listas (`chrome.storage`). |
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
