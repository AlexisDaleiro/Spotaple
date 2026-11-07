# Playlists en la búsqueda (fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la búsqueda muestre playlists de YouTube Music (pestaña y fila de tarjetas) y que cada una se abra en su propia página, se reproduzca entera y se pueda guardar como playlist propia.

**Architecture:** La búsqueda suma una cuarta consulta `type: 'playlist'` dentro del mismo `Promise.allSettled`; un nuevo `getPlaylist(id)` del proveedor trae las canciones (con continuaciones hasta un tope) y los mapeadores tolerantes de `mappers.ts` las convierten a `Track`. La interfaz reutiliza `Shelf`, `Hero`, `TrackList` y la estructura de `AlbumPage`; «Guardar en mi biblioteca» usa las acciones de `useLibrary` que ya existen.

**Tech Stack:** Electron 45, React 19, zustand 5, TypeScript, `youtubei.js` 18.3.0, vitest (entorno `node`), playwright-core (e2e).

**Spec:** `docs/superpowers/specs/2026-11-06-descubrimiento-offline-ajustes-design.md` (§5 «Fase 2»). Los datos reales salen del spike de esta fase (sección siguiente), que corrige tres puntos del spec.

## Hallazgos del spike (verificados contra YouTube Music el 2026-11-07)

- **Búsqueda `type: 'playlist'`:** un solo estante `MusicShelf` de 20 ítems `MusicResponsiveListItem` con `item_type: 'playlist'` (y `has_continuation: true`, que esta fase no usa). `id` **viene con prefijo `VL`** (`VLPLwO8Yaz8URbq0HdSG3VFeCIUSGpsjbCtH`); `getPlaylist` acepta el id con o sin `VL`. `title` es el nombre. El autor está en `author: { name, channel_id }` y también en `flex_columns[1]` como `«Adam Is very weird • 281K views»`. **`item_count` y `subtitle` llegan vacíos: la búsqueda no trae la cantidad de canciones.**
- **Miniaturas:** o bien cuadradas `https://yt3.googleusercontent.com/…=s1200` / `=s576` / `=s192` (el renderer ya las reduce con `thumbUrl`), o bien un frame de video 16:9 de `i.ytimg.com/vi/<id>/hqdefault.jpg…` (400×225 a 853×480, no reducible). Ambos dominios están permitidos por la CSP.
- **`getPlaylist`:** cabecera `MusicResponsiveHeader`: `title`, `thumbnail.contents` (3 tamaños), `subtitle` = `["Playlist"," • ","2022"]` y `second_subtitle` = `["281K views"," • ","75 tracks"," • ","5 hours, 13 minutes"]` (en inglés: el cliente se crea con `lang: 'en'`). **El autor no está en la cabecera** (`strapline_text_one` = `N/A`, `author` indefinido). Las canciones: 54, 75 y 100 ítems en la primera página; las listas largas traen ~101 y `has_continuation: true`; `getContinuation()` devuelve otro objeto `Playlist` con el resto (113 pistas = 101 + 12).
- **Los ítems de canción pueden venir con `item_type: 'unknown'` e `id` indefinido** (por ejemplo, listas de videos de un canal: 54 de 54 ítems). Entonces el `videoId` solo está en `overlay.content.endpoint.payload.videoId`, la duración solo en `fixed_columns[0].title` (`1:53:55`) y el artista en `flex_columns[1]`. `mapTrack` hoy los rechazaría a todos y la playlist saldría vacía. Los de tipo `video` sí traen `id`, `duration.seconds` y `authors`.

**Qué cambia respecto del spec:** (1) `RemotePlaylistSummary` no lleva `trackCount` (la búsqueda no lo da); sí lo lleva `RemotePlaylistDetail`, leído de `second_subtitle`. (2) El autor de la página de detalle viaja en la ruta desde la tarjeta (`{ page: 'remotePlaylist', id, author? }`), porque la cabecera no lo trae. (3) Hace falta un mapeador propio de canciones de playlist (`mapPlaylistTrack`) que cubra los ítems `unknown`.

