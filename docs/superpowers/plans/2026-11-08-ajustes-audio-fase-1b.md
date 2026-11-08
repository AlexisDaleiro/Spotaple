# Ajustes de audio (fase 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el sonido se pueda ajustar: ecualizador de 10 bandas con presets, normalización de volumen por canción y fundido cruzado (crossfade) entre canciones.

**Architecture:** El `<audio>` de la app pasa por un grafo de Web Audio creado una vez en el renderer (`audio-engine.ts`): por cada elemento `fuente → ganancia de normalización → ganancia de fundido`, y un bus común `preamplificador → 10 filtros biquad → salida`. Main solo aporta lo que Web Audio exige (CORS en `spotaple-audio://`) y el loudness de cada canción (viaja como número en `PreparedAudio`; la URL sigue sin salir de main). El crossfade es lo único que toca la máquina de estados del reproductor: un segundo `<audio>` alterna con el primero y las rampas las hace el motor.

**Tech Stack:** Electron 45, React 19, zustand 5, TypeScript, Web Audio, `node:sqlite`, `youtubei.js` 18.3.0, vitest (entorno `node`), playwright-core (e2e).

**Spec:** `docs/superpowers/specs/2026-11-06-descubrimiento-offline-ajustes-design.md` (§4.2 «Mías» y §5 «Fase 1b»). Los datos reales salen del spike de esta fase (siguiente sección), que corrige tres puntos del spec.

## Hallazgos del spike (verificados en Electron real el 2026-11-08)

- **Web Audio sobre `spotaple-audio://` necesita las tres piezas del spec.** Sin `crossOrigin`: la consola dice `MediaElementAudioSource outputs zeroes due to CORS access restrictions` y el pico de señal es **0** (el audio suena en el elemento pero sale mudo del grafo). Con `crossOrigin="anonymous"` y sin `corsEnabled`: `Cross origin requests are only supported for protocol schemes…` y el audio no carga. Con `corsEnabled: true` en `registerSchemesAsPrivileged` + `Access-Control-Allow-Origin: *` en toda respuesta de `audio-protocol.ts` + `crossOrigin="anonymous"`: **pico 0,6 al arrancar y 0,67 tras saltar a 0:60**; el Range funciona. Los dos cambios de main ya están en la rama (sin commit) y los consolida la Tarea 1.
- **Loudness: el campo que sugería el spec no existe en VISIONOS.** `player_config.audio_config.loudness_db` solo viene con `ANDROID_VR`. VISIONOS entrega `audio_config.perceptual_loudness_db` y cada formato trae `track_absolute_loudness_lkfs` (el mismo número, **LUFS absolutos**; `loudness_db` del formato = LUFS + 14). Cuatro canciones medidas: −12,36 · −8,85 · −14,5 · −13,87 LUFS. **Se usa `format.track_absolute_loudness_lkfs`**, con `perceptual_loudness_db` de respaldo.
- Una canción **ya descargada** suena del disco sin pasar por YouTube, así que su loudness hay que guardarlo al bajarla: columna nueva `tracks.loudness` (el spec no la anunciaba).

**Qué cambia respecto del spec:** (1) Campo de loudness: `track_absolute_loudness_lkfs`. (2) Migración nueva `tracks.loudness REAL`. (3) La normalización **solo baja, nunca sube** (objetivo −14 LUFS, la referencia de YouTube): sin limitador, subir una canción callada saturaría. Es lo que hace YouTube. (4) Normalizar, ecualizador y fundido nacen **apagados**: nada cambia hasta que la persona lo active.

## Global Constraints

