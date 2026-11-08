# Descargas y offline (fase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las canciones favoritas se bajan solas al disco y suenan sin internet; el clic derecho «Descargar canción» guarda cualquier canción como Opus (.webm) o AAC (.m4a) donde la persona elija.

**Architecture:** Un servicio `offline` en el proceso principal mantiene una cola (2 descargas a la vez) que escribe `userData/offline/<videoId>.<ext>` y un índice en la tabla `downloads`. El protocolo `spotaple-audio://` sirve primero el archivo local (con Range) y solo si no existe va a YouTube; `music:prepare` responde sin red cuando el archivo existe. La descarga manual reutiliza la misma primitiva (`downloadTo`) pero escribe donde elige la persona en un diálogo del sistema; el renderer nunca pasa una ruta. El renderer se entera del estado por un evento `offline:state` (como `jam:state`) y el reproductor se salta, sin red, lo que no está descargado.

**Tech Stack:** Electron 45, `node:sqlite`, `youtubei.js` 18.3.0 (cliente `VISIONOS`), React + zustand, vitest, playwright-core `_electron`.

**Spec:** `docs/superpowers/specs/2026-11-06-descubrimiento-offline-ajustes-design.md` §5 «Fase 4».

## Spike (hecho, 2026-11-07, YouTube real, «One More Time», 320 s)

- `VISIONOS` entrega audio completo en **Opus** (itag 251, 161 kbps, 5,3 MB; 250 y 249 más livianos) y en **AAC** (itag 140, `mp4a.40.2`, 131 kbps, 5,2 MB; el 139 es HE-AAC de 50 kbps). `chooseFormat({ type:'audio', quality:'best', format:'mp4' })` elige el 140.
- Una descarga completa (`Range: bytes=0-`, 206) tarda **0,15–0,3 s** (18–40 MB/s): no hay límite a velocidad de reproducción. Dos descargas en paralelo no se estorban. A trozos de 512 KiB también funciona. Conclusión: no hace falta barra de progreso por canción; basta un contador discreto.

## Global Constraints

- Archivos en `userData/offline/<videoId>.<ext>`; se escribe `<archivo>.part` y se renombra al terminar. Cola de **2** descargas simultáneas.
- Tabla `downloads(track_id TEXT PRIMARY KEY REFERENCES tracks(id), format TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL)` como migración 3.
- Formatos de exportación: «Opus (.webm)» y «AAC (.m4a)». Las favoritas offline son siempre Opus de calidad Alta (el ajuste de calidad no las toca).
- El renderer nunca pasa una ruta: el diálogo «Guardar como» lo abre main; nombre sugerido `Artista - Título.ext` saneado para Windows.
- Sin dependencias nuevas. La CSP no cambia. Textos de interfaz en español rioplatense (voseo), errores con mensaje listo para mostrar.
- Descargar audio de YouTube va contra sus términos de uso: queda para uso personal y local, decisión de la persona dueña (README lo dice).
- Cada tarea termina con `npm run typecheck` y `npm test` en verde.

## Review Focus