## Global Constraints

- Rama de trabajo `feat/playlists-busqueda`, creada desde `main` antes de la Tarea 1. Commits en español con prefijo convencional (`feat(playlists): …`) que terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Sin push ni merge sin que el usuario lo pida.
- Textos de interfaz en español con voseo.
- Patrón IPC único: canal en `src/shared/api.ts` → método en `src/preload/index.ts` → manejador en `src/main/ipc.ts` (validando con `id()` de `src/main/validate.ts`) → `src/renderer/src/api.ts` (que ya envuelve todo `SpotapleApi`). Los errores viajan como `IpcResult`.
- Los datos remotos son **datos no confiables y a veces incompletos**: todo en los mapeadores es opcional y se recorta (`txt`, `bestThumb`, ids con patrón).
- La búsqueda suma la cuarta consulta **dentro del mismo `Promise.allSettled`** y cuenta para `partial`.
- Tope de canciones por playlist remota: **200**; si hay más, `truncated: true` y la página dice «Mostrando las primeras N canciones…».
- La playlist remota es **de solo lectura**; «Guardar en mi biblioteca» la copia a una playlist propia con `createPlaylist` + `addToPlaylist` existentes (sin código nuevo en main).
- Reproducir = `playTracks(tracks, 0)` (dentro de una sala, el gancho jam ya lo reduce a pedir una canción). La radio al terminar es de la fase 3.
- CSP sin cambios. Ninguna URL de audio llega al renderer.
- Verificación por tarea: `npm run typecheck` y `npm test`; al final también `npm run build`, `npm run e2e:playlists`, `npm run a11y`, `npm run e2e` y `npm run e2e:ui`.

## Review Focus

1. **Playlist cuyos ítems son todos de tipo `unknown`** (videos de canal): se ven sus canciones, no una lista vacía (Tareas 1 y 4).
2. **Ítems privados o eliminados** (sin `videoId`): se omiten sin error y el resto se muestra (Tarea 1).
3. **Playlist de más de 200 canciones** (p. ej. 500): se cargan las primeras 200 y se avisa cuántas se muestran y de cuántas (Tareas 2 y 3).
4. **Una continuación que falla a mitad de camino** (se corta la red): se muestra lo ya cargado con el aviso, no un error (Tarea 2).
5. **Doble clic en «Guardar en mi biblioteca»:** se crea una sola playlist (Tareas 3 y 4).

## File Structure

Crear:
- `src/main/music/youtube/playlist.ts` — `MAX_PLAYLIST_TRACKS`, `PlaylistPage`, `collectPlaylistItems`.
- `src/renderer/src/pages/RemotePlaylistPage.tsx` — la página de una playlist remota.
- `scripts/e2e-playlists.mjs`.
- Pruebas: `tests/playlist-collect.test.ts`.

Modificar: `src/shared/types.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/music/provider.ts`, `src/main/music/youtube/provider.ts`, `src/main/music/youtube/mappers.ts`, `src/renderer/src/lib/actions.ts`, `src/renderer/src/components/Shelf.tsx`, `src/renderer/src/stores/nav.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/pages/Search.tsx`, `scripts/a11y.mjs`, `package.json`, `README.md`, `tests/mappers.test.ts`, `tests/audio-protocol.test.ts` (el proveedor falso necesita el método nuevo).

---

### Task 1: Tipos y mapeadores de playlist

**Files:**
- Modify: `src/shared/types.ts`, `src/main/music/youtube/mappers.ts`
- Test: `tests/mappers.test.ts`

**Interfaces:**
- Produces (en `src/shared/types.ts`):
  - `interface RemotePlaylistSummary { id: string; title: string; author?: string; thumbnail?: string }`.
  - `interface RemotePlaylistDetail extends RemotePlaylistSummary { tracks: Track[]; trackCount?: number; truncated: boolean }`.
  - `SearchResults` gana `playlists: RemotePlaylistSummary[]` (campo obligatorio).
