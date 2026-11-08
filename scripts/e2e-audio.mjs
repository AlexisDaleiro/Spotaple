// Recorrido real del sonido: el audio llega al grafo de Web Audio con los ajustes por defecto, el ecualizador cambia
// lo que se oye (y «Restablecer» lo devuelve), «Normalizar» baja las canciones fuertes, todo persiste y se recupera de
// ajustes corruptos, y una favorita descargada suena del disco sin red (CORS + Range desde el archivo) con su loudness.
// Requiere `npm run build` e internet. El motor se lee con el interruptor de diagnóstico `localStorage.debugAudio`.
// ONLY=3 ejecuta solo los pasos cuyo nombre empieza así. Capturas en ./.e2e
import { _electron as electron } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';

const OUT = join(import.meta.dirname, '..', '.e2e');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
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
const near = (got, want, tol, what) => {
  if (!(Math.abs(got - want) <= tol)) throw new Error(`${what}: se esperaba ≈${want.toFixed(3)} y salió ${got}`);
};

const userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-audio-'));
const offlineDir = join(userData, 'offline');
let app;
let page;
async function launch(extraArgs = []) {
  app = await electron.launch({ executablePath: electronPath, args: ['.', ...extraArgs], env: { ...process.env, SPOTAPLE_USER_DATA: userData } });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.waitForSelector('.titlebar');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
  // El motor solo se expone con este interruptor: se activa y se recarga para que el reproductor lo vea al crearse.
  await page.evaluate(() => localStorage.setItem('debugAudio', '1'));
  await page.reload();
  await page.waitForSelector('.titlebar');
  await sleep(500);
}
const closeApp = async () => {
  await sleep(700); // el guardado de ajustes va con un retraso corto
  await app.close();
};
const writeSettings = (obj) => {
  const db = new DatabaseSync(join(userData, 'spotaple.db'));
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('app_settings', JSON.stringify(obj));
  db.close();
};

const files = () => (existsSync(offlineDir) ? readdirSync(offlineDir) : []);
const firstTitle = () => page.locator('.tracklist__body .row .row__title').first().innerText().catch(() => '');
// Primer título de la búsqueda anterior: al volver a Búsqueda desde otra página la lista aún muestra lo viejo.
let lastFirst = '';
async function songsTab(q) {
  const input = page.locator('input[aria-label^="Buscar"]');
  await input.fill('');
  await input.fill(q);
  lastFirst = await waitFor(async () => {
    const t = await firstTitle();
    return t && t !== lastFirst ? t : '';
  }, 30000, `resultados de «${q}»`);
  await page.locator('.tab', { hasText: 'Canciones' }).click().catch(() => undefined);
  await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
}
const playedId = () =>
  page.evaluate(() => {
    const el = globalThis.__spotapleAudio?.elements[0];
    return el?.src ? decodeURIComponent(new URL(el.src).pathname.replace(/^\//, '')) : '';
  });
/** Busca, toca la primera canción y espera a que suene una distinta de la anterior. Devuelve su id. */
async function playFirst(q) {
  const prev = await playedId();
  await songsTab(q);
  await page.locator('.tracklist__body .row .row__title').first().dblclick();
  const id = await waitFor(async () => {
    const now = await playedId();
    return now && now !== prev ? now : '';
  }, 30000, `que empiece a sonar «${q}»`).catch(async (e) => {
    await shot('fallo-reproducir');
    throw e;
  });
  await page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 30000 });
  return id;
}
/** Pico y RMS de lo que sale del grafo (último nodo antes de la salida) durante `ms`. */
const measure = (ms) =>
  page.evaluate(async (ms) => {
    const eng = globalThis.__spotapleAudio;
    const an = eng.tap.context.createAnalyser();
    an.fftSize = 2048;
    eng.tap.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    let sum = 0;
    let n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) {
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        n++;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    eng.tap.disconnect(an);
    return { peak, rms: Math.sqrt(sum / n) };
  }, ms);
