// Recorrido real de descargas y offline: las favoritas se bajan solas al disco; «Descargar canción» guarda en Opus y en
// AAC (y cancelar no hace nada); sin red suenan las descargadas y las demás se atenúan y se saltan; quitar una favorita
// borra su archivo; en Ajustes se ve el espacio, la descarga automática se apaga y enciende, y se borra todo.
// Requiere `npm run build` e internet. Capturas en ./.e2e
import { _electron as electron } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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
    await sleep(250);
  }
  throw new Error(`tiempo agotado esperando: ${what}`);
};

const userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-offline-'));
const saveDir = mkdtempSync(join(tmpdir(), 'spotaple-e2e-save-'));
const offlineDir = join(userData, 'offline');
let app;
let page;
async function launch(extraArgs = []) {
  app = await electron.launch({ executablePath: electronPath, args: ['.', ...extraArgs], env: { ...process.env, SPOTAPLE_USER_DATA: userData } });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.waitForSelector('.titlebar');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
  await sleep(500);
}

const files = () => (existsSync(offlineDir) ? readdirSync(offlineDir) : []);
const audioFiles = () => files().filter((f) => f.endsWith('.webm') || f.endsWith('.m4a'));
const toSec = (s) => s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
const elapsed = async () => toSec((await page.locator('.progress__time').first().innerText()).trim());
const playLabel = () => page.locator('.play-btn').getAttribute('aria-label');
const currentTitle = async () => (await page.locator('.player__title').innerText()).trim();
const shot = (name) => page.screenshot({ path: join(OUT, `offline-${name}.png`) });
const firstTitle = () => page.locator('.tracklist__body .row .row__title').first().innerText().catch(() => '');

/** Busca, espera a que lleguen los resultados nuevos y deja visible la lista de canciones. */
async function songsTab(q) {
  const before = await firstTitle();
  const input = page.locator('input[aria-label^="Buscar"]');
  await input.fill('');
  await input.fill(q);
  await waitFor(async () => {
    const t = await firstTitle();
    return t && t !== before;
  }, 30000, `resultados de «${q}»`);
  await page.locator('.tab', { hasText: 'Canciones' }).click().catch(() => undefined);
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
}
const heart = async (row) => {
  await row.hover();
  await row.locator('.row__fav').click();
};
const goLibrary = async () => {
  await page.locator('.nav-item[title="Biblioteca"]').click();
  await page.waitForSelector('.tracklist__body .row', { timeout: 15000 });
};
const stubSave = (filePath) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, filePath);
const stubCancel = () =>
  app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
  });
const exportVia = async (row, formatLabel) => {
  await row.click({ button: 'right' });
  await page.locator('.menu [role="menuitem"]', { hasText: 'Descargar canción' }).click();
  await page.locator('.menu [role="menuitem"]', { hasText: formatLabel }).click();
};
const readDownloads = () => {
  const db = new DatabaseSync(join(userData, 'spotaple.db'));
  const rows = db.prepare('SELECT track_id, format FROM downloads').all();
  db.close();
  return rows;
};

await launch();

await step('1 las favoritas se descargan solas', async () => {
  await songsTab('Daft Punk One More Time');
  await heart(page.locator('.tracklist__body .row').first());
  await songsTab('Queen Bohemian Rhapsody');
  await heart(page.locator('.tracklist__body .row').first());
  await waitFor(() => audioFiles().length === 2 && !files().some((f) => f.endsWith('.part')), 60000, '2 archivos descargados');
  await goLibrary();
  await waitFor(async () => (await page.locator('.tracklist__body .row .row__offline').count()) === 2, 10000, 'la marca «disponible sin conexión» en las 2 filas');
  const meta = await page.locator('.toolbar__meta').innerText();
  if (!meta.includes('2 sin conexión')) throw new Error(`la barra dice «${meta}»`);
  const sizes = audioFiles().map((f) => statSync(join(offlineDir, f)).size);
  if (sizes.some((s) => s < 100_000)) throw new Error(`archivos demasiado chicos: ${sizes.join(', ')}`);
  await shot('favoritas');
  return sizes.map((s) => `${Math.round(s / 1024)} KB`).join(', ');
});

await step('2 «Descargar canción» en Opus y en AAC, y cancelar no hace nada', async () => {
  await songsTab('Charly García Demoliendo hoteles');
  const row = page.locator('.tracklist__body .row').first();
  const opusPath = join(saveDir, 'tema.webm');
  await stubSave(opusPath);
  await exportVia(row, 'Opus');
  await waitFor(() => existsSync(opusPath) && statSync(opusPath).size > 100_000, 40000, 'el archivo Opus');
  const head = readFileSync(opusPath).subarray(0, 4).toString('hex');
  if (head !== '1a45dfa3') throw new Error(`el .webm no empieza con la firma EBML (${head})`);

  const aacPath = join(saveDir, 'tema.m4a');
  await stubSave(aacPath);
  await exportVia(row, 'AAC');
  await waitFor(() => existsSync(aacPath) && statSync(aacPath).size > 100_000, 40000, 'el archivo AAC');
  const ftyp = readFileSync(aacPath).subarray(4, 8).toString('latin1');
  if (ftyp !== 'ftyp') throw new Error(`el .m4a no tiene la caja ftyp (${ftyp})`);

  await stubCancel();
  await exportVia(row, 'Opus');
  await sleep(2500);
  const saved = readdirSync(saveDir).sort();
  if (JSON.stringify(saved) !== JSON.stringify(['tema.m4a', 'tema.webm'])) throw new Error(`la carpeta de destino quedó con ${saved.join(', ')}`);
  if (await page.locator('.toast--error').count()) throw new Error('cancelar el diálogo mostró un error');

  // Se reproduce una canción que no es favorita para que quede en el historial.
  await row.locator('.row__title').dblclick();
  await page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 30000 });
  await sleep(1500);
  return `.webm ${Math.round(statSync(opusPath).size / 1024)} KB, .m4a ${Math.round(statSync(aacPath).size / 1024)} KB`;
});

