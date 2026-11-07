// Recorrido real de la página de Ajustes: temas (con el color de la barra de título nativa), acento, texto,
// densidad, animaciones, persistencia entre sesiones, ajustes corruptos y —con internet— «Reanudar al abrir»
// y la calidad de streaming «Ahorro». Los pasos 1 a 8 no usan red; NO_NETWORK=1 salta el 9.
// Requiere `npm run build`. Capturas en ./.e2e
import { _electron as electron } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';

const OUT = join(import.meta.dirname, '..', '.e2e');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
// ONLY=3 ejecuta solo los pasos cuyo nombre empieza así (útil para diagnosticar uno).
async function step(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name} — ${String(e.message).split('\n')[0]}`);
  }
}
const waitFor = async (fn, ms, what) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* reintenta */
    }
    await sleep(200);
  }
  throw new Error(`tiempo agotado esperando: ${what}`);
};
const expectEq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: se esperaba ${JSON.stringify(want)} y salió ${JSON.stringify(got)}`);
};

// Debe coincidir con THEMES de src/shared/settings.ts (color de fondo / barra de título de cada tema).
const BG = { grafito: '#0c0d0f', claro: '#e8eaee', medianoche: '#000000', oceano: '#08121c' };

const userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-settings-'));
let session = null;

/** Abre la app con un directorio de datos; devuelve app, page y los totales de audio que vio main. */
async function launch(dir = userData) {
  const app = await electron.launch({ executablePath: electronPath, args: ['.'], env: { ...process.env, SPOTAPLE_USER_DATA: dir, SPOTAPLE_DEBUG: '1' } });
  const audioTotals = [];
  app.process().stdout?.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      const m = /^\[audio\].*->\s+20[06]\s+bytes \d+-\d+\/(\d+)\s*$/.exec(line.trim());
      if (m) audioTotals.push(Number(m[1]));
    }
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.waitForSelector('.titlebar');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
  await sleep(400);
  return { app, page, audioTotals };
}
const close = async (s) => {
  await sleep(700); // el guardado de ajustes va con un retraso corto
  await s.app.close();
};
const openSettings = async (page) => {
  await page.locator('.nav-item[title="Ajustes"]').click();
  await page.getByRole('heading', { name: 'Ajustes', level: 1 }).waitFor();
};
const rootState = (page) =>
  page.evaluate(() => {
    const r = document.documentElement;
    return {
      theme: r.dataset.theme,
      density: r.dataset.density,
      reduceMotion: r.dataset.reduceMotion,
      scale: r.style.getPropertyValue('--text-scale'),
      accentInline: r.style.getPropertyValue('--accent'),
      accentComputed: getComputedStyle(r).getPropertyValue('--accent').trim(),
    };
  });
const winBg = async (app) => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor())).toLowerCase();
const pick = (page, label) => page.locator('.set-opt', { hasText: new RegExp(`^${label}$`) }).click();
const shot = (page, name) => page.screenshot({ path: join(OUT, `settings-${name}.png`) });

await step('1 abrir Ajustes desde el lateral', async () => {
  session = await launch();
  await openSettings(session.page);
  expectEq((await rootState(session.page)).theme, 'grafito', 'tema inicial');
  await shot(session.page, 'grafito');
});

await step('2 temas: data-theme, color de la ventana nativa y capturas', async () => {
  const { page, app } = session;
  for (const [label, id] of [['Claro', 'claro'], ['Medianoche', 'medianoche'], ['Océano', 'oceano']]) {
    await pick(page, label);
    await waitFor(async () => (await rootState(page)).theme === id, 3000, `tema ${id}`);
    await waitFor(async () => (await winBg(app)) === BG[id], 3000, `color de ventana de ${id}`);
    await sleep(300);
    await shot(page, id);
  }
});

await step('3 acento propio y volver al del tema', async () => {
  const { page } = session;
  await page.locator('.set-color').fill('#1d4ed8');
  await waitFor(async () => (await rootState(page)).accentComputed === '#1d4ed8', 3000, 'acento #1d4ed8');
  await page.locator('.btn', { hasText: 'Usar el del tema' }).click();
  await waitFor(async () => (await rootState(page)).accentInline === '', 3000, 'acento quitado');
});

