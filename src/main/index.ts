import { app, BrowserWindow, dialog, Menu, nativeTheme, net, protocol, session, shell } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import updater from 'electron-updater';
import { AUDIO_SCHEME, IPC } from '../shared/api';
import { buildCsp } from '../shared/csp';
import { AUDIO_FORMATS, type AudioFormat } from '../shared/offline';
import type { AppSettings } from '../shared/settings';
import { JAM_RELAY_URL } from '../shared/jam/config';
import { createAudioHandler } from './audio-protocol';
import { applyChrome, prepareChrome, TITLE_BAR_HEIGHT } from './chrome';
import { createStore } from './db/store';
import { registerIpc } from './ipc';
import { createJamSession } from './jam/session';
import { createRelaySetup } from './jam/relay-setup';
import { withoutCredentials } from './net-fetch';
import { createDiscover } from './music/discover';
import { createOffline } from './offline';
import { createYouTubeProvider } from './music/youtube/provider';
import { createUpdates } from './updates';

// Permite aislar los datos (pruebas e2e) sin tocar la biblioteca real del usuario.
if (process.env['SPOTAPLE_USER_DATA']) app.setPath('userData', process.env['SPOTAPLE_USER_DATA']);

protocol.registerSchemesAsPrivileged([
  // `corsEnabled`: el <audio> pide el archivo con crossOrigin="anonymous"; sin eso Web Audio (ecualizador) emite silencio.
  { scheme: AUDIO_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
const isDev = Boolean(rendererUrl);
const isMac = process.platform === 'darwin';

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow(settings: AppSettings) {
  // Con los colores del tema guardado desde el primer cuadro: sin destello del tema equivocado al abrir.
  const chrome = prepareChrome(settings);
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: chrome.bg,
    title: 'Spotaple',
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? true : { color: chrome.bg, symbolColor: chrome.symbol, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // El audio y el avance de cola no deben depender de que la ventana esté visible.
      backgroundThrottling: false,
      // «Reanudar al abrir» necesita poder reproducir sin un gesto previo del usuario.
      autoplayPolicy: 'no-user-gesture-required',
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
  let lastRecovery = 0;
  win.webContents.on('render-process-gone', (_event, { reason }) => {
    if (reason === 'clean-exit') return;
    // Deja que Electron termine de cerrar el proceso antes de recargar la ventana.
    setImmediate(async () => {
      if (win.isDestroyed()) return;
      if (Date.now() - lastRecovery < 60_000) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'error',
          title: 'Spotaple',
          message: 'Spotaple se cerró inesperadamente.',
          buttons: ['Volver a abrir', 'Cerrar'],
          cancelId: 1,
        });
        if (win.isDestroyed()) return;
        if (response === 1) {
          win.close();
          return;
        }
      }
      lastRecovery = Date.now();
      win.webContents.reload();
    });
  });
  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}

/** Diálogo «Guardar como» de «Descargar canción»: devuelve la ruta elegida, o null si se canceló. */
async function pickSavePath(suggestedName: string, format: AudioFormat): Promise<string | null> {
  const options = {
    defaultPath: join(app.getPath('downloads'), suggestedName),
    filters: [{ name: AUDIO_FORMATS[format].label, extensions: [AUDIO_FORMATS[format].ext] }],
  };
  const win = BrowserWindow.getFocusedWindow();
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return res.canceled || !res.filePath ? null : res.filePath;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]) : null);
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
  const provider = createYouTubeProvider({
    cacheDir: join(userData, 'yt-cache'),
    fetch: netFetch,
    getQuality: () => store.getAppSettings().streamQuality,
  });
  // Las favoritas se guardan en userData/offline y suenan sin red: el protocolo de audio sirve primero el archivo local.
  const offline = createOffline({
    dir: join(userData, 'offline'),
    store,
    provider,
    fetchImpl: netFetch,
    enabled: () => store.getAppSettings().autoDownload,
    maxBytes: () => store.getAppSettings().offlineLimitMiB * 1024 * 1024,
    emit: (state) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.offlineState, state)),
  });
  protocol.handle(AUDIO_SCHEME, createAudioHandler(provider, netFetch, offline.local));
  // La red del jam vive aquí, no en el renderer: la CSP de la interfaz sigue sin permitir conexiones directas.
  const relayOverride = process.env['SPOTAPLE_JAM_RELAY'];
  const jamRelay = createRelaySetup({
    source: app.isPackaged ? join(process.resourcesPath, 'jam-relay') : app.getAppPath(),
    stored: store.getSetting('jam_relay_url'),
    override: relayOverride,
    save: (url) => store.setSetting('jam_relay_url', url),
    emit: (status) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.jamRelayState, status)),
    open: (url) => shell.openExternal(url),
    fetch: netFetch,
  });
  const jam = createJamSession({
    settings: { get: <V>(key: string) => store.getSetting<V>(key), set: (key, value) => store.setSetting(key, value) },
    relayUrl: relayOverride ?? JAM_RELAY_URL,
    hostRelayUrl: relayOverride ? undefined : jamRelay.url,
    emit: (view) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.jamState, view)),
  });
  const leaveJamOnQuit = () => jam.leave({ quit: true }).catch(() => undefined);
  // El instalador NSIS lleva un feed. El portable y los builds --dir se actualizan manualmente.
  const canUpdate = process.platform === 'win32' && app.isPackaged && !process.windowsStore && !process.env['PORTABLE_EXECUTABLE_FILE'] &&
    existsSync(join(process.resourcesPath, 'app-update.yml'));
  const updates = createUpdates(
    canUpdate ? updater.autoUpdater : null,
    (state) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.updatesState, state)),
    leaveJamOnQuit,
    process.windowsStore === true,
  );
  registerIpc({
    store,
    provider,
    jam,
    jamRelay,
    offline,
    updates,
    // «Hecho para vos»: se apaga con el ajuste; la generación es perezosa (la pide Inicio) y por período.
    discover: createDiscover({ source: provider, store, enabled: () => store.getAppSettings().forYou }),
    fetchImpl: netFetch,
    pickSavePath: (suggestedName: string, format: AudioFormat) => pickSavePath(suggestedName, format),
    // Cada cambio de ajustes recolorea la ventana nativa (la interfaz se actualiza sola en el renderer).
    onSettings: (s) => BrowserWindow.getAllWindows().forEach((w) => applyChrome(w, s)),
    rendererOrigin: rendererUrl,
  });
  // Pone el disco al día con las favoritas (borra restos, baja las que faltan) sin demorar la apertura de la ventana.
  void offline.reconcile().catch(() => undefined);
  // «Sistema» sigue al sistema operativo con la app abierta: la barra de título nativa se vuelve a pintar.
  nativeTheme.on('updated', () => {
    const settings = store.getAppSettings();
    if (settings.theme === 'system') BrowserWindow.getAllWindows().forEach((w) => applyChrome(w, settings));
  });

  createWindow(store.getAppSettings());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(store.getAppSettings());
  });
  // Antes de cerrar, el admin de una sala local la cierra para que los miembros vean "La sala terminó".
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    void Promise.all([leaveJamOnQuit(), jamRelay.stop()]).finally(() => {
      store.close();
      app.quit();
    });
  });
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
