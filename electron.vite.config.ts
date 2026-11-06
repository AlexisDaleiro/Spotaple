import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { buildCsp } from './src/shared/csp';

const shared = resolve(import.meta.dirname, 'src/shared');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts') } } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        // El preload con sandbox:true debe ser CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared, '@': resolve(import.meta.dirname, 'src/renderer/src') } },
    plugins: [
      react(),
      // En el build la página se carga con file://, donde no hay cabeceras: la política va en un <meta>.
      {
        name: 'spotaple-csp-meta',
        apply: 'build',
        transformIndexHtml: () => [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp(false) }, injectTo: 'head-prepend' },
        ],
      },
    ],
    build: { rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') } },
  },
});
