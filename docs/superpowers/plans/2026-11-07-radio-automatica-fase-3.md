# Radio automática (fase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la cola nunca se quede sin música: cuando quedan pocas canciones por sonar, la app pide a YouTube Music una «radio» de la canción actual, la reordena con tus gustos y la agrega sola al final de la cola.

**Architecture:** Un motor de radio en main (`src/main/music/radio.ts`, sin dependencias de Electron) pide candidatos al proveedor (`getUpNext` con `automix`), descarta lo ya escuchado o ya encolado, los reordena por afinidad con el historial y aplica «máximo 2 seguidas del mismo artista». El reproductor del renderer decide *cuándo* pedirla (quedan < 3, radio activada, sin sala, sin repetición) y marca esas canciones como `auto`; la marca viaja a la base para que las reproducciones automáticas no cuenten como gusto. Un ajuste «Radio automática» la apaga.

**Tech Stack:** Electron 45, React 19, zustand 5, TypeScript, `node:sqlite`, `youtubei.js` 18.3.0, vitest (entorno `node`), playwright-core (e2e).

**Spec:** `docs/superpowers/specs/2026-11-06-descubrimiento-offline-ajustes-design.md` (§4.2 «Mías» y §5 «Fase 3»). Los datos reales salen del spike de esta fase (sección siguiente), que corrige tres puntos del spec.

## Hallazgos del spike (verificados contra YouTube Music el 2026-11-07)

- **`yt.music.getUpNext(videoId, true)`** devuelve un `PlaylistPanel` con **50 ítems** (≈ 650–760 ms). El **primer ítem es la propia semilla** (`selected: true`): hay que descartarlo. Sin duplicados de `video_id`. Con `automix = false` devuelve solo la semilla y un `AutomixPreviewVideo` sin `video_id`: **inservible, siempre `true`**.
- **Variedad real:** 29 a 43 artistas distintos en los 50 ítems; del mismo artista que la semilla, de 3 a 14; la racha más larga del mismo artista fue 2 (YouTube ya intercala, la regla de «máximo 2 seguidas» es una garantía y no un arreglo).
- **Forma de cada ítem** (`PlaylistPanelVideo`): `video_id` (**no trae `id`**, por eso `mapTrack` hoy los rechazaría), `title` (`Text`), `artists: [{ name, channel_id }]`, `album: { id, name }`, `duration.seconds` y `thumbnail` como **arreglo** (6 tamaños; 3 en videos de canal). `contents` puede traer también `PlaylistPanelVideoWrapper` (con el video en `.primary`) y `AutomixPreviewVideo`.
- **Funciona con semillas de video de canal** (sin ficha de canción): 50 ítems. **Una semilla inválida lanza** `Music queue was empty, the given id is probably invalid.`
- `PlaylistPanel` trae un token `continuation` pero **no un método `getContinuation()`**: cada pedido da un lote de 50. Los rellenos se hacen con una semilla nueva.

**Qué cambia respecto del spec:** (1) La IPC recibe la semilla como `Track` completo y no solo su id (`music:radio` con `{ seed, excludeIds }`), porque el respaldo por artista necesita el `channel_id`. (2) El motor descarta la semilla del lote y usa al artista de la semilla como «anterior» en la regla de rachas. (3) No hay continuación: el relleno vuelve a pedir con la canción que está sonando. Además se agrega el ajuste `radio` (el spec lo anunciaba para esta fase).

## Global Constraints