- Produces (en `src/main/music/youtube/mappers.ts`):
  - `mapRemotePlaylist(item: Node): RemotePlaylistSummary | null` — `null` si `item_type !== 'playlist'`, si no hay `id` con patrón `/^[\w-]{6,64}$/` o si no hay título.
  - `mapPlaylistTrack(item: Node): Track | null` — como `mapTrack`, pero acepta ítems `unknown`: `id` = `item.id` o `item.overlay?.content?.endpoint?.payload?.videoId`; duración = `item.duration?.seconds` o la de `fixed_columns[0].title` leída como `h:mm:ss` o `m:ss`; `null` si no hay `videoId` usable.
  - `parseTrackCount(parts: string[]): number | undefined` — la cantidad de la parte `«N track(s)»` (admite comas de miles); `undefined` si ninguna coincide.

- [ ] **Step 1: Write the failing tests** en `tests/mappers.test.ts` (ampliar el import con `mapRemotePlaylist`, `mapPlaylistTrack`, `parseTrackCount`; reutilizar los helpers `text` y `flex` del archivo):
  - `mapRemotePlaylist` · «playlist de búsqueda: id con prefijo VL, autor y la portada más grande»: ítem `{ id: 'VLPLwO8Yaz8URbq0HdSG3VFeCIUSGpsjbCtH', item_type: 'playlist', title: 'Every Daft Punk Song', author: { name: 'Adam Is very weird', channel_id: 'UCx1' }, flex_columns: flex('Every Daft Punk Song', 'Adam Is very weird • 281K views'), thumbnails: [{ url: 'https://yt3.googleusercontent.com/abc=s192', width: 192 }, { url: 'https://yt3.googleusercontent.com/abc=s1200', width: 1200 }] }` → `toEqual({ id: 'VLPLwO8Yaz8URbq0HdSG3VFeCIUSGpsjbCtH', title: 'Every Daft Punk Song', author: 'Adam Is very weird', thumbnail: 'https://yt3.googleusercontent.com/abc=s1200' })`.
  - · «sin `author`: el nombre sale de la 2.ª columna, sin las reproducciones»: `flex('Daft Punk (Instrumental)', 'Rahmadia Kushardiani • 12K views')` → `author === 'Rahmadia Kushardiani'`.
  - · «sin autor en ningún lado no inventa uno»: `flex('Solo título')` → `author` es `undefined`; y una portada de video (`https://i.ytimg.com/vi/qxCSOaJG7fg/sddefault.jpg`, ancho 640) se conserva como `thumbnail`.
  - · «rechaza lo que no es una playlist usable»: `item_type: 'album'`, id `'../../etc'`, id corto `'x'`, sin título y `null` → todos `null`.
  - `mapPlaylistTrack` · «ítem tipado como video»: `{ item_type: 'video', id: 'yuoghR-5-Xs', title: 'Daftendirekt', duration: { seconds: 165 }, authors: [{ name: 'Daft Punk', channel_id: 'UCRr1xG' }], thumbnails: [{ url: 'https://i.ytimg.com/vi/yuoghR-5-Xs/hqdefault.jpg', width: 400 }] }` → `{ id: 'yuoghR-5-Xs', title: 'Daftendirekt', artists: [{ id: 'UCRr1xG', name: 'Daft Punk' }], durationSec: 165, thumbnail: 'https://i.ytimg.com/vi/yuoghR-5-Xs/hqdefault.jpg' }`.
  - · «ítem de tipo desconocido (videos de canal): el id sale del overlay, la duración de la columna fija y el artista de la 2.ª columna»: `{ item_type: 'unknown', title: 'Breathe the Air', overlay: { content: { endpoint: { payload: { videoId: '1ZNBxNpHZGc' } } } }, flex_columns: flex('Breathe the Air', 'Gentle Lo-Fi Days', 'N/A'), fixed_columns: flex('1:53:55') }` → `id === '1ZNBxNpHZGc'`, `durationSec === 6835`, `artists` igual a `[{ name: 'Gentle Lo-Fi Days' }]`.
  - · «duración en m:ss y texto raro»: `fixed_columns: flex('2:45')` → `165`; `flex('0:29')` → `29`; `flex('N/A')` → `durationSec` `undefined`.
  - · «ítem sin video (privado o eliminado) y entradas inválidas»: `{ item_type: 'unknown', title: 'Deleted video', flex_columns: flex('Deleted video', 'N/A') }`, `{}` y `null` → `null`.
  - `parseTrackCount` · `['281K views', ' • ', '75 tracks', ' • ', '5 hours, 13 minutes']` → `75`; `['1 track']` → `1`; `['1,234 tracks']` → `1234`; `['3 days']` y `[]` → `undefined`.
