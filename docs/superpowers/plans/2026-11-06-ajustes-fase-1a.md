# Ajustes (fase 1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una página «Ajustes» con efecto inmediato (tema, acento, tamaño de texto, densidad, reducir animaciones, calidad de streaming, reanudar al abrir, nombre en salas, versión), guardada en la base y aplicada también a la barra de título nativa.

**Architecture:** Un único objeto `AppSettings` (módulo compartido con valores por defecto, lista de temas y un parser que descarta lo inválido) se guarda como JSON bajo la clave `app_settings` de la tabla `settings`. Dos canales IPC (`settings:get`, `settings:set`) lo llevan al renderer, cuyo store lo aplica al `<html>` (atributos `data-*` y variables CSS) y persiste con retraso; main reaplica los colores de la ventana nativa. La calidad de streaming la lee el proveedor de YouTube en cada resolución.

**Tech Stack:** Electron 45, React 19, zustand 5, TypeScript, `node:sqlite`, `youtubei.js` 18.3.0, vitest (entorno `node`), playwright-core (e2e).

**Spec:** `docs/superpowers/specs/2026-11-06-descubrimiento-offline-ajustes-design.md` (§5 «Fase 1a», §4.2 «Mías»). Este plan cubre **solo la fase 1a**. Las fases 1b, 2, 3, 4 y 5 tendrán su propio plan, escrito después de sus spikes (cada una depende de formas de datos o permisos que el spike confirma).

## Global Constraints

- Rama de trabajo `feat/descubrimiento-ajustes` (crearla desde `main` antes de la Tarea 1). Mensajes de commit en español con prefijo convencional (`feat(ajustes): …`), como el historial; terminan con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Los commits solo se hacen si el usuario los autoriza en la sesión.
- Textos de interfaz en español con voseo.
- Los ajustes se guardan como **un único JSON bajo la clave `app_settings`** de la tabla `settings`, **sin migración**. Main valida con lista blanca de claves y rangos; claves o valores desconocidos se descartan.
- Patrón IPC único: canal en `src/shared/api.ts` → método en `src/preload/index.ts` → manejador en `src/main/ipc.ts` → `src/renderer/src/api.ts` (que ya envuelve todo el árbol de `SpotapleApi`). Los errores viajan como `IpcResult`.
- CSP sin cambios. Ninguna URL de audio llega al renderer.
- Los cambios se aplican al instante, sin botón «guardar».
- Los controles de una función solo aparecen cuando la función existe: nada de radio, descargas, ecualizador, crossfade ni «Hecho para vos» en esta fase.
- «Repetir y aleatorio por defecto» **no** existe como ajuste (el reproductor ya recuerda su último estado).
- Temas: Sistema / Grafito (el actual) / Claro / Medianoche (negro puro) / Océano. El valor por defecto es **`grafito`** (conserva el aspecto de hoy; `system` es opcional).
- La barra de título nativa sigue al tema: `win.setTitleBarOverlay({ color, symbolColor, height: 48 })` y `setBackgroundColor`.
- Calidad de streaming: **Alta** (hoy: Opus, mejor calidad) y **Ahorro** (formato de audio de menor bitrate vía `chooseFormat`). La opción forma parte de la clave de la caché de audio resuelto.
- Reanudar al abrir: `hydrate` sigue dejando la sesión en pausa salvo que el ajuste esté activo. Puede chocar con la política de autoplay: se prueba con la app real y se ajusta `autoplayPolicy` en `webPreferences`.
- Sistema visual existente: «grafito + un acento», contraste WCAG AA en todos los temas.
- Verificación por tarea: `npm run typecheck` y `npm test`; al final también `npm run e2e:settings`, `npm run a11y` y `npm run build`.

## Review Focus

Cada línea tiene su prueba en la tarea indicada.