- Rama de trabajo `feat/radio-automatica`, creada desde `main` antes de la Tarea 1. Commits en español con prefijo convencional (`feat(radio): …`) que terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Sin push ni merge sin que el usuario lo pida.
- Textos de interfaz en español con voseo.
- Patrón IPC único: canal en `src/shared/api.ts` → método en `src/preload/index.ts` → manejador en `src/main/ipc.ts` con validación en `src/main/validate.ts` → `src/renderer/src/api.ts` (envuelve todo `SpotapleApi`). Los errores viajan como `IpcResult`.
- Los datos remotos son no confiables y a veces incompletos: todo en los mapeadores es opcional y se recorta.
- **La radio no corre** si el ajuste está apagado, si hay una sala Jam activa (`jam.active()`), ni si `repeat` es `all` o `one`.
- **Disparo:** al empezar cada canción (`go()`), si quedan **menos de 3 por sonar**, no hay un pedido en curso y no falló ya para esa canción. «Limpiar» la cola no dispara un relleno inmediato.
- **Filtro:** fuera lo ya encolado, lo reproducido en las últimas **50** reproducciones (automáticas o no), la semilla y los duplicados por título + artista. **Orden:** la posición que da YouTube pesa más; se suma un empujón moderado por afinidad (reproducciones **no automáticas** con vida media de **45 días** + favoritas con peso 3); **máximo 2 seguidas del mismo artista**. Lote de **20**. Todas las constantes en un solo objeto (`RADIO` en `radio.ts`).
- **Fallos:** un error que no es de red → un solo aviso discreto y no reintentar hasta que cambie la canción; **sin internet → silencio**. Sin sugerencias → respaldo con las canciones populares del artista de la semilla (`getArtist`); si también falla, se informa el primer error.
- **Marca `auto`:** migración `ALTER TABLE plays ADD COLUMN auto INTEGER NOT NULL DEFAULT 0`. Una reproducción es `auto` solo si el ítem vino de la radio **y** avanzó sola (no si el usuario lo eligió, ni con «siguiente»). Cuenta en «Recientes» y en la exclusión de «ya reproducido», **no** en el perfil de afinidad. La marca se pierde en la cola restaurada al reabrir (techo aceptado).
- **Canción suelta de la búsqueda:** con la radio activada suena sola y sigue la radio; con la radio apagada se mantiene el comportamiento actual (se encolan los resultados desde esa canción). Desde álbum, playlist, favoritas, recientes y Biblioteca: la lista en orden y la radio al final.
- CSP sin cambios. Ninguna URL de audio llega al renderer.
- Verificación por tarea: `npm run typecheck` y `npm test`; al final también `npm run build`, `npm run e2e:radio`, `npm run a11y`, `npm run e2e`, `npm run e2e:ui`, `npm run e2e:jam` y `npm run e2e:settings`.

## Review Focus

1. **Semilla que es un video de canal** (sin ficha de canción): la radio igual se arma (Tareas 2 y 3, con comprobación real).
2. **Semilla inválida o sin sugerencias:** no rompe; un solo aviso y **sin bucle de reintentos** (Tareas 2 y 4).
3. **Sin internet:** silencio, sin avisos ni reintentos (Tarea 4).
4. **Una canción de la radio que elegís a mano** (clic, «siguiente»): cuenta como reproducción normal en la base (Tareas 4 y 6).
5. **Lo que ya sonó o ya está en la cola no vuelve** (por id y por título + artista), incluso si la cola cambió mientras llegaba la respuesta (Tareas 2 y 4).

## File Structure

Crear:
- `src/main/music/radio.ts` — `RADIO`, `artistKey`, `computeAffinity`, `rankRadio`, `createRadio`.
- `scripts/e2e-radio.mjs`.
- Pruebas: `tests/radio.test.ts`.

Modificar: `src/shared/settings.ts`, `src/renderer/src/pages/Settings.tsx`, `src/main/music/youtube/mappers.ts`, `src/main/music/provider.ts`, `src/main/music/youtube/provider.ts`, `src/main/db/store.ts`, `src/main/validate.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/renderer/src/player/queue.ts`, `src/renderer/src/player/player.ts`, `src/renderer/src/player/instance.ts`, `src/renderer/src/pages/Search.tsx`, `src/renderer/src/components/QueuePanel.tsx`, `src/renderer/src/styles/components.css`, `scripts/a11y.mjs`, `package.json`, `README.md`, `tests/settings.test.ts`, `tests/mappers.test.ts`, `tests/store.test.ts`, `tests/queue.test.ts`, `tests/player.test.ts`, `tests/audio-protocol.test.ts` (el proveedor falso necesita el método nuevo).

---

### Task 1: Ajuste «Radio automática»

**Files:**
- Modify: `src/shared/settings.ts`, `src/renderer/src/pages/Settings.tsx`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `AppSettings.radio: boolean` y `DEFAULT_SETTINGS.radio === true`; `parseSettings` acepta `radio` solo si es booleano.