- [ ] **Step 2: Run** `npx vitest run tests/mappers.test.ts` → FAIL (las funciones no existen).
- [ ] **Step 3: Implement** los tres tipos en `types.ts` y las tres funciones en `mappers.ts`. `mapRemotePlaylist` usa `bestThumb(item.thumbnails ?? item.thumbnail?.contents)` y el autor `txt(item.author?.name)` o, si falta, la primera parte (antes de `•`) de `flexText(item, 1)` descartando `N/A`. `mapPlaylistTrack` arma un objeto `{ ...item, id, duration }` con los valores de respaldo y delega en `mapTrack`.
- [ ] **Step 4: Run** `npx vitest run tests/mappers.test.ts` → PASS; `npm run typecheck` fallará en `provider.ts`/`api.ts` solo si algo consume `SearchResults` sin `playlists`: dejar la corrección para la Tarea 2 (esta tarea no cambia la forma devuelta por `search` todavía).
- [ ] **Step 5: Commit** (`feat(playlists): tipos y mapeadores de playlists de YouTube Music`).

---

### Task 2: Proveedor, IPC y API

**Files:**
- Create: `src/main/music/youtube/playlist.ts`
- Modify: `src/main/music/provider.ts`, `src/main/music/youtube/provider.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `tests/audio-protocol.test.ts`
- Test: `tests/playlist-collect.test.ts`

**Interfaces:**
- Consumes: `RemotePlaylistDetail`, `Track` (`types.ts`); `mapRemotePlaylist`, `mapPlaylistTrack`, `parseTrackCount`, `bestThumb`, `txt`, `searchItems` (`mappers.ts`).
- Produces:
  - En `playlist.ts`: `const MAX_PLAYLIST_TRACKS = 200`; `interface PlaylistPage { contents?: unknown[]; has_continuation: boolean; getContinuation(): Promise<PlaylistPage> }`; `collectPlaylistItems(first: PlaylistPage, map: (item: unknown) => Track | null, max?: number): Promise<{ tracks: Track[]; truncated: boolean }>` (`max` por defecto `MAX_PLAYLIST_TRACKS`).
  - `MusicProvider.getPlaylist(id: string): Promise<RemotePlaylistDetail>` (y la misma firma en el proveedor de YouTube).
  - `IPC.remotePlaylist = 'music:remote-playlist'`; `SpotapleApi.music.remotePlaylist(id: string): Promise<RemotePlaylistDetail>`.

- [ ] **Step 1: Write the failing tests** en `tests/playlist-collect.test.ts` (ayudantes: `track(n)` devuelve `{ id: 'video' + String(n).padStart(6, '0'), title: 'T' + n, artists: [] }`; `map = (n) => (typeof n === 'number' && n >= 0 ? track(n) : null)`; `page(ids, next?)` devuelve un `PlaylistPage` con `contents: ids`, `has_continuation: Boolean(next)` y `getContinuation` espía que resuelve `next`):
  - «una sola página sin continuación: todo y sin aviso» → 3 canciones, `truncated === false`.
  - «sigue las continuaciones hasta el tope y avisa que hay más»: páginas `[1,2,3] → [4,5,6] → [7,8,9]`, `max = 5` → 5 canciones (`T1…T5`), `truncated === true`, y la tercera página nunca se pide (`getContinuation` de la segunda no se llama).
  - «si la lista entra justo en el tope no avisa»: `[1,2,3] → [4,5,6]` sin más, `max = 6` → 6 canciones y `truncated === false`.
  - «descarta ítems que no son canciones (privados, eliminados)»: `contents: [1, -1, 2]` → 2 canciones.
  - «si una continuación falla devuelve lo cargado y avisa»: primera página `[1,2,3]` con `getContinuation` que rechaza → 3 canciones, `truncated === true`, sin lanzar.
  - «primera página vacía»: `contents: []` → 0 canciones y `truncated === false`.
- [ ] **Step 2: Run** `npx vitest run tests/playlist-collect.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implement `collectPlaylistItems`** en `playlist.ts`: mapea la primera página; mientras `has_continuation` y `tracks.length < max`, pide `getContinuation()` y agrega; una continuación que lanza corta el bucle y marca `truncated`; al final recorta a `max` y marca `truncated` si sobraron canciones o si todavía `has_continuation`.
- [ ] **Step 4: Run** `npx vitest run tests/playlist-collect.test.ts` → PASS.
- [ ] **Step 5: Wire provider, IPC and API.**
  - `src/main/music/provider.ts`: agregar `getPlaylist(id: string): Promise<RemotePlaylistDetail>` a `MusicProvider`; en `tests/audio-protocol.test.ts` agregar `getPlaylist: vi.fn()` al proveedor falso (junto a `getArtist: vi.fn()`).
  - `youtube/provider.ts`, `search`: sumar `run('playlist')` al `Promise.allSettled` (cuarto resultado), incluirlo en el chequeo de «todas rechazadas» y en `partial`, y devolver `playlists: items(playlistsR).filter((i) => i.item_type === 'playlist').map(mapRemotePlaylist).filter((p) => p !== null)`.
  - `youtube/provider.ts`, `getPlaylist(id)`: `yt.music.getPlaylist(id)` con `withTimeout(…, REQUEST_TIMEOUT_MS)`; título `txt(header.title)` (si falta, `MusicError('parse', MESSAGES.parse)`); `thumbnail = bestThumb(header.thumbnail?.contents)`; `trackCount = parseTrackCount(header.second_subtitle?.runs?.map((r) => txt(r.text)) ?? [])`; canciones con `collectPlaylistItems(page, mapPlaylistTrack)`; todo envuelto en `try/catch` con `classify(e)` como `getAlbum`. Devolver `{ id, title, thumbnail, trackCount, tracks, truncated }`.
  - `shared/api.ts`: `IPC.remotePlaylist`, `music.remotePlaylist`; `preload`: `remotePlaylist: (id) => call(IPC.remotePlaylist, id)`; `ipc.ts`: `handle(IPC.remotePlaylist, (x: unknown) => provider.getPlaylist(id(x)))`.
