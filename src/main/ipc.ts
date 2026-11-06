import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/api';
import type { IpcResult, PreparedAudio } from '../shared/types';
import type { Store } from './db/store';
import type { MusicProvider } from './music/provider';
import { classify, MusicError } from './music/youtube/errors';
import { id, int, sanitizePlayerState, sanitizeTrack, str } from './validate';

/** Solo la página de la propia app puede invocar el IPC. */
function trusted(e: IpcMainInvokeEvent, allowedOrigin: string | undefined) {
  const url = e.senderFrame?.url ?? '';
  const ok = allowedOrigin ? url.startsWith(allowedOrigin) : url.startsWith('file://');
  if (!ok) throw new MusicError('unknown', 'Origen no autorizado.');
}

export function registerIpc(deps: { store: Store; provider: MusicProvider; rendererOrigin?: string }) {
  const { store, provider, rendererOrigin } = deps;

  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) => {
    ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<R>> => {
      try {
        trusted(event, rendererOrigin);
        return { ok: true, data: await fn(...(args as A)) };
      } catch (e) {
        const err = classify(e);
        // Los errores de validación/base de datos llevan su propio mensaje en español.
        const message = err.code === 'unknown' && e instanceof Error && !(e instanceof MusicError) ? e.message : err.message;
        return { ok: false, error: { code: err.code, message } };
      }
    });
  };

  handle(IPC.search, (q: unknown) => provider.search(str(q, 200).trim() || str('', 1)));
  handle(IPC.album, (x: unknown) => provider.getAlbum(id(x)));
  handle(IPC.artist, (x: unknown) => provider.getArtist(id(x)));
  handle(IPC.prepare, async (x: unknown): Promise<PreparedAudio> => {
    const trackId = id(x);
    const a = await provider.resolveAudio(trackId);
    return { trackId, mimeType: a.mimeType, durationSec: a.durationSec };
  });
  handle(IPC.invalidate, (x: unknown) => provider.invalidate(id(x)));

  handle(IPC.favorites, () => store.favorites());
  handle(IPC.favoriteIds, () => store.favoriteIds());
  handle(IPC.toggleFavorite, (t: unknown) => store.toggleFavorite(sanitizeTrack(t)));
  handle(IPC.playlists, () => store.playlists());
  handle(IPC.playlist, (x: unknown) => store.playlist(int(x)));
  handle(IPC.createPlaylist, (n: unknown) => store.createPlaylist(str(n, 400)));
  handle(IPC.renamePlaylist, (x: unknown, n: unknown) => store.renamePlaylist(int(x), str(n, 400)));
  handle(IPC.deletePlaylist, (x: unknown) => store.deletePlaylist(int(x)));
  handle(IPC.addToPlaylist, (x: unknown, ts: unknown) => {
    if (!Array.isArray(ts) || ts.length === 0 || ts.length > 500) throw new MusicError('unknown', 'Solicitud inválida.');
    return store.addToPlaylist(int(x), ts.map(sanitizeTrack));
  });
  handle(IPC.removeFromPlaylist, (x: unknown, item: unknown) => store.removeFromPlaylist(int(x), int(item)));
  handle(IPC.reorderPlaylist, (x: unknown, order: unknown) => {
    if (!Array.isArray(order) || order.length > 5000) throw new MusicError('unknown', 'Solicitud inválida.');
    return store.reorderPlaylist(int(x), order.map(int));
  });
  handle(IPC.recentPlays, (n: unknown) => store.recentPlays(Math.min(100, Math.max(1, int(n)))));
  handle(IPC.recordSelection, (t: unknown) => store.recordSelection(sanitizeTrack(t)));
  handle(IPC.recordPlay, (t: unknown) => store.recordPlay(sanitizeTrack(t)));
  handle(IPC.loadPlayerState, () => store.loadPlayerState());
  handle(IPC.savePlayerState, (s: unknown) => store.savePlayerState(sanitizePlayerState(s)));
}