1. **JSON de ajustes corrupto, viejo o con basura** (`{"theme":"neon","textScale":99,"accent":"red"}`): la app arranca con los valores por defecto para lo inválido y conserva lo válido (Tareas 1, 2 y 7).
2. **Acento que no es `#rrggbb`** (`red`, `#12`, `url(x)`, `#GGGGGG`): se ignora; nunca llega a una propiedad CSS (Tareas 1 y 5).
3. **Parche de ajustes malicioso o mal formado** (no objeto, `__proto__`, claves extra): se descarta sin lanzar y devuelve los ajustes completos (Tareas 1 y 2).
4. **Cambiar la calidad con canciones ya resueltas:** una URL resuelta en Alta no se reutiliza en Ahorro, ni al revés (Tarea 3).
5. **El tema del sistema cambia con la app abierta:** el renderer reaplica `data-theme` y main reaplica los colores de la barra de título (Tareas 4, 5 y 7).

## File Structure

Crear:
- `src/shared/settings.ts` — tipos, `DEFAULT_SETTINGS`, `TEXT_SCALES`, `THEMES`, `parseSettings`, `resolveTheme`.
- `src/main/chrome.ts` — colores de la ventana nativa según tema.
- `src/main/music/youtube/format.ts` — `chooseAudioFormat`.
- `src/main/music/youtube/audio-cache.ts` — caché de audio resuelto con clave por calidad.
- `src/renderer/src/lib/accent.ts` — `deriveAccent`, `relativeLuminance`, `contrastRatio`.
- `src/renderer/src/lib/apply-settings.ts` — `applySettings`.
- `src/renderer/src/stores/settings.ts` — `createSettingsStore`, `settingsStore`, `useSettings`.
- `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/styles/settings.css`.
- `scripts/e2e-settings.mjs`.
- Pruebas: `tests/settings.test.ts`, `tests/audio-format.test.ts`, `tests/audio-cache.test.ts`, `tests/accent.test.ts`, `tests/apply-settings.test.ts`, `tests/settings-store.test.ts`.

Modificar: `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/db/store.ts`, `src/main/index.ts`, `src/main/music/youtube/provider.ts`, `src/renderer/src/stores/nav.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/main.tsx`, `src/renderer/src/styles/{tokens,base,layout,components}.css`, `electron.vite.config.ts`, `scripts/a11y.mjs`, `package.json`, `README.md`, `tests/store.test.ts`.

---

### Task 1: Modelo de ajustes compartido

**Files:**
- Create: `src/shared/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces (todo exportado desde `src/shared/settings.ts`):
  - `type ThemeId = 'system' | 'grafito' | 'claro' | 'medianoche' | 'oceano'`; `type ResolvedTheme = Exclude<ThemeId, 'system'>`; `type Density = 'comfortable' | 'compact'`; `type StreamQuality = 'high' | 'saver'`.
  - `interface AppSettings { theme: ThemeId; accent: string | null; textScale: number; density: Density; reduceMotion: boolean; streamQuality: StreamQuality; resumeOnOpen: boolean; jamName: string }`.
  - `const DEFAULT_SETTINGS: AppSettings` = `{ theme: 'grafito', accent: null, textScale: 1, density: 'comfortable', reduceMotion: false, streamQuality: 'high', resumeOnOpen: false, jamName: '' }`.
  - `const TEXT_SCALES: readonly [0.9, 1, 1.1, 1.25]`.
  - `interface ThemeInfo { id: ResolvedTheme; label: string; scheme: 'dark' | 'light'; bg: string; symbol: string }` y `const THEMES: readonly ThemeInfo[]` con los cuatro temas concretos (etiquetas: «Grafito», «Claro», «Medianoche», «Océano»). `bg` es el color de la barra de título (`#rrggbb`, el mismo valor que `--bg-0` del tema) y `symbol` el de los botones nativos.
  - `parseSettings(raw: unknown): Partial<AppSettings>` — devuelve solo los campos conocidos y válidos.
  - `resolveTheme(theme: ThemeId, systemLight: boolean): ResolvedTheme`.

