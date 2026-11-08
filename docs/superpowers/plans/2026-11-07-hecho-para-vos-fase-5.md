# Hecho para vos (fase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inicio muestra, arriba de lo actual, «Hecho para vos» (Descubrimiento semanal, Mixes diarios y Release Radar) y «Artistas que podrías escuchar», todo armado desde el historial y las favoritas locales; cada lista se abre en una página propia, se reproduce y se guarda como playlist.

**Architecture:** Un perfil de gustos puro (`taste.ts`) ordena los artistas con la misma afinidad que usa la radio. Un servicio `discover` en el proceso principal genera las listas de forma perezosa por período (semana, día, viernes), las guarda en la tabla `generated_lists` y devuelve siempre las anteriores mientras regenera; la generación es de una sola corrida a la vez y cada lista falla por separado. El renderer carga el estado, dispara `refresh` al montar Inicio y dibuja tarjetas y una página de solo lectura. «Reiniciar mis gustos» guarda una marca de tiempo que ignoran la radio y las listas.

**Tech Stack:** Electron 45, `node:sqlite`, `youtubei.js` 18.3.0 (cliente en inglés), React + zustand, vitest, playwright-core `_electron`.

**Spec:** `docs/superpowers/specs/2026-11-06-descubrimiento-offline-ajustes-design.md` §5 «Fase 5».

## Spike (hecho, 2026-11-07, YouTube Music real, cliente `hl=en gl=UY`)

- **Artistas similares:** `getArtist` trae la sección **`Fans might also like`** (carrusel de 10 artistas con `id`, `title`, `subtitle` y 2 miniaturas) en Daft Punk, Charly García, Queen y Soda Stereo. El título es estable porque el cliente va en inglés. Las demás secciones: `Top songs`, `Albums`, `Singles & EPs`, `Videos`, `Live performances`, `Featured on`, `Playlists by …`.
- **Lanzamientos:** `Albums` y `Singles & EPs` traen `year` (texto de 4 dígitos), `id` `MPREb_…` y vienen del más nuevo al más viejo; cada carrusel trae hasta 10. No hay fecha exacta. Hay reediciones con el año actual (por ejemplo «Queen II (2026 Mix)», varios discos de Charly con 2026): el radar inicial las va a mostrar.
- **Variedad de `getUpNext(semilla, true)`:** 50 canciones por semilla, 28–39 artistas distintos y 8–14 del mismo artista que la semilla; entre semillas de artistas distintos el solape es 0–4 canciones. La unión de varias semillas sobra para 30 canciones.
- **Otros endpoints:** `getRelated` trae «You might also like» (20 canciones) y «Similar artists»; `getExplore` trae «New albums & singles» global (no personalizado); `getHomeFeed` sin cuenta trae solo listas genéricas. No se usan.
- **Tiempos:** 10 `getArtist` con 4 en paralelo = 0,8 s; 8 `getUpNext` con 4 en paralelo = 1,6 s; 6 `getAlbum` con 3 en paralelo = 0,45 s. Generar todo ronda los 5 s en segundo plano.

## Decisiones de este plan (el dueño las puede cambiar)

- **Mixes diarios solo con ≥ 3 artistas ancla** (artistas top con canción semilla); con menos, la sección de mixes no aparece (el semanal sí). Evita mixes casi iguales entre sí.
- **Artistas sugeridos se guardan en `generated_lists`** con `kind='artists'` y `slot='1'`; la columna `tracks` (nombre fijado por el diseño) guarda para ese tipo el JSON de `ArtistSummary[]`. Se renuevan con el período semanal.
- **Release Radar sin novedades:** si no hay ids nuevos pero hay un radar anterior, se copia ese radar bajo la clave del período nuevo (conserva su contenido y su subtítulo con la fecha original) para no volver a consultar a YouTube en cada apertura. Sin radar anterior ni novedades, la sección no aparece.
- **Primera corrida del radar:** muestra los lanzamientos del año en curso y marca como vistos **todos** los ids observados (también los de años anteriores).
- **«Reiniciar mis gustos»:** guarda `taste_reset_at` (clave de `settings`, fuera del JSON de ajustes), vacía `generated_lists` y conserva `radar_seen`. La radio lo respeta porque `affinityInputs` filtra por esa marca.
- **Ya reproducido** para el semanal significa cualquier canción que haya sonado alguna vez (incluidas las automáticas de la radio) o esté en favoritas; para los mixes solo se excluyen duplicados.

## Global Constraints