- [ ] **Step 1: Write the failing tests** en `tests/settings.test.ts`:
  - `DEFAULT_SETTINGS.radio` es `true` (agregar al caso «el tema por defecto conserva el aspecto actual» o uno nuevo «la radio viene activada»).
  - `parseSettings({ radio: false })` → `{ radio: false }`; `parseSettings({ radio: true })` → `{ radio: true }`.
  - Agregar `radio: 'yes'` al objeto de basura de «descarta todo lo inválido o desconocido» (sigue dando `{}`).
- [ ] **Step 2: Run** `npx vitest run tests/settings.test.ts` → FAIL.
- [ ] **Step 3: Implement** `radio: boolean` en `AppSettings`, `radio: true` en `DEFAULT_SETTINGS` y la rama booleana en `parseSettings`.
- [ ] **Step 4: UI.** En `Settings.tsx`, grupo «Reproducción»: `Toggle` «Radio automática» con la pista «Cuando se acaba lo que hay en la cola, sigue sola con canciones del mismo artista y de otros parecidos. Con la radio activada, tocar una canción suelta en la búsqueda suena sola y sigue la radio. Apagada, la reproducción se detiene al terminar la cola.», enlazado a `settings.radio`.
- [ ] **Step 5: Run** `npx vitest run` y `npm run typecheck` → todo PASS / sin errores (los tests de `store.test.ts` que comparan con `DEFAULT_SETTINGS` siguen verdes).
- [ ] **Step 6: Commit** (`feat(radio): ajuste «Radio automática»`).

---

### Task 2: Motor de radio (puro) y mapeador del panel

**Files:**
- Create: `src/main/music/radio.ts`
- Modify: `src/main/music/youtube/mappers.ts`
- Test: `tests/radio.test.ts`, `tests/mappers.test.ts`