- Rama `feat/ajustes-audio-1b` (ya creada desde `main`). Commits en español con prefijo convencional (`feat(audio): …`) que terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Sin push ni merge sin que el usuario lo pida.
- Textos de interfaz en español con voseo. Los controles aparecen en Ajustes **solo cuando la función existe** (el fundido se agrega en la Tarea 6, no antes).
- Ajustes nuevos en `AppSettings` (validados en `parseSettings`, lo inválido se descarta): `eqOn: boolean` (false), `eqGains: number[]` (10 valores en −12…+12 dB, todos 0), `eqPreamp: number` (−12…+12 dB, 0), `normalize: boolean` (false), `crossfade: number` (entero 0…12 s, 0). Un arreglo de `eqGains` con otro largo, con `NaN` o fuera de rango se descarta entero.
- **Ecualizador:** bandas `[31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]` Hz; la primera es `lowshelf`, la última `highshelf`, el resto `peaking` con Q = 1. Presets: Plano, Más graves, Más agudos, Voz, Rock, Pop, Electrónica (cada uno con su preamplificador que compensa el mayor realce). Con `eqOn` apagado el grafo queda en plano (ganancias 0), sin reconectar nada.
- **Normalización:** ganancia = `clamp(−14 − loudness, −12, 0)` dB; sin loudness (o no finito) = 0 dB. Rige por elemento, así que con fundido cada canción lleva la suya.
- **Crossfade:** 0 = apagado (el comportamiento actual, intacto). Curva de potencia constante (coseno/seno). Nunca dentro de una sala (`jam.active()`), con `repeat = one`, ni en la última canción de la cola, ni si la canción dura menos de 2 × el fundido.
- Si el motor de audio no se puede crear (antes de conectar el elemento), el `<audio>` suena como hoy. Ninguna URL de audio llega al renderer. CSP sin cambios.
- No hay canal IPC nuevo: los ajustes viajan por `settings:set`.
- Verificación por tarea: `npm run typecheck` y `npm test`; al final también `npm run build`, `npm run e2e:audio`, `npm run e2e:offline`, `npm run e2e:settings`, `npm run e2e:radio`, `npm run e2e:jam`, `npm run e2e`, `npm run e2e:ui` y `npm run a11y`.

## Review Focus

