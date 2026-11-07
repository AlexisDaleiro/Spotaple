# Spotaple: descubrimiento, radio, descargas y ajustes — diseño

Fecha: 2026-11-06 · Estado: borrador para aprobación · Rama sugerida: `feat/descubrimiento-ajustes`

## 1. Intención

Hoy Spotaple reproduce lo que le pedís y se corta: si tocás una canción suelta, la cola es la lista donde estaba (resultados, álbum, favoritas) y cuando termina no pasa nada. La reproducción "se centra mucho en la misma canción". El dueño quiere que la app se comporte como Spotify o YouTube Music: que elija música que le puede gustar, que le muestre artistas y portadas nuevas, que sus favoritas suenen sin internet, que pueda guardar cualquier canción como archivo y que casi todo se pueda configurar.

Es una app personal (un solo usuario, Windows, Electron + React + `youtubei.js`, sin cuenta de YouTube). Todo lo "personal" sale del historial local (`plays`, `favorites`), no de una cuenta.

## 2. Alcance

Cinco bloques, en este orden de construcción (cada uno se puede entregar solo):

1. **Ajustes** (1a: página, tema, calidad, preferencias · 1b: ecualizador, normalización, crossfade)
2. **Playlists en la búsqueda**
3. **Radio automática** (cola infinita inteligente)
4. **Descargas y offline** (favoritas offline + "Descargar canción" en 2 formatos)
5. **Hecho para vos**: Descubrimiento semanal, Mixes diarios, Release Radar y "Artistas que podrías escuchar"

### Objetivos
- Tocar una canción nunca deja la cola vacía ni repite la misma canción en bucle.
- La música sugerida mezcla el mismo artista y artistas afines, y se inclina hacia tus gustos.
- Las portadas y los artistas sugeridos son protagonistas visuales en Inicio.
- Las favoritas suenan sin conexión, automáticamente.
- Cualquier canción se puede guardar como archivo desde el clic derecho, en al menos 2 formatos.
- Una página de Ajustes cubre apariencia, sonido, reproducción y el resto de la app, con efecto inmediato.
- Una playlist encontrada en la búsqueda se reproduce como cualquier playlist.

### No objetivos
- Iniciar sesión en YouTube / usar datos de la cuenta.
- MP3 u otra conversión (exigiría empaquetar ffmpeg, ~70 MB).
- Etiquetas (tags) y portada dentro de los archivos exportados.
- Iniciar con Windows, bandeja del sistema, atajos de teclado configurables, otros idiomas.
- Seguir artistas (no existe el concepto de "seguir"; ver Release Radar).
- Letras, podcasts, sincronización entre dispositivos.

### Anti-objetivos (fallaría aunque "funcione")
- Que la radio meta canciones dentro de una sala Jam, o contra un `repeat` explícito del usuario.
- Que una descarga, la generación de listas o la radio bloqueen la interfaz o la reproducción en curso.
- Que una URL de audio llegue al renderer o se guarde (regla existente: solo `videoId`).
- Que Inicio muestre listas "inteligentes" vacías o con pocos datos y parezcan rotas.
- Que cambiar de tema o de calidad deje la ventana a medias (barra de título nativa con colores viejos).

## 3. Restricciones y hechos verificados en el código