- [ ] **Step 1: Write the failing tests** in `tests/settings.test.ts`:
  - `parseSettings` conserva lo válido: `{ theme: 'claro', accent: '#AABBCC', textScale: 1.25, density: 'compact', reduceMotion: true, streamQuality: 'saver', resumeOnOpen: true, jamName: 'Ale' }` → igual, con `accent: '#aabbcc'`.
  - descarta lo inválido: `{ theme: 'neon', accent: 'red', textScale: 99, density: 'x', reduceMotion: 'yes', streamQuality: 'ultra', resumeOnOpen: 1, jamName: 42, extra: true }` → `toEqual({})`.
  - `accent: null` es válido (`{ accent: null }`); `accent` con `'#12'`, `'#GGGGGG'`, `'url(x)'`, `''` se descarta.
  - `jamName: ''` es válido (borra el nombre); `jamName` con caracteres de control o más largo que `LIMITS.name` (de `src/shared/jam/protocol.ts`) se descarta; con espacios alrededor se recorta.
  - `parseSettings(null)`, `parseSettings('x')`, `parseSettings([])` → `{}`; `parseSettings(JSON.parse('{"__proto__":{"theme":"claro"}}'))` → `{}` y `({} as { theme?: string }).theme` sigue `undefined`.
  - `resolveTheme('system', true)` → `'claro'`; `('system', false)` → `'grafito'`; `('oceano', true)` → `'oceano'`.
  - `THEMES.map(t => t.id)` es `['grafito', 'claro', 'medianoche', 'oceano']`; solo `claro` tiene `scheme: 'light'`; todos con `bg` y `symbol` que cumplen `/^#[0-9a-f]{6}$/`.
  - `DEFAULT_SETTINGS.theme === 'grafito'`.