1. **Arranque en frío con todo apagado:** la app tiene que sonar (el grafo siempre existe). Lo cubre el paso 1 de `e2e:audio` (Tarea 5): pico > 0 con los ajustes por defecto.
2. **Archivo descargado (CORS + Range desde el disco):** `e2e:offline` sigue verde y el paso 6 de `e2e:audio` repite el pico con una favorita bajada (Tarea 5).
3. **Canción sin loudness o con un valor basura** (`undefined`, `NaN`, `±Infinity`, +50): ganancia 0 dB, sin `NaN` en el grafo (Tarea 1, `normalizationGainDb`; Tarea 2, `loudnessOf`).
4. **Ajustes de ecualizador corruptos** (9 valores, `NaN`, 99 dB, texto): se descartan y rigen los de por defecto (Tarea 1, `parseSettings`).
5. **Saltar, pausar o buscar durante el fundido; que falle la siguiente canción en pleno fundido; canción corta; cola de una sola canción** (Tarea 6, `player.test.ts`).
6. Activar o desactivar «Normalizar» **con la canción sonando** se aplica al instante (Tarea 3, `instance.ts`).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/shared/audio.ts` (nuevo) | Constantes y funciones puras: bandas, presets, `presetFor`, `normalizationGainDb`, `crossfadeCurve`. |
| `src/shared/settings.ts` | Los 5 ajustes nuevos y su validación. |
| `src/main/music/youtube/format.ts` | `loudnessOf(info, format)`. |
| `src/main/db/store.ts` | Migración `tracks.loudness`; `setLoudness`, `trackLoudness`. |
| `src/renderer/src/player/audio-engine.ts` (nuevo) | Grafo de Web Audio; no conoce al reproductor ni a los ajustes. |
| `src/renderer/src/player/instance.ts` | Crea el motor, lo conecta a los ajustes y al reproductor. |
| `src/renderer/src/player/player.ts` | Gancho `onPrepared` (Tarea 3) y fundido con dos elementos (Tarea 6). |
| `src/renderer/src/pages/Settings.tsx` + `styles/components.css` | Grupo «Sonido». |
| `scripts/e2e-audio.mjs` (nuevo) | Recorrido real: señal, EQ, normalización, fundido. |

---

### Task 1: Base de CORS, matemática pura y ajustes

**Files:**
- Modify: `src/main/index.ts` (ya con `corsEnabled`), `src/main/audio-protocol.ts` (ya con el encabezado), `src/shared/settings.ts`
- Create: `src/shared/audio.ts`
- Test: `tests/audio-protocol.test.ts`, `tests/audio-math.test.ts` (nuevo), `tests/settings.test.ts`

**Interfaces:**
- Produces (`src/shared/audio.ts`):
  - `EQ_BANDS: readonly number[]` (10 frecuencias), `EQ_RANGE_DB = 12`, `NORMALIZE_TARGET_LKFS = -14`
  - `interface EqPreset { id: string; label: string; gains: readonly number[]; preamp: number }`, `EQ_PRESETS: readonly EqPreset[]` (el primero es `plano`)
  - `presetFor(gains: readonly number[], preamp: number): EqPreset | null` — el preset cuyos valores coinciden exactos, o `null` («Personalizado»)
  - `normalizationGainDb(lkfs: number | undefined): number` — `clamp(−14 − lkfs, −12, 0)`; `0` si no es finito
  - `crossfadeCurve(points: number, dir: 'in' | 'out'): Float32Array` — potencia constante: `sin`/`cos` de 0 a π/2
- Produces (`AppSettings`): `eqOn`, `eqGains`, `eqPreamp`, `normalize`, `crossfade` con los valores de Global Constraints; `DEFAULT_SETTINGS` los trae.

- [ ] **Step 1: Tests que fallan.** `audio-protocol.test.ts`: `createAudioHandler` agrega `Access-Control-Allow-Origin: *` a una respuesta 200, a un 206 y a un 400 (id inválido). `audio-math.test.ts`: `normalizationGainDb(-8.85)` ≈ −5,15; `(-14.5)` = 0; `(-30)` = 0; `(-1)` = −12 (tope); `undefined`, `NaN` e `Infinity` = 0; `crossfadeCurve(32,'out')[0]` = 1 y último ≈ 0, y `in[i]² + out[i]²` ≈ 1 en todo punto; `EQ_BANDS.length` = 10; cada preset tiene 10 ganancias en ±12 y `presetFor(preset.gains, preset.preamp)` lo devuelve. `settings.test.ts`: `parseSettings` acepta `eqGains` de 10 números válidos y descarta uno de 9, uno con `NaN`, uno con 99 y un texto; `eqPreamp` fuera de ±12 se descarta; `crossfade` 3 vale, 13, 2,5 y `-1` no; `normalize` y `eqOn` solo booleanos.
- [ ] **Step 2:** `npx vitest run tests/audio-protocol.test.ts tests/audio-math.test.ts tests/settings.test.ts` → FAIL (falta el módulo y los ajustes).
- [ ] **Step 3:** Crear `src/shared/audio.ts` con las firmas de arriba; los presets los elige quien implementa (Plano todo en 0; los demás con curvas razonables y un preamplificador negativo igual al mayor realce). Agregar los ajustes a `AppSettings`, `DEFAULT_SETTINGS` (copiar el arreglo, no compartirlo) y `parseSettings` (mismo estilo que `textScale`: leer con `get`, validar, descartar).
- [ ] **Step 4:** Mismo comando → PASS; luego `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(audio): CORS en spotaple-audio, matemática del ecualizador y ajustes de sonido` (incluye los cambios de `index.ts` y `audio-protocol.ts` del spike).

### Task 2: Loudness por canción (main)

**Files:**
- Modify: `src/main/music/youtube/format.ts`, `src/main/music/youtube/provider.ts`, `src/main/music/provider.ts`, `src/shared/types.ts`, `src/main/db/store.ts`, `src/main/ipc.ts`, `src/main/download.ts`, `src/main/offline.ts`
- Test: `tests/audio-format.test.ts`, `tests/store.test.ts`

**Interfaces:**
- Produces: `loudnessOf(info: { player_config?: { audio_config?: { perceptual_loudness_db?: number } } }, format: { track_absolute_loudness_lkfs?: number }): number | undefined` (en `format.ts`; solo valores finitos entre −60 y 0, si no `undefined`).
- Produces: `ResolvedAudio.loudnessLkfs?: number`; `PreparedAudio.loudnessLkfs?: number`; `downloadTo` devuelve además `loudnessLkfs?: number`.
- Produces (`store`): `setLoudness(trackId: string, lkfs: number): void` (UPDATE; no hace nada si la canción no existe) y `trackLoudness(trackId: string): number | undefined`; migración nueva al final de `MIGRATIONS`: `ALTER TABLE tracks ADD COLUMN loudness REAL;`.

- [ ] **Step 1: Tests que fallan.** `loudnessOf`: toma `track_absolute_loudness_lkfs` si existe; si no, `perceptual_loudness_db`; devuelve `undefined` con `NaN`, `0,5`, `-100` y sin ningún campo. `store`: una base nueva trae `tracks.loudness`; `setLoudness` + `trackLoudness` ida y vuelta; `setLoudness` sobre un id que no existe no crea fila; una base con `user_version` anterior migra sin perder canciones.
- [ ] **Step 2:** `npx vitest run tests/audio-format.test.ts tests/store.test.ts` → FAIL.
- [ ] **Step 3:** `resolveWith` (provider de YouTube) llena `loudnessLkfs: loudnessOf(info, format)`. `ipc.ts` `prepare`: al resolver por red llama `store.setLoudness` si hay valor y lo devuelve en `PreparedAudio`; la rama local devuelve `loudnessLkfs: store.trackLoudness(trackId)`. En `offline.ts`, tras una descarga exitosa, guardar el loudness con `store.setLoudness` (la favorita ya existe en `tracks`).
- [ ] **Step 4:** Mismo comando → PASS; `npm run typecheck`; `npm test` completo.
- [ ] **Step 5: Commit** — `feat(audio): el loudness de cada canción llega al reproductor y se guarda para las descargadas`.

### Task 3: Motor de audio, ecualizador y normalización en el reproductor

**Files:**
- Create: `src/renderer/src/player/audio-engine.ts`
- Modify: `src/renderer/src/player/player.ts` (gancho `onPrepared`), `src/renderer/src/player/instance.ts`
- Test: `tests/player.test.ts`

**Interfaces:**
- Consumes: `EQ_BANDS`, `EQ_RANGE_DB` (Tarea 1).
- Produces:
  ```ts
  export interface AudioEngine {
    setEq(eq: { on: boolean; gains: readonly number[]; preamp: number }): void;
    /** Ganancia de normalización del elemento, en dB (≤ 0). */
    setTrackGainDb(el: HTMLAudioElement, db: number): void;
    /** Diagnóstico: último nodo antes de la salida, y los elementos del grafo. */
    readonly tap: AudioNode;
    readonly elements: readonly HTMLAudioElement[];
  }
  export function createAudioEngine(elements: HTMLAudioElement[]): AudioEngine | null
  ```
  `null` si Web Audio no está o falla antes de conectar (el elemento suena como hoy).
- Produces (`PlayerDeps`): `onPrepared?: (prepared: PreparedAudio, audio: AudioLike) => void`, llamado en `go()` justo antes de asignar `audio.src`.

- [ ] **Step 1: Test que falla** (`player.test.ts`): al reproducir una canción, `onPrepared` recibe lo que devolvió `prepare` (con su `loudnessLkfs`) y el audio simulado, una vez por canción, antes de que `audio.src` tenga la URL nueva.
- [ ] **Step 2:** `npx vitest run tests/player.test.ts -t onPrepared` → FAIL.
- [ ] **Step 3:** Implementar `onPrepared` en `go()`. Implementar `createAudioEngine` con el grafo de la Arquitectura (decibeles a lineal con `10 ** (db / 20)`; los cambios se aplican con `setTargetAtTime(valor, ctx.currentTime, 0.015)` para evitar chasquidos). En `instance.ts`: `audio.crossOrigin = 'anonymous'` **antes** de cualquier `src`; crear el motor con `[audio]`; suscribirse a `settingsStore` para `setEq` (con `eqOn` apagado manda ganancias 0 y preamplificador 0); guardar el loudness de la canción en curso para que activar «Normalizar» con la canción sonando se aplique ya (`setTrackGainDb(audio, normalize ? normalizationGainDb(loudness) : 0)`), y llamarlo también desde `onPrepared`. Con `localStorage.debugAudio === '1'`, exponer el motor en `globalThis.__spotapleAudio` (lo usa el e2e; es el mismo interruptor de diagnóstico que ya existe).
- [ ] **Step 4:** `npx vitest run tests/player.test.ts` → PASS; `npm run typecheck`; `npm test`.
- [ ] **Step 5: Commit** — `feat(audio): grafo de Web Audio con ecualizador y normalización por canción`.

### Task 4: Grupo «Sonido» en Ajustes

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/styles/components.css`