- [ ] **Step 6: Run** `npm run typecheck` → sin errores; `npx vitest run` → todo PASS. La verificación real, contra YouTube, de esta tarea es la de la Tarea 4.
- [ ] **Step 7: Commit** (`feat(playlists): búsqueda de playlists y canal music:remote-playlist`).

---

### Task 3: Interfaz: búsqueda, tarjeta y página de playlist

**Files:**
- Create: `src/renderer/src/pages/RemotePlaylistPage.tsx`
- Modify: `src/renderer/src/lib/actions.ts`, `src/renderer/src/components/Shelf.tsx`, `src/renderer/src/stores/nav.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/pages/Search.tsx`

**Interfaces:**
- Consumes: `RemotePlaylistSummary`, `RemotePlaylistDetail`, `SearchResults.playlists`; `api.music.remotePlaylist`; `useLibrary` (`createPlaylist`, `addToPlaylist`), `Hero`, `MediaCard`, `TrackList`, `TrackRow`, `Empty`, `ErrorState`, `RowsSkeleton`, `useResource`, `plural`, `formatTotal`, `totalDuration`.
- Produces:
  - `Route` gana `{ page: 'remotePlaylist'; id: string; author?: string }`.
  - En `lib/actions.ts`: `playRemotePlaylist(id: string): Promise<void>` (con `withTracks`; mensaje vacío «Esta playlist no tiene canciones disponibles.»).
  - En `Shelf.tsx`: `RemotePlaylistCard({ playlist, onPlay }: { playlist: RemotePlaylistSummary; onPlay?: () => void })` — `MediaCard` con la portada, el título, subtítulo `Playlist · <autor>` (solo `Playlist` si no hay autor) y `onOpen = navigate({ page: 'remotePlaylist', id: playlist.id, author: playlist.author })`.
  - `RemotePlaylistPage({ id, author }: { id: string; author?: string })`.