- [ ] **Step 2: Run** `npx vitest run tests/settings.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implement** `src/shared/settings.ts` con las firmas de arriba. `parseSettings` lee solo claves propias conocidas (`Object.hasOwn`), nunca copia el objeto de entrada; `jamName` se valida con `sanitizeName` de `./jam/protocol` (el `''` explícito se acepta aparte). Los colores de `THEMES` los define el implementador respetando el AA de `tokens.css`; deben coincidir con `--bg-0` de cada tema de la Tarea 5 (esa tarea ajusta uno de los dos lados si difieren).
- [ ] **Step 4: Run** `npx vitest run tests/settings.test.ts` → PASS, y `npm run typecheck` → sin errores.
- [ ] **Step 5: Commit** (`feat(ajustes): modelo compartido de ajustes con validación`).

---

### Task 2: Persistencia, IPC y API del renderer

**Files:**
- Modify: `src/main/db/store.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`
- Test: `tests/store.test.ts` (nuevo `describe('ajustes de la app')`)

**Interfaces:**
- Consumes: `AppSettings`, `DEFAULT_SETTINGS`, `parseSettings` (Tarea 1).
- Produces:
  - `Store.getAppSettings(): AppSettings` — `DEFAULT_SETTINGS` + `parseSettings(getSetting('app_settings'))` + `jamName` leído de la clave existente `'jam_name'` (`''` si no hay).
  - `Store.setAppSettings(patch: Partial<AppSettings>): AppSettings` — vuelve a pasar `patch` por `parseSettings`, guarda `jamName` en `'jam_name'` y el resto (sin `jamName`) en `'app_settings'`, y devuelve los ajustes completos.
  - `IPC.settingsGet = 'settings:get'`, `IPC.settingsSet = 'settings:set'` en `src/shared/api.ts`; `SpotapleApi.settings: { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<AppSettings> }`.
  - `registerIpc` recibe además `onSettings(settings: AppSettings): void` en `deps`; el manejador de `settings:set` llama `store.setAppSettings(parseSettings(patch))`, invoca `onSettings` con el resultado y lo devuelve.

- [ ] **Step 1: Write the failing tests** en `tests/store.test.ts` (usan `createStore(':memory:')` como el resto):
  - base nueva: `store.getAppSettings()` es igual a `DEFAULT_SETTINGS`.
  - `store.setAppSettings({ theme: 'claro', jamName: 'Ale' })` devuelve ambos; `store.getSetting('jam_name') === 'Ale'`; `store.getSetting<Record<string, unknown>>('app_settings')` tiene `theme: 'claro'` y **no** tiene `jamName`.
  - `store.setSetting('jam_name', 'Ale')` (como lo hace la sala) → `getAppSettings().jamName === 'Ale'`.
  - blob corrupto: `store.setSetting('app_settings', { theme: 'neon', textScale: 99, density: 'compact' })` → `theme: 'grafito'`, `textScale: 1`, `density: 'compact'`.
  - parche basura: `store.setAppSettings({ theme: 'neon' } as never)` no cambia nada (`getAppSettings()` igual que antes).
- [ ] **Step 2: Run** `npx vitest run tests/store.test.ts` → FAIL (`getAppSettings is not a function`).
- [ ] **Step 3: Implement** `getAppSettings` y `setAppSettings` en `createStore` (dentro de la transacción `tx` el guardado de las dos claves) y exportarlos en el objeto devuelto.
- [ ] **Step 4: Wire the IPC.** Agregar los dos canales y el tipo en `src/shared/api.ts`; en `src/preload/index.ts` un grupo `settings: { get: () => call(IPC.settingsGet), set: (p) => call(IPC.settingsSet, p) }`; en `src/main/ipc.ts` los dos `handle` (el de `set` valida con `parseSettings` aunque `Store` ya lo hace). `src/renderer/src/api.ts` no cambia (envuelve el árbol entero).
- [ ] **Step 5: Run** `npx vitest run tests/store.test.ts` → PASS y `npm run typecheck` → sin errores (el typecheck falla en `index.ts` hasta que la Tarea 4 pase `onSettings`; dejarlo opcional en `deps` hasta entonces o pasar `() => undefined` en esta tarea).
- [ ] **Step 6: Commit** (`feat(ajustes): guardado y canales IPC de ajustes`).

---

### Task 3: Calidad de streaming en el proveedor

**Files:**
- Create: `src/main/music/youtube/format.ts`, `src/main/music/youtube/audio-cache.ts`
- Modify: `src/main/music/youtube/provider.ts`, `src/main/index.ts`
- Test: `tests/audio-format.test.ts`, `tests/audio-cache.test.ts`

**Interfaces:**
- Consumes: `StreamQuality` (Tarea 1), `Store.getAppSettings` (Tarea 2).
- Produces:
  - `chooseAudioFormat<F>(info: { chooseFormat(o: Record<string, unknown>): F }, quality: StreamQuality): F` en `format.ts`. Alta: primero `{ type: 'audio', quality: 'best', format: 'any', codec: 'opus' }`, y si lanza, `{ type: 'audio', quality: 'best' }` (comportamiento actual). Ahorro: primero `{ type: 'audio', quality: 'bestefficiency', format: 'any', codec: 'opus' }`, y si lanza, `{ type: 'audio', quality: 'bestefficiency', format: 'any' }`. Si el segundo intento también lanza, propaga ese error.
  - `createAudioCache(now: () => number)` en `audio-cache.ts`, con `get(quality: StreamQuality, trackId: string): ResolvedAudio | undefined` (devuelve `undefined` si `expiresAt <= now()`), `set(quality, trackId, audio): void`, `invalidate(trackId: string): void` (borra ambas calidades).
  - `YouTubeProviderOptions.getQuality?: () => StreamQuality` (por defecto `() => 'high'`), leído en cada `resolveAudio`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/audio-format.test.ts` con un `info` falso cuyo `chooseFormat` es un `vi.fn`: `high` llama primero con las opciones exactas de arriba y devuelve su resultado; si la primera lanza, la segunda llamada es `{ type: 'audio', quality: 'best' }`; `saver` usa `quality: 'bestefficiency'` en ambas; si ambas lanzan, `chooseAudioFormat` lanza.
  - `tests/audio-cache.test.ts` (reloj falso): `set('high', 'a', x)` → `get('high', 'a')` es `x` y `get('saver', 'a')` es `undefined`; con `expiresAt` en el pasado `get` devuelve `undefined`; `invalidate('a')` borra `high` y `saver`.
- [ ] **Step 2: Run** `npx vitest run tests/audio-format.test.ts tests/audio-cache.test.ts` → FAIL.
- [ ] **Step 3: Implement** los dos módulos. En `provider.ts`: reemplazar el `Map` de caché y su verificación de vencimiento por `createAudioCache(now)`; la clave de `inflight` pasa a ser `` `${quality}:${trackId}` ``; `resolveWith` recibe `quality` y usa `chooseAudioFormat` (el `catch` que convierte el fallo en `MusicError('unavailable', MESSAGES.unavailable)` se mantiene); `invalidate: (id) => cache.invalidate(id)`.
- [ ] **Step 4: Wire** en `src/main/index.ts`: `createYouTubeProvider({ …, getQuality: () => store.getAppSettings().streamQuality })`.
- [ ] **Step 5: Run** `npx vitest run` → todo PASS; `npm run typecheck` → sin errores; `npm run check:youtube` → mismo resultado que antes de la tarea (la calidad Alta no cambia).
- [ ] **Step 6: Commit** (`feat(ajustes): calidad de streaming Alta/Ahorro`).