**Interfaces:**
- Consumes: `EQ_BANDS`, `EQ_PRESETS`, `presetFor`, `EQ_RANGE_DB` (Tarea 1); `set(patch)` y los componentes `Group`, `Toggle` ya existentes en `Settings.tsx`.

- [ ] **Step 1:** Agregar un `Group` «Sonido» entre «Calidad» y «Reproducción» (o donde quede coherente con el orden actual) con: `Toggle` «Normalizar volumen» (hint: iguala el volumen entre canciones; solo baja las más fuertes); `Toggle` «Ecualizador»; un `<select>` de presets (incluye «Personalizado» cuando `presetFor` da `null`; elegir uno escribe `eqGains` y `eqPreamp`); 10 `<input type="range">` (−12…+12, paso 0,5) con `aria-label` «`<frecuencia>` Hz» y `aria-valuetext` «+3 dB»; un deslizador de «Preamplificador»; un botón «Restablecer» (Plano). Los controles del ecualizador quedan deshabilitados con `eqOn` apagado. Frecuencias en el rótulo como «62 Hz» / «1 kHz». Estilos en `components.css` con los tokens existentes (sin colores sueltos); en 900 px de ancho las 10 bandas no desbordan.
- [ ] **Step 2:** `npm run typecheck`; `npm run build`; abrir la app y comprobar a ojo (captura) que el grupo se ve bien en Grafito y en Claro.
- [ ] **Step 3: Commit** — `feat(audio): grupo «Sonido» en Ajustes con ecualizador y normalización`.