**Interfaces:**
- Produces (en `mappers.ts`): `mapPanelTrack(item: Node): Track | null` — desenvuelve `item.primary` si existe; arma la canción desde un `PlaylistPanelVideo` (`id` ← `video_id`, `thumbnails` ← `thumbnail` si es arreglo); `null` si no hay `video_id` usable (p. ej. `AutomixPreviewVideo`).
- Produces (en `radio.ts`):
  - `const RADIO = { BATCH: 20, RECENT_PLAYS: 50, HALF_LIFE_DAYS: 45, FAVORITE_WEIGHT: 3, AFFINITY_WEIGHT: 0.35, AFFINITY_K: 3, MAX_SAME_ARTIST_RUN: 2, AFFINITY_PLAYS: 500 } as const`.
  - `interface AffinityInputs { plays: { artists: ArtistRef[]; playedAt: number }[]; favorites: { artists: ArtistRef[] }[] }`.
  - `interface RadioHistory { recentPlayIds(limit: number): string[]; affinityInputs(limit: number): AffinityInputs }`.
  - `interface RadioSource { getRadio(videoId: string): Promise<Track[]>; getArtist(id: string): Promise<{ topSongs: Track[] }> }`.
  - `artistKey(a: ArtistRef): string` — `a.id` si existe, si no `a.name` en minúsculas y recortado.
  - `computeAffinity(input: AffinityInputs, now: number): Map<string, number>` — cada reproducción suma `0.5 ** (días / HALF_LIFE_DAYS)` y cada favorita suma `FAVORITE_WEIGHT`, a **cada** artista acreditado.
  - `rankRadio(candidates: Track[], ctx: { exclude: ReadonlySet<string>; affinity: ReadonlyMap<string, number>; seedArtist?: ArtistRef; limit?: number }): Track[]`.
  - `createRadio(deps: { source: RadioSource; history: RadioHistory; now?: () => number }): { next(seed: Track, excludeIds: string[]): Promise<Track[]> }`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/mappers.test.ts`, `mapPanelTrack`: (a) ítem `{ video_id: 'Rgrt_8mXrK8', title: text('Get Lucky (Radio Edit)'), artists: [{ name: 'Daft Punk', channel_id: 'UCRr1xG' }, { name: 'Pharrell Williams' }], album: { id: 'MPREb_x', name: 'Get Lucky' }, duration: { seconds: 249 }, thumbnail: [{ url: 'https://lh3.googleusercontent.com/a=w60-h60', width: 60 }, { url: 'https://lh3.googleusercontent.com/a=w226-h226', width: 226 }] }` → `{ id: 'Rgrt_8mXrK8', title: 'Get Lucky (Radio Edit)', artists: [{ id: 'UCRr1xG', name: 'Daft Punk' }, { name: 'Pharrell Williams' }], album: { id: 'MPREb_x', title: 'Get Lucky' }, durationSec: 249, thumbnail: 'https://lh3.googleusercontent.com/a=w226-h226' }`; (b) el mismo ítem dentro de `{ primary: <ítem> }` da lo mismo; (c) un video de canal (`album` ausente, 3 miniaturas de `i.ytimg.com`) conserva id, título y artista; (d) `{}` (como un `AutomixPreviewVideo`), `{ video_id: '../etc', title: 'x' }` y `null` → `null`.
  - `tests/radio.test.ts` (ayudantes: `t(id, title, artist, artistId?)` arma un `Track`; `rank = (cands, ctx?) => rankRadio(cands, { exclude: new Set(), affinity: new Map(), ...ctx })`):
    - `rankRadio` «conserva el orden de YouTube cuando no hay afinidad».
    - «descarta lo excluido y los duplicados por título + artista» (mismo título y artista con distinto id, mayúsculas distintas → queda el primero).
    - «la afinidad sube a un artista querido pero no lo pone primero»: candidatos `[A, B, C, D]` de cuatro artistas y afinidad enorme solo para el de `D` → orden `[A, B, D, C]`.
    - «nunca más de 2 seguidas del mismo artista»: `[X1, X2, X3, Y1, Z1]` → sin tres `X` seguidas en el resultado, y están las 5 canciones.
    - «cuenta a la semilla como la anterior»: `seedArtist` = el de `X` y candidatos `[X1, X2, Y1]` → `[X1, Y1, X2]`.
    - «si todos son del mismo artista igual los devuelve» (no se cuelga) y «respeta `limit`».
    - `computeAffinity`: una reproducción de ahora vale 1 y una de hace 45 días vale 0.5 (`toBeCloseTo`); una favorita suma 3; la clave es el `channel_id` si existe o el nombre en minúsculas; una canción con dos artistas acreditados suma a ambos.
    - `createRadio.next` (con `source` y `history` falsos): (1) quita la semilla y lo que está en `excludeIds` y en `recentPlayIds`; (2) devuelve a lo sumo `RADIO.BATCH`; (3) si `getRadio` devuelve `[]` usa `getArtist(seed.artists[0].id).topSongs`; (4) si `getRadio` lanza un error con `code: 'network'` lo propaga **sin** probar el respaldo; (5) si lanza otro error y el respaldo funciona, devuelve el respaldo; (6) si fallan los dos, lanza el primer error; (7) con semilla sin `channel_id` y sin sugerencias devuelve `[]`.
- [ ] **Step 2: Run** `npx vitest run tests/radio.test.ts tests/mappers.test.ts` → FAIL.
- [ ] **Step 3: Implement** `mapPanelTrack` (delegando en `mapTrack` con `{ ...node, id: node.video_id, thumbnails: Array.isArray(node.thumbnail) ? node.thumbnail : undefined }`) y `radio.ts`. `rankRadio`: puntaje = `1 - i / N` (posición en el orden recibido) `+ AFFINITY_WEIGHT * a / (a + AFFINITY_K)` con `a` = la mayor afinidad entre los artistas del tema; orden estable descendente; luego una pasada voraz que toma el mejor candidato que no complete una racha mayor a `MAX_SAME_ARTIST_RUN` (la racha arranca contando a `seedArtist`) y, si ninguno cumple, toma el primero. El artista de una canción es `artistKey(artists[0])`.
- [ ] **Step 4: Run** los mismos tests → PASS; `npm run typecheck` → sin errores.
- [ ] **Step 5: Commit** (`feat(radio): motor de radio y mapeador del panel de YouTube Music`).

---

### Task 3: Proveedor, base de datos, IPC y API

**Files:**
- Modify: `src/main/music/provider.ts`, `src/main/music/youtube/provider.ts`, `src/main/db/store.ts`, `src/main/validate.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `tests/audio-protocol.test.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `mapPanelTrack`, `createRadio`, `RadioHistory` (Tarea 2).
- Produces:
  - `MusicProvider.getRadio(videoId: string): Promise<Track[]>` (YouTube: `getUpNext(videoId, true)`, con tiempo máximo, mapeando `contents` con `mapPanelTrack` y descartando `null`; errores con `classify`).
  - Migración 2 de `store.ts`: `ALTER TABLE plays ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;`; `Store.recordPlay(track: Track, auto?: boolean)` (por defecto `false`); `Store.recentPlayIds(limit: number): string[]` (ids distintos de todas las reproducciones, la más reciente primero); `Store.affinityInputs(limit: number): AffinityInputs` (reproducciones **no automáticas**, las últimas `limit`, y las favoritas).
  - `sanitizeRadioRequest(v: unknown): { seed: Track; excludeIds: string[] }` en `validate.ts`: `seed` con `sanitizeTrack`, `excludeIds` arreglo de hasta 2000 ids válidos; lanza «Solicitud inválida.» si no.
  - `IPC.radio = 'music:radio'`; `SpotapleApi.music.radio(seed: Track, excludeIds: string[]): Promise<Track[]>`; `SpotapleApi.library.recordPlay(track: Track, auto?: boolean): Promise<void>` (ya existe sin el segundo parámetro); `lib:record-play` recibe `(track, auto)` y valida `auto === true`.

- [ ] **Step 1: Write the failing tests** en `tests/store.test.ts` (con `createStore(':memory:')`):
  - «una base con la migración 2 guarda la marca auto»: `recordPlay(t(1))`, `recordPlay(t(2), true)` → `affinityInputs(10).plays` tiene solo la de `t(1)` y `recentPlayIds(10)` es `[t(2).id, t(1).id]`.
  - «`recentPlayIds` devuelve ids distintos, respeta el límite y el orden»: reproducir `t(1)`, `t(2)`, `t(1)` → `[t(1).id, t(2).id]`; `recentPlayIds(1)` → `[t(1).id]`.
  - «`affinityInputs` trae las favoritas con sus artistas»: `toggleFavorite(t(3))` → `affinityInputs(10).favorites` es `[{ artists: t(3).artists }]`; cada reproducción trae `playedAt` numérico.
  - «una base creada con la migración 1 sube a la 2 sin perder datos»: crear la base en disco temporal, aplicar solo la migración 1 a mano (o reabrir tras forzar `PRAGMA user_version = 1` con la tabla vieja), reabrir con `createStore` y comprobar que las reproducciones viejas siguen y tienen `auto` 0.
  - `sanitizeRadioRequest`: acepta `{ seed: t(1), excludeIds: ['abcDEF12345'] }`; rechaza `null`, `excludeIds` que no es arreglo, más de 2000 ids, un id `'../x'` y una semilla inválida.
- [ ] **Step 2: Run** `npx vitest run tests/store.test.ts` → FAIL.
- [ ] **Step 3: Implement** la migración y los métodos del `Store` (consultas con `JOIN tracks` y `JSON.parse` de `artists`, como `rowToTrack`), `sanitizeRadioRequest`, y el proveedor: agregar `getRadio` a `MusicProvider`, implementarlo en `youtube/provider.ts` y sumar `getRadio: vi.fn()` al proveedor falso de `tests/audio-protocol.test.ts`.
- [ ] **Step 4: Wire IPC and API.** `shared/api.ts`: `IPC.radio`, `music.radio`, y el segundo parámetro de `library.recordPlay`; `preload`: `radio: (seed, ids) => call(IPC.radio, { seed, excludeIds: ids })` y `recordPlay: (t, auto) => call(IPC.recordPlay, t, auto)`; `ipc.ts`: crear `createRadio({ source: provider, history: store })` una vez y `handle(IPC.radio, (o) => { const r = sanitizeRadioRequest(o); return radio.next(r.seed, r.excludeIds); })`; `handle(IPC.recordPlay, (t, auto) => store.recordPlay(sanitizeTrack(t), auto === true))`. En `src/renderer/src/player/instance.ts`, la implementación de `recordPlay` pasa a `(t, auto) => api.library.recordPlay(t, auto)` (el tipo de `PlayerApi` se ajusta en la Tarea 4).
- [ ] **Step 5: Run** `npx vitest run` → todo PASS; `npm run typecheck` → sin errores. **Comprobación real** (como en la fase 2): empaquetar `provider.ts` con `npx esbuild src/main/music/youtube/provider.ts --bundle --platform=node --format=esm --packages=external --outfile=.e2e/provider-check.mjs` y, con `node --input-type=module`, llamar `getRadio` con la semilla `wU26xVT_vBU` (Daft Punk): ≥ 30 canciones, con `id`, `title` y `artists`, la semilla incluida en la primera posición; y con la semilla de video de canal `1ZNBxNpHZGc`: ≥ 30 canciones; y con `xxxxxxxxxxx`: lanza un error clasificado. Anotar los números en el registro.
- [ ] **Step 6: Commit** (`feat(radio): canal music:radio, marca auto en las reproducciones y migración`).

---

### Task 4: El reproductor pide y marca la radio

**Files:**
- Modify: `src/renderer/src/player/queue.ts`, `src/renderer/src/player/player.ts`
- Test: `tests/queue.test.ts`, `tests/player.test.ts`

**Interfaces:**
- Consumes: la forma de `music.radio` y `library.recordPlay` (Tarea 3).
- Produces:
  - `QueueItem.auto?: boolean`; `newItem(track: Track, auto?: boolean): QueueItem` y `makeItems(tracks: Track[], auto?: boolean): QueueItem[]` (el campo solo existe cuando es `true`).
  - `PlayerApi.recordPlay(track: Track, auto?: boolean): Promise<void>`.
  - `interface RadioHook { enabled(): boolean; fetch(seed: Track, excludeIds: string[]): Promise<Track[]> }` y `PlayerDeps.radio?: RadioHook`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/queue.test.ts`: `makeItems(tracks, true)` marca todos con `auto: true`; `makeItems(tracks)` no agrega la propiedad `auto`.
  - `tests/player.test.ts` (ampliar `setup` para aceptar `radio`; `radioOf(batch)` arma `{ enabled: () => on, fetch: vi.fn(async () => batch) }`):
    - «con la radio activa, al empezar una canción suelta se piden sugerencias y se agregan marcadas»: `playTracks([track(0)])`, `await flush()` → `fetch` se llamó una vez con la semilla `track(0)` y `excludeIds` `[track(0).id]`; la cola tiene la canción más el lote; los ítems agregados tienen `auto === true` y el primero no.
    - «no pide si quedan 3 o más por sonar»: `playTracks(tracks(5), 0)` → `fetch` no se llama; con `playTracks(tracks(3), 1)` (queda 1) sí.
    - «no pide con la radio apagada, con `repeat` all u one, ni en una sala» (`jam: { active: () => true, request }`).
    - «una sola petición a la vez y no reintenta tras un fallo hasta que cambia la canción»: `fetch` rechaza con `new Error('boom')` → `notify` se llama **una** vez y `fetch` una vez aunque se dispare otro evento; al pasar a otra canción (`s().next()` con algo en la cola) se pide de nuevo.
    - «un error de red es silencioso»: rechazo con `{ code: 'network' }` → `notify` no se llama; y una respuesta vacía tampoco avisa.
    - «descarta lo que ya está en la cola cuando llega la respuesta tarde»: durante el pedido se agrega a la cola una canción que también viene en el lote → no queda duplicada.
    - «Limpiar no dispara un relleno inmediato»: con la cola ya rellenada, `clearUpcoming()` → `fetch` no se vuelve a llamar hasta que cambie la canción.
    - «recordPlay recibe `auto` solo si el ítem vino de la radio y avanzó solo»: tras `playTracks([track(0)])` + lote, la primera reproducción registra `(track(0), false)`; `audio.ended()` avanza sola a la 1.ª de la radio → `recordPlay(radioTrack, true)`; elegir a mano otra de la radio con `playIndex(i)` → `recordPlay(…, false)`; `next()` sobre una de la radio → `false`.