await step('4 texto, densidad y animaciones (y la página a 900×600)', async () => {
  const { page, app } = session;
  await pick(page, 'Muy grande');
  await pick(page, 'Compacta');
  await page.getByRole('switch', { name: 'Reducir animaciones' }).click();
  await waitFor(async () => {
    const s = await rootState(page);
    return s.scale === '1.25' && s.density === 'compact' && s.reduceMotion === 'true';
  }, 3000, 'escala 1.25, densidad compacta y animaciones reducidas');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  await sleep(500);
  await shot(page, 'extremo-900x600');
  await page.locator('.nav-item[title="Inicio"]').click();
  await sleep(300);
  await shot(page, 'inicio-extremo-900x600');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
  await openSettings(page);
});

await step('5 los ajustes persisten al cerrar y reabrir', async () => {
  await close(session);
  session = await launch();
  const s = await rootState(session.page);
  expectEq(s.theme, 'oceano', 'tema');
  expectEq(s.scale, '1.25', 'escala');
  expectEq(s.density, 'compact', 'densidad');
  expectEq(s.reduceMotion, 'true', 'animaciones');
  expectEq(s.accentInline, '', 'acento (sin uno propio)');
  expectEq(await winBg(session.app), BG.oceano, 'color de la ventana nativa al abrir');
});

await step('6 «Sistema» sigue el esquema del sistema (emulado en la página)', async () => {
  const { page, app } = session;
  await openSettings(page);
  await pick(page, 'Sistema');
  await page.emulateMedia({ colorScheme: 'light' });
  await waitFor(async () => (await rootState(page)).theme === 'claro', 3000, 'tema claro al emular esquema claro');
  await page.emulateMedia({ colorScheme: 'dark' });
  await waitFor(async () => (await rootState(page)).theme === 'grafito', 3000, 'tema grafito al emular esquema oscuro');
  // Main usa el esquema real del sistema operativo.
  const dark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
  await waitFor(async () => (await winBg(app)) === (dark ? BG.grafito : BG.claro), 3000, 'color de ventana según el sistema');
  await page.emulateMedia({ colorScheme: null });
});

await step('7 ajustes corruptos en la base: arranca con lo válido y los valores de fábrica', async () => {
  await close(session);
  const db = new DatabaseSync(join(userData, 'spotaple.db'));
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    'app_settings',
    JSON.stringify({ theme: 'neon', textScale: 99, accent: 'red', density: 'compact' }),
  );
  db.close();
  session = await launch();
  const s = await rootState(session.page);
  expectEq(s.theme, 'grafito', 'tema inválido → fábrica');
  expectEq(s.scale, '1', 'escala inválida → fábrica');
  expectEq(s.accentInline, '', 'acento inválido → ninguno');
  expectEq(s.density, 'compact', 'lo válido se conserva');
  await close(session);
  session = null;
});

if (process.env.NO_NETWORK !== '1') {
  await step('8 con internet: «Reanudar al abrir» y calidad «Ahorro» (formato más liviano)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spotaple-e2e-settings-net-'));
    try {
      let s = await launch(dir);
      await s.page.locator('input[aria-label^="Buscar"]').fill('Daft Punk One More Time');
      await s.page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
      await s.page.locator('.tracklist__body .row .row__title').first().dblclick();
      await s.page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 30000 });
      await waitFor(() => s.audioTotals.length > 0, 10000, 'tamaño del audio en Alta');
      const high = Math.max(...s.audioTotals);
      await openSettings(s.page);
      await pick(s.page, 'Ahorro de datos');
      await s.page.getByRole('switch', { name: 'Reanudar al abrir la app' }).click();
      await sleep(700);
      await s.page.locator('.play-btn').click(); // pausa: queda guardada como sesión en pausa
      await s.page.waitForSelector('.play-btn[aria-label="Reproducir"]', { timeout: 5000 });
      await sleep(1200);
      await s.app.close();

      s = await launch(dir);
      // Sin tocar nada: la canción retoma sola y suena (si el autoplay estuviera bloqueado, se quedaría en «Reproducir»).
      await s.page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 30000 });
      await waitFor(() => s.audioTotals.length > 0, 10000, 'tamaño del audio en Ahorro');
      const saver = Math.max(...s.audioTotals);
      if (!(saver < high * 0.7)) throw new Error(`Ahorro no usó un formato más liviano: ${saver} B contra ${high} B en Alta`);
      await s.app.close();
      return `Alta ${(high / 1e6).toFixed(1)} MB → Ahorro ${(saver / 1e6).toFixed(1)} MB`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

if (session) await session.app.close().catch(() => undefined);
rmSync(userData, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} paso(s) con fallas` : `\nTodos los pasos pasaron (${results.length})`);
process.exit(failed.length ? 1 : 0);
