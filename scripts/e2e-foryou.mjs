// Recorrido real de «Hecho para vos»: con pocos datos no aparece nada; con datos suficientes se arman el Descubrimiento
// semanal, los Mixes diarios, el Release Radar y los artistas sugeridos; la página de una lista se reproduce y se guarda
// como playlist; sin red se siguen viendo las listas anteriores sin avisos de error; y en Ajustes se apaga, se enciende y
// se reinician los gustos sin borrar el historial ni las favoritas.
// Requiere `npm run build` e internet. Capturas en ./.e2e
import vm from 'node:vm';
import { _electron as electron } from 'playwright-core';
import { Innertube, Log, Platform } from 'youtubei.js';
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

// ── Datos reales: 4 artistas y sus canciones más escuchadas (sin audio, solo metadatos).
Log.setLevel(Log.Level.NONE);
Platform.shim.eval = (d) => JSON.parse(JSON.stringify(vm.runInNewContext(`(function(){${d.output}})()`, Object.create(null), { timeout: 5000 })));
const yt = await Innertube.create({ retrieve_player: false });
const artists = [];
for (const name of ['Daft Punk', 'Charly García', 'Queen', 'Soda Stereo']) {
  const s = await yt.music.search(name, { type: 'artist' });
  const hit = (s.contents ?? []).flatMap((c) => c.contents ?? []).find((i) => i.item_type === 'artist');
  const a = await yt.music.getArtist(hit.id);
  const top = (a.sections ?? []).find((sec) => /^top songs$|^songs$/i.test(String(sec.header?.title ?? sec.title)));
  const songs = (top?.contents ?? []).filter((i) => i.id).slice(0, 5).map((i) => ({ id: i.id, title: String(i.title), duration: i.duration?.seconds ?? null }));
  if (songs.length < 5) throw new Error(`${name} trae solo ${songs.length} canciones populares`);
  artists.push({ id: hit.id, name: String(a.header?.title ?? name), songs });
}
const seededNames = new Set(artists.map((a) => a.name));
const seededTitles = new Set(artists.flatMap((a) => a.songs.map((s) => s.title)));
console.log(`datos: ${artists.map((a) => a.name).join(', ')}`);

const userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-foryou-'));
const dbPath = join(userData, 'spotaple.db');
let app;
let page;
async function launch(extraArgs = []) {
  await app?.close().catch(() => undefined); // un paso que falló pudo dejar la app abierta
  app = await electron.launch({ executablePath: electronPath, args: ['.', ...extraArgs], env: { ...process.env, SPOTAPLE_USER_DATA: userData } });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.waitForSelector('.titlebar');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
  await sleep(500);
}
const db = (fn) => {
  const d = new DatabaseSync(dbPath);
  try {
    return fn(d);
  } finally {
    d.close();
  }
};
const count = (table) => db((d) => Number(d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n));

/** Guarda las canciones (si faltan) y las reproduce `times` veces, con fechas recientes. */
function play(songIndexByArtist) {
  db((d) => {
    const addTrack = d.prepare('INSERT OR IGNORE INTO tracks(id,title,artists,duration_sec,updated_at) VALUES(?,?,?,?,?)');
    const addPlay = d.prepare('INSERT INTO plays(track_id, played_at, auto) VALUES(?,?,0)');
    let minute = 0;
    artists.forEach((a, ai) => {
      for (const si of songIndexByArtist[ai] ?? []) {
        const s = a.songs[si];
        addTrack.run(s.id, s.title, JSON.stringify([{ id: a.id, name: a.name }]), s.duration, Date.now());
        addPlay.run(s.id, Date.now() - ++minute * 60_000 - Math.floor(Math.random() * 1000));
      }
    });
  });
}
function favorite(songIndexByArtist) {
  db((d) => {
    const addTrack = d.prepare('INSERT OR IGNORE INTO tracks(id,title,artists,duration_sec,updated_at) VALUES(?,?,?,?,?)');
    const addFav = d.prepare('INSERT OR IGNORE INTO favorites(track_id, added_at) VALUES(?,?)');
    artists.forEach((a, ai) => {
      for (const si of songIndexByArtist[ai] ?? []) {
        const s = a.songs[si];
        addTrack.run(s.id, s.title, JSON.stringify([{ id: a.id, name: a.name }]), s.duration, Date.now());
        addFav.run(s.id, Date.now());
      }
    });
  });
}

