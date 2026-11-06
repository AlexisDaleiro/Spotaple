// Auditoría de accesibilidad automática (axe-core, WCAG 2.2 A/AA) sobre las pantallas principales.
// Complementa —no reemplaza— una revisión manual con lector de pantalla. Requiere `npm run build` e internet.
import { _electron as electron } from 'playwright-core';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userData = mkdtempSync(join(tmpdir(), 'spotaple-a11y-'));
const app = await electron.launch({ executablePath: electronPath, args: ['.'], env: { ...process.env, SPOTAPLE_USER_DATA: userData } });
const page = await app.firstWindow();
await page.waitForSelector('.titlebar');
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
await sleep(500);

let total = 0;
async function audit(name) {
  await sleep(700);
  await page.evaluate(axeSource);
  const res = await page.evaluate(() =>
    // eslint-disable-next-line no-undef
    axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }),
  );
  const v = res.violations;
  total += v.length;
  console.log(`${v.length ? 'FAIL' : 'PASS'}  ${name} — ${res.passes.length} reglas OK, ${v.length} con problemas`);
  for (const x of v) {
    console.log(`   · [${x.impact}] ${x.id}: ${x.help} (${x.nodes.length} nodos)`);
    for (const n of x.nodes.slice(0, 3)) console.log(`       ${n.target.join(' ')} → ${String(n.failureSummary).split('\n')[1]?.trim() ?? ''}`);
  }
}

await audit('Inicio vacío');
await page.locator('input[aria-label^="Buscar"]').fill('Daft Punk One More Time');
await page.waitForSelector('.tracklist__body .row', { timeout: 30000 });
await audit('Resultados de búsqueda');
await page.locator('.tracklist__body .row .row__title').first().dblclick();
await page.waitForSelector('.play-btn[aria-label="Pausar"]', { timeout: 30000 });
await page.locator('button[aria-label="Mostrar la cola"]').click();
await page.waitForSelector('.queue .qrow');
await audit('Búsqueda + cola + reproduciendo');
await page.locator('.nav-item[title="Playlists"]').click();
await audit('Playlists vacío');
await page.locator('.btn', { hasText: 'Nueva playlist' }).first().click();
await page.waitForSelector('.dialog');
await audit('Diálogo nueva playlist');
await page.keyboard.press('Escape');
await page.locator('.tracklist__body .row').count().catch(() => 0);
await page.locator('.nav-item[title="Inicio"]').click();
await page.locator('input[aria-label^="Buscar"]').fill('Daft Punk');
await page.waitForSelector('.card', { timeout: 30000 });
await page.locator('.card__body', { hasText: 'Álbum' }).first().click();
await page.waitForSelector('.hero__title');
await page.waitForSelector('.tracklist__body .row');
await audit('Página de álbum');

await app.close();
rmSync(userData, { recursive: true, force: true });
console.log(total ? `\n${total} problemas de accesibilidad detectados` : '\nSin problemas detectados por axe-core');
process.exit(total ? 1 : 0);