- **Proveedor:** `src/main/music/youtube/provider.ts` usa `youtubei.js` 18.3.0. `Music` expone `search(query, filters)`, `getPlaylist(id)`, `getUpNext(videoId, automix?)`, `getRelated(videoId)`, `getExplore()`, `getHomeFeed()` (verificado en `Music.d.ts`). `PlaylistPanelVideo` trae `video_id`, `title`, `artists[{name,channel_id}]`, `album{id,name,year}`, `duration`, `thumbnail`. `Playlist` tiene `getContinuation()` y `has_continuation`. Los álbumes de artista (`MusicTwoRowItem`) traen solo `year`, **no fecha exacta**.
- **Audio:** solo el cliente `VISIONOS` entrega el archivo completo (`assertFullRange`). El renderer solo conoce el `videoId`; `spotaple-audio://track/<id>` lo sirve `audio-protocol.ts` con soporte de Range y reintento si la URL caduca. `api.music.prepare(id)` resuelve la fuente remota y falla sin internet.
- **Esquema `spotaple-audio`:** registrado con `standard, secure, supportFetchAPI, stream` y **sin `corsEnabled`** (`src/main/index.ts`). CSP: `media-src spotaple-audio:`. Un `<audio>` conectado a Web Audio (`createMediaElementSource`) con medio sin CORS emite silencio.
- **Base de datos:** SQLite (`node:sqlite`), migraciones en el arreglo `MIGRATIONS` (solo se agregan al final; `PRAGMA user_version`). Ya existen `plays`, `selections`, `favorites`, `playlists`, `playlist_items`, `tracks` y `settings(key, value JSON)`. `getSetting/setSetting` existen en `store.ts` pero **no hay IPC de ajustes** hacia el renderer.
- **IPC:** patrón único: canal en `src/shared/api.ts` → método en `src/preload/index.ts` → manejador en `src/main/ipc.ts` con validación en `src/main/validate.ts` → `src/renderer/src/api.ts`. Los errores viajan como `IpcResult`.
- **Tema:** `tokens.css` solo define el tema oscuro (`color-scheme: dark`, un acento coral). `main/index.ts` fija `backgroundColor` y `titleBarOverlay` (color y símbolo) con constantes.
- **Reproductor:** `createPlayer` en `player/player.ts` es una sola instancia sobre un único `<audio>` (`AudioLike`); `hydrate` deja la sesión en pausa; dentro de una sala Jam `jam.active()` redirige los pedidos a la sala.
- **Sin internet:** Inicio, biblioteca y favoritas se leen de la base local; la búsqueda y todo lo remoto ya muestran error controlado.

## 4. Decisiones

### 4.1 Del dueño (conversadas)
- Radio automática que mezcla el mismo artista y otros afines, apoyada en el historial y favoritas; álbum/playlist suenan en su orden y al terminar sigue la radio; se puede apagar en Ajustes.
- Descubrimiento semanal estilo Spotify: sección propia en Inicio, portada grande, ~30 canciones, se renueva cada lunes, portadas y artistas sugeridos como protagonistas. También **Mixes diarios** y **Release Radar**.
- Las playlists de la búsqueda se reproducen "como en YouTube": página propia con las canciones y botón reproducir.
- Favoritas offline automáticas; "Descargar canción" por clic derecho con ≥ 2 formatos (elección delegada).
- Ajustes: criterio delegado, tomando lo pedido (tema, calidad de sonido, sonido, reproducción, configuración general) y lo que ofrece Spotify.

### 4.2 Mías (el dueño las puede cambiar)
- **Formatos de exportación:** Opus (`.webm`, mejor calidad por peso) y AAC (`.m4a`, compatible en todos lados). Sin conversión.
- **Nombre de archivo:** `Artista - Título.ext`, saneado para Windows. Guardado con el diálogo nativo "Guardar como" cada vez.
- **Favoritas offline:** se guardan en `userData/offline/<videoId>.<ext>`; se borran al quitar de favoritas; se sirven desde el archivo aunque haya internet (ahorra datos). Las favoritas ya existentes se bajan en segundo plano la primera vez.
- **Calidad de streaming:** dos opciones (Alta, Ahorro), no tres. "Automática" sería igual a "Alta" mientras no se mida la red; se agrega si hace falta.
- **Canción suelta desde la búsqueda:** suena sola y sigue la radio (no se encola todo el listado de resultados). Desde álbum, playlist, favoritas, recientes y Biblioteca: la lista en orden, y la radio al final.
- **Radio y `repeat`:** si `repeat` es `all` o `one`, la radio no corre (el usuario pidió bucle). Nunca corre dentro de una sala Jam.
- **Sin señal de "saltar":** v1 usa solo reproducciones y favoritas. Registrar saltos queda para si la radio se siente floja.
- **Guardar en biblioteca:** una playlist remota o generada se copia a una playlist local con un botón.
- **Los controles de una función aparecen en Ajustes cuando esa función existe** (no hay interruptores que no hagan nada).
- **Crossfade** es la parte más cara (hay que tener dos elementos de audio y precargar la siguiente). Va en la fase 1b y se puede recortar si el spike muestra problemas. Deshabilitado dentro de una sala Jam (sincronización).
- **Sin conexión con favoritas sin bajar:** el reproductor salta las canciones sin archivo local mientras no hay internet (hoy un error de red solo avisa y se detiene). En favoritas y Biblioteca esas canciones se ven atenuadas sin conexión, y «reproducir todo» usa solo las disponibles.
- **Archivos de favoritas:** siempre Opus en calidad Alta (se bajan una sola vez; el ahorro de datos del streaming no aplica). Cambiar ajustes no dispara re-descargas.
- **«Formato por defecto» de descargas:** solo decide cuál de los dos formatos aparece primero en el submenú «Descargar canción». No toca los archivos de favoritas.
- **Radio y gustos:** las reproducciones que empiezan solas desde un ítem de la radio se marcan `auto` en `plays` (columna nueva, migración en la fase 3). Cuentan en «Recientes» y en la exclusión de "ya reproducido", pero **no** en el perfil de gustos, para que la radio no se alimente de sí misma. Una canción de la radio que elegís a mano cuenta como normal. La marca se pierde en la cola restaurada al reabrir la app (techo aceptado: esas canciones pasan a contar como normales).
- **Radio apagada:** tocar una canción suelta en la búsqueda encola los resultados desde esa canción, como hoy.
- **Release Radar, primera vez:** muestra los lanzamientos del año en curso como radar inicial y los marca como vistos. Los ids vistos se guardan en la clave de ajustes `radar_seen` (tope ~2000), sin tabla nueva.
- **Fuera de Ajustes: «repetir y aleatorio por defecto».** El reproductor ya recuerda el último estado, y un `repeat=all` olvidado en un ajuste apagaría la radio sin que se note.
- **«Reiniciar mis gustos»:** ignora las reproducciones **y las favoritas agregadas** antes de la marca, y también reinicia la afinidad que usa la radio. No borra el historial ni las favoritas.