- [ ] **Step 1: Route and action.** Agregar la ruta a `nav.ts`, su `case` en `Page` de `App.tsx` (renderiza `RemotePlaylistPage`) y `playRemotePlaylist` en `actions.ts`.
- [ ] **Step 2: Card.** `RemotePlaylistCard` en `Shelf.tsx` según la firma de arriba.
- [ ] **Step 3: Search.** En `Search.tsx`: `Tab` suma `'playlists'`; pestaña «Playlists» (icono `ListMusic` de `lucide-react`) con su cantidad, al final de la lista de pestañas; `total` incluye `playlists.length`; en «Todo» y en su pestaña, un `Shelf` «Playlists» (`id="sec-playlists"`) con `RemotePlaylistCard` (8 en «Todo», todas en la pestaña) y `onPlay = () => void playRemotePlaylist(p.id)`; el estado vacío («No encontramos nada…») solo si `total === 0`.
- [ ] **Step 4: Page.** `RemotePlaylistPage`, basada en `AlbumPage`: `useResource(() => api.music.remotePlaylist(id), [id])`; error → `ErrorState` con reintento; cargando → `RowsSkeleton`; `Hero` con `Cover` de 200 px, `kind="Playlist"`, título y `meta` = autor (si viene en la ruta) · `plural(tracks.length, 'canción', 'canciones')` · duración total (si se puede); acciones «Reproducir» (`playTracks(tracks, 0)`), aleatorio, agregar a la cola (con `toastQueued`) y **«Guardar en mi biblioteca»**: con un estado `saving` que deshabilita el botón mientras corre (evita crear dos playlists con doble clic), `createPlaylist(detail.title)` y, si devolvió una playlist, `addToPlaylist(playlist, tracks)`. Si `truncated`, un `<div className="notice" role="status">` con «Mostrando las primeras {tracks.length}{trackCount ? ` de ${trackCount}` : ''} canciones de esta playlist.». Sin canciones: `Empty` «Esta playlist no tiene canciones disponibles». Lista: `TrackList` con `showAlbum={false}` y `TrackRow` por canción (`key={`${t.id}-${i}`}`, `onPlay={() => player().playTracks(tracks, i)}`).
- [ ] **Step 5: Verify** `npm run typecheck` → sin errores; `npm run build` → compila; `npx vitest run` → todo PASS. (La verificación real, con YouTube, es la Tarea 4.)
- [ ] **Step 6: Commit** (`feat(playlists): pestaña, tarjetas y página de playlist en la búsqueda`).

---

### Task 4: Verificación de punta a punta, accesibilidad y documentación

**Files:**
- Create: `scripts/e2e-playlists.mjs`
- Modify: `scripts/a11y.mjs`, `package.json` (script `"e2e:playlists": "node scripts/e2e-playlists.mjs"`), `README.md`

**Interfaces:**
- Consumes: todo lo anterior. Sigue el estilo de `scripts/e2e-settings.mjs` (`_electron` de `playwright-core`, `SPOTAPLE_USER_DATA` temporal, helper `step`, `waitFor`, capturas en `./.e2e`). Requiere `npm run build` e internet.