- [ ] **Step 2: Run** `npx vitest run tests/queue.test.ts tests/player.test.ts` → FAIL.
- [ ] **Step 3: Implement.** En `queue.ts`, `newItem`/`makeItems` con el parámetro `auto`. En `player.ts`: `maybeRefill()` llamada desde `go()` tras fijar el índice, con estas guardas en este orden (radio presente y `enabled()`, `!jam?.active()`, `repeat === 'off'`, quedan `< 3` (`items.length - index - 1`), no hay pedido en curso, `radioBlockedUid !== cur.uid`); pide con `cur.track` y los ids de toda la cola, filtra lo que ya está en la cola al llegar y agrega con `append(qs(), makeItems(fresh, true))`; un rechazo marca `radioBlockedUid = cur.uid`, avisa una sola vez salvo `code === 'network'`, y una respuesta vacía solo bloquea. `go()` calcula `playedAuto = item.auto === true && !opts.user` y el evento `playing` llama `api.recordPlay(item.track, playedAuto)`.
- [ ] **Step 4: Run** `npx vitest run` → todo PASS; `npm run typecheck` → sin errores.
- [ ] **Step 5: Commit** (`feat(radio): el reproductor rellena la cola con la radio y marca las reproducciones automáticas`).

---

### Task 5: Interfaz: cableado, búsqueda y cola