## 5. Diseño por fase

### Fase 1a — Ajustes (página, apariencia, calidad, preferencias)

- **Modelo:** un objeto `AppSettings` con valores por defecto en `src/shared/settings.ts`, guardado como un único JSON bajo la clave `app_settings` de la tabla `settings` (sin migración). Main valida con lista blanca de claves y rangos (`validate.ts`); claves/valores desconocidos se descartan.
- **IPC:** `settings:get` (todo) y `settings:set` (parche parcial). Un evento `settings:changed` no hace falta: hay una sola ventana.
- **Renderer:** `stores/settings.ts` (zustand) carga al arrancar, aplica de inmediato y persiste con un pequeño retraso. Nueva página `settings` en `stores/nav.ts`, con engranaje en la barra lateral (y en el riel de iconos).
- **Apariencia:**
  - Tema: Sistema / Oscuro (actual, "Grafito") / Claro / "Medianoche" (negro puro) y 1 o 2 temas más a elección del implementador. Se definen como `:root[data-theme="…"]` sobre los mismos tokens.
  - Acento libre: un selector de color; las variantes (`--accent-hover/-press/-soft/-ink`) se derivan por cálculo HSL, y el color de texto sobre el acento (`--accent-ink`) se elige por contraste.
  - Tamaño de texto (escala sobre `--fs-*`), densidad (compacta/cómoda, afecta alto de filas y `--gap`), reducir animaciones (además de `prefers-reduced-motion`).
  - La barra de título nativa debe seguir al tema: IPC para `win.setTitleBarOverlay({ color, symbolColor })` y `backgroundColor`.
- **Calidad de streaming:** Alta (hoy: Opus mejor calidad) y Ahorro (formato de audio de menor bitrate vía `chooseFormat`). La opción forma parte de la clave de la caché de `resolveAudio` y de `prepare`; al cambiarla se invalida la caché.
- **Reproducción:** reanudar al abrir la app (hoy `hydrate` siempre deja en pausa). Nota: reproducir sin gesto del usuario puede estar bloqueado por la política de autoplay; el implementador debe probarlo y, si hace falta, ajustar `autoplayPolicy` en `webPreferences`.
- **Salas (Jam):** exponer el nombre por defecto que `jam/session.ts` ya guarda en `settings`.
- **Acerca de:** versión de la app.

### Fase 1b — Ajustes de audio (ecualizador, normalización, crossfade)

**Spike previo obligatorio:** confirmar que el audio puede pasar por Web Audio con el esquema propio. Probable requisito: `corsEnabled: true` en `registerSchemesAsPrivileged`, cabecera `Access-Control-Allow-Origin` en las respuestas de `audio-protocol.ts` y `crossOrigin="anonymous"` en el `<audio>`. Sin esto, el ecualizador deja la app muda. Si el spike falla, 1b se difiere y 1a sigue.

