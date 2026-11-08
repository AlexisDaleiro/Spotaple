import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const root = import.meta.dirname;
const { version } = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo;

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  resolve: { alias: {
    '@shared': resolve(root, '../src/shared'),
    react: resolve(root, '../node_modules/react'),
    'react-dom': resolve(root, '../node_modules/react-dom'),
  } },
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: resolve(root, 'modules/spotaple-runtime/android/src/main/assets/spotaple/renderer'),
    emptyOutDir: true,
    target: 'chrome120',
  },
});