- Perfil: reproducciones **no automáticas**, últimas **500**, vida media **45 días** (`RADIO.HALF_LIFE_DAYS`), favorita pesa **3** (`RADIO.FAVORITE_WEIGHT`); `taste_reset_at` ignora reproducciones y favoritas agregadas antes de la marca. Sección visible con **≥ 15 reproducciones o ≥ 5 favoritas**.
- Descubrimiento semanal: **30** canciones, semillas = canción más escuchada de cada uno de los **8** artistas top, candidatos = `getRadio` (automix) de cada semilla, fuera lo ya reproducido o en favoritas, primero artistas que nunca escuchaste, **máximo 2 por artista**, intercalado entre semillas.
- Mixes diarios: **3 a 6**, «Mix N», subtítulo «Artista A, Artista B y más», mitad canciones conocidas (base local) y mitad radio del ancla, mezcla con semilla derivada de la fecha local (estable durante el día).
- Release Radar: **15** artistas top con id, `getArtist` → `Albums` y `Singles & EPs`, «nuevo» = id no visto, tope **30** canciones (más nuevos primero), ids vistos en la clave `radar_seen` con tope **2000**.
- Artistas que podrías escuchar: sección `Fans might also like` de los **4** artistas top, sin los que ya están en el historial, tope **12**.
- Períodos (hora local): semanal = el lunes de la semana ISO, diario = la fecha, radar = el viernes anterior o actual; formato `YYYY-MM-DD`.
- Migración 4: `generated_lists(kind TEXT, slot TEXT, period TEXT, title TEXT, subtitle TEXT, tracks TEXT, created_at INTEGER, PRIMARY KEY(kind, slot, period))`.
- Ajustes nuevos: `forYou` (por defecto `true`) y la acción «Reiniciar mis gustos». Textos en español rioplatense (voseo). Sin dependencias nuevas; CSP sin cambios. Nada de esto bloquea la interfaz ni la reproducción: la generación corre en main y la interfaz sigue mostrando lo anterior.
- Cada tarea termina con `npm run typecheck` y `npm test` en verde.

## Review Focus