- **Ecualizador:** 10 bandas (filtros biquad) + preamplificador, con presets (Plano, Más graves, Más agudos, Voz, Rock, Pop, Electrónica, a elección). Un solo grafo de audio creado una vez sobre el elemento existente.
- **Normalizar volumen:** si `getBasicInfo` entrega el nivel de loudness (campo a verificar, p. ej. `player_config.audio_config.loudness_db`), aplicar una ganancia por canción hacia un objetivo fijo; si no viene, sin ajuste. No inventar una medición propia.
- **Crossfade (0–12 s):** dos elementos de audio alternados, precarga de la siguiente (`api.prepare` anticipado) y rampas de volumen. Recortable (ver 4.2).

### Fase 2 — Playlists en la búsqueda

- **Tipos:** `RemotePlaylistSummary { id, title, author?, trackCount?, thumbnail? }` y `RemotePlaylistDetail extends RemotePlaylistSummary { tracks: Track[]; truncated: boolean }`. `SearchResults` gana `playlists: RemotePlaylistSummary[]`.
- **Proveedor:** `search` agrega una cuarta consulta `type: 'playlist'` dentro del mismo `Promise.allSettled` (cuenta para `partial`). Nuevo `getPlaylist(id)` con `yt.music.getPlaylist` y continuaciones hasta un tope (p. ej. 200 canciones; `truncated` si hay más). Mapeadores nuevos `mapRemotePlaylist` y reutilizar `mapTrack` para los ítems. Spike: confirmar los campos reales del ítem de playlist (`item_type`, `id`, `author`, `item_count`, miniaturas) ampliando `scripts/probe.mjs`.
- **IPC:** `music:remote-playlist` con validación del id (patrón de ids de YouTube).
- **UI:** pestaña «Playlists» y una fila de tarjetas en «Todo» (reutilizar `Shelf` y el estilo de `PlaylistCard`). Nueva página `remotePlaylist` basada en `AlbumPage`: portada, nombre, autor, cantidad, reproducir, cola, menú contextual de canciones y **«Guardar en mi biblioteca»** (usa `createPlaylist` + `addToPlaylist` existentes; sin código nuevo en main). Si `truncated`, aviso "Mostrando las primeras N canciones".
- **Reproducir:** `playTracks(tracks, 0)`; al terminar, sigue la radio (fase 3).
- **Pruebas:** mapeadores con datos simulados (`tests/mappers.test.ts` se amplía).

### Fase 3 — Radio automática

- **Motor (main):** `src/main/music/radio.ts` con una función pura de ordenamiento y una de obtención.
  - Candidatos: `yt.music.getUpNext(seedVideoId, true)` (automix de YouTube Music). Si devuelve vacío o falla: respaldo con las canciones populares del artista de la semilla (`getArtist` ya existe).
  - Filtro: fuera lo que ya está en la cola, lo reproducido en las últimas ~50 reproducciones y duplicados por título+artista.
  - Orden local: la posición que da YouTube pesa más; se suma un empujón moderado por afinidad del artista (reproducciones recientes con vida media ~45 días + favoritas con peso mayor); regla dura de **no más de 2 seguidas del mismo artista**.
  - Todas las constantes (tamaño del lote ~20, umbral de relleno, vida media, pesos) en un solo archivo, calibrables.
- **IPC:** `music:radio({ seedId, excludeIds })` → `Track[]`. El renderer no calcula afinidad; main la lee de la base.
- **Disparo (renderer, en `player.ts`):** cuando quedan menos de 3 canciones por sonar, la radio está activada (ajuste), no hay sala Jam activa y `repeat` es `off`: pedir un lote con semilla = canción actual y agregarlo. Marcar esos ítems con `auto: true` en `QueueItem` para que `QueuePanel` muestre un separador «Radio automática».
- **Canción suelta de la búsqueda:** con la radio activada, `Search.tsx` pasa `[canción]` en vez de todos los resultados (ver 4.2). Con la radio apagada, mantiene el comportamiento actual (encola los resultados desde esa canción).
- **Marca `auto`:** migración nueva `ALTER TABLE plays ADD COLUMN auto INTEGER NOT NULL DEFAULT 0`. `recordPlay` recibe la marca (IPC `lib:record-play` ampliado y validado). Una reproducción es `auto` solo si el ítem vino de la radio y avanzó por sí solo (no si el usuario lo eligió). El perfil de gustos ignora las `auto`.
- **Fallos:** si la red falla, un solo aviso discreto y no reintentar hasta cambiar de canción (evita bucles). Sin internet: silencio, la cola simplemente termina.
- **Pruebas:** `tests/radio.test.ts` (orden, filtro, regla de artistas seguidos) y casos nuevos en `tests/player.test.ts` (dispara, no dispara en sala/repeat/ajuste apagado).
- **Spike previo:** forma real de `getUpNext(…, true)` y si trae continuación; verificarlo con una sonda.