1. **Cancelar el diálogo «Guardar como»** → no se crea nada y no sale error (Task 7: `exportTrack` devuelve `{ saved: false }`).
2. **Títulos o artistas con caracteres que Windows prohíbe** (`AC/DC`, `?`, `:`, `CON`, punto final, 300 caracteres) → nombre válido (Task 1: `exportFileName`).
3. **Quitar de favoritas o «Borrar todas» mientras se está descargando** → no queda archivo ni fila huérfana (Task 5).
4. **Descarga cortada a la mitad o tamaño distinto al declarado** → ningún archivo parcial se sirve ni queda `.part` (Task 4 y 5).
5. **El archivo desapareció del disco** (la persona lo borró) → el protocolo cae a la red y el siguiente `reconcile` borra la fila (Task 5 y 6).
6. **Sin red con una cola de canciones no descargadas** → se saltan con el tope existente y el mensaje lo explica, nunca queda cargando para siempre (Task 8).
7. **Pedido de Range más allá del final o malformado sobre el archivo local** → 416 / archivo entero, nunca bytes de más (Task 6).

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/shared/offline.ts` (nuevo) | `AudioFormat`, `AUDIO_FORMATS`, `parseFormat`, `formatFromMime`, `formatFromExt`, `OfflineState`, `ExportResult`, `exportFileName`. Puro. |
| `src/shared/settings.ts` | Ajustes `autoDownload` y `exportFormat`. |
| `src/main/db/store.ts` | Migración 3 + `downloads`, `addDownload`, `removeDownload`, `clearDownloads`, `trackDuration`. |
| `src/main/music/provider.ts`, `youtube/format.ts`, `youtube/audio-cache.ts`, `youtube/provider.ts` | `AudioVariant = StreamQuality \| 'aac'`; `resolveAudio(id, { variant })` que ignora el ajuste de calidad. |
| `src/main/upstream.ts` (nuevo) | `openUpstream`: resolver → pedir con Range → reintentar una vez si la URL caducó. Lo usan el protocolo y las descargas. |
| `src/main/download.ts` (nuevo) | `downloadTo`: baja una canción a un archivo (`.part` → renombrar, verifica tamaño y formato). |
| `src/main/offline.ts` (nuevo) | Cola, índice en memoria, `local`, `onFavorite`, `reconcile`, `clear`, `state`, `idle`. |
| `src/main/export.ts` (nuevo) | `exportTrack`: diálogo → copiar el local o descargar al destino. |
| `src/main/audio-protocol.ts` | Usa `openUpstream`; sirve el archivo local primero (`parseRange`). |
| `src/shared/api.ts`, `src/preload/index.ts`, `src/main/validate.ts`, `src/main/ipc.ts`, `src/main/index.ts` | Canales, puente, validación, atajo de `prepare`, favoritas ↔ descargas, ajustes. |
| `src/renderer/src/stores/offline.ts` (nuevo), `components/OfflineBanner.tsx` (nuevo), `main.tsx`, `App.tsx` | Estado en el renderer, aviso «Sin conexión», sincronización al volver la red. |
| `src/renderer/src/player/player.ts`, `instance.ts` | `reachable`: sin red se salta lo no descargado. |
| `src/renderer/src/components/TrackRow.tsx`, `pages/Library.tsx`, `pages/PlaylistPage.tsx`, `lib/actions.ts` | Icono «disponible sin conexión», fila atenuada, «reproducir» solo lo disponible. |
| `src/renderer/src/components/ContextMenu.tsx`, `pages/Settings.tsx`, `lib/format.ts` | Submenú «Descargar canción», grupo «Descargas», `formatBytes`. |
| `scripts/e2e-offline.mjs` (nuevo), `package.json`, `README.md` | Recorrido real y documentación. |

Estilos: `components.css` (icono, fila atenuada, aviso), `layout.css` (`.main` pasa a columna), `settings.css` (fila de espacio).

---

### Task 1: Contratos compartidos y ajustes

**Files:**
- Create: `src/shared/offline.ts`, `tests/offline-shared.test.ts`
- Modify: `src/shared/settings.ts`, `tests/settings.test.ts`

**Interfaces:**
- Produces (en `src/shared/offline.ts`):
  - `type AudioFormat = 'opus' | 'aac'`
  - `AUDIO_FORMATS: Record<AudioFormat, { ext: 'webm' | 'm4a'; mime: 'audio/webm' | 'audio/mp4'; label: string }>` con `opus → webm, audio/webm, 'Opus (.webm)'` y `aac → m4a, audio/mp4, 'AAC (.m4a)'`
  - `parseFormat(v: unknown): AudioFormat | null`, `formatFromMime(mime: string): AudioFormat | null`, `formatFromExt(ext: string): AudioFormat | null`
  - `interface OfflineState { ids: string[]; pending: number; failed: number; bytes: number }` (`ids`: descargadas; `pending`: en cola o bajando; `failed`: fallidas desde el último `reconcile`)
  - `type ExportResult = { saved: false } | { saved: true; name: string }`
  - `exportFileName(track: Track, format: AudioFormat): string`
- Produces (en settings): `AppSettings.autoDownload: boolean` (por defecto `true`) y `AppSettings.exportFormat: AudioFormat` (por defecto `'opus'`).

- [ ] **Step 1: Tests que fallan.** En `tests/offline-shared.test.ts`:
  - `formatFromMime('audio/webm')` → `'opus'`, `'audio/mp4'` → `'aac'`, `'audio/ogg'` → `null`; `formatFromExt('m4a')` → `'aac'`, `'mp3'` → `null`; `parseFormat('opus')` → `'opus'`, `parseFormat('mp3')` → `null`.
  - `exportFileName` con `{ title:'One More Time', artists:[{name:'Daft Punk'}] }` y `'opus'` → `'Daft Punk - One More Time.webm'`; dos artistas → `'A, B - T.m4a'`; `AC/DC` + `Back In Black?` → `'AC_DC - Back In Black_.webm'`; sin artistas y título `CON` → `'_CON.webm'`; título `'Hola. . '` sin artistas → `'Hola.webm'`; título de 300 `x` → el nombre sin extensión mide 150; título vacío o solo caracteres inválidos que quedan vacíos tras recortar → `'Sin título.webm'`.
  - En `tests/settings.test.ts`: `parseSettings({ autoDownload:false, exportFormat:'aac' })` los conserva; `autoDownload:'si'` y `exportFormat:'mp3'` se descartan (agregarlos al objeto `junk` existente); `DEFAULT_SETTINGS.autoDownload === true` y `exportFormat === 'opus'`.
- [ ] **Step 2:** `npx vitest run tests/offline-shared.test.ts tests/settings.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `src/shared/offline.ts`. `exportFileName`: base = artistas unidos con `', '` + `' - '` + título (sin artistas, solo el título); cada carácter de `<>:"/\|?*` o de control pasa a `_`; se recortan espacios y puntos del final; si el resultado (sin extensión) es un nombre reservado de Windows (`CON PRN AUX NUL COM1-9 LPT1-9`, sin distinguir mayúsculas) se antepone `_`; se corta a 150 caracteres antes de recortar el final; vacío → `Sin título`.
- [ ] **Step 4: Implementar** los dos ajustes en `AppSettings`, `DEFAULT_SETTINGS` y `parseSettings` (booleano estricto; `exportFormat` por `parseFormat`).
- [ ] **Step 5:** los tests pasan; `npm run typecheck`.
- [ ] **Step 6: Commit** `feat(offline): contratos compartidos, nombres de archivo y ajustes de descargas`.