1. **Poca data** (14 reproducciones y 4 favoritas) → «Hecho para vos» y «Artistas que podrías escuchar» no aparecen; Inicio no muestra tarjetas vacías ni errores (Task 6 y 8).
2. **Sin internet al abrir Inicio con listas ya generadas** → se ven las anteriores, sin aviso de error y sin reintentos en bucle (Task 6 y 8).
3. **Dos aperturas de Inicio seguidas (o el doble efecto de StrictMode)** → una sola generación, sin pedidos duplicados a YouTube (Task 6 y 8).
4. **«Reiniciar mis gustos»** → desaparecen las listas, las favoritas agregadas antes de la marca no cuentan y la radio también las ignora; el historial y las favoritas quedan intactos (Task 4, 6 y 9).
5. **Artista top sin `channel_id`** (solo nombre) → se omite de lo que necesita `getArtist` (radar y similares) sin romper el resto (Task 5 y 6).
6. **Cambio de semana o de día** (lunes, medianoche, horario de verano) → períodos correctos; no se regenera de más ni se queda la lista vieja (Task 5).
7. **Release Radar:** la primera vez muestra los lanzamientos del año; después solo ids nuevos; sin novedades conserva el anterior; `radar_seen` nunca pasa de 2000 (Task 4, 5 y 6).
8. **Mix con pocas canciones conocidas, o semanal con muchos candidatos repetidos** → igual sale una lista sin duplicados de título y artista (Task 5).

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/shared/discover.ts` (nuevo) | `GeneratedKind`, `GeneratedList`, `DiscoverState`. |
| `src/shared/settings.ts`, `src/shared/types.ts` | Ajuste `forYou`; `ArtistDetail.similar`. |
| `src/main/music/youtube/mappers.ts`, `youtube/provider.ts` | `similarArtists`, `getArtist` devuelve `similar`. |
| `src/main/music/taste.ts` (nuevo) | `buildTaste`: ranking de artistas, semilla por artista, `ready`. Puro. |
| `src/main/db/store.ts` | Migración 4, `tasteInputs`, reinicio de gustos, listas generadas, `radar_seen`, `knownTracks`, `playedTrackIds`. |
| `src/main/music/discover-pick.ts` (nuevo) | Funciones puras: períodos, mezcla con semilla, `weeklyPick`, `mixPick`, `radarPick`, `pickSimilarArtists`. |
| `src/main/music/discover.ts` (nuevo) | Servicio: `get`, `refresh` (una corrida a la vez), `reset`. |
| `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts` | Canales `discover:get`, `discover:refresh`, `taste:reset` y cableado. |
| `src/renderer/src/stores/discover.ts` (nuevo), `stores/nav.ts` | Estado en el renderer; ruta `generated`. |
| `src/renderer/src/components/Shelf.tsx`, `pages/Home.tsx`, `pages/GeneratedPage.tsx` (nuevo), `App.tsx` | Tarjetas, filas de Inicio y página de la lista. |
| `src/renderer/src/pages/Settings.tsx` | Grupo «Hecho para vos». |
| `scripts/e2e-foryou.mjs` (nuevo), `package.json`, `README.md` | Recorrido real y documentación. |

---

### Task 1: Contratos compartidos y ajuste `forYou`

**Files:**
- Create: `src/shared/discover.ts`
- Modify: `src/shared/settings.ts`, `tests/settings.test.ts`

**Interfaces:**
- Produces (en `src/shared/discover.ts`):
  - `type GeneratedKind = 'weekly' | 'mix' | 'radar'`
  - `interface GeneratedList { kind: GeneratedKind; slot: string; title: string; subtitle: string; tracks: Track[]; period: string; createdAt: number; stale: boolean }` (`stale`: es de un período anterior al vigente y se muestra mientras se regenera)
  - `interface DiscoverState { enabled: boolean; ready: boolean; updating: boolean; lists: GeneratedList[]; artists: ArtistSummary[] }` (`lists` ordenadas: semanal, mixes por `slot`, radar; vacías si `!enabled` o `!ready`)
- Produces (settings): `AppSettings.forYou: boolean`, por defecto `true`.

- [ ] **Step 1: Tests que fallan** en `tests/settings.test.ts`: `parseSettings({ forYou: false })` → `{ forYou: false }`; `parseSettings({ forYou: 'si' })` → `{}` (sumarlo al objeto `junk` existente); `DEFAULT_SETTINGS.forYou === true`.
- [ ] **Step 2:** `npx vitest run tests/settings.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `forYou` en `AppSettings`, `DEFAULT_SETTINGS` y `parseSettings` (booleano estricto) y crear `src/shared/discover.ts` solo con los tipos.
- [ ] **Step 4:** pasan los tests; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(discover): contratos compartidos y ajuste «Hecho para vos»`.

---

### Task 2: Artistas similares en `getArtist`

**Files:**
- Modify: `src/shared/types.ts`, `src/main/music/youtube/mappers.ts`, `src/main/music/youtube/provider.ts`, `tests/mappers.test.ts`

**Interfaces:**
- Produces: `ArtistDetail.similar: ArtistSummary[]`; `similarArtists(sections: Node[]): ArtistSummary[]` exportada desde `mappers.ts` (`Node` = el `any` ya usado en ese archivo).

- [ ] **Step 1: Tests que fallan** en `tests/mappers.test.ts` (con secciones de la forma que devuelve YouTube.js, como los demás tests del archivo): `similarArtists` toma solo la sección cuyo título, sin distinguir mayúsculas, empieza con `fans might also like`; devuelve `{ id, name, subtitle, thumbnail }` por cada ítem `item_type: 'artist'`; ignora ítems que no son artistas o no traen `id`; sin esa sección devuelve `[]`; no mezcla artistas de otras secciones (por ejemplo `Playlists by X`).
- [ ] **Step 2:** `npx vitest run tests/mappers.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `similarArtists` reutilizando `mapArtist`, y que `getArtist` del proveedor devuelva `similar: similarArtists(sections)`; agregar `similar` a `ArtistDetail` en `types.ts` (sin tocar `ArtistPage`).
- [ ] **Step 4:** pasan los tests; `npm run typecheck`; `npm test`.
- [ ] **Step 5: Commit** `feat(discover): artistas similares en el detalle de artista`.

---

### Task 3: Perfil de gustos (puro)

**Files:**
- Create: `src/main/music/taste.ts`, `tests/taste.test.ts`

**Interfaces:**
- Consumes: `computeAffinity`, `RADIO`, `artistKey` (de `radio.ts`).
- Produces:
  - `TASTE = { MIN_PLAYS: 15, MIN_FAVORITES: 5, TOP_ARTISTS: 8 } as const`
  - `interface TasteInputs { plays: { trackId: string; artists: ArtistRef[]; playedAt: number }[]; favorites: { trackId: string; artists: ArtistRef[]; addedAt: number }[] }`
  - `interface TasteArtist { key: string; id?: string; name: string; score: number; seedTrackId?: string }`
  - `interface Taste { artists: TasteArtist[]; playCount: number; favoriteCount: number; ready: boolean }`
  - `buildTaste(input: TasteInputs, now: number): Taste`

- [ ] **Step 1: Tests que fallan** en `tests/taste.test.ts`:
  - `artists` sale ordenado por `score` descendente (desempate por `key`), con el mismo valor que `computeAffinity` para cada clave; una reproducción de hace 45 días pesa la mitad y una favorita pesa 3.
  - `id` es el `channel_id` si algún crédito lo trae; `key` es el id o el nombre en minúsculas; `name` es el primero visto.
  - `seedTrackId` es la canción **más reproducida** de ese artista (empate: la más reciente); sin reproducciones del artista pero con favorita, la favorita más reciente; una canción con dos artistas acreditados cuenta para ambos.
  - `ready` es `true` con 15 reproducciones o con 5 favoritas, y `false` con 14 y 4; `playCount` y `favoriteCount` cuentan las entradas recibidas.
  - Entrada vacía → `{ artists: [], playCount: 0, favoriteCount: 0, ready: false }`.