### Task 5: Verificación real de ecualizador y normalización

**Files:**
- Create: `scripts/e2e-audio.mjs`; Modify: `package.json` (`"e2e:audio": "node scripts/e2e-audio.mjs"`), `README.md`

**Interfaces:**
- Consumes: `globalThis.__spotapleAudio` (Tarea 3). Misma estructura que `scripts/e2e-settings.mjs` (`step`, `waitFor`, `userData` temporal, `ONLY`, `NO_NETWORK`).

- [ ] **Step 1: Escribir el recorrido** (requiere `npm run build` e internet). Pasos: **1** con los ajustes por defecto, reproducir una canción de la búsqueda y comprobar con un `AnalyserNode` conectado a `tap` que el pico es > 0,05 (cubre el arranque en frío); **2** subir el preamplificador a −12 dB desde la página de Ajustes y comprobar que el RMS cae al menos 3 veces (y que `Restablecer` lo recupera); **3** activar «Normalizar» con una canción fuerte (−8,85 LUFS: «MONACO» de Bad Bunny) y ver que la ganancia de normalización del elemento baja a ≈ −5 dB, y que con una canción de −14,5 LUFS queda en 0; **4** cerrar y reabrir con el mismo `userData`: los ajustes persisten; **5** `eqGains` corruptos escritos directo en la base se descartan y la app abre sin error; **6** descargar una favorita (esperar a que `useOffline` la marque) y comprobar que su pico sigue > 0,05 sonando del disco y que la ganancia de normalización sale de la columna `tracks.loudness`.
- [ ] **Step 2:** `npm run build && npm run e2e:audio` → todos PASS. Si el paso 2 o 3 falla, diagnosticar con `ONLY=2` antes de seguir.
- [ ] **Step 3:** README: sección «Sonido» (qué hace cada control, que normalizar solo baja, que los controles se guardan al instante) y la fila de `e2e:audio`.
- [ ] **Step 4:** Regresión completa: `npm run typecheck`, `npm test`, `npm run e2e:offline`, `npm run e2e:settings`, `npm run e2e:radio`, `npm run e2e`, `npm run e2e:ui`, `npm run a11y`. Todo verde.
- [ ] **Step 5: Commit** — `test(audio): e2e de señal, ecualizador y normalización, y documentación`. **Punto de entrega:** con esto la fase ya se puede mergear sin fundido.

