import { app, BrowserWindow, Menu, net, protocol, session, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIO_SCHEME } from '../shared/api';
import { buildCsp } from '../shared/csp';
import { createAudioHandler } from './audio-protocol';
import { createStore } from './db/store';
import { registerIpc } from './ipc';
import { withoutCredentials } from './net-fetch';
import { createYouTubeProvider } from './music/youtube/provider';

// Permite aislar los datos (pruebas e2e) sin tocar la biblioteca real del usuario.
if (process.env['SPOTAPLE_USER_DATA']) app.setPath('userData', process.env['SPOTAPLE_USER_DATA']);

protocol.registerSchemesAsPrivileged([
  { scheme: AUDIO_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
const isDev = Boolean(rendererUrl);
const BG = '#0e0f11';

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: BG,
    title: 'Spotaple',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // Misma altura que la barra superior de la interfaz (--title-h: 48px) para que los botones alineen.
    titleBarOverlay: { color: BG, symbolColor: '#b4b8c0', height: 48 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // El audio y el avance de cola no deben depender de que la ventana esté visible.
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Nada de ventanas nuevas ni navegación fuera de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!(rendererUrl && url.startsWith(rendererUrl))) e.preventDefault();
  });
  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });

  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // La política solo se aplica a las páginas de la app, no a lo que pidan YouTube.js o el audio.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const own = details.url.startsWith('file://') || (rendererUrl !== undefined && details.url.startsWith(rendererUrl));
    cb(own ? { responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [buildCsp(isDev)] } } : {});
  });

  const store = createStore(join(userData, 'spotaple.db'));
  // Toda la red del proceso local va por Chromium: respeta el proxy del sistema (PAC, autenticación
  // integrada) y los certificados de Windows. Sin proxy sale directo, igual que antes.
  const netFetch = withoutCredentials(net.fetch as unknown as typeof fetch);
  const provider = createYouTubeProvider({ cacheDir: join(userData, 'yt-cache'), fetch: netFetch });
  protocol.handle(AUDIO_SCHEME, createAudioHandler(provider, netFetch));
  registerIpc({ store, provider, rendererOrigin: rendererUrl });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('before-quit', () => store.close());
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