- [ ] **Step 2:** `npx vitest run tests/taste.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `buildTaste` apoyado en `computeAffinity` para los puntajes.
- [ ] **Step 4:** pasan los tests; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(discover): perfil de gustos con la misma afinidad que la radio`.

---

### Task 4: Base de datos: listas generadas, gustos y radar visto

**Files:**
- Modify: `src/main/db/store.ts`, `tests/store.test.ts`

**Interfaces:**
- Consumes: `TasteInputs` (Task 3), `ArtistSummary`, `Track`.
- Produces (en `createStore`):
  - `interface StoredList { kind: string; slot: string; period: string; title: string; subtitle: string; items: Track[] | ArtistSummary[]; createdAt: number }` (exportada)
  - `tasteInputs(limit: number): TasteInputs` (reproducciones no automáticas y favoritas posteriores a `taste_reset_at`)
  - `affinityInputs(limit)` conserva su forma y pasa a ignorar lo anterior a `taste_reset_at`
  - `resetTaste(now: number): void` (guarda `taste_reset_at`)
  - `playedTrackIds(): string[]` (todos los ids distintos que alguna vez sonaron, automáticos incluidos)
  - `knownTracks(limit: number): Track[]` (canciones distintas con `tracks` que sonaron no automáticas o son favoritas, posteriores a la marca, las más recientes primero)
  - `generatedLists(): StoredList[]` (la fila del período más nuevo de cada `kind` + `slot`)
  - `saveGenerated(list: StoredList): void` (reemplaza la del mismo `kind`, `slot` y `period`; conserva los **2** períodos más nuevos de cada `kind` + `slot`)
  - `clearGenerated(): void`
  - `radarSeen(): string[]` y `saveRadarSeen(ids: string[]): void` (clave `radar_seen`, guarda los **2000** últimos sin repetir)

- [ ] **Step 1: Tests que fallan** en `tests/store.test.ts`:
  - migración 4: una base creada con la migración 3 sube a la 4 sin perder favoritas ni descargas; reabrir no rompe.
  - `tasteInputs`: devuelve `trackId`, `artists`, `playedAt` y `addedAt`; omite las reproducciones `auto`; tras `resetTaste(ahora)` ignora reproducciones y favoritas anteriores y toma las nuevas; `affinityInputs` también las ignora (la radio respeta el reinicio).
  - `playedTrackIds` incluye las automáticas; `knownTracks` respeta el límite y no repite canciones.
  - `saveGenerated`/`generatedLists`: ida y vuelta de canciones y de artistas; dos períodos distintos del mismo `kind` + `slot` devuelven el más nuevo; a la tercera se borra el más viejo; `clearGenerated` vacía todo.
  - `saveRadarSeen`: guarda y lee; con 2500 ids conserva 2000 (los últimos); sin repetidos.
- [ ] **Step 2:** `npx vitest run tests/store.test.ts` → FALLA.
- [ ] **Step 3: Implementar** la migración 4 (SQL de Global Constraints) y los métodos. `tasteInputs` y `affinityInputs` comparten la consulta; filtrar con `> taste_reset_at` (0 si no hay marca).
- [ ] **Step 4:** pasan los tests; `npm run typecheck`; `npm test` (los tests de radio siguen iguales).
- [ ] **Step 5: Commit** `feat(discover): tabla generated_lists (migración 4), reinicio de gustos y radar visto`.

---

### Task 5: Funciones puras de la generación

**Files:**
- Create: `src/main/music/discover-pick.ts`, `tests/discover-pick.test.ts`

**Interfaces:**
- Consumes: `TasteArtist` (Task 3), `artistKey` y `songKey` de `shared/track`, `Track`, `AlbumSummary`, `ArtistSummary`.
- Produces:
  - `periodKeys(now: Date): { weekly: string; daily: string; radar: string }` (hora local, formato `YYYY-MM-DD`)
  - `seededShuffle<T>(items: readonly T[], seed: string): T[]` (determinista; no muta)
  - `weeklyPick(seeds: { artistKey: string; tracks: Track[] }[], ctx: { excludeIds: ReadonlySet<string>; knownArtists: ReadonlySet<string>; limit: number }): Track[]`
  - `mixPick(o: { anchor: { key: string; name: string }; radio: Track[]; known: Track[]; seed: string; limit: number }): Track[]`
  - `mixSubtitle(names: string[]): string`
  - `radarPick(artists: { albums: AlbumSummary[]; singles: AlbumSummary[] }[], seen: ReadonlySet<string>, ctx: { year: number }): { fresh: AlbumSummary[]; observed: string[] }`
  - `pickSimilarArtists(lists: ArtistSummary[][], knownKeys: ReadonlySet<string>, limit: number): ArtistSummary[]`

