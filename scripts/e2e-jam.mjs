// Prueba real del modo Jam con DOS instancias de Electron (admin y miembro, carpetas de datos distintas)
// y música de verdad. Requiere `npm run build` e internet.
//   JAM_KIND=local (por defecto) | internet      tipo de sala
//   SPOTAPLE_JAM_RELAY=ws://127.0.0.1:8788       relé al que apuntan las dos instancias en modo internet
// Cada instancia se silencia para no sonar dos veces en el mismo parlante.
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';

const KIND = process.env.JAM_KIND === 'internet' ? 'internet' : 'local';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
// ONLY=J3 ejecuta solo los pasos cuyo nombre empieza así (los pasos dependen unos de otros: úsalo para diagnosticar).
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
    // E2E_VERBOSE=1: qué ven las dos apps en el momento de fallar (para diagnosticar sin adivinar).
    if (process.env.E2E_VERBOSE) console.log('      ', JSON.stringify(await snapshot().catch((err) => String(err))));
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

const dirs = [];
async function launch(userData = mkdtempSync(join(tmpdir(), 'spotaple-e2e-jam-'))) {
  if (!dirs.includes(userData)) dirs.push(userData);
  const exe = process.env.SPOTAPLE_EXE;
  const app = await electron.launch({
    executablePath: exe ?? electronPath,
    args: exe ? [] : ['.'],
    env: { ...process.env, SPOTAPLE_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.waitForSelector('.titlebar');
  await page.locator('button[aria-label="Silenciar"]').click();
  return { app, page, dir: userData };
}

/** Llama al puente de la app (devuelve el dato o lanza con el mensaje que vería la persona). */
const call = async (page, path, arg) => {
  const r = await page.evaluate(([p, a]) => p.split('.').reduce((o, k) => o[k], window.spotapleBridge)(a), [path, arg]);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
};
const view = (page) => call(page, 'jam.view');
const send = (page, msg) => call(page, 'jam.send', msg);
const label = (page) => page.locator('.play-btn').getAttribute('aria-label');
/** Posición mostrada en la barra (m:ss): resolución de 1 s. */
const position = async (page) => {
  const parts = (await page.locator('.progress__time').first().innerText()).split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};
const mara = (st) => st?.members.find((m) => m.name === 'Mara');
async function snapshot() {
  const one = async (x) => {
    const v = await view(x.page);
    return {
      status: v.status,
      reason: v.reason,
      mode: v.state?.mode,
      now: v.state?.now ? `${v.state.now.item.track.title} (${v.state.now.status})` : null,
      queue: v.state?.queue.length,
      members: v.state?.members.map((m) => `${m.name}${m.connected ? '' : ' (desconectada)'}: ${m.likesReceived} likes`),
      boton: await label(x.page),
      titulo: await x.page.locator('.player__title').allInnerTexts(),
      error: await x.page.locator('.player__error-msg').allInnerTexts(),
    };
  };
  return { admin: await one(A), miembro: await one(B) };
}

let A = await launch();
let B = await launch();
let invite;
let songs;

await step(`J1. el admin crea la sala (${KIND}) y el miembro se une con la invitación`, async () => {
  const created = await call(A.page, 'jam.create', { kind: KIND, name: 'Ana' });
  // Las dos instancias están en esta PC: se conecta por loopback para no depender de un firewall (eso lo cubre check:jam).
  invite = KIND === 'local' ? created.invite.replace(/^[^:]+/, '127.0.0.1') : created.invite;
  await call(B.page, 'jam.join', { invite, name: 'Mara' });
  await waitFor(async () => (await view(A.page)).state?.members.length === 2, 5000, 'el admin ve a 2 miembros');
  return `invitación ${invite}`;
});

await step('J2. Mara pide una canción: llega al admin en ≤ 3 s y suena solo en la PC del admin', async () => {
  songs = (await call(B.page, 'music.search', 'Daft Punk One More Time')).songs.slice(0, 2);
  if (songs.length < 2) throw new Error('la búsqueda no devolvió 2 canciones');
  await send(B.page, { t: 'queue.add', track: songs[0] });
  await waitFor(async () => (await view(A.page)).state?.now?.item.track.id === songs[0].id, 3000, 'la canción llega al admin');
  await waitFor(async () => (await label(A.page)) === 'Pausar', 60000, 'suena en la PC del admin');
  if ((await B.page.locator('.player__title').count()) !== 0) throw new Error('la PC del miembro cargó la canción en modo "Solo admin"');
  if ((await label(B.page)) !== 'Reproducir') throw new Error('la PC del miembro está sonando en modo "Solo admin"');
  return songs[0].title;
});

await step('J3. segunda canción en cola y like: el contador de Mara suma 1', async () => {
  await send(B.page, { t: 'queue.add', track: songs[1] });
  await send(B.page, { t: 'like.toggle' });
  await waitFor(async () => {
    const st = (await view(A.page)).state;
    return st.queue.length === 1 && mara(st)?.likesReceived === 1;
  }, 4000, 'cola de 1 y 1 like para Mara');
});

await step('J4. el admin pasa a la siguiente: suena la 2.ª y el like se conserva', async () => {
  await send(A.page, { t: 'transport', action: 'next' });
  await waitFor(async () => (await view(A.page)).state?.now?.item.track.id === songs[1].id, 3000, 'la sala pasa a la 2.ª');
  await waitFor(async () => (await A.page.locator('.player__title').innerText()) === songs[1].title, 60000, 'el reproductor del admin muestra la 2.ª');
  if (mara((await view(A.page)).state)?.likesReceived !== 1) throw new Error('el like de Mara no se conservó');
});

await step('J5. modo "Todas": el reproductor de Mara suena y queda a ≤ 2 s del admin', async () => {
  await send(A.page, { t: 'mode.set', mode: 'everyone' });
  await waitFor(async () => (await label(B.page)) === 'Pausar', 90000, 'suena en la PC de Mara');
  await sleep(7000); // da tiempo a una corrección de desvío (cada ~5 s)
  const [a, b] = await Promise.all([position(A.page), position(B.page)]);
  // La barra muestra segundos enteros: un desvío real de hasta 1,5 s puede verse como 2. La meta de 0,5 s la cubren las pruebas unitarias.
  if (Math.abs(a - b) > 2) throw new Error(`desvío de ${Math.abs(a - b)} s (admin ${a} s, Mara ${b} s)`);
  return `admin ${a} s · Mara ${b} s`;
});

await step('J6. Mara cierra su app, la reabre y se une de nuevo: sigue siendo 1 miembro con su like', async () => {
  const dir = B.dir;
  await B.app.close();
  B = await launch(dir);
  await call(B.page, 'jam.join', { invite, name: 'Mara' });
  await waitFor(async () => {
    const st = (await view(A.page)).state;
    return st.members.length === 2 && mara(st)?.connected && mara(st)?.likesReceived === 1;
  }, 8000, '2 miembros, Mara conectada y con su like');
});

await step(`J7. el admin sale: ${KIND === 'local' ? 'la sala local termina' : 'Mara pasa a admin'}`, async () => {
  await call(A.page, 'jam.leave');
  if (KIND === 'local') {
    await waitFor(async () => (await view(B.page)).status === 'ended', 8000, 'la sala local termina para Mara');
    return `motivo: ${(await view(B.page)).reason}`;
  }
  await waitFor(async () => {
    const v = await view(B.page);
    return v.state?.adminId === v.selfId;
  }, 8000, 'Mara pasa a admin');
});

await step('J8. por la interfaz: crear sala, unirse con la invitación y cambiar dónde suena', async () => {
  await call(B.page, 'jam.leave');
  await A.page.locator('.nav-item[title="Jam"]').click();
  await A.page.locator('.jam-name input').fill('Ana');
  if (KIND === 'internet') await A.page.locator('.jam-kind__opt', { hasText: 'Internet' }).click();
  await A.page.locator('.jam-card .btn', { hasText: 'Crear sala' }).click();
  await A.page.waitForSelector('.jam-panel', { timeout: 10000 });
  const shown = await A.page.locator('.jam-invite__input').inputValue();
  invite = KIND === 'local' ? shown.replace(/^[^:]+/, '127.0.0.1') : shown;
  await B.page.locator('.nav-item[title="Jam"]').click();
  await B.page.locator('.jam-name input').fill('Mara');
  await B.page.locator('.jam-card input[placeholder^="K7M2P"]').fill(invite);
  await B.page.locator('.jam-card .btn', { hasText: 'Unirse' }).click();
  await B.page.waitForSelector('.jam-panel', { timeout: 10000 });
  await waitFor(async () => (await A.page.locator('.jam-member').count()) === 2, 5000, 'el panel del admin lista a 2 miembros');
  const sw = A.page.locator('.jam-switch[role="switch"]');
  // La sala arranca en el último modo que usó el admin (jam_last_mode), así que se verifica que el switch lo invierta.
  const before = (await sw.getAttribute('aria-checked')) === 'true';
  await sw.click();
  await waitFor(async () => ((await sw.getAttribute('aria-checked')) === 'true') === !before, 4000, 'el switch cambia de modo');
  await waitFor(async () => (await B.page.locator('.jam-switch').innerText()).includes(before ? 'la PC del admin' : 'todas las PCs'), 4000, 'Mara ve dónde suena ahora');
  return `${before ? 'Todas' : 'Solo admin'} → ${before ? 'Solo admin' : 'Todas'}`;
});

for (const x of [A, B]) await x.app.close().catch(() => undefined);
for (const d of dirs) rmSync(d, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pasos OK`);
process.exit(failed.length ? 1 : 0);