const goHome = () => page.locator('.nav-item[title="Inicio"]').click();
const shelf = (id) => page.locator(`.shelf[aria-labelledby="${id}"]`);
const shot = (name) => page.screenshot({ path: join(OUT, `foryou-${name}.png`) });
const playLabel = () => page.locator('.play-btn').getAttribute('aria-label');

// La app crea la base al abrir; después se siembra.
await launch();
await sleep(800);
await app.close();

await step('1 con pocos datos (14 reproducciones y 4 favoritas) no aparece nada de «Hecho para vos»', async () => {
  play([[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2], [0, 1, 2]]); // 14
  favorite([[4], [4], [4], [4]]); // 4
  await launch();
  await goHome();
  await page.waitForSelector('h1.h1');
  await sleep(6000); // si fuera a generar algo, ya habría empezado
  if (await shelf('sec-foryou').count()) throw new Error('apareció «Hecho para vos» con pocos datos');
  if (await shelf('sec-artists').count()) throw new Error('aparecieron «Artistas que podrías escuchar» con pocos datos');
  if (await page.locator('.toast--error').count()) throw new Error('hay un aviso de error con pocos datos');
  if (count('generated_lists') !== 0) throw new Error('se generó una lista con pocos datos');
  await app.close();
  return '14 reproducciones y 4 favoritas: nada en Inicio';
});

await step('2 con datos suficientes aparecen el semanal, los mixes, el radar y los artistas sugeridos', async () => {
  play([[0, 0, 0], [0, 0], [0, 0], [0]]); // +8 → 22
  await launch();
  await goHome();
  await waitFor(async () => (await shelf('sec-foryou').locator('.card').count()) >= 4, 120000, 'las listas de «Hecho para vos»');
  const titles = await shelf('sec-foryou').locator('.card__title').allInnerTexts();
  const mixes = titles.filter((t) => /^Mix \d$/.test(t)).length;
  if (!titles.includes('Descubrimiento semanal')) throw new Error(`falta el semanal: ${titles.join(' | ')}`);
  if (mixes < 3) throw new Error(`hay ${mixes} mixes (se esperaban al menos 3)`);
  await waitFor(async () => (await shelf('sec-artists').locator('.card').count()) >= 6, 30000, 'los artistas sugeridos');
  const suggested = await shelf('sec-artists').locator('.card__title').allInnerTexts();
  const clash = suggested.filter((n) => seededNames.has(n));
  if (clash.length) throw new Error(`se sugieren artistas que ya escuchás: ${clash.join(', ')}`);
  await shot('inicio');
  return `${titles.length} listas (${mixes} mixes${titles.includes('Release Radar') ? ' y radar' : ', sin radar'}) y ${suggested.length} artistas`;
});

await step('3 abrir el semanal: sin repetidos ni lo ya escuchado, suena, y «Guardar en mi biblioteca» crea una sola playlist', async () => {
  await shelf('sec-foryou').locator('.card__body', { hasText: 'Descubrimiento semanal' }).click();
  await page.waitForSelector('.hero__title');
  await page.waitForSelector('.tracklist__body .row');
  const rows = await page.locator('.tracklist__body .row .row__title').allInnerTexts();
  if (rows.length < 20) throw new Error(`el semanal trae solo ${rows.length} canciones`);
  if (new Set(rows).size !== rows.length) throw new Error('hay títulos repetidos en el semanal');
  const heard = rows.filter((t) => seededTitles.has(t));
  if (heard.length) throw new Error(`el semanal trae canciones que ya escuchaste: ${heard.join(' | ')}`);
  await shot('semanal');

  await page.locator('.hero__actions').getByRole('button', { name: 'Reproducir', exact: true }).click();
  await waitFor(async () => (await playLabel()) === 'Pausar', 60000, 'el semanal sonando');

  const save = page.getByRole('button', { name: /Guardar en mi biblioteca/ });
  await save.dblclick();
  await waitFor(async () => (await page.locator('.nav-item, .pl-item').filter({ hasText: 'Descubrimiento semanal' }).count()) >= 1, 15000, 'la playlist en el lateral');
  await sleep(1000);
  await app.close();
  const playlists = db((d) => d.prepare('SELECT id, name FROM playlists').all());
  if (playlists.length !== 1 || playlists[0].name !== 'Descubrimiento semanal') throw new Error(`playlists = ${JSON.stringify(playlists)}`);
  const items = count('playlist_items');
  if (items !== rows.length) throw new Error(`la playlist tiene ${items} canciones y la lista ${rows.length}`);
  return `${rows.length} canciones, 1 playlist`;
});