---

### Task 4: Ventana nativa, tema del sistema y autoplay

**Files:**
- Create: `src/main/chrome.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `AppSettings`, `THEMES`, `resolveTheme` (Tarea 1); `registerIpc` con `onSettings` (Tarea 2).
- Produces:
  - `chromeFor(settings: AppSettings, systemLight: boolean): { bg: string; symbol: string }` (pura: `THEMES.find(id === resolveTheme(...))`).
  - `applyChrome(win: BrowserWindow, settings: AppSettings): void` — fija `nativeTheme.themeSource` (`'system'` si `theme === 'system'`, si no el `scheme` del tema), calcula `systemLight = !nativeTheme.shouldUseDarkColors` **después** de fijarlo, y llama `win.setBackgroundColor(bg)` y `win.setTitleBarOverlay({ color: bg, symbolColor: symbol, height: 48 })`.

- [ ] **Step 1: Implement** `src/main/chrome.ts` según las firmas.
- [ ] **Step 2: Modify `src/main/index.ts`:** `createWindow(settings: AppSettings)` usa `chromeFor` para `backgroundColor` y `titleBarOverlay` iniciales (se elimina la constante `BG`); `webPreferences` gana `autoplayPolicy: 'no-user-gesture-required'`; en `whenReady`, `onSettings` reaplica `applyChrome` a todas las ventanas, y `nativeTheme.on('updated', …)` hace lo mismo con `store.getAppSettings()` (para que el tema «Sistema» siga al sistema con la app abierta).
- [ ] **Step 3: Verify** `npm run typecheck` → sin errores; `npm run build` → compila. (La comprobación visual la cubre `e2e:settings` en la Tarea 7.)
- [ ] **Step 4: Commit** (`feat(ajustes): la barra de título nativa sigue al tema`).

---

### Task 5: Aplicar ajustes en el renderer (store, acento, CSS)

**Files:**
- Create: `src/renderer/src/lib/accent.ts`, `src/renderer/src/lib/apply-settings.ts`, `src/renderer/src/stores/settings.ts`
- Modify: `src/renderer/src/styles/tokens.css`, `base.css`, `layout.css`, `components.css`, `src/renderer/src/main.tsx`, `electron.vite.config.ts`
- Test: `tests/accent.test.ts`, `tests/apply-settings.test.ts`, `tests/settings-store.test.ts`

**Interfaces:**
- Consumes: `AppSettings`, `DEFAULT_SETTINGS`, `resolveTheme` (Tarea 1); `api.settings` (Tarea 2).
- Produces:
  - `lib/accent.ts`: `type AccentVars = Record<'--accent' | '--accent-hover' | '--accent-press' | '--accent-ink' | '--accent-soft', string>`; `const ACCENT_VARS: readonly (keyof AccentVars)[]`; `deriveAccent(hex: string): AccentVars | null` (`null` si no es `#rrggbb`); `relativeLuminance(hex: string): number`; `contrastRatio(a: string, b: string): number`.
  - `lib/apply-settings.ts`: `interface RootLike { dataset: Record<string, string | undefined>; style: { setProperty(k: string, v: string): void; removeProperty(k: string): void } }` y `applySettings(root: RootLike, s: AppSettings, systemLight: boolean): void`. Fija `dataset.theme` (= `resolveTheme`), `dataset.density`, `dataset.reduceMotion` (`'true'`/`'false'`), `--text-scale` (`String(s.textScale)`) y las cinco variables de acento (o las quita si `accent` es `null` o no deriva).
  - `stores/settings.ts`: `interface SettingsApi { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<AppSettings> }`; `createSettingsStore(deps: { api: SettingsApi; apply: (s: AppSettings) => void; onError: (message: string) => void; debounceMs?: number })` (por defecto 250) que devuelve un store zustand vanilla con `{ settings: AppSettings; loaded: boolean; load(): Promise<void>; update(patch: Partial<AppSettings>): void; flush(): Promise<void>; reapply(): void }`; `settingsStore` (instancia real: `api.settings`, `apply` sobre `document.documentElement` y `matchMedia('(prefers-color-scheme: light)')`, `onError` con `toast(…, 'error')`); `useSettings = <T>(sel: (s: SettingsState) => T) => useStore(settingsStore, sel)`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/accent.test.ts`: `deriveAccent('#ff5d73')` devuelve `'--accent': '#ff5d73'` y `'--accent-soft': 'rgba(255, 93, 115, 0.14)'`; `relativeLuminance(hover) > relativeLuminance(accent) > relativeLuminance(press)`; `contrastRatio(ink, accent) >= 4.5` para `'#ff5d73'`, `'#ffd60a'` y `'#1d4ed8'` (el texto sobre el acento es oscuro en el amarillo y claro en el azul); `deriveAccent` devuelve `null` para `'red'`, `'#12345'`, `'#GGGGGG'`, `''`, `'url(x)'`.
  - `tests/apply-settings.test.ts` con un `root` falso (objeto con `dataset: {}` y `style` con espías): `theme: 'system'` con `systemLight: true` → `dataset.theme === 'claro'`, con `false` → `'grafito'`; `accent: '#1d4ed8'` llama `setProperty` para las cinco variables; `accent: null` llama `removeProperty` para las cinco; `textScale: 1.25` → `setProperty('--text-scale', '1.25')`; `density: 'compact'` → `dataset.density === 'compact'`; `reduceMotion: true` → `dataset.reduceMotion === 'true'`.
  - `tests/settings-store.test.ts` (`vi.useFakeTimers()`, `api` falsa): `load()` guarda lo de `api.get` y llama `apply`; `update({ theme: 'claro' })` llama `apply` ya con `theme: 'claro'` y `api.set` todavía no; tras 250 ms `api.set` se llamó una vez; `update({ accent: '#111111' })` y `update({ textScale: 1.1 })` seguidos producen **una** llamada con ambos campos; `flush()` persiste de inmediato; si `api.set` rechaza se llama `onError` y el estado local no se revierte; `reapply()` llama `apply` con los ajustes actuales.
- [ ] **Step 2: Run** `npx vitest run tests/accent.test.ts tests/apply-settings.test.ts tests/settings-store.test.ts` → FAIL.
- [ ] **Step 3: Implement** `accent.ts` (HSL: hover = claridad +6 puntos, press = −8, acotadas; `ink` = `#101114` o `#ffffff`, el que dé mayor contraste), `apply-settings.ts` y `settings.ts` con las firmas de arriba.
- [ ] **Step 4: CSS.** En `tokens.css`: (a) bloques `:root[data-theme='claro']`, `'medianoche'` y `'oceano'` que redefinen superficies, texto, líneas y acento por defecto (y `color-scheme`), sobre los mismos nombres de token; `--bg-0` de cada tema debe coincidir con `THEMES[].bg` de la Tarea 1; (b) `--fs-xs … --fs-3xl` pasan a `calc(<px actual> * var(--text-scale, 1))` (`--fs-hero` no cambia); (c) `--row-h: 52px` en `:root` y, en `:root[data-density='compact']`, `--row-h: 44px; --gap: 4px`. En `components.css`, `.row { height: var(--row-h) }`. Convertir en tokens por tema los colores literales que dependen del fondo: `layout.css:133`, `base.css:77,84,90`, `components.css:97,119,122,170,189,315,862-863` (cada uno: leer el contexto y decidir; las sombras negras pueden quedar). Buscar en las cuatro hojas cualquier `font:` o `font-size` con `px` literal y pasarlo a los tokens. Duplicar el bloque `@media (prefers-reduced-motion: reduce)` de `base.css` bajo `:root[data-reduce-motion='true'] …`.
- [ ] **Step 5: Boot.** `main.tsx`: antes de `root.render`, `await settingsStore.getState().load()` (si falla, se arranca con los valores por defecto aplicados); registrar `matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => settingsStore.getState().reapply())` y `window.addEventListener('beforeunload', () => void settingsStore.getState().flush())`. `electron.vite.config.ts`: en `renderer`, `define: { __APP_VERSION__: JSON.stringify(<version de package.json>) }` y `declare const __APP_VERSION__: string;` en un `.d.ts` del renderer.
- [ ] **Step 6: Run** `npx vitest run` → todo PASS; `npm run typecheck` → sin errores; `npm run build` → compila.
- [ ] **Step 7: Commit** (`feat(ajustes): temas, acento, texto y densidad aplicados al instante`).