**Files:**
- Modify: `src/renderer/src/player/instance.ts`, `src/renderer/src/pages/Search.tsx`, `src/renderer/src/components/QueuePanel.tsx`, `src/renderer/src/styles/components.css`

**Interfaces:**
- Consumes: `RadioHook`, `QueueItem.auto` (Tarea 4); `settingsStore` / `useSettings` y `settings.radio` (Tarea 1); `api.music.radio` (Tarea 3).
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Wire the hook.** En `instance.ts`, `createPlayer({ …, radio: { enabled: () => settingsStore.getState().settings.radio, fetch: (seed, ids) => api.music.radio(seed, ids) } })`.
- [ ] **Step 2: Search.** En `Search.tsx`, `const radio = useSettings((s) => s.settings.radio)` antes de los retornos tempranos; en `songsBlock`, `onPlay` pasa `[t]` con índice 0 si `radio` está activada y mantiene `songs` con `songs.indexOf(t)` si no.
- [ ] **Step 3: Queue.** En `QueuePanel.tsx` (cola personal): antes de la primera fila `auto` de «A continuación», un `<li className="queue__divider" aria-hidden="true">Radio automática</li>`; las filas `auto` suman «, de la radio automática» a su `aria-label`; las flechas ↑/↓ de `QueueRow` saltan los hermanos que no se pueden enfocar (para no quedar trabadas en el divisor). Estilo `.queue__divider` en `components.css` (texto pequeño `--fs-xs`, `--fg-2`, mayúsculas con seguimiento, línea inferior `--line`), sin colores fijos.
- [ ] **Step 4: Verify** `npm run typecheck` → sin errores; `npm run build` → compila; `npx vitest run` → todo PASS. (La verificación real, con YouTube, es la Tarea 6.)
- [ ] **Step 5: Commit** (`feat(radio): cableado del reproductor, canción suelta en la búsqueda y separador en la cola`).