- [ ] **Step 1: Tests que fallan** en `tests/discover-pick.test.ts`:
  - `periodKeys`: miércoles 2026-11-11 → `weekly '2026-11-09'` (lunes), `daily '2026-11-11'`, `radar '2026-11-06'` (viernes anterior); un lunes devuelve ese mismo lunes como semanal; un viernes devuelve ese viernes como radar y un sábado, el viernes anterior; domingo 2026-11-15 sigue en la semana del 2026-11-09; el cambio de horario de verano (por ejemplo `new Date(2026, 2, 8, 12)`, `new Date(2026, 9, 25, 12)`) no corre el día; medianoche local `new Date(2026, 10, 9, 0, 0)` ya es lunes 2026-11-09 (Review Focus 6).
  - `seededShuffle`: misma semilla → mismo orden; semillas distintas → órdenes distintos; conserva los elementos; no muta la entrada.
  - `weeklyPick`: descarta ids excluidos y duplicados por `songKey`; máximo 2 por artista principal en toda la lista; intercala entre semillas (la salida alterna una de cada semilla mientras haya); dentro de cada semilla pasa primero lo de artistas que no están en `knownArtists`; respeta `limit`; con todas las canciones de un solo artista devuelve 2 (Review Focus 8).
  - `mixPick`: alterna conocidas y radio (mitad y mitad, `limit` total); sin duplicados por `songKey` entre ambas mitades; con pocas conocidas completa con radio hasta `limit`; con pocas de radio completa con conocidas; misma `seed` → misma lista y otra `seed` → otro orden; las conocidas solo son del ancla o de artistas que aparecen en `radio` (los afines) (Review Focus 8).
  - `mixSubtitle(['A','B','C'])` → `'A, B y más'`; `['A','B']` → `'A y B'`; `['A']` → `'A'`; `[]` → `''`.
  - `radarPick`: con `seen` vacío devuelve como `fresh` solo lo del año `ctx.year` y en `observed` todos los ids vistos (también los de años anteriores); con `seen` no vacío devuelve solo ids no vistos, sin importar el año; ordena `fresh` del año más nuevo al más viejo (estable); no repite un id que aparece en `albums` y `singles` (Review Focus 7).
  - `pickSimilarArtists`: une listas, sin repetir `id`; quita los de `knownKeys` (por `id` o por nombre en minúsculas); ordena por cantidad de listas en que aparece (desc) y luego por primera aparición; respeta `limit`.
