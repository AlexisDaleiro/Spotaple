import { IPC, type SpotapleBridge } from './api';
import type { IpcResult } from './types';

export function createBridge(
  call: <T>(channel: string, ...args: unknown[]) => Promise<IpcResult<T>>,
  subscribe: <T>(channel: string, callback: (value: T) => void) => Promise<IpcResult<void>>,
  platform: SpotapleBridge['platform'],
): SpotapleBridge {
  return {
    music: {
      search: (q) => call(IPC.search, q),
      copyLink: (id) => call(IPC.copyTrackLink, id),
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
      subscribe: (cb) => subscribe(IPC.offlineState, cb),
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
    updates: {
      state: () => call(IPC.updatesGet),
      check: () => call(IPC.updatesCheck),
      install: () => call(IPC.updatesInstall),
      subscribe: (cb) => subscribe(IPC.updatesState, cb),
    },
    jam: {
      relayStatus: () => call(IPC.jamRelayGet),
      prepareRelay: (accepted) => call(IPC.jamRelayPrepare, accepted),
      openRelayClaim: () => call(IPC.jamRelayClaim),
      activateRelay: () => call(IPC.jamRelayActivate),
      setRelayUrl: (url) => call(IPC.jamRelaySetUrl, url),
      subscribeRelay: (cb) => subscribe(IPC.jamRelayState, cb),
      create: (o) => call(IPC.jamCreate, o),
      join: (o) => call(IPC.jamJoin, o),
      leave: () => call(IPC.jamLeave),
      send: (msg) => call(IPC.jamSend, msg),
      view: () => call(IPC.jamView),
      // Único evento main→renderer: la vista de la sala. Un solo oyente; suscribirse otra vez reemplaza al anterior.
      subscribe: (cb) => subscribe(IPC.jamState, cb),
    },
    platform,
  };
}
