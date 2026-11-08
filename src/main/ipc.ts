import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/api';
import type { AudioFormat } from '../shared/offline';
import { parseSettings, type AppSettings } from '../shared/settings';
import type { IpcResult, PreparedAudio } from '../shared/types';
import type { Store } from './db/store';
import { exportTrack } from './export';
import type { Discover } from './music/discover';
import type { MusicProvider } from './music/provider';
import { classify, MusicError } from './music/youtube/errors';
import type { JamSession } from './jam/session';
import type { Offline } from './offline';
import { createLoudnessFill } from './loudness';
import { createRadio } from './music/radio';
import type { Updates } from './updates';
import { id, int, sanitizeExportRequest, sanitizePlayerState, sanitizeRadioRequest, sanitizeTrack, str } from './validate';

/** Solo la página de la propia app puede invocar el IPC. */
function trusted(e: IpcMainInvokeEvent, allowedOrigin: string | undefined) {
  const url = e.senderFrame?.url ?? '';
  const ok = allowedOrigin ? url.startsWith(allowedOrigin) : url.startsWith('file://');
  if (!ok) throw new MusicError('unknown', 'Origen no autorizado.');
}

export function registerIpc(deps: {
  store: Store;
  provider: MusicProvider;
  jam: JamSession;
  offline: Offline;
  discover: Discover;
  updates: Updates;
  /** La red del proceso local (net.fetch con el proxy del sistema), la misma que usa el protocolo de audio. */
  fetchImpl: typeof fetch;
  /** Diálogo «Guardar como» del sistema: devuelve la ruta elegida o null si se canceló. */
  pickSavePath: (suggestedName: string, format: AudioFormat) => Promise<string | null>;
  /** Se llama con los ajustes completos después de cada cambio (p. ej. para recolorear la ventana). */
  onSettings: (settings: AppSettings) => void;
  rendererOrigin?: string;
}) {
  const { store, provider, jam, offline, discover, updates, fetchImpl, pickSavePath, onSettings, rendererOrigin } = deps;
  const radio = createRadio({ source: provider, history: store });
  const fillLoudness = createLoudnessFill({ provider, store, enabled: () => store.getAppSettings().normalize });

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
  handle(IPC.remotePlaylist, (x: unknown) => provider.getPlaylist(id(x)));
  handle(IPC.radio, (o: unknown) => {
    const r = sanitizeRadioRequest(o);
    return radio.next(r.seed, r.excludeIds);
  });
  handle(IPC.prepare, async (x: unknown): Promise<PreparedAudio> => {
    const trackId = id(x);
    // Descargada: suena del disco, así que se responde sin pasar por YouTube (y por tanto sin red).
    const local = offline.local(trackId);
    // Bajada antes de «Normalizar»: sin loudness guardado, se completa una vez (ver loudness.ts).
    if (local) return { trackId, mimeType: local.mimeType, durationSec: local.durationSec, loudnessLkfs: store.trackLoudness(trackId) ?? (await fillLoudness(trackId)) };
    const a = await provider.resolveAudio(trackId, { newPlay: true });
    // Se guarda por si la canción se descarga después: del disco ya no hay a quién preguntarle.
    if (a.loudnessLkfs !== undefined) store.setLoudness(trackId, a.loudnessLkfs);
    return { trackId, mimeType: a.mimeType, durationSec: a.durationSec, loudnessLkfs: a.loudnessLkfs };
  });
  handle(IPC.invalidate, (x: unknown) => provider.invalidate(id(x)));
  handle(IPC.export, (o: unknown) => {
    const r = sanitizeExportRequest(o);
    return exportTrack({ offline, provider, fetchImpl, pickSavePath }, r.track, r.format);
  });

  handle(IPC.offlineGet, () => offline.state());
  handle(IPC.offlineSync, () => offline.reconcile());
  handle(IPC.offlineClear, () => offline.clear());

  // «Hecho para vos»: ninguno recibe argumentos; la generación corre en main y nunca bloquea la interfaz.
  handle(IPC.discoverGet, () => discover.get());
  handle(IPC.discoverRefresh, () => discover.refresh());
  handle(IPC.tasteReset, () => discover.reset());

  handle(IPC.favorites, () => store.favorites());
  handle(IPC.favoriteIds, () => store.favoriteIds());
  handle(IPC.toggleFavorite, (t: unknown) => {
    const track = sanitizeTrack(t);
    const now = store.toggleFavorite(track);
    // Favorita nueva → se descarga; quitada → se borra la descarga. No se espera: la respuesta no depende del disco.
    void offline.onFavorite(track.id, now);
    return now;
  });
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
  handle(IPC.recordPlay, (t: unknown, auto: unknown) => store.recordPlay(sanitizeTrack(t), auto === true));
  handle(IPC.loadPlayerState, () => store.loadPlayerState());
  handle(IPC.savePlayerState, (s: unknown) => store.savePlayerState(sanitizePlayerState(s)));

  handle(IPC.settingsGet, () => store.getAppSettings());
  handle(IPC.updatesGet, updates.state);
  handle(IPC.updatesCheck, updates.check);
  handle(IPC.updatesInstall, updates.install);
  handle(IPC.settingsSet, (raw: unknown) => {
    const patch = parseSettings(raw);
    const next = store.setAppSettings(patch);
    onSettings(next);
    // Encender o apagar la descarga automática: baja las favoritas que faltan o vacía la cola.
    if (patch.autoDownload !== undefined) void offline.reconcile();
    return next;
  });

  // Jam: el nombre y los mensajes de sala se validan dentro de la sesión; aquí solo la forma de los argumentos.
  handle(IPC.jamCreate, (o: unknown) => {
    const x = (o ?? {}) as { kind?: unknown; name?: unknown };
    if (x.kind !== 'local' && x.kind !== 'internet') throw new MusicError('unknown', 'Solicitud inválida.');
    return jam.create({ kind: x.kind, name: typeof x.name === 'string' ? x.name : '' });
  });
  handle(IPC.jamJoin, (o: unknown) => {
    const x = (o ?? {}) as { invite?: unknown; name?: unknown };
    return jam.join({ invite: str(x.invite, 200), name: typeof x.name === 'string' ? x.name : '' });
  });
  handle(IPC.jamLeave, () => jam.leave());
  handle(IPC.jamSend, (m: unknown) => jam.send(m));
  handle(IPC.jamView, () => jam.view());
}