### Task 6: Crossfade

**Files:**
- Modify: `src/renderer/src/player/audio-engine.ts`, `src/renderer/src/player/player.ts`, `src/renderer/src/player/instance.ts`, `src/renderer/src/pages/Settings.tsx`, `scripts/e2e-audio.mjs`, `README.md`
- Test: `tests/player.test.ts`

**Interfaces:**
- Consumes: `crossfadeCurve` (Tarea 1), `createAudioEngine` (Tarea 3).
- Produces (motor): el grafo crece con una ganancia de fundido por elemento y estos métodos en `AudioEngine`:
  `fadeOut(el: HTMLAudioElement, sec: number): void` (1 → 0, curva `out`; el elemento sigue sonando), `fadeIn(el, sec): void` (0 → 1, curva `in`), `unfade(el): void` (cancela rampas y vuelve a 1). `createAudioEngine` recibe los dos elementos.
- Produces (`PlayerDeps`): `audio2?: AudioLike` (el segundo elemento) y `crossfade?: { seconds(): number; fadeOut(el: AudioLike): void; fadeIn(el: AudioLike): void; unfade(el: AudioLike): void }`. Sin ambos, el reproductor se comporta exactamente como hoy.

Reglas del reproductor (decisiones que el implementador no debe cambiar):
1. `audio` pasa a ser variable: los oyentes se registran en **los dos** elementos y cada uno ignora los eventos de un elemento que no sea el vigente (`el === audio`). `applyVolume` escribe en los dos.
2. **Disparo** (en `timeupdate`): `status === 'playing'`, `crossfade.seconds() > 0`, hay `audio2`, no hay sala, `repeat !== 'one'`, existe un siguiente distinto del actual (`nextIndex(…, auto = true)`), `duration ≥ 2 × seconds`, quedan `duration − currentTime ≤ seconds`, y no hay un fundido en curso ni uno bloqueado para esta canción. Entonces `go(siguiente, { user: false, fade: seconds })`.
3. **Precarga:** una vez por canción, cuando faltan `seconds + 10` s o menos, `api.prepare(siguiente)` sin esperar ni avisar de errores (calienta la caché de la fuente).
4. **`go` con `fade`:** no pausa el elemento actual. Espera `prepare`; si falla, **no cambia el estado** (la canción actual sigue), marca el fundido como bloqueado para esa canción y el final natural sigue el camino normal (con su manejo de errores). Si sale bien: el elemento libre pasa a ser `audio`, `onPrepared`, `fadeIn(nuevo)`, `fadeOut(viejo)`, y tras `seconds` s el viejo se pausa y se hace `unfade`.
5. **Todo `go` sin `fade`** (saltar, elegir, pausa y retoma, error) corta ya cualquier fundido en curso (viejo: `unfade` + `pause`) y deja el elemento que va a sonar con `unfade`. Pausar durante el fundido también corta el viejo.
6. El `ended` del elemento que se está apagando no hace nada (regla 1).

