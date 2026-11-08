import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type SpotapleBridge } from '../shared/api';

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

// Superficie explícita y limitada: el renderer no recibe ipcRenderer ni Node.
const bridge: SpotapleBridge = {
  music: {
    search: (q) => call(IPC.search, q),
    album: (id) => call(IPC.album, id),
    artist: (id) => call(IPC.artist, id),
    remotePlaylist: (id) => call(IPC.remotePlaylist, id),
    radio: (seed, excludeIds) => call(IPC.radio, { seed, excludeIds }),
    prepare: (id) => call(IPC.prepare, id),
    invalidate: (id) => call(IPC.invalidate, id),
    export: (track, format) => call(IPC.export, { track, format }),
  },
  offline: {
    state: () => call(IPC.offlineGet),
    sync: () => call(IPC.offlineSync),
    clear: () => call(IPC.offlineClear),
    // Un solo oyente; suscribirse otra vez reemplaza al anterior (igual que la sala).
    subscribe: (cb) => {
      ipcRenderer.removeAllListeners(IPC.offlineState);
      ipcRenderer.on(IPC.offlineState, (_e, state) => cb(state));
      return Promise.resolve({ ok: true, data: undefined });
    },
  },
  discover: {
    get: () => call(IPC.discoverGet),
    refresh: () => call(IPC.discoverRefresh),
    resetTaste: () => call(IPC.tasteReset),
  },
  library: {
    favorites: () => call(IPC.favorites),
    favoriteIds: () => call(IPC.favoriteIds),
    toggleFavorite: (t) => call(IPC.toggleFavorite, t),
    playlists: () => call(IPC.playlists),
    playlist: (id) => call(IPC.playlist, id),
    createPlaylist: (name) => call(IPC.createPlaylist, name),
    renamePlaylist: (id, name) => call(IPC.renamePlaylist, id, name),
    deletePlaylist: (id) => call(IPC.deletePlaylist, id),
    addToPlaylist: (id, tracks) => call(IPC.addToPlaylist, id, tracks),
    removeFromPlaylist: (id, itemId) => call(IPC.removeFromPlaylist, id, itemId),
    reorderPlaylist: (id, order) => call(IPC.reorderPlaylist, id, order),
    recentPlays: (n) => call(IPC.recentPlays, n),
    recordSelection: (t) => call(IPC.recordSelection, t),
    recordPlay: (t, auto) => call(IPC.recordPlay, t, auto),
  },
  state: {
    load: () => call(IPC.loadPlayerState),
    save: (s) => call(IPC.savePlayerState, s),
  },
  settings: {
    get: () => call(IPC.settingsGet),
    set: (patch) => call(IPC.settingsSet, patch),
  },
  jam: {
    create: (o) => call(IPC.jamCreate, o),
    join: (o) => call(IPC.jamJoin, o),
    leave: () => call(IPC.jamLeave),
    send: (msg) => call(IPC.jamSend, msg),
    view: () => call(IPC.jamView),
    // Único evento main→renderer: la vista de la sala. Un solo oyente; suscribirse otra vez reemplaza al anterior.
    subscribe: (cb) => {
      ipcRenderer.removeAllListeners(IPC.jamState);
      ipcRenderer.on(IPC.jamState, (_e, view) => cb(view));
      return Promise.resolve({ ok: true, data: undefined });
    },
  },
  platform: process.platform as 'win32' | 'darwin' | 'linux',
};

contextBridge.exposeInMainWorld('spotapleBridge', bridge);