---

### Task 6: Verificación de punta a punta, accesibilidad y documentación

**Files:**
- Create: `scripts/e2e-radio.mjs`
- Modify: `scripts/a11y.mjs`, `package.json` (script `"e2e:radio": "node scripts/e2e-radio.mjs"`), `README.md`

**Interfaces:**
- Consumes: todo lo anterior. Sigue el estilo de `scripts/e2e-playlists.mjs` y `scripts/e2e-settings.mjs` (`_electron` de `playwright-core`, `SPOTAPLE_USER_DATA` temporal, helper `step`, `waitFor`, capturas en `./.e2e`; `node:sqlite` para leer la base al final). Requiere `npm run build` e internet.

- [ ] **Step 1: Write `scripts/e2e-radio.mjs`** con estos pasos (cada uno PASS/FAIL):
  1. Buscar «Daft Punk One More Time», doble clic en la primera canción y abrir la cola: en ≤ 20 s la cola tiene más de 10 filas y se ve el separador «Radio automática».
  2. Variedad: entre las primeras 20 filas de «A continuación» hay al menos 5 artistas distintos, ninguno repite más de 2 filas seguidas y la canción que suena no aparece repetida en la cola.
  3. «Siguiente»: cambia la canción y sigue sonando.
  4. Fin natural: llevar la barra de progreso al final (como el paso 5 de `scripts/e2e.mjs`) y comprobar que suena otra canción de la cola sin tocar nada.
  5. Base: cerrar la app y leer `spotaple.db` con `node:sqlite`: la primera fila de `plays` tiene `auto = 0` (la eligió el usuario) y hay al menos una con `auto = 1` (el avance natural a una de la radio); y después, abrir de nuevo, elegir a mano una canción de la radio con doble clic y comprobar que su fila nueva tiene `auto = 0`.
  6. Radio apagada: en Ajustes apagar «Radio automática»; buscar y dar doble clic a una canción: no aparece el separador y la cola tiene tantas filas como canciones mostradas en los resultados desde esa (comportamiento anterior).
  7. Repetición: con la radio activada y `repeat` en «toda la cola», una canción suelta no recibe radio en 8 s.