---

### Task 2: Índice de descargas en la base

**Files:**
- Modify: `src/main/db/store.ts`, `tests/store.test.ts`

**Interfaces:**
- Consumes: `AudioFormat` (Task 1).
- Produces (en el objeto que devuelve `createStore`): `downloads(): { trackId: string; format: AudioFormat; bytes: number }[]`, `addDownload(trackId: string, format: AudioFormat, bytes: number): void` (reemplaza si ya había fila; `created_at = Date.now()`), `removeDownload(trackId: string): void`, `clearDownloads(): void`, `trackDuration(trackId: string): number | undefined`.

- [ ] **Step 1: Tests que fallan** en `tests/store.test.ts` (patrón de archivo temporal ya usado en ese archivo para reabrir la base):
  - «downloads: ida y vuelta»: tras `toggleFavorite(track)` y `addDownload(track.id,'opus',123)`, `downloads()` es `[{ trackId, format:'opus', bytes:123 }]`; otro `addDownload` del mismo id con `'aac'`/456 lo reemplaza (una sola fila).
  - `removeDownload` borra una; `clearDownloads` borra todas.
  - «migración 3 es idempotente»: crear, cerrar y reabrir el mismo archivo no rompe ni pierde las filas.
  - `trackDuration` devuelve `durationSec` de la canción guardada, y `undefined` si no hay duración o no existe.
- [ ] **Step 2:** `npx vitest run tests/store.test.ts` → FALLA.
- [ ] **Step 3: Implementar** la migración 3 (SQL de Global Constraints, tercer elemento de `MIGRATIONS`) y los cinco métodos; `downloads()` valida que `format` sea `'opus'|'aac'` con `parseFormat` y omite filas con otro valor.
- [ ] **Step 4:** pasan los tests; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(offline): tabla downloads (migración 3) y métodos del índice`.

---

### Task 3: Variante de audio en el proveedor (AAC y Opus a pedido)

**Files:**
- Modify: `src/main/music/provider.ts`, `src/main/music/youtube/format.ts`, `src/main/music/youtube/audio-cache.ts`, `src/main/music/youtube/provider.ts`, `tests/audio-format.test.ts`, `tests/audio-cache.test.ts`

**Interfaces:**
- Produces: `type AudioVariant = StreamQuality | 'aac'` exportado desde `src/main/music/provider.ts`; `MusicProvider.resolveAudio(trackId: string, opts?: { newPlay?: boolean; variant?: AudioVariant }): Promise<ResolvedAudio>`. Con `variant` el pedido ignora el ajuste de calidad y el bloqueo de calidad: `'high'` = Opus mejor, `'aac'` = AAC mejor. `chooseAudioFormat(info, variant: AudioVariant)`. `createAudioCache` indexa por variante y `invalidate(trackId)` borra las tres.

- [ ] **Step 1: Tests que fallan.**
  - `tests/audio-format.test.ts`: `chooseAudioFormat(info, 'aac')` llama a `info.chooseFormat` una sola vez con exactamente `{ type:'audio', quality:'best', format:'mp4' }` (el spike confirmó que eso elige el itag 140); `'high'` y `'saver'` no cambian.
  - `tests/audio-cache.test.ts`: la caché distingue `'high'`, `'saver'` y `'aac'` de la misma canción; `invalidate` las borra a las tres.
- [ ] **Step 2:** `npx vitest run tests/audio-format.test.ts tests/audio-cache.test.ts` → FALLA.
- [ ] **Step 3: Implementar.** En `youtube/provider.ts`, `resolveAudio` calcula `const variant = opts?.variant ?? (newPlay ? getQuality() : qualityLock.get(id) ?? getQuality())`; con `opts.variant` no toca `qualityLock`; `inflight` y la caché usan `variant` en la clave; `resolveWith` pasa la variante a `chooseAudioFormat` (`quality` para `saver`, `high` y `aac` por la rama que corresponda).
- [ ] **Step 4:** pasan los tests; `npm run typecheck`; `npm test` completo (los tests del protocolo siguen igual).
- [ ] **Step 5: Commit** `feat(offline): variante de audio AAC y Opus a pedido en el proveedor`.

---

### Task 4: `openUpstream` y `downloadTo`

**Files:**
- Create: `src/main/upstream.ts`, `src/main/download.ts`, `tests/download.test.ts`
- Modify: `src/main/audio-protocol.ts`

**Interfaces:**
- Consumes: `MusicProvider`, `ResolvedAudio`, `AudioVariant` (Task 3); `formatFromMime`, `AudioFormat` (Task 1); `MusicError`, `MESSAGES`, `classify` de `src/main/music/youtube/errors.ts`.
- Produces:
  - `openUpstream(o: { provider: MusicProvider; fetchImpl: typeof fetch; id: string; range: string; signal?: AbortSignal; variant?: AudioVariant }): Promise<{ res: Response; audio: ResolvedAudio }>`: resuelve, pide con `Range`, y si el estado es 403/404/410 cancela el cuerpo, `provider.invalidate(id)`, resuelve de nuevo y pide otra vez (una sola vez). Devuelve la respuesta sea cual sea su estado.
  - `downloadTo(o: { provider; fetchImpl; id: string; variant: AudioVariant; destFor: (format: AudioFormat) => string; expect?: AudioFormat; signal?: AbortSignal }): Promise<{ dest: string; bytes: number; format: AudioFormat }>`: llama a `openUpstream` con `bytes=0-`; si el estado no es 200/206 lanza `MusicError('unavailable', MESSAGES.blocked)`; deduce el formato del `mimeType` (si no es Opus ni AAC, o si `expect` no coincide, lanza `MusicError('unavailable', 'Esta canción no está disponible en ese formato.')`); escribe `<dest>.part` con `pipeline(Readable.fromWeb(...), createWriteStream(...))`; si `contentLength` está declarado y el tamaño escrito difiere, lanza `MusicError('network', MESSAGES.network)`; renombra a `dest`; ante cualquier error borra el `.part`. Los errores de red de `fetch` salen clasificados con `classify`.

- [ ] **Step 1: Tests que fallan** en `tests/download.test.ts` (carpeta temporal real, proveedor y `fetch` simulados como en `tests/audio-protocol.test.ts`):
  - éxito: queda `dest` con los bytes, no queda `.part`, devuelve `{ dest, bytes:11, format:'opus' }` para `audio/webm`; `audio/mp4` → `'aac'`.
  - `expect:'opus'` con `audio/mp4` → rechaza con `code:'unavailable'` y no queda ningún archivo.
  - `audio/ogg` → rechaza `unavailable`.
  - 403 y luego 206 → invalida, resuelve dos veces y termina bien.
  - `contentLength: 1000` con 11 bytes recibidos → rechaza `network`; no existen ni `dest` ni `.part`.
  - estado 502 → rechaza `unavailable`; `fetch` que lanza `TypeError('fetch failed')` → `code:'network'`.
  - `resolveAudio` se llama con `(id, { variant:'aac' })` cuando se pidió `aac`.
- [ ] **Step 2:** `npx vitest run tests/download.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `src/main/upstream.ts` y `src/main/download.ts`.
- [ ] **Step 4: Refactor de `audio-protocol.ts`** para usar `openUpstream` en lugar de su bucle propio. El chequeo de 416 pasa a después de abrir (cancelando el cuerpo si corresponde); el resto del comportamiento no cambia. Los 8 tests de `tests/audio-protocol.test.ts` deben pasar **sin modificarlos**.
- [ ] **Step 5:** `npx vitest run tests/download.test.ts tests/audio-protocol.test.ts` → PASAN; `npm run typecheck`.
- [ ] **Step 6: Commit** `feat(offline): openUpstream compartido y downloadTo atómico`.

