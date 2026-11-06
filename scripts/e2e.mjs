// Recorrido REAL de punta a punta contra YouTube Music (no usa respuestas simuladas):
//   abrir → buscar → reproducir → pausar/continuar/saltar → cola → navegar → minimizar →
//   playlist + favoritos → cerrar y reabrir (persistencia) → tamaños de ventana.
// Requiere `npm run build` y conexión a internet. Capturas en ./.e2e
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';

const OUT = join(import.meta.dirname, '..', '.e2e');
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-'));
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
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

// SPOTAPLE_EXE=release/win-unpacked/Spotaple.exe prueba la versión empaquetada en lugar del código en ./out
const exe = process.env.SPOTAPLE_EXE;
const launch = () =>
  electron.launch({ executablePath: exe ?? electronPath, args: exe ? [] : ['.'], env: { ...process.env, SPOTAPLE_USER_DATA: userData } });
const toSec = (t) => t.split(':').reduce((a, p) => a * 60 + Number(p), 0);
const elapsed = async (page) => toSec((await page.locator('.progress__time').first().innerText()).trim());
const label = (page) => page.locator('.play-btn').getAttribute('aria-label');
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
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const resize = (app, w, h) => app.evaluate(({ BrowserWindow }, [W, H]) => BrowserWindow.getAllWindows()[0].setSize(W, H), [w, h]);

let app = await launch();
let page = await app.firstWindow();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('  [console.error]', m.text().slice(0, 200)));
await page.waitForSelector('.titlebar');
await resize(app, 1200, 800);
await sleep(600);

await step('1. abre con estado vacío atractivo', async () => {
  await page.waitForSelector('.empty__title');
  await shot(page, '01-home-vacio');
  return await page.locator('.empty__title').innerText();
});

await step('2. búsqueda real devuelve canciones, artistas y álbumes', async () => {
  const input = page.locator('input[aria-label^="Buscar"]');
  await input.click();
  await input.fill('Daft Punk One More Time');
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  await sleep(800);
  await shot(page, '02-busqueda');
  const songs = await page.locator('.tracklist__body .row').count();
  const sections = await page.locator('.h2').allInnerTexts();
  return `${songs} canciones, secciones: ${sections.join(' / ')}`;
});

await step('3. reproduce de verdad (el tiempo avanza)', async () => {
  const t0 = Date.now();
  // Doble clic sobre el título (el centro de la fila cae sobre el enlace del álbum, que navega).
  await page.locator('.tracklist__body .row .row__title').first().dblclick();
  await waitFor(async () => (await label(page)) === 'Pausar', 30000, 'estado reproduciendo');
  console.log(`      tiempo hasta el primer sonido: ${Date.now() - t0} ms`);
  const a = await elapsed(page);
  await sleep(3500);
  const b = await elapsed(page);
  if (b <= a) throw new Error(`el tiempo no avanza (${a}s → ${b}s)`);
  await shot(page, '03-reproduciendo');
  // Tarjeta/teclas multimedia del sistema: la sesión multimedia debe reflejar la canción que suena.
  const ms = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, state: navigator.mediaSession.playbackState }));
  const shown = await page.locator('.player__title').innerText();
  if (ms.title !== shown || ms.state !== 'playing') throw new Error(`mediaSession desincronizada: ${JSON.stringify(ms)} vs «${shown}»`);
  return `${a}s → ${b}s; mediaSession OK`;
});

await step('4. pausar y continuar', async () => {
  await page.locator('.play-btn').click();
  await waitFor(async () => (await label(page)) === 'Reproducir', 5000, 'pausa');
  const paused = await elapsed(page);
  await sleep(1500);
  if ((await elapsed(page)) !== paused) throw new Error('siguió avanzando en pausa');
  await page.locator('.play-btn').click();
  await waitFor(async () => (await label(page)) === 'Pausar', 10000, 'continuar');
  await waitFor(async () => (await elapsed(page)) > paused, 8000, 'avance tras continuar');
});

await step('5. cambiar la posición (seek)', async () => {
  const slider = page.locator('.slider--progress');
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  // La interfaz muestra la posición al instante; lo que importa es que el AUDIO la alcance y siga sonando.
  await sleep(4000);
  const t = await elapsed(page);
  if (t < 150 || t > 175) throw new Error(`posición inesperada tras saltar: ${t}s (esperaba ~160 s)`);
  if ((await label(page)) !== 'Pausar') throw new Error('dejó de sonar tras saltar');
  await sleep(2500);
  const t2 = await elapsed(page);
  if (t2 <= t) throw new Error(`no avanza tras saltar (${t} → ${t2})`);
  return `saltó a ~160 s y sigue sonando (${t}s → ${t2}s)`;
});

await step('6. cambiar de canción y editar la cola', async () => {
  await page.locator('button[aria-label="Mostrar la cola"]').click();
  await page.waitForSelector('.queue');
  const before = await page.locator('.queue .qrow').count();
  // Agrega la 2.ª y 3.ª canción de la lista desde su botón de fila
  const rows = page.locator('.tracklist__body .row');
  await rows.nth(1).hover();
  await rows.nth(1).locator('.row__queue').click();
  await rows.nth(2).hover();
  await rows.nth(2).locator('.row__queue').click();
  await sleep(500);
  const after = await page.locator('.queue .qrow').count();
  await shot(page, '04-cola');
  if (after <= before) throw new Error(`la cola no creció (${before} → ${after})`);
  const firstTitle = await page.locator('.player__title').innerText();
  await page.locator('button[aria-label="Canción siguiente"]').click();
  await waitFor(async () => (await page.locator('.player__title').innerText()) !== firstTitle, 20000, 'cambio de canción');
  await waitFor(async () => (await label(page)) === 'Pausar', 30000, 'suena la siguiente');
  // quitar un ítem de la cola
  const n = await page.locator('.queue .qrow').count();
  await page.locator('.queue .qrow').last().hover();
  await page.locator('.queue .qrow').last().locator('.qrow__remove').click();
  await waitFor(async () => (await page.locator('.queue .qrow').count()) < n, 3000, 'quitar de la cola');
  return `cola ${before} → ${after}, siguiente OK, quitar OK`;
});