await step('4 sin red al abrir Inicio con listas ya guardadas: se ven las anteriores y no hay avisos de error', async () => {
  // Todo queda como de un período viejo, así que la app intenta regenerar y no puede.
  db((d) => d.exec("UPDATE generated_lists SET period = '2000-01-03'"));
  await launch(['--proxy-server=127.0.0.1:9']); // red de main cortada
  await goHome();
  await waitFor(async () => (await shelf('sec-foryou').locator('.card').count()) >= 4, 20000, 'las listas anteriores');
  await sleep(8000); // tiempo para que el intento de regenerar falle
  if (await page.locator('.toast--error').count()) throw new Error('apareció un aviso de error sin red');
  const still = await shelf('sec-foryou').locator('.card').count();
  if (still < 4) throw new Error(`quedaron ${still} listas tras el intento sin red`);
  await shot('sin-red');
  await app.close();
  return `${still} listas siguen visibles`;
});

await step('5 Ajustes: apagar y encender «Hecho para vos», y reiniciar los gustos sin borrar historial ni favoritas', async () => {
  const playsBefore = count('plays');
  const favsBefore = count('favorites');
  await launch();
  await page.locator('.nav-item[title="Ajustes"]').click();
  const toggle = () => page.getByRole('switch', { name: 'Mostrar «Hecho para vos» en Inicio' });
  await toggle().click();
  await sleep(1500); // el guardado de ajustes va con un retraso corto
  await goHome();
  await sleep(1500);
  if (await shelf('sec-foryou').count()) throw new Error('con el ajuste apagado siguen las listas');
  await page.locator('.nav-item[title="Ajustes"]').click();
  await toggle().click();
  await sleep(1500);
  await goHome();
  await waitFor(async () => (await shelf('sec-foryou').locator('.card').count()) >= 4, 120000, 'las listas al volver a encender el ajuste');

  await page.locator('.nav-item[title="Ajustes"]').click();
  await page.getByRole('button', { name: 'Reiniciar mis gustos' }).click();
  await page.getByRole('button', { name: 'Reiniciar', exact: true }).click();
  await sleep(1500);
  await goHome();
  await sleep(2500);
  if (await shelf('sec-foryou').count()) throw new Error('tras reiniciar los gustos siguen las listas');
  await page.screenshot({ path: join(OUT, 'foryou-reiniciado.png'), timeout: 8000 }).catch(async () => {
    const w = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused(), bounds: win.getBounds() };
    });
    console.log(`  [debug] no se pudo capturar; ventana: ${JSON.stringify(w)}`);
  });
  await sleep(500);
  await app.close();
  if (count('generated_lists') !== 0) throw new Error('quedaron listas guardadas tras reiniciar');
  if (count('plays') !== playsBefore) throw new Error(`plays pasó de ${playsBefore} a ${count('plays')}`);
  if (count('favorites') !== favsBefore) throw new Error(`favorites pasó de ${favsBefore} a ${count('favorites')}`);
  return `intactos: ${playsBefore} reproducciones y ${favsBefore} favoritas`;
});

await app?.close().catch(() => undefined);
rmSync(userData, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} paso(s) con fallas` : `\nTodos los pasos pasaron (${results.length})`);
process.exit(failed.length ? 1 : 0);