await step('3 sin conexión: aviso, suenan las descargadas y lo demás se atenúa y se salta', async () => {
  await app.close();
  // Red de main muerta (proxy inexistente): si la reproducción pasara por YouTube fallaría.
  await launch(['--proxy-server=127.0.0.1:9']);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForSelector('.offline-banner:not(:empty)', { timeout: 10000 });
  const banner = (await page.locator('.offline-banner').innerText()).trim();
  if (!banner.includes('Sin conexión')) throw new Error(`el aviso dice «${banner}»`);

  await goLibrary();
  if (await page.locator('.tracklist__body .row.is-unreachable').count()) throw new Error('una favorita descargada quedó atenuada');
  await page.locator('.tracklist__body .row .row__title').first().dblclick();
  await page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 20000 });
  const t0 = await elapsed();
  await sleep(3500);
  const t1 = await elapsed();
  if (t1 <= t0) throw new Error(`el tiempo no avanzó sin red (${t0} → ${t1})`);
  await shot('sin-conexion');

  await page.locator('.tab', { hasText: 'Historial' }).click();
  await page.waitForSelector('.tracklist__body .row');
  const dimmed = page.locator('.tracklist__body .row.is-unreachable');
  if (!(await dimmed.count())) throw new Error('el historial no atenúa lo que no está descargado');
  await dimmed.first().locator('.row__title').dblclick();
  const toast = await waitFor(async () => {
    const msgs = await page.locator('.toast--error .toast__msg').allInnerTexts();
    return msgs.find((m) => /no está (disponible|descargada)/i.test(m));
  }, 15000, 'el aviso de canción no descargada');
  return `t ${t0}s → ${t1}s sin red; aviso: ${toast.slice(0, 60)}`;
});

await step('4 quitar de favoritas borra el archivo y la fila', async () => {
  await app.close();
  await launch();
  await goLibrary();
  const before = audioFiles().length;
  if (before !== 2) throw new Error(`había ${before} archivos tras reabrir (se esperaban 2)`);
  await heart(page.locator('.tracklist__body .row').first());
  await waitFor(() => audioFiles().length === 1, 15000, 'el archivo borrado');
  await sleep(500);
  await app.close();
  const rows = readDownloads();
  if (rows.length !== 1 || rows[0].format !== 'opus') throw new Error(`downloads = ${JSON.stringify(rows)}`);
  const left = audioFiles();
  if (left.length !== 1 || !left[0].startsWith(rows[0].track_id)) throw new Error(`el archivo que queda (${left.join(', ')}) no es el de la fila`);
  return `queda ${left[0]}`;
});

await step('5 Ajustes: espacio usado, descarga automática apagada y encendida, y borrar todo', async () => {
  await launch();
  await page.locator('.nav-item[title="Ajustes"]').click();
  await page.waitForSelector('.page--settings');
  const space = (await page.locator('.set-row', { hasText: 'Espacio usado' }).innerText()).replace(/\s+/g, ' ');
  if (!/\d.*(KB|MB)/.test(space) || !space.includes('1 canción descargada')) throw new Error(`espacio usado: «${space}»`);

  const autoSwitch = () => page.getByRole('switch', { name: 'Descargar las favoritas automáticamente' });
  await autoSwitch().click();
  await sleep(1500); // el guardado de ajustes va con un retraso corto
  await songsTab('Charly García Demoliendo hoteles');
  await heart(page.locator('.tracklist__body .row').first());
  await sleep(6000);
  if (audioFiles().length !== 1) throw new Error(`con la descarga automática apagada hay ${audioFiles().length} archivos`);

  await page.locator('.nav-item[title="Ajustes"]').click();
  await autoSwitch().click();
  await waitFor(() => audioFiles().length === 2, 40000, 'la favorita que faltaba al encender la descarga automática');
  await shot('ajustes');

  await page.getByRole('button', { name: 'Borrar todas las descargas' }).click();
  await page.getByRole('button', { name: 'Borrar todo' }).click();
  await waitFor(() => audioFiles().length === 0, 15000, 'la carpeta sin descargas');
  await sleep(500);
  await app.close();
  const rows = readDownloads();
  if (rows.length) throw new Error(`quedaron filas en downloads: ${JSON.stringify(rows)}`);
  return 'todo borrado';
});

await app.close().catch(() => undefined);
rmSync(userData, { recursive: true, force: true });
rmSync(saveDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} paso(s) con fallas` : `\nTodos los pasos pasaron (${results.length})`);
process.exit(failed.length ? 1 : 0);
