// Recorrido real de las playlists de la búsqueda: pestaña y tarjetas, abrir una, reproducirla entera, una lista
// de videos de canal (ítems de tipo desconocido) y guardarla como playlist propia con doble clic.
// Requiere `npm run build` e internet. Capturas en ./.e2e
import { _electron as electron } from 'playwright-core';
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

const userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-playlists-'));
const app = await electron.launch({ executablePath: electronPath, args: ['.'], env: { ...process.env, SPOTAPLE_USER_DATA: userData } });
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.waitForSelector('.titlebar');
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
await sleep(500);

const search = async (q) => {
  const input = page.locator('input[aria-label^="Buscar"]');
  await input.fill('');
  await input.fill(q);
};
const playlistsTab = () => page.locator('.tab', { hasText: 'Playlists' });
const shelfCards = () => page.locator('section:has(#sec-playlists) .card');
const rowCount = () => page.locator('.tracklist__body .row').count();
const shot = (name) => page.screenshot({ path: join(OUT, `playlists-${name}.png`) });
const ctx = {};

await step('1 la búsqueda trae la pestaña y el estante de playlists', async () => {
  await search('Daft Punk');
  await page.waitForSelector('.tabs', { timeout: 30000 });
  const n = await waitFor(async () => Number(await playlistsTab().locator('.tab__n').innerText()) || 0, 30000, 'playlists en los resultados');
  const cards = await shelfCards().count();
  if (!cards) throw new Error('el estante «Playlists» de «Todo» no tiene tarjetas');
  return `${n} playlists, ${cards} tarjetas en «Todo»`;
});

await step('2 abrir una playlist: cabecera «Playlist» y canciones', async () => {
  await playlistsTab().click();
  if ((await playlistsTab().getAttribute('aria-selected')) !== 'true') throw new Error('la pestaña «Playlists» no quedó activa');
  const card = shelfCards().first();
  ctx.title = (await card.locator('.card__title').innerText()).trim();
  await card.locator('.card__body').click();
  await page.waitForSelector('.hero__title');
  const kind = (await page.locator('.hero__kind').innerText()).trim();
  if (kind.toLowerCase() !== 'playlist') throw new Error(`la etiqueta es «${kind}»`); // la hoja de estilos la muestra en mayúsculas
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  await page.waitForSelector('.hero__cover img.is-ready', { timeout: 15000 }); // la portada de la cabecera carga de verdad
  ctx.rows = await rowCount();
  await shot('pagina');
  return `«${ctx.title}»: ${ctx.rows} canciones`;
});

await step('3 reproducir la playlist entera: suena y la cola tiene todas', async () => {
  await page.locator('.hero__actions .btn--accent').click();
  await page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 30000 });
  await page.locator('button[aria-label="Mostrar la cola"]').click();
  await page.waitForSelector('.queue .qrow');
  const queued = await page.locator('.queue .qrow').count();
  if (queued !== ctx.rows) throw new Error(`la cola tiene ${queued} filas y la página ${ctx.rows}`);
  await page.locator('button[aria-label="Ocultar la cola"]').click().catch(() => undefined);
  return `${queued} canciones en la cola`;
});

await step('4 lista de videos de canal (ítems de tipo desconocido): muestra canciones, no una lista vacía', async () => {
  await search('lo-fi');
  await page.waitForSelector('.tabs', { timeout: 30000 });
  await waitFor(async () => (await shelfCards().count()) >= 3, 30000, 'tarjetas de playlists para «lo-fi»');
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await shelfCards().nth(i).locator('.card__body').click();
    await page.waitForSelector('.hero__title');
    const rows = await waitFor(async () => (await rowCount()) || ((await page.locator('.empty, .notice--error').count()) ? -1 : 0), 30000, `canciones de la playlist ${i + 1}`);
    seen.push(rows);
    await page.keyboard.press('Alt+ArrowLeft');
    await waitFor(async () => (await shelfCards().count()) >= 3, 15000, 'volver a los resultados');
  }
  if (!seen.some((n) => n > 0)) throw new Error(`ninguna de las 3 primeras mostró canciones (${seen.join(', ')})`);
  return `canciones por playlist: ${seen.map((n) => (n < 0 ? 'vacía' : n)).join(', ')}`;
});

await step('5 «Guardar en mi biblioteca» con doble clic crea una sola playlist', async () => {
  await search('Every Daft Punk Song');
  await page.waitForSelector('.tabs', { timeout: 30000 });
  await waitFor(async () => (await shelfCards().count()) >= 1, 30000, 'tarjetas de playlists');
  await shelfCards().first().locator('.card__body').click();
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  const sourceRows = await rowCount();
  const before = await page.locator('.sidebar__scroll .pl-item').count();
  await page.locator('.hero__actions .btn', { hasText: 'Guardar en mi biblioteca' }).dblclick();
  await waitFor(async () => (await page.locator('.sidebar__scroll .pl-item').count()) > before, 15000, 'la playlist nueva en el lateral');
  await sleep(2500); // si el doble clic hubiera creado dos, la segunda ya estaría
  const after = await page.locator('.sidebar__scroll .pl-item').count();
  if (after !== before + 1) throw new Error(`había ${before} listas y ahora ${after} (se esperaba ${before + 1})`);
  await shot('guardada');
  await page.locator('.sidebar__scroll .pl-item').nth(1).click(); // la más nueva va primero, después de «Favoritos»
  await waitFor(async () => (await rowCount()) >= 1, 10000, 'canciones de la playlist guardada');
  const savedRows = await rowCount();
  if (savedRows > sourceRows) throw new Error(`la guardada tiene ${savedRows} canciones y la original ${sourceRows}`);
  return `lateral: ${before} → ${after}; la original tiene ${sourceRows} canciones y la guardada ${savedRows} (las repetidas se omiten)`;
});

await app.close();
rmSync(userData, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} paso(s) con fallas` : `\nTodos los pasos pasaron (${results.length})`);
process.exit(failed.length ? 1 : 0);