---

### Task 5: Servicio `offline` (cola, índice, reconciliación)

**Files:**
- Create: `src/main/offline.ts`, `tests/offline.test.ts`

**Interfaces:**
- Consumes: `downloadTo` (Task 4), `AudioFormat`, `AUDIO_FORMATS`, `formatFromExt`, `OfflineState` (Task 1), métodos de `store` (Task 2) y `store.favoriteIds()`.
- Produces: `createOffline(d: { dir: string; store: Pick<Store, 'favoriteIds' | 'downloads' | 'addDownload' | 'removeDownload' | 'clearDownloads' | 'trackDuration'>; provider: MusicProvider; fetchImpl: typeof fetch; enabled: () => boolean; emit: (s: OfflineState) => void; concurrency?: number }): Offline` con:
  - `local(trackId: string): { file: string; mimeType: string; durationSec?: number } | null` (usa el índice en memoria; no toca el disco)
  - `state(): OfflineState`
  - `onFavorite(trackId: string, isFavorite: boolean): void` (agrega a la cola si `enabled()`; al quitar, borra archivo y fila y la saca de la cola)
  - `reconcile(): Promise<void>`: crea la carpeta; borra `.part` (salvo los de descargas activas) y archivos que no estén en el índice; borra del índice lo que no tiene archivo y lo que ya no es favorita; vacía `failed`; si `enabled()` encola las favoritas sin descarga y si no, vacía la cola pendiente; emite.
  - `clear(): Promise<void>`: vacía la cola, borra todos los archivos y filas, y descarta lo que esté bajando.
  - `idle(): Promise<void>`: se resuelve cuando no hay cola ni activas.
  - Las descargas usan `variant:'high'`, `destFor: (f) => join(dir, `${id}.${AUDIO_FORMATS[f].ext}`)`. Al terminar, solo se registran (`addDownload`) si la canción sigue siendo favorita y no hubo `clear()` mientras tanto; si no, se borra el archivo. Los fallos suman a `failed` y no se reintentan hasta el próximo `reconcile`. Borrar un archivo ocupado (Windows) no lanza: queda huérfano y lo limpia el siguiente `reconcile`.