- [ ] **Step 2:** `npx vitest run tests/discover-pick.test.ts` → FALLA.
- [ ] **Step 3: Implementar** (todo puro; sin hora ni azar implícitos: la fecha y la semilla entran por parámetro).
- [ ] **Step 4:** pasan los tests; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(discover): períodos, semanal, mixes, radar y artistas sugeridos (funciones puras)`.

---

### Task 6: Servicio `discover`

**Files:**
- Create: `src/main/music/discover.ts`, `tests/discover.test.ts`

**Interfaces:**
- Consumes: `buildTaste`, `TASTE` (Task 3), las funciones de Task 5, los métodos de `store` de Task 4, `DiscoverState`/`GeneratedList` (Task 1), `getRadio`/`getArtist`/`getAlbum` del proveedor.
- Produces: `createDiscover(d: { source: Pick<MusicProvider, 'getRadio' | 'getArtist' | 'getAlbum'>; store: DiscoverStore; enabled: () => boolean; now?: () => number }): { get(): DiscoverState; refresh(): Promise<DiscoverState>; reset(): DiscoverState }`, con `DiscoverStore` = el subconjunto de `Store` que usa (`tasteInputs`, `playedTrackIds`, `knownTracks`, `favoriteIds`, `generatedLists`, `saveGenerated`, `clearGenerated`, `radarSeen`, `saveRadarSeen`, `resetTaste`).
- Comportamiento:
  - `get()` no usa red: sin `enabled()` o sin `ready` devuelve `{ enabled, ready, updating:false, lists:[], artists:[] }`; si no, las listas guardadas (aunque sean de un período anterior, con `stale: true`) ordenadas semanal, mixes por `slot`, radar.
  - `refresh()`: una sola corrida a la vez (mientras corre, los demás llamados reciben la misma promesa); sin `enabled` o sin `ready` no llama a la red; solo genera lo que no tiene fila del período vigente; cada lista falla por separado y conserva la anterior; hasta 4 pedidos a YouTube a la vez; en una misma corrida cada `getArtist` y cada `getRadio` se piden una sola vez.
  - Semanal: slot `'1'`, título «Descubrimiento semanal»; no se guarda si queda vacío. Mixes: slots `'1'`…`'6'`, título «Mix N»; solo si hay ≥ 3 anclas con `seedTrackId`. Radar: título «Release Radar», `getAlbum` de hasta 12 lanzamientos nuevos, 30 canciones, nuevos primero; sin nuevos conserva el anterior bajo el período nuevo; marca vistos lo observado. Artistas: `kind 'artists'`, slot `'1'`, de los 4 artistas top con id, sin ningún artista que aparezca en `knownTracks(2000)` (historial y favoritas, por id o por nombre en minúsculas).
  - Un artista top sin `id` se omite de lo que necesita `getArtist`; sus semillas de `getRadio` siguen valiendo.
  - `reset()`: `store.resetTaste(now)` + `store.clearGenerated()` y devuelve `get()`.

- [ ] **Step 1: Tests que fallan** en `tests/discover.test.ts` (base `createStore(':memory:')` sembrada con `recordPlay` y `toggleFavorite`; proveedor simulado con `vi.fn`; hora fija inyectada):
  - con 14 reproducciones y 4 favoritas: `ready` es `false`, `lists` y `artists` vacíos y el proveedor no se llama (Review Focus 1).
  - con data suficiente: `refresh()` guarda semanal, ≥ 3 mixes, radar y artistas; `get()` los devuelve con `stale:false`, el semanal sin canciones ya reproducidas ni favoritas y con ≤ 2 por artista.
  - segunda `refresh()` del mismo día/semana no llama al proveedor.
  - al cambiar de día se regeneran los mixes pero no el semanal; al cambiar de semana el semanal; `get()` antes de refrescar devuelve las anteriores con `stale:true`.
  - si el proveedor falla con error de red durante una regeneración, `refresh()` no lanza, `get()` conserva las listas anteriores y la siguiente `refresh()` reintenta (sin bucle dentro de la misma llamada) (Review Focus 2).
  - dos `refresh()` simultáneas comparten la promesa y el proveedor recibe un solo juego de pedidos (Review Focus 3).
  - radar: primera corrida muestra lo del año en curso y marca todo visto; segunda con un álbum nuevo muestra solo ese; tercera sin novedades conserva el radar anterior (mismo contenido y subtítulo) bajo el período nuevo y no vuelve a pedir `getArtist` en esa misma semana; `radar_seen` queda ≤ 2000 (Review Focus 7).
  - artista top sin `id`: no entra en `getArtist` ni en el radar, y el semanal igual usa su semilla (Review Focus 5).
  - `enabled: () => false` no llama a la red y `get()` dice `enabled:false`.
  - `reset()` deja `lists` vacío, hace que una favorita agregada antes de la marca no cuente y no toca `radar_seen` (Review Focus 4).
- [ ] **Step 2:** `npx vitest run tests/discover.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `createDiscover` (un `Map` de promesas por corrida para `getArtist`/`getRadio`; un limitador de concurrencia de 4).
- [ ] **Step 4:** pasan los tests; `npm run typecheck`; `npm test`.
- [ ] **Step 5: Commit** `feat(discover): servicio que genera y renueva Hecho para vos por período`.

---

### Task 7: IPC y cableado en main

