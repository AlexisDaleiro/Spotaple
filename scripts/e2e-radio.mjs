// Recorrido real de la radio automática: al tocar una canción suelta la cola se llena sola (con el separador
// «Radio automática»), con variedad y sin repetir; «siguiente», fin natural y elección a mano quedan bien
// marcados en la base (`plays.auto`); con la radio apagada o con la repetición activa no hay radio.
// Requiere `npm run build` e internet. Capturas en ./.e2e
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
    await sleep(250);
  }
  throw new Error(`tiempo agotado esperando: ${what}`);
};

const userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-radio-'));
let app;
let page;
async function launch() {
  app = await electron.launch({ executablePath: electronPath, args: ['.'], env: { ...process.env, SPOTAPLE_USER_DATA: userData } });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.waitForSelector('.titlebar');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
  await sleep(500);
}

const search = async (q) => {
  const input = page.locator('input[aria-label^="Buscar"]');
  await input.fill('');
  await input.fill(q);
};
const playLabel = () => page.locator('.play-btn').getAttribute('aria-label');
const currentTitle = async () => (await page.locator('.player__title').innerText()).trim();
const openQueue = async () => {
  const toggle = page.locator('button[aria-label="Mostrar la cola"]');
  if (await toggle.count()) await toggle.click();
  await page.waitForSelector('.queue');
};
const upcoming = () => page.locator('.queue ul[aria-label="Próximas canciones"] .qrow');
const queueRows = () => page.locator('.queue .qrow').count();
const playFirstSong = async (q) => {
  await search(q);
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  await page.locator('.tracklist__body .row .row__title').first().dblclick();
  await page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 30000 });
};
const settingsSwitch = async (name, on) => {
  await page.locator('.nav-item[title="Ajustes"]').click();
  const sw = page.getByRole('switch', { name });
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
  await sleep(700); // el guardado de ajustes va con un retraso corto
};
const shot = (name) => page.screenshot({ path: join(OUT, `radio-${name}.png`) });

await launch();

await step('1 al tocar una canción suelta la cola se llena sola, con el separador', async () => {
  await playFirstSong('Daft Punk One More Time');
  await openQueue();
  await page.waitForSelector('.queue__divider', { timeout: 20000 });
  const total = await queueRows();
  if (total <= 10) throw new Error(`la cola tiene solo ${total} filas`);
  const divider = (await page.locator('.queue__divider').innerText()).trim().toLowerCase();
  if (!divider.includes('radio automática')) throw new Error(`el separador dice «${divider}»`);
  return `${total} filas en la cola`;
});

await step('2 variedad: artistas distintos, sin rachas de 3 y sin repetir la que suena', async () => {
  const rows = (await upcoming().count()) > 20 ? 20 : await upcoming().count();
  const artists = [];
  const titles = [];
  for (let i = 0; i < rows; i++) {
    artists.push((await upcoming().nth(i).locator('.qrow__sub').innerText()).trim());
    titles.push((await upcoming().nth(i).locator('.qrow__title').innerText()).trim());
  }
  const distinct = new Set(artists).size;
  if (distinct < 5) throw new Error(`solo ${distinct} artistas distintos en ${rows} filas`);
  let run = 0;
  let maxRun = 0;
  let prev = '';
  for (const a of artists) {
    run = a === prev ? run + 1 : 1;
    prev = a;
    maxRun = Math.max(maxRun, run);
  }
  if (maxRun > 2) throw new Error(`hay ${maxRun} filas seguidas del mismo artista`);
  const now = await currentTitle();
  if (titles.includes(now)) throw new Error(`la canción que suena («${now}») también está en la cola`);
  await shot('cola');
  return `${distinct} artistas en ${rows} filas, racha máxima ${maxRun}`;
});

await step('3 «siguiente» cambia la canción y sigue sonando', async () => {
  const before = await currentTitle();
  await page.keyboard.press('Control+ArrowRight');
  await waitFor(async () => (await currentTitle()) !== before && (await playLabel()) === 'Pausar', 30000, 'otra canción sonando');
});

await step('4 fin natural: la canción termina y sigue otra sola', async () => {
  const before = await currentTitle();
  const slider = page.locator('.slider--progress');
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width * 0.997, box.y + box.height / 2);
  await waitFor(async () => (await currentTitle()) !== before && (await playLabel()) === 'Pausar', 40000, 'otra canción tras el final');
});

await step('5 elegir a mano una canción de la radio', async () => {
  const before = await currentTitle();
  await upcoming().nth(4).dblclick();
  await waitFor(async () => (await currentTitle()) !== before && (await playLabel()) === 'Pausar', 30000, 'la canción elegida sonando');
});

await step('6 la base distingue lo elegido de lo automático (plays.auto)', async () => {
  await sleep(1500);
  await app.close();
  const db = new DatabaseSync(join(userData, 'spotaple.db'));
  const autos = db.prepare('SELECT auto FROM plays ORDER BY id').all().map((r) => Number(r.auto));
  db.close();
  // 1.ª: la eligió el usuario · 2.ª: «siguiente» · 3.ª: avance natural a una de la radio · 4.ª: elegida a mano.
  if (JSON.stringify(autos.slice(0, 4)) !== JSON.stringify([0, 0, 1, 0])) throw new Error(`plays.auto = [${autos.join(', ')}] (se esperaba empezar con 0, 0, 1, 0)`);
  return `plays.auto = [${autos.join(', ')}]`;
});

await step('7 con la radio apagada se encolan los resultados, sin separador', async () => {
  await launch();
  await settingsSwitch('Radio automática', false);
  await search('Daft Punk One More Time');
  await page.waitForSelector('.tabs', { timeout: 30000 });
  await page.locator('.tab', { hasText: 'Canciones' }).click();
  await page.waitForSelector('.tracklist__body .row');
  const songs = await page.locator('.tracklist__body .row').count();
  await page.locator('.tracklist__body .row .row__title').first().dblclick();
  await page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 30000 });
  await openQueue();
  await waitFor(async () => (await queueRows()) === songs, 8000, `la cola con las ${songs} canciones de los resultados`);
  await sleep(3000);
  if (await page.locator('.queue__divider').count()) throw new Error('apareció el separador con la radio apagada');
  return `${songs} canciones encoladas`;
});

await step('8 con «repetir toda la cola» una canción suelta no recibe radio', async () => {
  await settingsSwitch('Radio automática', true);
  const repeat = page.locator('button[aria-label^="Repetir"]');
  for (let i = 0; i < 3 && !(await repeat.getAttribute('aria-label')).includes('toda la cola'); i++) await repeat.click();
  await playFirstSong('Charly García Demoliendo hoteles');
  await openQueue();
  await sleep(8000);
  const rows = await queueRows();
  if (rows !== 1) throw new Error(`la cola tiene ${rows} filas con la repetición activa`);
  if (await page.locator('.queue__divider').count()) throw new Error('apareció el separador con la repetición activa');
});

await app.close().catch(() => undefined);
rmSync(userData, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} paso(s) con fallas` : `\nTodos los pasos pasaron (${results.length})`);
process.exit(failed.length ? 1 : 0);
