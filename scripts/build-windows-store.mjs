import { execFileSync } from 'node:child_process';
import { build, Arch, Platform } from 'electron-builder';

const preview = process.argv.includes('--preview');
const identityName = preview ? 'Spotaple.LocalTest' : process.env.SPOTAPLE_STORE_IDENTITY;
const publisher = preview ? 'CN=Spotaple Local Test' : process.env.SPOTAPLE_STORE_PUBLISHER;
const publisherDisplayName = preview ? 'Spotaple' : process.env.SPOTAPLE_STORE_PUBLISHER_DISPLAY_NAME;

if (!identityName || !/^[A-Za-z0-9.-]{3,50}$/.test(identityName) || !publisher || !publisherDisplayName) {
  throw new Error('Completá SPOTAPLE_STORE_IDENTITY, SPOTAPLE_STORE_PUBLISHER y SPOTAPLE_STORE_PUBLISHER_DISPLAY_NAME con los valores de Partner Center.');
}

execFileSync(process.execPath, ['scripts/prepare-relay.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'], { stdio: 'inherit' });
await build({
  targets: Platform.WINDOWS.createTarget(['appx'], Arch.x64),
  publish: 'never',
  config: {
    publish: null,
    directories: { output: 'release/microsoft-store' },
    appx: {
      applicationId: 'Spotaple',
      identityName,
      publisher,
      publisherDisplayName,
      languages: ['es'],
      displayName: 'Spotaple',
      artifactName: preview ? 'Spotaple-LocalTest-${version}-${arch}.msix' : 'Spotaple-Store-${version}-${arch}.msix',
    },
  },
});