**Files:**
- Modify: `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: `createDiscover` (Task 6), `DiscoverState` (Task 1).
- Produces: canales `discoverGet: 'discover:get'`, `discoverRefresh: 'discover:refresh'`, `tasteReset: 'taste:reset'`; API `discover: { get(): Promise<DiscoverState>; refresh(): Promise<DiscoverState>; resetTaste(): Promise<DiscoverState> }`; `registerIpc` recibe además `discover`.

- [ ] **Step 1: Cablear.** `shared/api.ts` y `preload/index.ts`: canales y métodos. `ipc.ts`: `discover:get` → `discover.get()`, `discover:refresh` → `discover.refresh()`, `taste:reset` → `discover.reset()`; ninguno recibe argumentos. `index.ts`: `createDiscover({ source: provider, store, enabled: () => store.getAppSettings().forYou })` pasado a `registerIpc`.
- [ ] **Step 2:** `npm run typecheck`; `npm test`; `npm run build`.
- [ ] **Step 3: Commit** `feat(discover): canales IPC de Hecho para vos y reinicio de gustos`.

---

### Task 8: Inicio y página de la lista

**Files:**
- Create: `src/renderer/src/stores/discover.ts`, `src/renderer/src/pages/GeneratedPage.tsx`, `tests/discover-store.test.ts`
- Modify: `src/renderer/src/stores/nav.ts`, `src/renderer/src/components/Shelf.tsx`, `src/renderer/src/pages/Home.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles/components.css` (solo si hace falta)

**Interfaces:**
- Consumes: `api.discover` (Task 7), `DiscoverState`, `GeneratedList` (Task 1).
- Produces:
  - `createDiscoverStore(api: { get(): Promise<DiscoverState>; refresh(): Promise<DiscoverState> })` y `useDiscover` (zustand) con `state: DiscoverState` (inicial: todo vacío y `enabled:false`), `load(): Promise<void>`, `refresh(): Promise<void>` (los llamados concurrentes comparten la promesa; un fallo se ignora y conserva el estado previo), `set(state: DiscoverState): void`.
  - Ruta `{ page: 'generated'; kind: GeneratedKind; slot: string }` en `nav.ts` y su caso en `App.tsx`.
  - `GeneratedCard({ list, onPlay })` en `Shelf.tsx`: `MediaCard` con mosaico de 4 portadas (`PlaylistCover`), título, subtítulo, abre la página y reproduce con el botón.
  - `GeneratedPage({ kind, slot })`: cabecera tipo `PlaylistPage` (`Hero` con mosaico), «Reproducir», «Aleatorio», «Agregar a la cola», «Guardar en mi biblioteca» (crea la playlist con el título de la lista y agrega las canciones, con la guarda contra doble clic de `RemotePlaylistPage`) y la lista de canciones; si la lista ya no existe (por ejemplo tras reiniciar gustos) muestra un estado vacío con «Esta lista ya no está disponible».

- [ ] **Step 1: Tests que fallan** en `tests/discover-store.test.ts` (API simulada): `load` deja en `state` lo que devuelve `get`; `refresh` reemplaza `state` con el resultado; si `refresh` rechaza, `state` no cambia y no lanza (Review Focus 2); dos `refresh` simultáneos llaman a la API una sola vez (Review Focus 3); un `refresh` después de terminar el anterior vuelve a llamar.
- [ ] **Step 2:** `npx vitest run tests/discover-store.test.ts` → FALLA.
- [ ] **Step 3: Implementar** el store (misma forma de fábrica con API inyectada que `stores/settings.ts`).
- [ ] **Step 4: Interfaz.**
  - `Home.tsx`: al montar llama `useDiscover.getState().load()` y después `refresh()`. Arriba de «Continuar escuchando», si `state.enabled && state.ready && lists.length > 0`, un `Shelf` «Hecho para vos» con una `GeneratedCard` por lista (reproducir = `player().playTracks(list.tracks, 0)`) y, si `artists.length > 0`, un `Shelf` «Artistas que podrías escuchar» con `ArtistCard` (círculos). Nunca se dibuja una sección vacía ni un esqueleto por estas listas; el estado vacío de Inicio no cambia (si no hay historial, no hay «Hecho para vos»).
  - La lista `stale` se muestra igual (sin marca especial).
- [ ] **Step 5:** pasan los tests; `npm run typecheck`; `npm test`; `npm run build`.
- [ ] **Step 6: Commit** `feat(discover): «Hecho para vos» y «Artistas que podrías escuchar» en Inicio, y la página de la lista`.

---

### Task 9: Ajustes: «Hecho para vos» y «Reiniciar mis gustos»

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `api.discover.resetTaste`, `useDiscover.set`, `settings.forYou` (Tasks 1, 7, 8).

- [ ] **Step 1: Implementar.** Grupo «Hecho para vos» entre «Descargas» y «Salas»: `Toggle` «Mostrar «Hecho para vos» en Inicio» (pista: «Listas armadas con lo que escuchás y tus favoritas: Descubrimiento semanal, Mixes diarios, Release Radar y artistas que podrías escuchar. Todo sale de tu historial en esta PC.»); fila «Reiniciar mis gustos» con la pista «Las listas se arman de nuevo solo con lo que escuches desde ahora. No borra tu historial ni tus favoritas.» y el botón «Reiniciar mis gustos» que abre `openDialog({ kind:'confirm', danger:true, title:'Reiniciar mis gustos', message:'Se ignora lo que escuchaste y las favoritas agregadas hasta ahora para armar las listas y la radio. Tu historial y tus favoritas no se borran.', confirmLabel:'Reiniciar' })`; al confirmar llama a `api.discover.resetTaste()`, vuelca el estado con `useDiscover.getState().set(...)` y avisa «Gustos reiniciados».
- [ ] **Step 2:** `npm run typecheck`; `npm test`; `npm run build`; `npm run a11y` sin violaciones nuevas (Ajustes y Inicio).
- [ ] **Step 3: Commit** `feat(discover): ajustes de Hecho para vos y reinicio de gustos`.

---

### Task 10: Recorrido real, documentación y cierre

**Files:**
- Create: `scripts/e2e-foryou.mjs`
- Modify: `package.json` (script `e2e:foryou`), `README.md`

**Interfaces:** consume todo lo anterior; sin API nueva.

- [ ] **Step 1: Escribir `scripts/e2e-foryou.mjs`** (estructura de `scripts/e2e-offline.mjs`: `step`, `waitFor`, datos temporales, capturas en `.e2e/foryou-*.png`). Con `youtubei.js` directo (como `scripts/probe.mjs`) toma 4 artistas reales (Daft Punk, Charly García, Queen, Soda Stereo) con sus ids y 4 canciones de `Top songs` cada uno; abre la app una vez para que cree la base, la cierra y siembra `tracks`, `plays` y `favorites` con `node:sqlite`. Pasos:
  1. «poca data»: 14 reproducciones y 4 favoritas → Inicio no muestra «Hecho para vos» ni «Artistas que podrías escuchar» y no hay avisos de error.
  2. «con data suficiente» (se completa hasta 20 reproducciones): aparece «Hecho para vos» con el semanal y ≥ 3 mixes (y el radar si hay), y «Artistas que podrías escuchar» con ≥ 6 círculos que no son los 4 sembrados.
  3. «abrir el semanal»: la página trae ≥ 20 canciones, sin títulos repetidos ni canciones de las sembradas; «Reproducir» suena de verdad; «Guardar en mi biblioteca» crea una sola playlist con esas canciones.
  4. «sin red al abrir»: relanzar con `--proxy-server=127.0.0.1:9` (red de main cortada) y datos de otro día/semana simulados borrando las filas del período vigente de `generated_lists`: Inicio sigue mostrando las listas anteriores y no sale ningún aviso de error.
  5. «Ajustes»: apagar «Mostrar «Hecho para vos»» las oculta de Inicio; encenderlo vuelve a mostrarlas; «Reiniciar mis gustos» (confirmando) las hace desaparecer y deja intactas las filas de `plays` y `favorites`.
- [ ] **Step 2: Ejecutar** `npm run build && node scripts/e2e-foryou.mjs` y corregir hasta que pase con red real.
- [ ] **Step 3: Documentación.** `README.md`: sumar a «Qué incluye» «Hecho para vos» (semanal, mixes, radar, artistas, cómo se arman y cuándo se renuevan, y el umbral de datos); en «Límites de la integración» una nota: YouTube Music solo informa el año de los lanzamientos, así que «nuevo» = visto por primera vez por la app (el primer radar muestra los del año en curso, que incluye reediciones), y los artistas sugeridos salen de la sección «Fans might also like» (cliente en inglés); en «Datos locales» la tabla `generated_lists` y las claves `radar_seen` y `taste_reset_at`; en la tabla de pruebas la fila de `npm run e2e:foryou`; y quitar de Ajustes la mención de lo que falta si la hubiera.
- [ ] **Step 4: Batería completa** (todo debe pasar): `npm run typecheck`; `npm test`; `npm run build`; `npm run e2e`, `e2e:ui`, `e2e:jam`, `e2e:settings`, `e2e:playlists`, `e2e:radio`, `e2e:offline`, `e2e:foryou`; `npm run a11y`.
- [ ] **Step 5: Commit** `test(discover): e2e de Hecho para vos y documentación`.
- [ ] **Step 6:** Revisión final de la rama con un revisor fresco en Opus, pasada de correcciones con TDD, y cierre con `superpowers:finishing-a-development-branch`. Actualizar la memoria del proyecto.

---

## Autorrevisión

- **Spec §5 Fase 5:** perfil y reinicio (Tasks 3, 4, 9), mínimo de datos (3, 6, 8), persistencia por período y regeneración perezosa con la anterior visible (4, 5, 6, 8), semanal (5, 6), mixes (5, 6), radar con `radar_seen` y primera corrida (4, 5, 6), artistas (2, 5, 6), interfaz con tarjetas, página y «Guardar en mi biblioteca» y que al terminar siga la radio (8; la radio ya corre al terminar una cola suelta), ajustes (1, 9). Spikes: hechos arriba.
- **Un matiz a propósito:** los artistas sugeridos viven en `generated_lists` con la columna `tracks` guardando artistas (ver «Decisiones»); la alternativa era una columna o tabla más, que el diseño evitaba.
- **Consistencia de nombres:** `Taste`, `TasteArtist`, `TasteInputs`, `StoredList`, `GeneratedList`, `DiscoverState`, `periodKeys`, `weeklyPick`, `mixPick`, `radarPick`, `pickSimilarArtists`, `createDiscover`, `useDiscover` se usan igual en todas las tareas.
- **Proporción:** diez tareas, cada una con su ciclo de prueba; los cuerpos de funciones quedan para quien implemente.