- [ ] **Step 1: Tests que fallan** en `tests/offline.test.ts` (carpeta temporal real, `createStore(':memory:')`, favoritas sembradas con `store.toggleFavorite`, proveedor y `fetch` simulados con compuertas para controlar el avance):
  - `onFavorite(id, true)` con `enabled` → descarga: `local(id)` devuelve `{ file, mimeType:'audio/webm', durationSec }`, hay fila en `downloads`, y el último `emit` incluye el id y `bytes > 0`.
  - con `enabled: () => false`, `onFavorite(id, true)` no descarga.
  - con 5 favoritas y `fetch` que se queda esperando, nunca hay más de 2 descargas activas a la vez; al liberar, terminan las 5.
  - `onFavorite(id, false)` borra archivo y fila; si estaba bajando, al terminar no queda archivo ni fila (Review Focus 3).
  - `clear()` borra archivos y filas; una descarga en curso al llamar `clear()` no deja nada.
  - una descarga que falla (502) suma `failed`, no deja archivo ni `.part`, y el siguiente `reconcile()` la reintenta.
  - `reconcile`: borra un `x.webm.part` y un archivo suelto sin fila; quita la fila cuya archivo falta; quita la fila de una canción que ya no es favorita; encola las favoritas sin descarga; no toca el `.part` de una descarga activa (Review Focus 5 para la parte de fila sin archivo).
- [ ] **Step 2:** `npx vitest run tests/offline.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `createOffline`.
- [ ] **Step 4:** pasan los tests; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(offline): servicio de descargas con cola de 2, índice y reconciliación`.

---

### Task 6: El protocolo sirve el archivo local primero

**Files:**
- Modify: `src/main/audio-protocol.ts`, `tests/audio-protocol.test.ts`

**Interfaces:**
- Produces: `type LocalAudio = (id: string) => { file: string; mimeType: string } | null`; `createAudioHandler(provider, fetchImpl?, local?: LocalAudio)` y `createResponder(provider, fetchImpl, local?: LocalAudio)`; `parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null` (exportado). `null` = sin Range válido → archivo entero con 200. Soporta `bytes=a-b` y `bytes=a-`; `end` se recorta a `size - 1`; `start >= size` → `'unsatisfiable'`. Cualquier otra forma (incluido `bytes=-N`) cuenta como `null`.

- [ ] **Step 1: Tests que fallan** en `tests/audio-protocol.test.ts` (archivo temporal de 1000 bytes; `local` simulado):
  - `parseRange`: `'bytes=100-199'` → `{100,199}`; `'bytes=900-'` → `{900,999}`; `'bytes=0-5000'` → `{0,999}`; `'bytes=1000-'` → `'unsatisfiable'`; `null` y `'basura'` → `null`.
  - con archivo local y sin Range → 200, `content-length: 1000`, `content-type` del archivo, cuerpo completo; `provider.resolveAudio` y `fetch` no se llaman.
  - `bytes=100-199` → 206, `content-range: bytes 100-199/1000`, `content-length: 100`, cuerpo = ese tramo.
  - `bytes=1000-` → 416 con `content-range: bytes */1000`.
  - el archivo no existe en disco → cae a la red (se llama a `fetch`) y responde como siempre (Review Focus 5).
  - una canción que `local` no conoce → va a la red como antes.
- [ ] **Step 2:** `npx vitest run tests/audio-protocol.test.ts` → FALLA.
- [ ] **Step 3: Implementar.** Tras validar el id, `const hit = local?.(id)`; si hay, `stat` del archivo (si falla, seguir a la red); `parseRange`; `createReadStream(file, { start, end })` convertido con `Readable.toWeb`; cabeceras `Accept-Ranges`, `Cache-Control: no-store`, `Content-Type`.
- [ ] **Step 4:** pasan todos los tests del protocolo; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(offline): el protocolo de audio sirve el archivo local con Range`.

---

### Task 7: Exportar, IPC y cableado del proceso principal

**Files:**
- Create: `src/main/export.ts`, `tests/export.test.ts`, `tests/validate.test.ts`
- Modify: `src/shared/api.ts`, `src/preload/index.ts`, `src/main/validate.ts`, `src/main/ipc.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: `Offline` (Task 5), `downloadTo` (Task 4), `exportFileName`, `ExportResult`, `AUDIO_FORMATS`, `formatFromMime`, `parseFormat` (Task 1).
- Produces:
  - `exportTrack(d: { offline: Pick<Offline, 'local'>; provider: MusicProvider; fetchImpl: typeof fetch; pickSavePath: (suggestedName: string, format: AudioFormat) => Promise<string | null> }, track: Track, format: AudioFormat): Promise<ExportResult>`: pide la ruta (con `exportFileName`); `null` → `{ saved:false }` sin más; si hay archivo local del mismo formato lo copia; si no, `downloadTo` con `variant: format === 'aac' ? 'aac' : 'high'`, `expect: format` y `destFor: () => ruta`; devuelve `{ saved:true, name: basename(ruta) }`.
  - `sanitizeExportRequest(v: unknown): { track: Track; format: AudioFormat }` en `validate.ts` (lanza «Solicitud inválida.» si el formato o la canción no valen).
  - Canales en `IPC`: `export: 'music:export'`, `offlineGet: 'offline:get'`, `offlineSync: 'offline:sync'`, `offlineClear: 'offline:clear'` y el evento `offlineState: 'offline:state'`.
  - API: `music.export(track: Track, format: AudioFormat): Promise<ExportResult>` y `offline: { state(): Promise<OfflineState>; sync(): Promise<void>; clear(): Promise<void>; subscribe(cb: (s: OfflineState) => void): Promise<void> }` (un solo oyente, igual que `jam.subscribe`).
  - `registerIpc` recibe además `offline: Offline`, `fetchImpl: typeof fetch` y `pickSavePath`.