await step('7. navegar no corta el audio', async () => {
  const t0 = await elapsed(page);
  await page.locator('.nav-item[title="Biblioteca"]').click();
  await sleep(300);
  await page.locator('.nav-item[title="Playlists"]').click();
  await page.locator('.nav-item[title="Inicio"]').click();
  await sleep(2500);
  const t1 = await elapsed(page);
  if ((await label(page)) !== 'Pausar') throw new Error('se pausó al navegar');
  if (t1 <= t0) throw new Error('el tiempo no avanzó al navegar');
  return `${t0}s → ${t1}s`;
});

await step('8. minimizar no detiene la reproducción', async () => {
  const t0 = await elapsed(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await sleep(4000);
  const t1 = await elapsed(page);
  const state = await label(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await sleep(500);
  if (state !== 'Pausar') throw new Error(`estado tras minimizar: ${state}`);
  if (t1 <= t0) throw new Error(`el tiempo no avanzó minimizado (${t0} → ${t1})`);
  return `${t0}s → ${t1}s minimizado`;
});

await step('9. favoritos', async () => {
  await page.locator('input[aria-label^="Buscar"]').fill('Daft Punk One More Time');
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  const row = page.locator('.tracklist__body .row').first();
  await row.hover();
  await row.locator('.row__fav').click();
  await waitFor(async () => (await row.locator('.row__fav').getAttribute('aria-pressed')) === 'true', 4000, 'corazón activo');
});

await step('10. crear playlist y agregar canciones', async () => {
  await page.locator('button[aria-label="Nueva playlist"]').first().click();
  const field = page.locator('.field__input');
  await field.fill('Mis pruebas');
  await field.press('Enter');
  await page.waitForSelector('.hero__title');
  await page.locator('input[aria-label^="Buscar"]').fill('Daft Punk One More Time');
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  for (const i of [0, 1]) {
    await page.locator('.tracklist__body .row').nth(i).click({ button: 'right' });
    await page.locator('.menu [role="menuitem"]', { hasText: 'Agregar a playlist' }).click();
    await page.locator('.menu [role="menuitem"]', { hasText: 'Mis pruebas' }).click();
    await sleep(500);
  }
  await page.locator('.pl-item', { hasText: 'Mis pruebas' }).click();
  await page.waitForSelector('.tracklist__body .row');
  const n = await page.locator('.tracklist__body .row').count();
  await shot(page, '05-playlist');
  if (n !== 2) throw new Error(`esperaba 2 canciones, hay ${n}`);
  return '2 canciones';
});

await step('11. reordenar la playlist (menú: mover abajo)', async () => {
  const titles = () => page.locator('.tracklist__body .row .row__title').allInnerTexts();
  const before = await titles();
  await page.locator('.tracklist__body .row').first().click({ button: 'right' });
  await page.locator('.menu [role="menuitem"]', { hasText: 'Mover abajo' }).click();
  await waitFor(async () => {
    const after = await titles();
    return after[0] === before[1] && after[1] === before[0];
  }, 4000, 'orden invertido');
});

await step('12. cierra y reabre: persistencia', async () => {
  const title = await page.locator('.player__title').innerText();
  await sleep(1200);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('.titlebar');
  await resize(app, 1200, 800);
  await sleep(1500);
  const restored = await page.locator('.player__title').innerText();
  if (!restored) throw new Error('la cola no se restauró');
  if ((await label(page)) !== 'Reproducir') throw new Error('arrancó sonando solo');
  await page.waitForSelector('.pl-item:has-text("Mis pruebas")');
  const pls = await page.locator('.pl-item__name').allInnerTexts();
  await page.locator('.nav-item[title="Biblioteca"]').click();
  await page.waitForSelector('.tracklist__body .row');
  const favs = await page.locator('.tracklist__body .row').count();
  await shot(page, '06-reabierta');
  return `pista «${restored}» (antes «${title}»), listas: ${pls.join(', ')}, favoritas: ${favs}`;
});

await step('13. reanuda con una acción del usuario', async () => {
  await page.locator('.play-btn').click();
  await waitFor(async () => (await label(page)) === 'Pausar', 30000, 'reanudar tras reabrir');
  return `suena en ${await elapsed(page)}s`;
});

await step('14. tamaño 960×640 sin cortes', async () => {
  await resize(app, 960, 640);
  await sleep(600);
  await page.locator('.nav-item[title="Inicio"]').click();
  await sleep(600);
  await shot(page, '07-960-inicio');
  await page.locator('input[aria-label^="Buscar"]').fill('Daft Punk');
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  await sleep(800);
  await shot(page, '08-960-busqueda');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error('hay desplazamiento horizontal');
});

await app.close();
rmSync(userData, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pasos OK`);
process.exit(failed.length ? 1 : 0);