### Fase 4 — Descargas y offline

- **Almacenamiento:** migración nueva: `downloads(track_id TEXT PRIMARY KEY REFERENCES tracks(id), format TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL)`. Archivos en `userData/offline/`. Las exportaciones del usuario no se registran (van a la ruta elegida).
- **Servicio de offline (main):** `src/main/offline.ts` con cola de 2 descargas simultáneas, descarga a `.part` y renombrado al terminar, reintento con re-resolución si la URL caduca (reutilizar la lógica de `audio-protocol.ts`; extraerla a una función común en vez de duplicarla). Al arrancar, reconcilia: favoritas sin archivo → encolar; archivos huérfanos → borrar. `toggleFavorite` encola o borra.
- **Reproducción offline:** `audio-protocol.ts` mira primero si hay archivo local y lo sirve con Range (200/206/416). `music:prepare` devuelve de inmediato (mimeType por la extensión, duración de la tabla `tracks`) si el archivo existe, sin tocar la red.
- **Sin conexión y favoritas sin bajar:** `player.ts` trata un error de red de `prepare` en una canción sin archivo local, estando sin conexión, como "no disponible" y pasa a la siguiente (con el tope de saltos actual). La interfaz atenúa esas canciones y «reproducir todo» filtra a las disponibles (ver 4.2).
- **Archivos de favoritas:** Opus Alta, siempre; sin re-descargas al cambiar ajustes (ver 4.2).
- **Exportar:** submenú «Descargar canción» en el clic derecho (`ContextMenu` ya soporta `submenu`) con «Opus (.webm)» y «AAC (.m4a)». IPC `music:export({ track, format })`: main abre `dialog.showSaveDialog` (el renderer **nunca** pasa una ruta), nombre sugerido saneado (caracteres inválidos de Windows, longitud, punto final), y descarga a esa ruta. `resolveAudio` gana un parámetro de formato (con la clave de caché incluyendo el formato); para M4A elegir un formato AAC con `chooseFormat`. Si la favorita ya está en el formato pedido, copiar el archivo local.
- **Interfaz:** ícono "disponible offline" en `TrackRow` de las favoritas; progreso discreto; banner "Sin conexión" cuando `navigator.onLine` es falso. Evento `offline:state` (main → renderer, como `jam:state`) con ids descargados y pendientes.
- **Ajustes (aparecen con esta fase):** descargar favoritas automáticamente (sí/no), formato que aparece primero en el submenú «Descargar canción», espacio usado y «Borrar todas las descargas».
- **Spikes previos:** (1) velocidad real de una descarga completa desde `googlevideo` (si va estrangulada a velocidad de reproducción, 5 favoritas tardan minutos: la UI debe ser honesta sobre eso); (2) que `VISIONOS` entregue un formato AAC/M4A y no solo Opus.
- **Aviso legal:** bajar audio de YouTube va contra sus términos. Uso personal y local; decisión del dueño, consistente con que la app ya usa un cliente no oficial.

### Fase 5 — Hecho para vos