- [ ] **Step 1: Tests que fallan.**
  - `tests/export.test.ts` (carpeta temporal, `pickSavePath` simulado): cancelar → `{ saved:false }` y el proveedor no se llama (Review Focus 1); el nombre sugerido que recibe el selector es `exportFileName(track, format)`; con archivo local del mismo formato copia y no llama al proveedor; con local de otro formato descarga; `aac` pide `variant:'aac'` y `opus` pide `'high'`; si la descarga falla, el error se propaga.
  - `tests/validate.test.ts`: `sanitizeExportRequest` acepta `{ track, format:'aac' }`, rechaza `format:'mp3'`, rechaza un `track` sin `id`.
- [ ] **Step 2:** `npx vitest run tests/export.test.ts tests/validate.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `export.ts` y `sanitizeExportRequest`.
- [ ] **Step 4: Cablear.**
  - `shared/api.ts` y `preload/index.ts`: canales y métodos nuevos (el `subscribe` de `offline` sigue el patrón de `jam.subscribe`).
  - `ipc.ts`: `music:export` con `sanitizeExportRequest` + `exportTrack`; `prepare` responde `{ trackId, mimeType, durationSec }` desde `offline.local(trackId)` **sin tocar el proveedor** cuando hay archivo; `toggleFavorite` llama a `offline.onFavorite(track.id, now)`; `settingsSet` llama a `offline.reconcile()` solo cuando el parche trae `autoDownload`; `offline:get/sync/clear` delegan en el servicio.
  - `index.ts`: carpeta `join(userData, 'offline')`; `createOffline({ ..., enabled: () => store.getAppSettings().autoDownload, emit: (s) => enviar `IPC.offlineState` a todas las ventanas })`; `createAudioHandler(provider, netFetch, offline.local)`; `pickSavePath` con `dialog.showSaveDialog` (ventana enfocada si hay; `defaultPath` en `app.getPath('downloads')` + nombre; filtro por `AUDIO_FORMATS[format]`); `void offline.reconcile()` al arrancar.
- [ ] **Step 5:** pasan los tests; `npm run typecheck`; `npm test`; `npm run build`.
- [ ] **Step 6: Commit** `feat(offline): exportar canción, IPC de descargas y cableado en main`.

---

### Task 8: Estado offline en el renderer y reproductor consciente de la red

**Files:**
- Create: `src/renderer/src/stores/offline.ts`, `src/renderer/src/components/OfflineBanner.tsx`, `tests/offline-store.test.ts`
- Modify: `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/player/player.ts`, `src/renderer/src/player/instance.ts`, `src/renderer/src/components/TrackRow.tsx`, `src/renderer/src/pages/Library.tsx`, `src/renderer/src/pages/PlaylistPage.tsx`, `src/renderer/src/lib/actions.ts`, `src/renderer/src/styles/components.css`, `src/renderer/src/styles/layout.css`, `tests/player.test.ts`

**Interfaces:**
- Consumes: `OfflineState` (Task 1), `api.offline` (Task 7).
- Produces:
  - `useOffline` (zustand): `{ ids: Set<string>; pending: number; failed: number; bytes: number; online: boolean; set(s: OfflineState): void; setOnline(v: boolean): void; reachable(trackId: string): boolean; playable(tracks: Track[]): Track[] }`. `reachable` es `true` con red y, sin red, solo si el id está en `ids`; `playable` devuelve los mismos tracks con red y solo los alcanzables sin ella.
  - `startOfflineBridge(): Promise<void>`: carga `api.offline.state()`, se suscribe, fija `online` desde `navigator.onLine` y sus eventos; al volver la red llama `api.offline.sync()` (sin esperar ni propagar error).
  - `PlayerDeps.reachable?: (trackId: string) => boolean`. En `go`, antes de `api.prepare`, si `reachable` existe y devuelve `false`, falla con `{ code:'unavailable', message:'Sin conexión: esta canción no está descargada.' }` (usa el salto automático y el tope `MAX_AUTO_SKIPS` ya existentes; no se llama a `prepare`).

- [ ] **Step 1: Tests que fallan.**
  - `tests/offline-store.test.ts`: `reachable` con `online:true` es `true` para cualquier id; con `online:false` solo para ids descargados; `playable` filtra solo sin red.
  - `tests/player.test.ts`: con `reachable: (id) => id === 'a'` y cola `[b, c, a]` arrancando en `b`, `api.prepare` nunca se llama con `b` ni `c`, el reproductor termina sonando `a`, y `notify` recibió el aviso «no está disponible. Pasando a la siguiente.» por `b`; con una cola de 5 no alcanzables seguidas se detiene en `status:'error'` con ese mensaje tras 3 saltos (tope `MAX_AUTO_SKIPS`) y `prepare` no se llamó nunca (Review Focus 6).
- [ ] **Step 2:** `npx vitest run tests/offline-store.test.ts tests/player.test.ts` → FALLA.
- [ ] **Step 3: Implementar** el store, `startOfflineBridge` (se invoca en `main.tsx` junto a `startJamBridge`) y el gancho en el reproductor (`instance.ts` pasa `reachable: (id) => useOffline.getState().reachable(id)`).
- [ ] **Step 4: Interfaz.**
  - `OfflineBanner` (`role="status"`, texto «Sin conexión. Solo suenan las canciones descargadas.»), solo cuando `!online`, primer hijo de `<main>` en `App.tsx`. En `layout.css`, `.main` pasa a `display:flex; flex-direction:column` y `.main__scroll` a `flex:1; min-height:0` (en lugar de `height:100%`); comprobar con captura que el scroll y la memoria de scroll siguen igual.
  - `TrackRow`: junto al título, icono `CircleArrowDown` (verificar el nombre en la versión instalada de `lucide-react`) con `role="img"` y `aria-label="Disponible sin conexión"` cuando `ids.has(track.id)`; clase `is-unreachable` (opacidad reducida) cuando `!reachable`.
  - `Library` (pestaña Favoritos): «Reproducir» y «Aleatorio» usan `playable(tracks)`; el `toolbar__meta` suma «· N sin conexión» (cuando N > 0), «· bajando M» (cuando `pending > 0`) y «· K sin poder descargar» (cuando `failed > 0`).
  - `PlaylistPage` y `playPlaylist` (`actions.ts`): «Reproducir/Aleatorio» usan `playable`; si queda vacío, aviso «Sin conexión: ninguna canción de esta playlist está descargada.»
- [ ] **Step 5:** pasan los tests; `npm run typecheck`; `npm test`; `npm run build`.
- [ ] **Step 6: Commit** `feat(offline): estado offline en la interfaz y reproductor que salta lo no descargado`.

---

### Task 9: «Descargar canción» y ajustes de descargas

**Files:**
- Modify: `src/renderer/src/components/ContextMenu.tsx`, `src/renderer/src/lib/actions.ts`, `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/lib/format.ts`, `src/renderer/src/styles/settings.css`
- Create: `tests/format-bytes.test.ts`

**Interfaces:**
- Consumes: `api.music.export`, `api.offline.clear`, `useOffline`, `AUDIO_FORMATS`, `settings.exportFormat`/`autoDownload` (Tasks 1, 7, 8).
- Produces: `formatBytes(n: number): string` en `lib/format.ts` (`0 → '0 MB'`; menos de 1 MB en KB sin decimales; de 1 MB a 1 GB en MB con un decimal; desde 1 GB en GB con dos decimales; coma decimal como en el resto de la interfaz); `exportTrack(track: Track, format: AudioFormat): Promise<void>` en `lib/actions.ts` (toast «Guardada: <nombre>» si se guardó, nada si se canceló, toast de error con el mensaje si falla).

- [ ] **Step 1: Test que falla** `tests/format-bytes.test.ts`: `formatBytes(0)`, `formatBytes(512 * 1024)` → `'512 KB'`, `formatBytes(5_300_000)` → `'5,1 MB'`, `formatBytes(3 * 1024 ** 3)` → `'3,00 GB'` (ajustar los literales a la convención real de `format.ts` al escribir el test: si usa punto decimal, usar punto en toda la función y en estos valores).
- [ ] **Step 2:** `npx vitest run tests/format-bytes.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `formatBytes` y `exportTrack`.
- [ ] **Step 4: Menú.** En `trackMenuItems`, después de «Agregar a playlist», ítem «Descargar canción» (icono `Download`) con submenú de los dos formatos con el de `settings.exportFormat` primero (etiquetas `AUDIO_FORMATS[f].label`); `disabled` cuando `!online` y la canción no está descargada.
- [ ] **Step 5: Ajustes.** Grupo «Descargas» en `Settings.tsx` entre «Reproducción» y «Salas»: `Toggle` «Descargar las favoritas automáticamente» (pista: «Cada canción que marcás como favorita se guarda en tu disco para escucharla sin internet.»); `Choice` «Formato al descargar una canción» con Opus y AAC (pista: «Es el que aparece primero en el menú «Descargar canción» del clic derecho.»); fila de espacio «Espacio usado: X en N canciones» con botón «Borrar todas las descargas» (deshabilitado si N = 0) que abre `openDialog({ kind:'confirm', danger:true, ... })` con el texto «Se borran del disco las N canciones descargadas. Si la descarga automática sigue activada, las favoritas se bajan de nuevo la próxima vez que abras la app.».
- [ ] **Step 6:** `npm run typecheck`; `npm test`; `npm run build`; captura de la página de Ajustes y del menú con `npm run a11y` (sin violaciones nuevas).
- [ ] **Step 7: Commit** `feat(offline): «Descargar canción» con dos formatos y ajustes de descargas`.