const trackGain = () => page.evaluate(() => globalThis.__spotapleAudio.trackGains.get(globalThis.__spotapleAudio.elements[0]).gain.value);
const expectedGain = (lkfs) => 10 ** (Math.min(0, Math.max(-12, -14 - lkfs)) / 20);
const loudnessOfTrack = async (id) => (await page.evaluate((id) => window.spotapleBridge.music.prepare(id), id)).data.loudnessLkfs;
const openSettings = async () => {
  await page.locator('.nav-item[title="Ajustes"]').click();
  await page.getByRole('heading', { name: 'Ajustes', level: 1 }).waitFor();
};
const sw = (name) => page.getByRole('switch', { name });
const setSwitch = async (name, on) => {
  const el = sw(name);
  if ((await el.getAttribute('aria-checked')) !== String(on)) await el.click();
};
const shot = (name) => page.screenshot({ path: join(OUT, `audio-${name}.png`) });

let baseline;

await launch();

await step('1 con los ajustes por defecto el audio sale del grafo (arranque en frío)', async () => {
  await playFirst('Daft Punk One More Time');
  baseline = await measure(3000);
  if (!(baseline.peak > 0.05)) throw new Error(`pico ${baseline.peak.toFixed(3)}: el audio no sale del grafo`);
  near(await trackGain(), 1, 0.01, 'ganancia de normalización con «Normalizar» apagado');
  return `pico ${baseline.peak.toFixed(2)}, rms ${baseline.rms.toFixed(3)}`;
});

await step('2 el ecualizador cambia lo que se oye y «Restablecer» lo devuelve', async () => {
  await openSettings();
  await setSwitch('Ecualizador', true);
  await page.locator('.eqset__preamp input').fill('-12');
  await sleep(400);
  const low = await measure(3000);
  if (!(baseline.rms / low.rms >= 2.5)) throw new Error(`con −12 dB el rms bajó ${(baseline.rms / low.rms).toFixed(2)}× (se esperaba ≥ 2,5×)`);
  await shot('eq');
  await page.getByRole('button', { name: 'Restablecer' }).click();
  await sleep(400);
  const back = await measure(3000);
  if (!(back.rms / low.rms >= 2.5)) throw new Error(`tras «Restablecer» el rms solo subió ${(back.rms / low.rms).toFixed(2)}×`);
  return `rms ${baseline.rms.toFixed(3)} → ${low.rms.toFixed(3)} (−12 dB) → ${back.rms.toFixed(3)} (plano)`;
});

await step('3 «Normalizar» baja la canción fuerte según su loudness y deja las suaves como están', async () => {
  await openSettings();
  await setSwitch('Normalizar volumen', true);
  const notes = [];
  let loudOne = false;
  for (const q of ['Bad Bunny Monaco', 'Metallica Nothing Else Matters']) {
    const id = await playFirst(q);
    const lk = await loudnessOfTrack(id);
    if (!Number.isFinite(lk)) throw new Error(`«${q}» no trajo loudness`);
    const want = expectedGain(lk);
    await waitFor(async () => Math.abs((await trackGain()) - want) < 0.02, 5000, `ganancia ≈${want.toFixed(3)} para «${q}» (${lk} LUFS)`);
    if (want < 0.9) loudOne = true;
    notes.push(`${lk} LUFS → ×${want.toFixed(2)}`);
  }
  if (!loudOne) throw new Error('ninguna de las dos canciones era más fuerte que −14 LUFS: no se probó una baja');
  // Apagar «Normalizar» con la canción sonando se aplica al instante.
  await openSettings();
  await setSwitch('Normalizar volumen', false);
  await waitFor(async () => Math.abs((await trackGain()) - 1) < 0.01, 3000, 'ganancia de vuelta a 1 al apagar «Normalizar»');
  await setSwitch('Normalizar volumen', true);
  return notes.join(' · ');
});