---

### Task 6: Página de Ajustes, ruta y entrada de menú

**Files:**
- Create: `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/styles/settings.css`
- Modify: `src/renderer/src/stores/nav.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: `useSettings`, `settingsStore` (Tarea 5); `THEMES`, `TEXT_SCALES`, `DEFAULT_SETTINGS` (Tarea 1); `ACCENT_VARS`/`deriveAccent` (Tarea 5).
- Produces: ruta `{ page: 'settings' }` en `Route`; `SettingsPage()` exportado desde `pages/Settings.tsx`.

- [ ] **Step 1: Route and entry.** Agregar `{ page: 'settings' }` a `Route` (`nav.ts`) y su `case` en `Page` (`App.tsx`). En `Sidebar.tsx`, un `NavItem` «Ajustes» (icono `Settings` de `lucide-react`, `title="Ajustes"`, `active={route.page === 'settings'}`) en un bloque propio al pie del lateral; debe verse también en el riel de iconos (≤ 1020 px). Importar `settings.css` en `main.tsx`.
- [ ] **Step 2: Page.** `SettingsPage` con `<h1>Ajustes</h1>` y secciones `h2`; cada control es un elemento nativo accesible (`fieldset` + `legend`, `input type="radio"` para opciones exclusivas, `input type="checkbox" role="switch"` para interruptores, `input type="color"` para el acento) y escribe con `settingsStore.getState().update({...})`:
  - **Apariencia:** «Tema» (Sistema + los de `THEMES`), «Color de acento» (muestras predefinidas, selector libre y botón «Restablecer» que pone `accent: null`), «Tamaño del texto» (Pequeño 0.9 · Normal 1 · Grande 1.1 · Muy grande 1.25, desde `TEXT_SCALES`), «Densidad» (Cómoda / Compacta), «Reducir animaciones».
  - **Sonido:** «Calidad de streaming» (Alta / Ahorro de datos, con una línea que explique que el cambio vale para las canciones que se reproduzcan desde ahora).
  - **Reproducción:** «Reanudar al abrir la app».
  - **Salas:** «Tu nombre en las salas» (campo de texto con `maxLength` igual a `LIMITS.name`; se persiste al perder el foco o con Enter, no en cada tecla).
  - **Acerca de:** nombre y «Versión {__APP_VERSION__}».
- [ ] **Step 3: Resume.** En `main.tsx`, tras `startPlayerPersistence()`: si `settingsStore.getState().settings.resumeOnOpen` y `playerStore.getState().status === 'paused'`, llamar `playerStore.getState().togglePlay()`. (La lógica de `togglePlay` tras `hydrate` ya está cubierta por `tests/player.test.ts`, ~líneas 345-376; no hace falta prueba nueva.)
- [ ] **Step 4: Verify** `npm run typecheck` → sin errores; `npm run build` → compila; abrir la app con `npm run dev` y recorrer cada control a mano (la verificación automática es la Tarea 7).
- [ ] **Step 5: Commit** (`feat(ajustes): página de ajustes y entrada en el menú`).

---

### Task 7: Verificación de punta a punta, accesibilidad y documentación

**Files:**
- Create: `scripts/e2e-settings.mjs`
- Modify: `scripts/a11y.mjs`, `package.json` (script `"e2e:settings": "node scripts/e2e-settings.mjs"`), `README.md`

**Interfaces:**
- Consumes: todo lo anterior. Sigue el estilo de `scripts/e2e-ui.mjs` (`_electron` de `playwright-core`, `SPOTAPLE_USER_DATA` en un directorio temporal, helper `step`, capturas en `./.e2e`). Requiere `npm run build`. Los pasos 1 a 8 no necesitan internet.

- [ ] **Step 1: Write `scripts/e2e-settings.mjs`** con estos pasos (cada uno PASS/FAIL):
  1. Abrir la app; ir a «Ajustes» desde `.nav-item[title="Ajustes"]`; se ve el `h1` «Ajustes».
  2. Elegir «Claro» → `document.documentElement.dataset.theme === 'claro'`; captura. Repetir con «Medianoche» y «Océano» (capturas).
  3. Acento `#1d4ed8` por el selector de color → `getComputedStyle(root).getPropertyValue('--accent').trim() === '#1d4ed8'`; «Restablecer» → `root.style.getPropertyValue('--accent') === ''`.
  4. «Muy grande» → `root.style.getPropertyValue('--text-scale') === '1.25'`; «Compacta» → `dataset.density === 'compact'`; «Reducir animaciones» → `dataset.reduceMotion === 'true'`.
  5. Cerrar y reabrir con el mismo `SPOTAPLE_USER_DATA`: los valores persisten (tema, acento, escala, densidad).
  6. Con «Sistema» elegido, `app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark' })` → `data-theme === 'grafito'`; luego `'light'` → `'claro'`.
  7. Barra de título: `app.evaluate` lee el color de fondo de la ventana (`BrowserWindow.getAllWindows()[0].getBackgroundColor()`) y es el `bg` del tema activo.
  8. Ajustes corruptos: cerrar la app, escribir con `node:sqlite` en `spotaple.db` la fila `app_settings` = `{"theme":"neon","textScale":99,"accent":"red","density":"compact"}`, reabrir: `data-theme === 'grafito'`, `--text-scale` es `'1'`, no hay `--accent` en línea y `data-density === 'compact'`.
  9. (Con internet) «Reanudar al abrir»: reproducir una canción buscada, activar el ajuste, cerrar y reabrir; en ≤ 15 s el botón de reproducción del reproductor pasa a «Pausar» (ya sonando sin gesto del usuario). Si falla por autoplay, ajustar `autoplayPolicy` (Tarea 4) y repetir.