---

### Task 10: Recorrido real, documentación y cierre

**Files:**
- Create: `scripts/e2e-offline.mjs`
- Modify: `package.json` (script `e2e:offline`), `README.md`

**Interfaces:** consume todo lo anterior; sin API nueva.

- [ ] **Step 1: Escribir `scripts/e2e-offline.mjs`** (misma estructura que `scripts/e2e-radio.mjs`: `step`, `waitFor`, carpeta de datos temporal, capturas en `.e2e/offline-*.png`). Pasos:
  1. «las favoritas se descargan solas»: buscar «Daft Punk One More Time» y «Queen Bohemian Rhapsody», marcar el corazón de la primera canción de cada una; esperar a que `offline/<id>.webm` exista, que `downloads` tenga 2 filas con `format='opus'` y que cada fila muestre «Disponible sin conexión».
  2. «exportar en Opus y en AAC»: reemplazar `dialog.showSaveDialog` en main con `app.evaluate` para que devuelva una ruta temporal; clic derecho → «Descargar canción» → «Opus (.webm)» y luego «AAC (.m4a)» sobre una tercera canción **no** favorita; comprobar tamaño > 100 KB y firma (`1A 45 DF A3` para webm, `ftyp` en los bytes 4–8 para m4a); y que cancelar el diálogo (`canceled:true`) no crea archivo ni toast de error.
  3. «sin conexión»: cerrar y relanzar con los mismos datos y `args: ['.', '--proxy-server=127.0.0.1:9']` (red de main muerta), `page.context().setOffline(true)`; esperar el aviso «Sin conexión», que Favoritos reproduzca una descargada (posición del reproductor avanza) y que una canción del Historial no descargada quede atenuada y, al tocarla, pase a la siguiente sin quedar cargando.
  4. «quitar de favoritas borra el archivo»: relanzar con red, quitar el corazón, esperar a que desaparezca el archivo y la fila.
  5. «Ajustes»: la página muestra «Espacio usado» con MB; «Borrar todas las descargas» (confirmar el diálogo) deja la carpeta vacía y la tabla vacía. Con «Descargar las favoritas automáticamente» apagado, marcar una favorita nueva no crea archivo.