await step('4 los ajustes de sonido persisten entre sesiones', async () => {
  await openSettings();
  await setSwitch('Ecualizador', true);
  await page.locator('.eqset__preset select').selectOption('graves');
  await closeApp();
  await launch();
  await openSettings();
  const state = {
    eq: await sw('Ecualizador').getAttribute('aria-checked'),
    normalize: await sw('Normalizar volumen').getAttribute('aria-checked'),
    preset: await page.locator('.eqset__preset select').inputValue(),
    firstBand: (await page.locator('.eqset__db').first().innerText()).trim(),
  };
  if (state.eq !== 'true' || state.normalize !== 'true' || state.preset !== 'graves' || state.firstBand !== '+6 dB') throw new Error(`estado tras reabrir: ${JSON.stringify(state)}`);
  return JSON.stringify(state);
});

await step('5 ajustes de ecualizador corruptos: se descartan y la app abre con lo válido', async () => {
  await closeApp();
  writeSettings({ eqOn: true, eqGains: [1, 2, 3], eqPreamp: 99, normalize: true, crossfade: 99 });
  await launch();
  await openSettings();
  const state = {
    eq: await sw('Ecualizador').getAttribute('aria-checked'),
    normalize: await sw('Normalizar volumen').getAttribute('aria-checked'),
    preset: await page.locator('.eqset__preset select').inputValue(),
    preamp: (await page.locator('.eqset__preamp output').innerText()).trim(),
  };
  if (state.eq !== 'true' || state.normalize !== 'true') throw new Error(`lo válido no se conservó: ${JSON.stringify(state)}`);
  if (state.preset !== 'plano' || state.preamp !== '0 dB') throw new Error(`lo inválido no volvió a fábrica: ${JSON.stringify(state)}`);
  return JSON.stringify(state);
});

await step('6 una favorita descargada suena del disco sin red, con su loudness guardado', async () => {
  await closeApp();
  writeSettings({ normalize: true });
  await launch();
  await songsTab('Daft Punk One More Time');
  const row = page.locator('.tracklist__body .row').first();
  await row.hover();
  await row.locator('.row__fav').click();
  await waitFor(() => files().some((f) => f.endsWith('.webm')) && !files().some((f) => f.endsWith('.part')), 60000, 'la descarga de la favorita');
  await closeApp();
  const db = new DatabaseSync(join(userData, 'spotaple.db'));
  const rows = db.prepare('SELECT t.id, t.loudness FROM tracks t JOIN downloads d ON d.track_id = t.id').all();
  db.close();
  if (rows.length !== 1 || !Number.isFinite(rows[0].loudness)) throw new Error(`la canción descargada no guardó su loudness: ${JSON.stringify(rows)}`);
  // Red de main muerta: si el audio pasara por YouTube fallaría.
  await launch(['--proxy-server=127.0.0.1:9']);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.locator('.nav-item[title="Biblioteca"]').click();
  await page.waitForSelector('.tracklist__body .row', { timeout: 15000 });
  await page.locator('.tracklist__body .row .row__title').first().dblclick();
  await page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 20000 });
  const m = await measure(2500);
  if (!(m.peak > 0.05)) throw new Error(`pico ${m.peak.toFixed(3)} sonando del disco`);
  const want = expectedGain(rows[0].loudness);
  await waitFor(async () => Math.abs((await trackGain()) - want) < 0.02, 5000, `ganancia ≈${want.toFixed(3)} desde tracks.loudness (${rows[0].loudness} LUFS)`);
  return `pico ${m.peak.toFixed(2)} sin red; ${rows[0].loudness} LUFS → ×${want.toFixed(2)}`;
});

await app.close().catch(() => undefined);
rmSync(userData, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} paso(s) con fallas` : `\nTodos los pasos pasaron (${results.length})`);
process.exit(failed.length ? 1 : 0);