- [ ] **Step 2: Run** `npm run build && npm run e2e:radio` → todos los pasos en PASS; revisar la captura de la cola (el separador se ve bien y la lista no se desarma).
- [ ] **Step 3: Accesibilidad.** En `scripts/a11y.mjs`, después de «Búsqueda + cola + reproduciendo» (que ahora tiene radio), auditar de nuevo la cola con radio abierta (`Cola con radio automática`). Run `npm run a11y` → «Sin problemas detectados por axe-core».
- [ ] **Step 4: Regresión.** Run `npm run typecheck`, `npm test`, `npm run e2e`, `npm run e2e:ui`, `npm run e2e:jam`, `npm run e2e:settings` y `npm run e2e:playlists` → todo PASS como antes de la rama. Si algún e2e existente asumía que una canción suelta deja la cola sin más canciones, ajustarlo y anotarlo en el registro.
- [ ] **Step 5: README.** En «Qué incluye», la radio automática (cómo se arma: la radio de YouTube Music reordenada con tu historial, sin repetir lo reciente, máximo 2 seguidas del mismo artista; se apaga en Ajustes; no corre en salas ni con repetición); actualizar la frase «No hay descarga offline, crossfade…» solo si corresponde; en «Límites de la integración», que la radio sale de la lista de YouTube Music y la afinidad es moderada, sin señal de «saltar»; en «Datos locales», la columna `plays.auto`; en «Pruebas», la fila de `npm run e2e:radio`.
- [ ] **Step 6: Cleanup.** Borrar `.e2e/provider-check.mjs` si existe.
- [ ] **Step 7: Commit** (`test(radio): e2e de la radio, accesibilidad y documentación`).

---

## Self-review

- **Cobertura del spec §5 fase 3 y §4.2:** motor puro con filtro, orden y regla de rachas (T2); fuente `getUpNext` + respaldo por artista (T2, T3); IPC (T3); disparo, marca `auto`, no correr en sala/`repeat`/ajuste apagado, fallos (T4); canción suelta de la búsqueda (T5); separador «Radio automática» (T5); migración `plays.auto` y que la afinidad ignore lo automático (T3); ajuste (T1). Los cambios respecto del spec salen del spike y están dichos arriba.
- **Consistencia de tipos:** `RADIO`, `AffinityInputs`, `RadioHistory`, `RadioSource`, `artistKey`, `computeAffinity`, `rankRadio`, `createRadio`, `mapPanelTrack`, `getRadio`, `recentPlayIds`, `affinityInputs`, `sanitizeRadioRequest`, `RadioHook`, `QueueItem.auto`, `makeItems(tracks, auto?)`, `recordPlay(track, auto?)` y `music.radio(seed, excludeIds)` aparecen con el mismo nombre en cada tarea que los usa.
- **Review Focus:** 1 → T2 (mapeador con video de canal) + T3 (comprobación real); 2 → T2 (`createRadio` con semilla inválida o vacía) + T4 (un aviso, sin bucle); 3 → T4 (silencio con `code: 'network'`); 4 → T4 (`recordPlay` con `playIndex` y `next`) + T6 (la base); 5 → T2 (exclusión por id y por título + artista) + T4 (carrera).
- **Proporción:** el plan trae firmas, valores reales del spike y aserciones; los cuerpos los escribe quien implementa.
