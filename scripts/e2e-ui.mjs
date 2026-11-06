// Segundo recorrido real: pantallas de artista/álbum, menú contextual, diálogos, arrastrar para
// reordenar, y recuperación ante caídas de red (con un proxy local que se puede "cortar").
// Requiere `npm run build` e internet. Capturas en ./.e2e
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';

const OUT = join(import.meta.dirname, '..', '.e2e');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
// ONLY=B3 ejecuta solo los pasos cuyo nombre empieza así (útil para diagnosticar uno).
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

// ── proxy local con interruptor: simula caídas de red del proceso principal (fetch de Node)
let online = true;
const tunnels = new Set();
const hostsSeen = new Set();
const proxy = http.createServer((_, res) => (res.writeHead(502), res.end()));
proxy.on('connect', (req, client, head) => {
  const [host, port] = req.url.split(':');
  hostsSeen.add(host);
  if (!online) return client.destroy();
  const upstream = net.connect(Number(port) || 443, host, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  tunnels.add(client).add(upstream);
  const close = () => (client.destroy(), upstream.destroy(), tunnels.delete(client), tunnels.delete(upstream));
  upstream.on('error', close);
  client.on('error', close);
  client.on('close', close);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
const setOnline = (v) => {
  online = v;
  if (!v) for (const s of tunnels) s.destroy();
};

const userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-ui-'));
const exe = process.env.SPOTAPLE_EXE;
// La app usa la red de Chromium (net.fetch): se le indica el proxy como lo haría el sistema.
const app = await electron.launch({
  executablePath: exe ?? electronPath,
  args: [...(exe ? [] : ['.']), `--proxy-server=${proxyUrl}`],
  env: { ...process.env, SPOTAPLE_USER_DATA: userData },
});
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
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const imagesLoaded = () =>
  page.waitForFunction(() => [...document.querySelectorAll('.cover img')].every((i) => i.complete), null, { timeout: 15000 }).catch(() => undefined);
const label = () => page.locator('.play-btn').getAttribute('aria-label');

await step('A1. artista: ficha con populares, álbumes y sencillos', async () => {
  await search('Daft Punk');
  await page.waitForSelector('.card', { timeout: 30000 });
  await page.locator('.card__body', { hasText: 'Artista' }).first().click();
  await page.waitForSelector('.hero__title');
  await page.waitForSelector('.tracklist__body .row');
  await sleep(800);
  await imagesLoaded();
  await shot('10-artista');
  const sections = await page.locator('.h2').allInnerTexts();
  const name = await page.locator('.hero__title').innerText();
  return `${name}: ${sections.join(' / ')}`;
});

await step('A2. álbum: portada, canciones y "reproducir desde esta canción" ≠ "agregar a la cola"', async () => {
  await page.locator('.shelf', { hasText: 'Álbumes' }).locator('.card__body').first().click();
  await page.waitForSelector('.hero__kind');
  await page.waitForSelector('.tracklist__body .row');
  await sleep(800);
  await imagesLoaded();
  await shot('11-album');
  const rows = page.locator('.tracklist__body .row');
  const n = await rows.count();
  // Arranca la 1.ª; "agregar a la cola" NO debe cambiar lo que suena.
  await rows.nth(0).locator('.row__title').dblclick();
  await waitFor(async () => (await label()) === 'Pausar', 30000, 'suena la 1.ª');
  const before = await page.locator('.player__title').innerText();
  await rows.nth(2).hover();
  await rows.nth(2).locator('.row__queue').click();
  await sleep(600);
  if ((await page.locator('.player__title').innerText()) !== before) throw new Error('agregar a la cola cambió la canción actual');
  // "Reproducir desde esta canción" SÍ salta a esa y la cola continúa desde ahí.
  const fourth = await rows.nth(3).locator('.row__title').innerText();
  await rows.nth(3).locator('.row__title').dblclick();
  await waitFor(async () => (await page.locator('.player__title').innerText()) === fourth, 30000, 'suena desde la 4.ª');
  await page.locator('button[aria-label="Mostrar la cola"]').click();
  await page.waitForSelector('.queue .qrow');
  const queueNow = await page.locator('.queue .qrow').count();
  return `${n} canciones; «cola» no cambió lo que suena; «desde esta canción» sí (cola de ${queueNow})`;
});

await step('A3. menú contextual de canción (captura) y atajos de teclado', async () => {
  await page.locator('.tracklist__body .row').nth(1).click({ button: 'right' });
  await page.waitForSelector('.menu');
  await shot('12-menu');
  const items = await page.locator('.menu [role="menuitem"]').allInnerTexts();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu', { state: 'detached' });
  // Espacio pausa/reanuda cuando el foco no está en un campo de texto
  await page.locator('.main__scroll').focus();
  await page.keyboard.press('Space');
  await waitFor(async () => (await label()) === 'Reproducir', 4000, 'Espacio pausa');
  await page.keyboard.press('Space');
  await waitFor(async () => (await label()) === 'Pausar', 8000, 'Espacio reanuda');
  // Ctrl+K enfoca la búsqueda y Espacio dentro del campo escribe un espacio (no pausa)
  await page.keyboard.press('Control+k');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  if (!focused?.startsWith('Buscar')) throw new Error('Ctrl+K no enfocó la búsqueda');
  await page.keyboard.type('a b');
  if ((await label()) !== 'Pausar') throw new Error('Espacio en el campo de búsqueda pausó la música');
  return `menú: ${items.join(' | ')}`;
});

await step('A4. arrastrar para reordenar la cola', async () => {
  const titles = () => page.locator('.queue .qrow:not(.is-current) .qrow__title').allInnerTexts();
  await page.waitForSelector('.queue .qrow');
  const before = await titles();
  if (before.length < 3) throw new Error('la cola tiene muy pocos ítems para la prueba');
  const rows = page.locator('.queue .qrow:not(.is-current)');
  await rows.nth(0).dragTo(rows.nth(2));
  await sleep(500);
  const after = await titles();
  if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('el orden no cambió');
  return `${before[0]} pasó de 1.º a ${after.indexOf(before[0]) + 1}.º`;
});

await step('A5. playlists: crear, renombrar (diálogo), eliminar con confirmación', async () => {
  await page.locator('.nav-item[title="Playlists"]').click();
  await page.waitForSelector('.empty');
  await page.locator('.btn', { hasText: 'Nueva playlist' }).first().click();
  await page.locator('.field__input').fill('Para borrar');
  await page.locator('.field__input').press('Enter');
  await page.waitForSelector('.hero__title');
  await page.locator('.hero__rename').click();
  await page.waitForSelector('.dialog');
  await shot('13-dialogo-renombrar');
  await page.locator('.field__input').fill('Renombrada');
  await page.locator('.field__input').press('Enter');
  await waitFor(async () => (await page.locator('.hero__title').innerText()).includes('Renombrada'), 4000, 'nuevo nombre');
  // con canciones: pide confirmación
  await page.locator('input[aria-label^="Buscar"]').fill('Daft Punk One More Time');
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  await page.locator('.tracklist__body .row').first().click({ button: 'right' });
  await page.locator('.menu [role="menuitem"]', { hasText: 'Agregar a playlist' }).click();
  await page.locator('.menu [role="menuitem"]', { hasText: 'Renombrada' }).click();
  await sleep(500);
  await page.locator('.pl-item', { hasText: 'Renombrada' }).click();
  await page.waitForSelector('.hero__title');
  await page.locator('button[aria-label="Eliminar playlist"]').click();
  await page.waitForSelector('.dialog');
  await shot('14-confirmar-eliminar');
  await page.locator('.dialog .btn', { hasText: 'Cancelar' }).click();
  if ((await page.locator('.pl-item', { hasText: 'Renombrada' }).count()) !== 1) throw new Error('canceló pero se borró');
  await page.locator('button[aria-label="Eliminar playlist"]').click();
  await page.locator('.dialog .btn--danger').click();
  await waitFor(async () => (await page.locator('.pl-item', { hasText: 'Renombrada' }).count()) === 0, 4000, 'playlist eliminada');
});

await step('A6. pantalla de inicio con datos', async () => {
  await page.locator('.nav-item[title="Inicio"]').click();
  await page.waitForSelector('.quick__tile');
  await sleep(700);
  await imagesLoaded();
  await shot('15-inicio-con-datos');
});

await step('A7. volver a una pantalla ya visitada no deja portadas invisibles (imagen en caché)', async () => {
  // "Atascada" = la imagen cargó pero nunca recibió .is-ready, así que sigue con opacity 0.
  const stuck = () =>
    page.evaluate(() => [...document.querySelectorAll('.cover img')].filter((i) => i.complete && i.naturalWidth > 0 && !i.classList.contains('is-ready')).length);
  for (let n = 1; n <= 8; n++) {
    await page.locator('.nav-item[title="Playlists"]').click();
    await sleep(250);
    await page.locator('.nav-item[title="Inicio"]').click();
    await page.waitForSelector('.quick__tile');
    await sleep(600);
    await imagesLoaded();
    const bad = await stuck();
    if (bad) throw new Error(`vuelta ${n}: ${bad} portada(s) cargadas pero invisibles`);
  }
  const total = await page.locator('.cover img').count();
  if (!total) throw new Error('no había portadas que comprobar');
  return `8 idas y vueltas, ${total} portadas visibles`;
});

// ── proxy y caídas de red
await step('B0. el tráfico de YouTube respeta el proxy configurado', async () => {
  const hosts = [...hostsSeen].sort();
  const yt = hosts.filter((h) => /youtube\.com$/.test(h));
  const gv = hosts.filter((h) => /googlevideo\.com$/.test(h));
  if (!yt.length) throw new Error(`la API de YouTube no pasó por el proxy (hosts: ${hosts.join(', ')})`);
  if (!gv.length) throw new Error(`el audio no pasó por el proxy (hosts: ${hosts.join(', ')})`);
  return `API: ${yt.join(', ')} · audio: ${gv.length} servidor(es) googlevideo`;
});

await step('B1. búsqueda sin conexión: mensaje claro y reintento que recupera', async () => {
  await page.locator('.nav-item[title="Inicio"]').click();
  setOnline(false);
  await search('bossa nova ' + Date.now());
  await page.waitForSelector('.empty[role="alert"]', { timeout: 30000 });
  const msg = await page.locator('.empty__text').innerText();
  await shot('16-error-red');
  setOnline(true);
  await page.locator('.empty .btn', { hasText: 'Reintentar' }).click();
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
  return `«${msg}» → recuperó al volver la red`;
});

await step('B2. reproducir sin conexión: error accionable y "Reintentar" recupera', async () => {
  const row = page.locator('.tracklist__body .row').nth(1);
  setOnline(false);
  await row.locator('.row__title').dblclick();
  await page.waitForSelector('.player__error', { timeout: 30000 });
  const msg = await page.locator('.player__error-msg').innerText();
  await shot('17-error-reproduccion');
  setOnline(true);
  await page.locator('.player__error .link').click();
  await waitFor(async () => (await label()) === 'Pausar', 30000, 'suena al reintentar');
  return `«${msg}» → suena tras reintentar`;
});

await step('B3. contenido no disponible: mensaje claro, sin colgarse', async () => {
  // Un videoId con formato válido pero inexistente, guardado como favorito por el mismo puente de la app.
  await page.evaluate(() =>
    window.spotapleBridge.library.toggleFavorite({ id: 'ZZZZZZZZZZZ', title: 'Canción inexistente (prueba)', artists: [{ name: 'Nadie' }], durationSec: 100 }),
  );
  await page.locator('.nav-item[title="Biblioteca"]').click();
  await page.waitForSelector('.tracklist__body .row');
  await page.locator('.tracklist__body .row', { hasText: 'Canción inexistente' }).locator('.row__title').dblclick();
  const tPlay = Date.now();
  await page.waitForSelector('.player__error', { timeout: 30000 });
  console.log(`      el error aparece ${Date.now() - tPlay} ms después de elegir la canción`);
  const msg = await page.locator('.player__error-msg').innerText();
  await shot('18-error-no-disponible');
  if (!/disponible|YouTube/i.test(msg)) throw new Error(`mensaje inesperado: ${msg}`);
  return `«${msg}»`;
});

await app.close();
proxy.close();
rmSync(userData, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pasos OK`);
process.exit(failed.length ? 1 : 0);