- [ ] **Step 1: Write `scripts/e2e-playlists.mjs`** con estos pasos (cada uno PASS/FAIL):
  1. Buscar «Daft Punk»: aparece la pestaña «Playlists» con cantidad > 0 y, en «Todo», el estante «Playlists» con tarjetas.
  2. Abrir la pestaña «Playlists», tocar la primera tarjeta: se ve el `Hero` con la etiqueta «Playlist» y al menos una fila de canción; captura.
  3. «Reproducir»: el botón del reproductor pasa a «Pausar» en ≤ 30 s y, abierta la cola, la cantidad de filas de la cola es igual a la de filas de la página.
  4. Playlist de ítems «unknown» (regresión del Review Focus 1): buscar «lo-fi» con la pestaña «Playlists» y abrir las tres primeras, una por una; **al menos una** muestra filas de canciones (con el spike de 2026-11-07, «Gentle Lo-Fi Days» tiene 54 de 54 ítems `unknown`).
  5. «Guardar en mi biblioteca» con **doble clic rápido**: en el lateral aparece **una sola** playlist nueva con el nombre de la playlist remota, y al abrirla tiene al menos una fila.
- [ ] **Step 2: Run** `npm run build && npm run e2e:playlists` → todos los pasos en PASS; revisar las capturas (la portada de video 16:9 se ve recortada sin deformarse y el `Hero` no se desarma).
- [ ] **Step 3: Accesibilidad.** En `scripts/a11y.mjs`, después de «Página de álbum», agregar dos auditorías: «Resultados con playlists» (buscar «Daft Punk», abrir la pestaña «Playlists») y «Página de playlist (YouTube)» (abrir la primera tarjeta). Run `npm run a11y` → «Sin problemas detectados por axe-core».
- [ ] **Step 4: Regresión.** Run `npm run typecheck`, `npm test`, `npm run e2e`, `npm run e2e:ui` y `npm run e2e:settings` → todo PASS como antes de la rama.
- [ ] **Step 5: README.** En «Qué incluye», que la búsqueda también trae playlists y que se abren, reproducen y guardan en la biblioteca; en «Límites de la integración», que las playlists de YouTube se muestran hasta 200 canciones (con aviso), que la búsqueda no informa su cantidad de canciones y que el autor solo se muestra cuando se llega desde una tarjeta. En «Pruebas», la fila de `npm run e2e:playlists`.
- [ ] **Step 6: Cleanup.** Borrar `scripts/_spike-playlists.mjs` (descartable) si todavía existe.
- [ ] **Step 7: Commit** (`test(playlists): e2e de playlists, accesibilidad y documentación`).

---

## Self-review

- **Cobertura del spec §5 fase 2:** tipos (T1), proveedor con cuarta consulta + `getPlaylist` con tope y continuaciones + IPC validado (T2), pestaña, fila en «Todo», página, guardado y aviso de truncado (T3), pruebas de mapeadores (T1), README y verificación (T4). «Al terminar, sigue la radio» es de la fase 3 (anotado en Global Constraints). Los tres cambios respecto del spec salen del spike y están dichos arriba.
- **Consistencia de tipos:** `RemotePlaylistSummary`, `RemotePlaylistDetail`, `mapRemotePlaylist`, `mapPlaylistTrack`, `parseTrackCount`, `collectPlaylistItems`, `PlaylistPage`, `MAX_PLAYLIST_TRACKS`, `remotePlaylist`, `playRemotePlaylist`, `RemotePlaylistCard` y `RemotePlaylistPage` aparecen con el mismo nombre en cada tarea que los usa.
- **Review Focus:** 1 → T1 (ítems `unknown`) + T4 paso 4; 2 → T1 (ítem sin video); 3 → T2 (tope) + T3 (aviso); 4 → T2 (continuación que falla); 5 → T3 (`saving`) + T4 paso 5.
- **Proporción:** el plan trae firmas, valores reales del spike y aserciones; los cuerpos los escribe quien implementa.
