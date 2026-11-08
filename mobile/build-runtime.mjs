import { build } from 'vite';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = import.meta.dirname;
const android = resolve(root, 'modules/spotaple-runtime/android');
const assets = resolve(android, 'src/main/assets/spotaple');
const runtime = resolve(root, 'dist/node-runtime');
const name = 'nodejs-mobile-android-24.22.1-0.zip';
const archive = resolve(runtime, name);
const digest = 'd6fd9f610fe5d81fede8f0d400c5a62723247725a19831835f15abf4f0604250';

await build({ configFile: resolve(root, 'vite.config.mts') });
await build({
  configFile: false,
  root,
  ssr: { noExternal: true },
  build: {
    ssr: resolve(root, 'runtime.ts'),
    outDir: assets,
    emptyOutDir: false,
    target: 'node24',
    rolldownOptions: { output: { entryFileNames: 'runtime.cjs', format: 'cjs', codeSplitting: false } },
  },
});
await writeFile(resolve(assets, 'start.cjs'), "require('./runtime.cjs').runRuntime(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });\n");

if (!process.argv.includes('--web-only')) {
  await mkdir(runtime, { recursive: true });
  const contents = await readFile(archive).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!contents) {
    const response = await fetch(`https://github.com/fogtape/nodejs-mobile/releases/download/v24.22.1-0/${name}`);
    if (!response.ok) throw new Error(`No se pudo descargar Node para Android: HTTP ${response.status}`);
    const downloaded = Buffer.from(await response.arrayBuffer());
    verify(downloaded);
    await writeFile(archive, downloaded);
  } else {
    verify(contents);
  }
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'unzip',
    process.platform === 'win32' ? ['-xf', archive, '-C', runtime] : ['-oq', archive, '-d', runtime],
    { stdio: 'inherit' });
  const license = await fetch('https://raw.githubusercontent.com/nodejs/node/v24.22.1/LICENSE');
  if (!license.ok) throw new Error('No se pudo incluir la licencia de Node.js.');
  await writeFile(resolve(assets, 'NODE-LICENSE.txt'), await license.text());
}

function verify(buffer) {
  if (createHash('sha256').update(buffer).digest('hex') !== digest) {
    throw new Error('El archivo de Node para Android no coincide con el SHA-256 esperado.');
  }
}
