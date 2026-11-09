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
  const packaged = process.env.SPOTAPLE_EXE;
  const app = await electron.launch({ executablePath: packaged || electronPath, args: packaged ? [] : ['.'], env: { ...process.env, SPOTAPLE_USER_DATA: dir, SPOTAPLE_DEBUG: '1' } });
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
  await page.locator('.set-color').fill('#ffd60a');
  await waitFor(async () => (await rootState(page)).accentComputed === '#ffd60a', 3000, 'acento #ffd60a (ya se lee sobre Océano: no se toca)');
  await page.locator('.btn', { hasText: 'Usar el del tema' }).click();
  await waitFor(async () => (await rootState(page)).accentInline === '', 3000, 'acento quitado');

  // En el tema claro un acento claro se oscurece hasta leerse (AA) contra el marco, que es el fondo más oscuro del tema.
  await pick(page, 'Claro');
  await page.locator('.set-color').fill('#ffd60a');
  await waitFor(async () => {
    const s = await rootState(page);
    return s.theme === 'claro' && s.accentComputed !== '#ffd60a' && s.accentComputed !== '';
  }, 3000, 'acento oscurecido en Claro');
  const ratio = await page.evaluate(() => {
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
    };
    const [hi, lo] = [lum(css('--accent')), lum(css('--bg-0'))].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });
  if (ratio < 4.5) throw new Error(`el acento en Claro se lee con contraste ${ratio.toFixed(2)}:1 (< 4.5)`);
  await page.locator('.btn', { hasText: 'Usar el del tema' }).click();
  await waitFor(async () => (await rootState(page)).accentInline === '', 3000, 'acento quitado en Claro');
  await pick(page, 'Océano');
  await waitFor(async () => (await rootState(page)).theme === 'oceano', 3000, 'vuelve a Océano');
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

await step('8 el nombre de Ajustes llega a Salas y el de Salas llega a Ajustes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spotaple-e2e-settings-jam-'));
  let s;
  try {
    s = await launch(dir);
    const { page } = s;
    await openSettings(page);
    await page.locator('.set-name').fill('Ale');
    await page.locator('.set-name').press('Enter');
    await sleep(700);
    await page.locator('.nav-item[title="Jam"]').click();
    await page.waitForSelector('.jam-card');
    expectEq(await page.locator('.jam-name input').inputValue(), 'Ale', 'nombre en Salas (viene de Ajustes)');
    await page.locator('.jam-name input').fill('Bea');
    await page.locator('.jam-card .btn', { hasText: 'Crear sala' }).first().click();
    await page.waitForSelector('.jam-panel', { timeout: 15000 });
    await page.locator('.jam-actions .btn--danger').click();
    await page.waitForSelector('.dialog');
    await page.locator('.dialog .btn--danger').click();
    await page.waitForSelector('.jam-card', { timeout: 8000 });
    await openSettings(page);
    expectEq(await page.locator('.set-name').inputValue(), 'Bea', 'nombre en Ajustes (viene de Salas)');
  } finally {
    await s?.app.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

if (process.env.NO_NETWORK !== '1') {
  await step('9 con internet: «Reanudar al abrir» y calidad «Ahorro» (formato más liviano)', async () => {
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