- [ ] **Step 2: Run** `npm run build && npm run e2e:settings` → todos los pasos 1 a 8 en PASS (9 con internet); revisar las capturas de cada tema a 1200×800 y a 900×600 con texto «Muy grande» y densidad compacta: nada cortado ni superpuesto.
- [ ] **Step 3: Accesibilidad.** En `scripts/a11y.mjs`, agregar la página «Ajustes» (`.nav-item[title="Ajustes"]`) a las pantallas auditadas y repetir Inicio y Ajustes con cada tema (fijando `document.documentElement.dataset.theme` antes de correr axe). Run `npm run a11y` → «Sin problemas detectados por axe-core».
- [ ] **Step 4: Regresión.** Run `npm run typecheck`, `npm test`, `npm run e2e` y `npm run e2e:ui` → todo PASS como antes de la rama.
- [ ] **Step 5: README.** Una sección «Ajustes» que liste los controles de esta fase y diga que se guardan en la base local.
- [ ] **Step 6: Commit** (`test(ajustes): e2e de ajustes, accesibilidad por tema y documentación`).

---

## Self-review

- **Cobertura del spec §5 fase 1a:** modelo + IPC + store (T1–T2); apariencia: temas, acento, texto, densidad, animaciones, barra de título (T4–T6); calidad de streaming (T3); reanudar al abrir + autoplay (T4, T6, T7 paso 9); nombre de salas (T2 `jam_name`, T6); versión (T5 `define`, T6). «Repetir y aleatorio por defecto» queda fuera por decisión del spec §4.2. Fases 1b, 2–5: planes aparte.
- **Consistencia de tipos:** `AppSettings`, `ThemeId`, `ResolvedTheme`, `StreamQuality`, `THEMES`, `parseSettings`, `resolveTheme`, `chromeFor`, `applyChrome`, `deriveAccent`, `ACCENT_VARS`, `applySettings`, `createSettingsStore`, `settingsStore`, `useSettings`, `getAppSettings`, `setAppSettings`, `createAudioCache`, `chooseAudioFormat` aparecen con el mismo nombre en cada tarea que los usa.
- **Review Focus:** cada una de las 5 líneas tiene prueba (T1/T2 parser y store, T3 caché, T5 acento y `reapply`, T7 e2e con base corrupta y tema del sistema).
- **Proporción:** el plan trae firmas, valores del spec y aserciones; los cuerpos los escribe quien implementa.