- [ ] **Step 1: Tests que fallan** (`player.test.ts`, con dos `FakeAudio` y temporizadores simulados): (a) a `duration − seconds` el siguiente suena en el segundo elemento, se llama `fadeOut(viejo)` y `fadeIn(nuevo)`, y el viejo se pausa recién pasados `seconds` s; (b) sin fundido (`seconds() = 0`), con `repeat = one`, con sala activa, en la última canción y con una canción más corta que 2 × `seconds`: no se dispara; (c) la precarga llama `prepare(siguiente)` una sola vez; (d) «siguiente» del usuario durante el fundido corta el viejo (`unfade` + pausa); (e) pausar durante el fundido pausa los dos; (f) `prepare` que falla en pleno fundido deja `status = 'playing'`, no cambia de elemento y no reintenta el fundido; (g) el `ended` del elemento viejo no avanza la cola; (h) `recordPlay` se llama una sola vez por canción aunque haya fundido.
- [ ] **Step 2:** `npx vitest run tests/player.test.ts` → FAIL.
- [ ] **Step 3:** Implementar motor (`fadeOut/fadeIn/unfade` con `setValueCurveAtTime(crossfadeCurve(64, …), ctx.currentTime, sec)`, cancelando antes lo programado), reproductor (reglas 1–6) e `instance.ts` (segundo `<audio>` con `preload = 'auto'` y `crossOrigin = 'anonymous'`, motor con los dos elementos, `crossfade.seconds` lee `settings.crossfade` en cada decisión). Después, en Ajustes: un deslizador «Fundido entre canciones» (0–12 s, paso 1; en 0 dice «Sin fundido») con la nota «No rige dentro de una sala».
- [ ] **Step 4:** `npx vitest run tests/player.test.ts` → PASS; `npm run typecheck`; `npm test`.
- [ ] **Step 5: e2e** (paso 7 de `e2e-audio.mjs`): con 4 s de fundido y dos canciones en cola, saltar cerca del final de la primera y comprobar que durante el fundido los dos elementos suenan a la vez, que el título cambia a la segunda, y que a los ~5 s solo suena uno y la ganancia de fundido del viejo vuelve a 1. Otro paso: en una sala (`e2e:jam` ya sabe crear una) no hay fundido.
- [ ] **Step 6:** `npm run build`, `npm run e2e:audio`, `npm run e2e:jam`, `npm run e2e:settings`, `npm run e2e:radio`, `npm run e2e:offline`, `npm run e2e`, `npm run e2e:ui`, `npm run a11y` → todo verde. README (sección «Sonido»: fundido).
- [ ] **Step 7: Commit** — `feat(audio): fundido cruzado entre canciones con dos elementos de audio`.

### Task 7: Cierre

- [ ] **Step 1:** Revisión final de toda la rama en un subagente con Opus (Fable 5.1 devolvió 429 por créditos): foco en las reglas 1–6 de la Tarea 6, el grafo de la Tarea 3 y la migración de la Tarea 2. Corregir lo que sea real y registrar los menores diferidos.
- [ ] **Step 2:** Actualizar la memoria del proyecto (estado: 1b hecha, menores diferidos) y cerrar con `superpowers:finishing-a-development-branch`: el usuario elige merge local y push, como en las fases anteriores.

---

## Self-Review

- **Cobertura del spec §5 1b:** spike previo → hallazgos + Tarea 1; ecualizador de 10 bandas + preamp + presets → Tareas 1, 3, 4; «un solo grafo creado una vez» → Tarea 3 (con dos fuentes desde la Tarea 6, como pide el crossfade); normalizar con loudness de `getBasicInfo`, sin medición propia → Tareas 1–3; crossfade 0–12 s con dos elementos, precarga, rampas, recortable, apagado en salas → Tarea 6, que va al final para poder dejarla fuera sin perder nada de lo anterior.
- **Consistencia de nombres:** `normalizationGainDb`, `crossfadeCurve`, `presetFor`, `loudnessOf`, `setTrackGainDb`, `fadeOut/fadeIn/unfade`, `onPrepared`, `audio2`, `crossfade` se usan igual en todas las tareas.
- **Proporción:** el spec dedica seis líneas a 1b; el plan crece por el contrato del crossfade (reglas 1–6), que es la única parte que toca la máquina de estados del reproductor.
