// Relé del Jam en Node: empaqueta relay/src/node.ts con rolldown (ya viene con vite) y lo ejecuta aquí mismo.
//   npm run relay:node [-- puerto]        (8787 por defecto; también acepta PORT)
// Las apps se conectan con SPOTAPLE_JAM_RELAY=ws://<esta-pc>:<puerto>.
import { rolldown } from 'rolldown';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const out = join(root, '.relay', 'node.mjs');

const bundle = await rolldown({ input: join(root, 'relay', 'src', 'node.ts'), platform: 'node', external: ['ws', /^node:/] });
await bundle.write({ file: out, format: 'esm' });
await bundle.close();

await import(pathToFileURL(out).href);
