# Spotaple

Reproductor de música de escritorio para Windows, de uso personal y funcionamiento local. Buscás una canción, la escuchás por streaming desde internet y la organizás en playlists y favoritos que quedan guardados en tu equipo.

> **Integración no oficial.** La música llega a través de [YouTube.js](https://github.com/LuanRT/YouTube.js) (`youtubei.js`), que usa la API interna de YouTube. No hay garantía de acceso a todo el catálogo ni de reproducción siempre libre de errores. Ver [Límites de la integración](#límites-de-la-integración).

## Cómo ejecutarlo

Requisitos: Windows 10/11, Node.js 22.12 o más nuevo (probado con 24) y conexión a internet.

```bash
npm install
npm run dev        # desarrollo, con recarga en caliente
npm run build      # compila main, preload y renderer en ./out
npm run start      # ejecuta lo compilado
npm run pack       # versión sin instalar: release/win-unpacked/Spotaple.exe
npm run dist       # ejecutable portable en release/
npm run dist:installer # instalador de Windows x64 con actualizaciones en release/
```

La primera vez que se abre, la base de datos se crea sola en `%APPDATA%\Spotaple\spotaple.db`.

**Para usarlo sin instalar ni compilar:** descargá el `.exe` portable desde la página de **Releases** del repositorio y ejecutalo con doble clic. La carpeta `release/win-unpacked/` es interna del build y solo la usan las pruebas e2e.

**Para instalarlo y recibir actualizaciones:** ejecutá `Spotaple-Setup-<versión>.exe`. En **Ajustes → Acerca de**, «Buscar actualizaciones» consulta GitHub y descarga una versión más nueva si está disponible. «Reiniciar e instalar» aplica la actualización. El portable se sigue actualizando al descargar un ejecutable nuevo.

### Preparar una versión en GitHub

1. Para una versión nueva, ejecutá `npm version patch --no-git-tag-version` y subí los cambios de versión a `main`. El flujo usa la versión de `package.json` y prepara el tag correspondiente.
2. En GitHub, abrí **Actions → Instalador de Windows → Run workflow** y seleccioná `main`. GitHub ejecuta las pruebas, genera el instalador x64, lo prueba en Windows y crea un borrador en **Releases** con el `.exe`, su `.blockmap` y `latest.yml`. El flujo usa el token de GitHub Actions y funciona sin configurar secretos.
3. En **Releases**, revisá el borrador y descargá el instalador para probarlo. Cuando esté listo para distribuir, tocá **Publish release** para que el actualizador de Spotaple pueda encontrarlo. Los instaladores sin firma pueden mostrar un aviso de Windows.

Para generar esos mismos archivos localmente, usá `npm run dist:installer`. Los tres deben salir de la misma compilación. Si ya existe un borrador para esa versión, el flujo lo conserva. Revisalo en **Releases** antes de preparar otra versión.

## Qué incluye

- **Inicio** con lo que escuchaste, tus favoritas y tus playlists; estado vacío con sugerencias de búsqueda.
- **Búsqueda** de canciones, artistas, álbumes y playlists de YouTube Music (en paralelo, con resultados parciales si una parte falla). Una playlist se abre en su página, se reproduce entera, se agrega a la cola o se guarda como playlist propia con «Guardar en mi biblioteca».
- **Álbum y artista** con portada, canciones y discografía. "Reproducir desde esta canción" y "Agregar a la cola" son acciones distintas y visibles.
- **Biblioteca**: favoritos e historial (solo lo que *empezó a sonar*).
- **Playlists**: crear, renombrar, agregar y quitar canciones, reordenar (arrastrando o por menú) y eliminar con confirmación cuando tiene contenido.
- **Reproductor persistente**: play/pausa, anterior/siguiente, posición, volumen, silencio, aleatorio, repetición (toda la cola / una), cola editable en panel lateral, teclas multimedia y tarjeta del sistema.
- **Radio automática**: cuando quedan menos de 3 canciones por sonar, la cola se rellena sola con la radio de YouTube Music a partir de la canción que suena, reordenada con tu historial, sin repetir lo que sonó hace poco ni lo que ya está en la cola, y con un máximo de 2 seguidas del mismo artista. Las canciones agregadas se ven bajo un separador «Radio automática». Se apaga en Ajustes y no corre dentro de una sala del Jam ni con la repetición activada. Con la radio activada, una canción suelta de la búsqueda suena sola y sigue la radio (con la radio apagada o la repetición activa se encolan los resultados, como siempre). Lo que agregás a la cola va antes de las canciones de la radio.
- **Descargas y offline**: cada canción que marcás como favorita se guarda en tu disco (Opus, la mejor calidad) y suena sin internet: lleva una marca junto al título, la barra de la Biblioteca cuenta cuántas hay, y sin conexión aparece el aviso «Sin conexión», lo que no está descargado se atenúa y se salta, y «Reproducir» arma la cola solo con lo descargado. Con clic derecho → **Descargar canción** guardás cualquier canción donde quieras, en **Opus (.webm)** o **AAC (.m4a)** (el que elegiste en Ajustes aparece primero). Se apaga la descarga automática, se ve el espacio usado y se borra todo desde Ajustes.
- **Hecho para vos**: arriba de Inicio, con tarjetas grandes de portadas, **Descubrimiento semanal** (30 canciones que todavía no escuchaste, de la radio de tus artistas más escuchados, máximo 2 por artista; se renueva cada lunes), **Mixes diarios** (3 a 6, cada uno anclado en un artista: mitad canciones que ya conocés y mitad su radio; se renuevan cada día), **Release Radar** (lanzamientos nuevos de tus artistas; se renueva cada viernes) y **Artistas que podrías escuchar** (los que YouTube Music marca como parecidos a los tuyos y todavía no escuchaste). Cada lista se abre en su página, se reproduce, se agrega a la cola o se guarda como playlist con «Guardar en mi biblioteca», y al terminar sigue la radio. Todo sale de tu historial y tus favoritas en esta PC y no aparece hasta tener datos (al menos 15 reproducciones o 5 favoritas). Se genera en segundo plano al abrir Inicio, mostrando las listas anteriores mientras tanto y también sin internet.
- **Persistencia**: cola, canción actual, posición, volumen y modos se restauran al abrir; la reproducción solo arranca con una acción tuya.
- **Jam**: salas para escuchar en grupo (cola compartida, votos para saltar y likes), por red local o por internet. Ver [Modo Jam](#modo-jam-escuchar-en-grupo).
- **Sonido** (en Ajustes, al instante y guardado en la base local): **Normalizar volumen** baja las canciones que YouTube mide más fuertes que −14 LUFS hacia ese nivel y deja como están las más suaves (solo baja, nunca sube: sin limitador subir saturaría; el loudness de las favoritas descargadas se guarda con ellas; las que se bajaron antes de existir esta opción lo piden a YouTube una vez, al reproducirlas con «Normalizar» activo). **Ecualizador** de 10 bandas (31 Hz a 16 kHz, ±12 dB) con preamplificador y siete preajustes (Plano, Más graves, Más agudos, Voz, Rock, Pop, Electrónica); un valor propio se muestra como «Personalizado» y «Restablecer» vuelve a Plano. **Fundido entre canciones** (0 a 12 s, en Reproducción): a esa distancia del final la siguiente arranca en un segundo `<audio>` mientras la actual se apaga (curva de potencia constante); se precarga la fuente de la siguiente 10 s antes, no corre dentro de una sala, con «repetir una», en la última canción de la cola ni si la canción dura menos del doble del fundido, y si la siguiente no se puede cargar la actual sigue y termina como siempre. Los tres nacen apagados.
- **Ajustes** (engranaje al pie del lateral; cada cambio se aplica al instante y se guarda en la base local): tema (Sistema, Grafito, Claro, Medianoche, Océano) y barra de título nativa a juego, color de acento, tamaño de texto, densidad, reducir animaciones, calidad de streaming (Alta o Ahorro de datos), **sonido** (normalizar volumen y ecualizador de 10 bandas, ver abajo), radio automática, reanudar al abrir la app, descargas (descarga automática de favoritas, formato que va primero en «Descargar canción», espacio usado y borrar todo), «Hecho para vos» (mostrarlo en Inicio y «Reiniciar mis gustos», que no borra tu historial ni tus favoritas) y tu nombre en las salas.

No hay crossfade, reproducción sin pausas ni ecualizador: **no están implementados** y la interfaz no los muestra.

### Atajos

| Tecla | Acción |
|---|---|
| `Ctrl+K` o `/` | Enfocar la búsqueda |
| `Espacio` | Reproducir / pausar (si el foco no está en un campo o botón) |
| `Ctrl+→` / `Ctrl+←` | Siguiente / anterior |
| `Shift+→` / `Shift+←` | Adelantar / retroceder 10 s |
| `Ctrl+↑` / `Ctrl+↓` | Volumen |
| `M` | Silenciar |
| `Q` | Mostrar / ocultar la cola |
| `Alt+←` / `Alt+→` | Atrás / adelante |
| `Enter`, `Menú contextual` / `Shift+F10` sobre una canción | Reproducir desde ahí / abrir el menú |

## Modo Jam (escuchar en grupo)

Una sala compartida: cada persona pide canciones desde su propia PC y suenan donde decida el admin.

- **Crear o unirse:** barra lateral → **Jam**. Quien crea la sala es el admin y elige cómo se conectan:
  - **Red local:** el admin hospeda la sala en su PC y los demás se unen con `ip:puerto/CÓDIGO`. No usa ningún servidor externo. La primera vez Windows pregunta por el firewall: permití el acceso en redes privadas. Algunas redes Wi-Fi aíslan los equipos entre sí; ahí no funciona.
  - **Internet:** las apps se conectan al relé de Cloudflare ya configurado y se unen con un código de 5 caracteres. Funciona aunque la red no deje conectar PCs entre sí. Para mantener el relé o usar uno propio: ver [`relay/README.md`](relay/README.md).
- **Dónde suena** (switch del admin): **solo en la PC del admin** o **en todas las PCs**. En "Todas" cada PC baja su propio audio de YouTube y se sincroniza con la del admin; entre PCs solo viaja el control (qué canción, en qué segundo), nunca audio.
- **Cola compartida:** cualquiera pide canciones (botón +, clic derecho o doble clic) y entran por orden. El admin reordena y quita; cada persona quita lo que pidió.
- **Votos y likes:** una canción se salta cuando vota más de la mitad de las personas conectadas (el admin y quien la pidió la saltan directo). El like es un "buena elección" y suma a quien la pidió.
- Tu cola personal, tus favoritos y tus playlists no se tocan: al salir de la sala, la cola vuelve como estaba.
- No hay cuentas: cada uno elige un nombre. Tampoco hay contraseña ni expulsión; cualquiera con el código entra, y las salas de internet se borran tras 6 h sin actividad.
- Para probar la red antes de armar una sala: `npm run check:jam -- listen` en una PC y `npm run check:jam -- connect <ip>:47800` en otra.

## Arquitectura

```
src/
  shared/      tipos y contrato IPC (única fuente de verdad), política CSP
    jam/         motor de sala puro, protocolo y reloj (los comparten la app y el relé)
  main/        proceso local (Node): ventana, base de datos, proveedor musical, protocolo de audio
    db/          store.ts — SQLite (node:sqlite), migraciones, historial, playlists
    music/       provider.ts — contrato MusicProvider; youtube/ — implementación con YouTube.js
    audio-protocol.ts   spotaple-audio://track/<id> → audio con Range
    validate.ts  validación de todo lo que llega del renderer
    jam/         servidor de salas para red local, cliente WebSocket con reconexión y sesión (la red del jam vive aquí)
  preload/     puente contextBridge: superficie explícita y limitada
  renderer/    React + TypeScript
    src/player/  queue.ts (lógica pura de cola), player.ts (estado y audio), instance.ts (singleton)
    src/stores/  navegación, biblioteca, búsqueda, interfaz
    src/styles/  tokens → base → layout → componentes
tests/         pruebas automáticas (vitest)
scripts/       recorridos reales (e2e), accesibilidad, comprobación de YouTube y de la red del jam
relay/         relé del modo Internet (Cloudflare Workers + Durable Objects, y versión Node)
```

**Cambiar de proveedor musical** solo exige otra implementación de `MusicProvider` (`search`, `getAlbum`, `getArtist`, `resolveAudio`, `invalidate`); ni la interfaz ni la base de datos conocen YouTube.

### Cómo se reproduce una canción

1. La interfaz pide `prepare(videoId)` por IPC. El proceso local resuelve la fuente con YouTube.js y devuelve solo `{ trackId, mimeType, durationSec, loudnessLkfs }` (el loudness es un número; la URL no sale del proceso local).
2. El `<audio>` de la app (con `crossOrigin="anonymous"`) apunta a `spotaple-audio://track/<videoId>` y su salida pasa por un grafo de Web Audio (ecualizador y ganancia por canción). El esquema se registra con `corsEnabled` y toda respuesta lleva `Access-Control-Allow-Origin: *`: sin eso Web Audio emite silencio.
3. El proceso local atiende cada pedido con `Range` reenviándolo a googlevideo. **La URL real del audio nunca llega a la interfaz ni se guarda.** Si caduca (403/404/410), se descarta, se resuelve de nuevo y se reintenta una vez.
4. Se guardan identificadores duraderos (`videoId`, ids de álbum y artista) y metadatos para reconstruir la biblioteca sin red; las URLs de reproducción se tratan como temporales.

El estado de reproducción es una máquina única (`idle · loading · playing · paused · buffering · ended · error`) fuera de React: cambiar de pantalla no reinicia ni duplica el audio, y si elegís varias canciones rápido, gana la última.

## Límites de la integración

Verificado contra `youtubei.js` 18.3.0 (noviembre de 2026):

- **Evaluador de JavaScript obligatorio.** YouTube.js no trae intérprete: descifrar las URLs exige ejecutar fragmentos del reproductor de YouTube (código remoto). Se ejecutan en un contexto de V8 **vacío** (`node:vm`: sin `require`, `process`, `fetch` ni sistema de archivos), con tiempo máximo y devolviendo solo JSON — ver `src/main/music/youtube/eval.ts`. `node:vm` no es una frontera de seguridad fuerte frente a un exploit de V8; si el riesgo cambia, habría que moverlo a un proceso sin privilegios.
- **Token de origen (PO token).** Con la mayoría de los clientes de InnerTube (`YTMUSIC`, `ANDROID_VR`, `IOS`, `TV_SIMPLY`), googlevideo responde **403 pasado ~1 MiB**, lo que cortaría cada canción a los ~65 s. Hoy solo el cliente **`VISIONOS`** entrega el archivo completo sin token. La app lo comprueba de verdad antes de usar una fuente (pide un byte del medio) y prueba los clientes en orden; si ninguno sirve, muestra un error claro.
- **Puede dejar de funcionar.** Si YouTube cambia ese comportamiento, la reproducción se corta hasta actualizar `youtubei.js` o aportar un PO token (opción `po_token` de `Innertube.create`, ver la [guía](https://ytjs.dev/guide/getting-started)). Para diagnosticarlo: `npm run check:youtube` muestra qué clientes siguen sirviendo audio completo.
- **Datos incompletos.** La página de un artista no informa duraciones; el tema de un álbum llega sin portada ni artista (se completan desde el álbum). Si falta la duración, la fila queda en blanco y se completa al reproducir.
- **Playlists de YouTube.** Se muestran hasta 200 canciones, con aviso si hay más. La búsqueda no informa cuántas canciones tiene cada una y la cabecera de la playlist no trae al autor: solo se ve cuando se llega desde una tarjeta de la búsqueda. Los videos de canal (que llegan sin ficha de canción) también se reproducen; los privados o eliminados se omiten.
- **Radio.** Sale de la lista de sugerencias de YouTube Music (~50 canciones por pedido; la primera es la propia canción y se descarta). La afinidad con tu historial es moderada y no usa la señal de «saltar». Sin internet la cola simplemente termina, sin avisos.
- **Descargas.** Bajar audio de YouTube va contra sus términos de uso: las descargas son para uso personal y local, y es una decisión de quien usa la app. Una canción completa tarda menos de un segundo en bajar (medido con `VISIONOS`, que entrega Opus y AAC completos); si YouTube cambia eso, las descargas fallan igual que la reproducción (ver arriba). Las favoritas se guardan siempre en Opus y no cambian con el ajuste de calidad. Si el sistema dice que hay red pero no hay salida a internet, no aparece el aviso «Sin conexión» ni se atenúan las filas, pero un error de red en una canción no descargada salta a las descargadas que siguen en la cola (con el tope de 3 saltos); si no hay ninguna más adelante, se muestra el error de red de siempre.
- **Hecho para vos.** YouTube Music solo informa el **año** de un lanzamiento, no la fecha: «nuevo» en el Release Radar significa «visto por primera vez por la app» (ids guardados en `radar_seen`). La primera vez muestra los lanzamientos del año en curso, que incluye reediciones y remezclas; después solo cuentan los no vistos del año en curso o del anterior, para que un artista que recién entra entre tus favoritos no traiga todo su catálogo. Los artistas sugeridos salen de la sección «Fans might also like» de cada artista (el cliente va en inglés, y por eso el subtítulo de esas tarjetas aparece en inglés). Los mixes necesitan al menos 3 artistas con los que armarse. Un artista sin `channel_id` (solo nombre) no se consulta para el radar ni los sugeridos.
- **Contenido no disponible** (borrado, privado, restringido por región) se informa con un mensaje claro; en una cola se salta a la siguiente, con un tope de 3 saltos seguidos.
- MusicBrainz y Discogs no se usan: no apareció ninguna necesidad que YouTube.js no resuelva.

## Red y proxy

Todo el tráfico del proceso local (API de YouTube, descifrado y audio) usa `net.fetch` de Electron, es decir, la red de Chromium:

- respeta el **proxy del sistema** de Windows (incluidos PAC/WPAD y la autenticación integrada de Windows);
- usa los **certificados instalados en Windows**, que importa en redes que inspeccionan el tráfico TLS;
- sin proxy sale directo, igual que antes;
- no guarda cookies de YouTube (`credentials: 'omit'`).

Los fallos de red (`net::ERR_…`) se muestran como «Sin conexión…» en 1–2 s. Un certificado rechazado muestra un mensaje propio que menciona a IT, porque reintentar no lo arregla.

Verificado con `npm run e2e:ui`: arranca la app con un proxy local (`--proxy-server`), comprueba que la API de YouTube y el audio pasan por él, lo corta y confirma que la app avisa y se recupera. **No verificado:** un proxy corporativo real con PAC o autenticación NTLM/Kerberos.

## Seguridad

- `contextIsolation`, `sandbox`, sin `nodeIntegration`; el renderer solo ve `window.spotapleBridge` (métodos concretos, sin `ipcRenderer`).
- Política CSP: scripts propios, portadas solo de los dominios de imágenes de YouTube Music, audio solo por `spotaple-audio:`; sin conexiones directas a internet desde la interfaz.
- El IPC acepta únicamente llamadas de la propia página, y **todo** dato recibido se valida (formas, largos, `https` en portadas) antes de tocar la base.
- Títulos, artistas y portadas remotos se tratan como datos: React los escapa y no se usa HTML crudo.
- Navegación y ventanas nuevas bloqueadas; permisos del navegador denegados.
- No hay cuentas ni secretos: nada de sesión de YouTube se guarda ni se registra.
- Jam: la red vive en el proceso local, no en la interfaz (la CSP sigue sin permitir conexiones directas). Cada servidor de salas valida todo mensaje (tipos, largos, `https` en portadas, límite de 30 mensajes por segundo y cierre tras 20 inválidos) y la interfaz no puede enviar `hello`.

## Datos locales

SQLite (`node:sqlite`, incluido en Electron: no hay módulos nativos que reconstruir) con migraciones por `user_version`.

| Tabla | Contenido |
|---|---|
| `tracks` | metadatos de cada canción vista (id, título, artistas, álbum, duración, portada) |
| `favorites` | canciones favoritas |
| `playlists`, `playlist_items` | listas propias y su orden |
| `plays` | canciones que **realmente empezaron a sonar**; la columna `auto` marca las que puso la radio y avanzaron solas (no cuentan como gusto) |
| `selections` | canciones que solo se eligieron (pueden no haber sonado) |
| `downloads` | índice de las favoritas guardadas en el disco (`track_id`, `format` opus/aac, `bytes`, `created_at`); los archivos viven en `offline/<videoId>.<webm\|m4a>` dentro de la carpeta de datos y solo las favoritas tienen descarga |
| `generated_lists` | listas de «Hecho para vos» por período (`kind` semanal, mix, radar o artistas; `slot`; `period` en formato `YYYY-MM-DD`; título, subtítulo y las canciones, o los artistas si el tipo es `artists`, como JSON); se conservan los 2 períodos más nuevos de cada lista |
| `settings` | estado del reproductor (cola, índice, posición, volumen, modos), ajustes de la app (`app_settings`, un solo JSON validado al leer y al escribir) y del jam (`jam_member_id`, `jam_name`, `jam_last_mode`). `jam_name` es también el «nombre en las salas» de Ajustes; además `radar_seen` (ids de lanzamientos que el Release Radar ya mostró, hasta 2000) y `taste_reset_at` (marca de «Reiniciar mis gustos») |

Las playlists pertenecen a esta app; la sincronización con una cuenta de YouTube queda para más adelante.

## Sistema visual

Dirección: **la familiaridad de Spotify con la contención de Apple.** Tema oscuro en grafito con superficies apenas diferenciadas; **un único acento coral** que solo aparece donde significa algo (canción en curso, estados activos, acción principal); tipografía del sistema (Segoe UI Variable) con seguimiento más cerrado cuanto más grande; portadas protagonistas; densidad compacta con áreas cómodas. Todo sale de variables en `src/renderer/src/styles/tokens.css`. Hay cinco temas (Sistema, Grafito —el de siempre—, Claro, Medianoche y Océano) y el acento se puede cambiar desde **Ajustes**: redefinen las mismas variables y el contraste AA se audita en cada tema.

Movimiento breve con curva de desaceleración, respuesta inmediata al presionar, y `prefers-reduced-motion`, `prefers-reduced-transparency` y `prefers-contrast` respetados. Contrastes verificados (AA) y auditoría automática con axe-core sin problemas.

## Pruebas

**Automáticas** (no dependen de YouTube; `npm test`, `npm run typecheck`): cola y modos (aleatorio, repetición), máquina de estados del reproductor con audio simulado (la última elección gana, errores, reintentos, restauración), base de datos (favoritos, playlists, reorden, historial, persistencia en disco), protocolo de audio con respuestas controladas, mapeadores con la forma real de YouTube.js, el aislamiento del evaluador, el modo Jam (motor de sala, protocolo, reloj, servidores, cliente, sesión y conductor del reproductor), los ajustes (validación, guardado, acento derivado y aplicación al documento), la calidad de streaming (formato elegido y caché por calidad), las playlists de YouTube (mapeo de ítems de tipo desconocido y carga por páginas con tope), la radio (filtro, afinidad, regla de rachas, cuándo se pide y la marca de reproducciones automáticas) y las descargas (cola de 2, archivo atómico, descarga cortada, quitar una favorita mientras baja, reconciliación al abrir, archivo local con Range en el protocolo, exportar con nombre válido en Windows y el reproductor sin conexión) y «Hecho para vos» (perfil de gustos, períodos de renovación en hora local, armado del semanal, de los mixes y del radar, artistas sugeridos, una sola corrida a la vez, fallos que conservan lo anterior y reinicio de gustos).

**Reales** (contra YouTube; requieren internet y `npm run build`):

| Comando | Verifica |
|---|---|
| `npm run e2e` | abrir → buscar → **reproducir de verdad** → pausa/continuar → saltar de posición → cola → navegar → minimizar → playlist y favoritos → cerrar y reabrir → tamaños de ventana. `SPOTAPLE_EXE=ruta\Spotaple.exe` lo prueba sobre la versión empaquetada. |
| `npm run e2e:ui` | artista, álbum, menú, atajos, arrastrar la cola, diálogos, uso del proxy configurado, recuperación ante caídas de red (el proxy se corta) y contenido inexistente. |
| `npm run a11y` | axe-core WCAG 2.2 A/AA sobre las pantallas principales (incluidas las del Jam, Ajustes, una playlist de YouTube y la cola con radio automática; Inicio y Ajustes también con cada tema). |
| `npm run e2e:settings` | Ajustes de verdad: cambiar de tema (y el color de la barra de título nativa), acento, texto, densidad y animaciones; persistencia al cerrar y reabrir; ajustes corruptos en la base; con internet, «Reanudar al abrir» y que «Ahorro de datos» baje un formato más liviano (`NO_NETWORK=1` salta ese paso). |
| `npm run e2e:playlists` | playlists de la búsqueda: pestaña y tarjetas, abrir una, reproducirla entera (la cola trae todas), una lista de videos de canal y guardarla como playlist propia con doble clic (se crea una sola). |
| `npm run e2e:radio` | radio automática: al tocar una canción suelta la cola se llena sola con el separador, variedad de artistas sin rachas de 3, «siguiente», fin natural y elección a mano bien marcados en `plays.auto`, radio apagada (se encolan los resultados) y repetición activa (sin radio). |
| `npm run e2e:offline` | descargas de verdad: las favoritas se bajan solas, «Descargar canción» en Opus y en AAC (firma del archivo) y cancelar no hace nada, sin conexión (red de main cortada) suenan las descargadas y las demás se atenúan y se saltan, quitar una favorita borra su archivo y su fila, y en Ajustes el espacio usado, la descarga automática apagada y encendida y «Borrar todas las descargas». |
| `npm run e2e:audio` | el sonido de verdad: con los ajustes por defecto el audio sale del grafo de Web Audio (pico de señal medido), el ecualizador a −12 dB baja el RMS al menos 2,5× y «Restablecer» lo devuelve, «Normalizar» deja a cada canción con la ganancia que dicta su loudness (y de vuelta a 1 al apagarlo con la canción sonando), todo persiste entre sesiones, los ajustes de ecualizador corruptos en la base se descartan, y una favorita descargada suena del disco sin red (CORS + Range desde el archivo) con el loudness guardado, y con 4 s de fundido, a 6 s del final, los dos elementos suenan a la vez, cambia el título, queda uno solo y el que se apagó vuelve a volumen 1, y una descargada sin loudness guardado lo completa al reproducirla con «Normalizar» activo. |
| `npm run e2e:foryou` | «Hecho para vos» de verdad, con historial sembrado desde 4 artistas reales: con 14 reproducciones y 4 favoritas no aparece nada; con datos suficientes aparecen el semanal, ≥ 3 mixes, el radar y ≥ 6 artistas sugeridos que no son los tuyos; la página del semanal trae ≥ 20 canciones sin repetidos ni lo ya escuchado, suena y se guarda como una sola playlist; sin red al abrir (red de main cortada) se ven las listas anteriores sin avisos de error; y en Ajustes se apaga y enciende, y «Reiniciar mis gustos» las vacía sin tocar el historial ni las favoritas. |
| `npm run e2e:jam` | dos instancias de Electron (admin y miembro) con música real: crear sala y unirse, pedir canciones, like, saltar, pasar a "Todas" y comprobar la sincronía, cerrar y reabrir, y lo mismo por la interfaz. `JAM_KIND=internet` con `SPOTAPLE_JAM_RELAY=ws://127.0.0.1:8788` lo prueba contra un relé (`npm run relay:node -- 8788` o `wrangler dev`); `E2E_VERBOSE=1` muestra qué ve cada app si un paso falla. |
| `npm run check:youtube` | qué clientes de YouTube entregan hoy el audio completo. |
| `npm run check:jam` | si dos PCs (o esta y el relé) pueden hablarse por WebSocket: `listen`, `connect <ip>:<puerto>` y `url <ws://…>`. |
| `npm run check:relay -- <ws(s)://relé>` | dos clientes contra el relé: crear y unir sala, ping/pong, canción compartida, likes, cambio de modo y traspaso de admin. Cierra la sala de prueba al terminar; no reproduce audio. |

Capturas de los recorridos en `.e2e/`. No se probó con lector de pantalla real. Las pruebas e2e del build de Windows corren sobre su carpeta interna `win-unpacked`. El modo Jam se verificó en una sola PC con dos instancias: red local, relé Node, Cloudflare con `wrangler dev` y el relé desplegado `spotaple-jam.alexisdaleiro.workers.dev`. El 6 de noviembre de 2026 pasaron los 9 pasos de `e2e:jam` contra Cloudflare por internet con la URL predeterminada de la app, tanto desde el proyecto como con el ejecutable empaquetado. **No se probó** en una red de oficina real ni con un proxy que solo deje salir por HTTP.

## Diagnóstico

- `SPOTAPLE_DEBUG=1` imprime una línea por pedido de audio (sin URLs ni credenciales).
- En la consola de la interfaz: `localStorage.debugAudio = '1'` y recargar traza los eventos del audio.
- `SPOTAPLE_USER_DATA=<carpeta>` usa otra carpeta de datos (así se prueba sin tocar tu biblioteca).