- **Perfil de gustos (main, función pura + pruebas):** de `plays` no `auto` (últimas ~500, con vida media ~45 días) y `favorites` (peso mayor) se obtiene un ranking de artistas (clave: `channel_id` si existe, si no el nombre). `tasteResetAt` (ajuste) permite "Reiniciar mis gustos" sin borrar nada: se ignoran las reproducciones y las favoritas agregadas (`favorites.added_at`) anteriores a esa marca. La misma función de perfil alimenta la afinidad de la radio.
- **Mínimo de datos:** la sección no aparece hasta tener un umbral (propuesta: ≥ 15 reproducciones o ≥ 5 favoritas; constante en un archivo).
- **Persistencia y renovación:** migración nueva `generated_lists(kind TEXT, slot TEXT, period TEXT, title TEXT, subtitle TEXT, tracks TEXT /* JSON */, created_at INTEGER, PRIMARY KEY(kind, slot, period))`. Se genera de forma perezosa al montar Inicio si no hay fila del período actual, en segundo plano, mostrando la anterior mientras tanto. Períodos: **semanal** = semana ISO (lunes); **diario** = fecha local; **Release Radar** = el viernes anterior o actual. Si la generación falla, se conserva la anterior y se reintenta en la próxima apertura.
- **Descubrimiento semanal (~30):** semillas = canción más escuchada de cada uno de los ~8 artistas top; candidatos = unión de `getUpNext` de esas semillas; se descarta todo lo ya reproducido o en favoritas; se priorizan artistas que nunca escuchaste; máximo 2 por artista; intercalado entre semillas.
- **Mixes diarios (3 a 6):** cada mix se ancla en uno de los artistas top: mitad canciones que ya conocés de ese artista y afines (de la base local), mitad radio del ancla. Nombre «Mix N» con subtítulo "Artista A, Artista B y más". La mezcla usa una semilla derivada de la fecha, así es estable durante el día. No se hace agrupamiento por similitud entre artistas: la radio de cada ancla ya lo da.
- **Release Radar:** para los ~15 artistas top con id: `getArtist` → álbumes y sencillos. **YouTube Music solo da el año**, así que "nuevo" = **visto por primera vez por la app**, no fecha de lanzamiento: se guarda el conjunto de ids de lanzamientos ya vistos; la primera ejecución muestra los del año en curso como radar inicial (y los marca vistos); desde ahí solo cuentan los ids nuevos. Los ids vistos van en la clave de ajustes `radar_seen` (tope ~2000), sin tabla nueva. Cada lanzamiento nuevo se expande con `getAlbum`; tope de 30 canciones, más nuevos primero. Sin novedades, se mantiene el radar anterior con su fecha.
- **Artistas que podrías escuchar:** de `getArtist` de los 3 o 4 artistas top, leer la sección de artistas similares (título `fans might also like` con el cliente en inglés; a verificar) y mostrar foto y nombre; tocar abre `ArtistPage`. Excluir artistas ya presentes en el historial.
- **UI:** en Inicio, arriba de lo actual: fila «Hecho para vos» con tarjetas grandes (portada en mosaico de 4 portadas para listas generadas, estilo `PlaylistCard`) y fila «Artistas que podrías escuchar» con círculos. Nueva página `generated` (solo lectura, parecida a `PlaylistPage`) con «Guardar en mi biblioteca». Al terminar cualquiera, sigue la radio.
- **Ajustes (aparecen con esta fase):** activar/desactivar «Hecho para vos», «Reiniciar mis gustos».
- **Spikes previos:** títulos reales de las secciones del artista; que `getUpNext` por semilla sea suficientemente variado entre artistas; el campo `year` de los lanzamientos.

## 6. Transversal

- **Seguridad:** main valida toda entrada de IPC (ids con patrón, lista blanca de ajustes, rutas de exportación solo por diálogo nativo). CSP sin cambios, salvo lo que exija el spike de Web Audio (no debería tocar `connect-src`).
- **Textos:** español, con voseo en la interfaz, igual que el resto de la app.
- **Migraciones:** solo se agregan al final de `MIGRATIONS` (fase 3: columna `plays.auto`; fase 4: `downloads`; fase 5: `generated_lists`; los lanzamientos vistos van en `settings`).
- **Pruebas y verificación por fase:** `npm run typecheck`, `npm test`, `npm run e2e`, `npm run e2e:ui`, `npm run a11y`; ampliar `scripts/e2e*.mjs` con el flujo nuevo cuando la fase toque la interfaz. Los claims se respaldan con corridas reales, no con lectura de código.
- **Entrega:** un solo ejecutable portable (política vigente de empaquetado); actualizar el README con cada fase.

## 7. Lo que queda a criterio del implementador

- Paletas exactas de los temas extra y de los presets del ecualizador.
- Valores finales de las constantes de la radio, los umbrales de "Hecho para vos" y los topes (200 canciones por playlist remota, 30 por lista generada).
- Diseño visual fino de las tarjetas de «Hecho para vos» y de la página de Ajustes (dentro del sistema visual existente: grafito + un acento).
- Estructura interna de los módulos nuevos, mientras respeten el patrón IPC actual y no dupliquen la lógica de reintento de audio.
- Qué hacer si un spike falla: recortar esa pieza (1b, crossfade, Release Radar por "visto por primera vez"), avisar y seguir con el resto.