- [ ] **Step 2: Ejecutar** `npm run build && node scripts/e2e-offline.mjs` y corregir hasta que pase con red real.
- [ ] **Step 3: Documentación.** `README.md`: reemplazar la línea «No hay descarga offline, crossfade…» por la versión sin «descarga offline»; sumar a las funciones las descargas offline y «Descargar canción»; en «Límites de la integración» una nota corta de que descargar audio de YouTube va contra sus términos y que es de uso personal; en «Datos locales» la carpeta `offline/` y la tabla `downloads`; en la tabla de pruebas, la fila de `npm run e2e:offline`.
- [ ] **Step 4: Batería completa** (todo debe pasar, sin tocar los resultados previos): `npm run typecheck`; `npm test` (337 + los nuevos); `npm run build`; `npm run e2e` (14), `e2e:ui` (11), `e2e:jam` (9), `e2e:settings` (9), `e2e:playlists` (5), `e2e:radio` (9), `e2e:offline`; `npm run a11y`.
- [ ] **Step 5: Commit** `test(offline): e2e de descargas y offline, y documentación`.
- [ ] **Step 6:** Revisión final de la rama con un revisor fresco en Opus, pasada de correcciones con TDD, y cierre con `superpowers:finishing-a-development-branch`. Actualizar la memoria del proyecto (estado de la fase 4 y menores diferidos).

---

## Autorrevisión

- **Spec §5 Fase 4:** tabla y archivos (Tasks 2, 5), cola de 2 y `.part` (4, 5), reanudación por URL caducada (4), reconcile al arrancar (5), `toggleFavorite` encola/borra (7), protocolo local con 200/206/416 y `prepare` inmediato (6, 7), exportación con submenú, `music:export`, diálogo en main, nombre saneado, copia si ya está en ese formato (1, 7, 9), icono, aviso «Sin conexión», evento `offline:state` (7, 8), ajustes de descarga automática, formato primero y espacio + borrar todo (1, 9), decisiones del builder-check (saltar sin red, atenuar y filtrar «reproducir», favoritas siempre Opus Alta) (3, 5, 8). Spikes: hechos arriba.
- **Un matiz no cubierto a propósito:** con `navigator.onLine` verdadero pero sin internet real (por ejemplo, conectado a una red sin salida) el reproductor muestra el error de red de siempre en vez de saltar; es honesto y no hay forma fiable de saberlo antes de intentar.
- **Consistencia de nombres:** `AudioFormat`, `AudioVariant`, `OfflineState`, `ExportResult`, `Offline.local/onFavorite/reconcile/clear/idle/state`, `downloadTo`, `openUpstream`, `exportTrack`, `reachable`, `playable` se usan igual en todas las tareas.
- **Proporción:** diez tareas, cada una con su ciclo de prueba; los cuerpos de funciones quedan para quien implemente.
