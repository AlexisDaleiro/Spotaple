import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AUDIO_FORMATS, type AudioFormat, type OfflineState } from '../shared/offline';
import type { Store } from './db/store';
import { DownloadLimitError, downloadTo } from './download';
import type { MusicProvider } from './music/provider';

export interface OfflineDeps {
  /** `userData/offline`. */
  dir: string;
  store: Pick<Store, 'favoriteIds' | 'isFavorite' | 'downloads' | 'addDownload' | 'removeDownload' | 'clearDownloads' | 'trackDuration' | 'setLoudness'>;
  provider: MusicProvider;
  fetchImpl: typeof fetch;
  /** Ajuste «descargar las favoritas automáticamente»; se lee en cada decisión. */
  enabled: () => boolean;
  /** Se llama con el estado completo tras cada cambio (no por byte). */
  emit: (state: OfflineState) => void;
  concurrency?: number;
  maxBytes?: () => number;
}

export type Offline = ReturnType<typeof createOffline>;

const removeFile = (file: string) => rm(file, { force: true }).catch(() => undefined);

/**
 * Las favoritas que se guardan en el disco para escucharlas sin internet. El índice vive en la tabla `downloads` y en
 * memoria (`local` lo consulta en cada pedido de audio); los archivos, en `dir`. Invariante: solo las favoritas
 * tienen descarga; lo demás lo limpia `reconcile`. Las descargas son siempre Opus de calidad Alta.
 */
export function createOffline(d: OfflineDeps) {
  const concurrency = d.concurrency ?? 2;
  const index = new Map<string, { format: AudioFormat; bytes: number }>();
  for (const r of d.store.downloads()) index.set(r.trackId, { format: r.format, bytes: r.bytes });
  let bytes = [...index.values()].reduce((total, entry) => total + entry.bytes, 0);
  let limited = false;
  let priority = 0;
  const available = () => (d.maxBytes?.() ?? Infinity) - bytes;
  const pending = new Set<string>();
  const active = new Map<string, AbortController>();
  const failed = new Set<string>();
  const idleWaiters: (() => void)[] = [];
  /** Sube con `clear()`: una descarga que empezó antes ya no vale y se descarta al terminar. */
  let epoch = 0;
  let clearing: Promise<void> | undefined;

  const fileOf = (id: string, format: AudioFormat) => join(d.dir, `${id}.${AUDIO_FORMATS[format].ext}`);

  function state(): OfflineState {
    return {
      ids: [...index.keys()], pending: pending.size + active.size, failed: failed.size, bytes,
      ...(limited && { limited: true }),
    };
  }
  const notify = () => d.emit(state());

  /** Qué archivo suena para esta canción (sin tocar el disco: si falta, el protocolo cae a la red y `reconcile` lo corrige). */
  function local(id: string): { file: string; mimeType: string; durationSec?: number } | null {
    const e = index.get(id);
    if (!e) return null;
    return { file: fileOf(id, e.format), mimeType: AUDIO_FORMATS[e.format].mime, durationSec: d.store.trackDuration(id) };
  }

  function pump() {
    if (pending.size && available() <= 0) {
      limited = true;
      pending.clear();
    }
    while (!clearing && priority === 0 && d.enabled() && active.size < concurrency && pending.size) {
      const id = [...pending].find((entry) => !active.has(entry));
      if (id === undefined) break;
      pending.delete(id);
      if (!d.store.isFavorite(id)) continue;
      const controller = new AbortController();
      active.set(id, controller);
      void run(id, controller.signal);
    }
    if (!active.size && !pending.size) idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  async function run(id: string, signal: AbortSignal) {
    const startedIn = epoch;
    try {
      const out = await downloadTo({
        provider: d.provider, fetchImpl: d.fetchImpl, id, variant: 'high',
        destFor: (f) => fileOf(id, f), maxBytes: available(), signal,
      });
      // Pudo dejar de ser favorita (o la persona borró todo) mientras bajaba: el archivo ya no se quiere.
      if (startedIn !== epoch || signal.aborted || !d.enabled() || !d.store.isFavorite(id)) {
        await removeFile(out.dest);
        return;
      }
      if (out.bytes > available()) {
        limited = true;
        await removeFile(out.dest);
        return;
      }
      d.store.addDownload(id, out.format, out.bytes);
      if (out.loudnessLkfs !== undefined) d.store.setLoudness(id, out.loudnessLkfs);
      index.set(id, { format: out.format, bytes: out.bytes });
      bytes += out.bytes;
    } catch (error) {
      if (startedIn === epoch && !signal.aborted) {
        if (error instanceof DownloadLimitError) limited = true;
        else failed.add(id);
      }
    } finally {
      active.delete(id);
      if (signal.aborted && startedIn === epoch && d.enabled() && d.store.isFavorite(id)) enqueue(id);
      pump();
      notify();
    }
  }

  function enqueue(id: string) {
    const download = active.get(id);
    if (index.has(id) || (download && !download.signal.aborted)) return;
    failed.delete(id);
    pending.add(id);
  }

  /** Olvida la descarga: primero el índice (el protocolo deja de servirla) y después el archivo, sin fallar si está en uso. */
  async function forget(id: string) {
    const e = index.get(id);
    index.delete(id);
    d.store.removeDownload(id);
    if (e) {
      bytes -= e.bytes;
      await removeFile(fileOf(id, e.format));
    }
  }

  /** Avisa que la canción pasó a ser (o dejó de ser) favorita; `toggleFavorite` ya la guardó o quitó en la base. */
  async function onFavorite(id: string, isFavorite: boolean) {
    if (isFavorite) {
      failed.delete(id);
      if (d.enabled()) enqueue(id);
      pump();
      notify();
      return;
    }
    pending.delete(id);
    active.get(id)?.abort();
    failed.delete(id);
    await forget(id);
    if (limited && d.enabled() && available() > 0) return reconcile();
    pump();
    notify();
  }

  /**
   * Pone el disco, el índice y la cola de acuerdo con las favoritas (al abrir la app, al volver la red y al cambiar el
   * ajuste): borra `.part`, archivos sueltos y descargas de canciones que ya no son favoritas; quita las filas cuyo
   * archivo falta; y baja las favoritas que no tienen archivo (si el ajuste está activo).
   */
  async function reconcile() {
    const startedIn = epoch;
    await clearing;
    await mkdir(d.dir, { recursive: true });
    const favorites = new Set(d.store.favoriteIds());
    const previouslyIndexed = [...index];
    const names = await readdir(d.dir);
    if (startedIn !== epoch) return;
    const present = new Set(names);
    const keep = new Set<string>();
    for (const [id, e] of index) if (favorites.has(id)) keep.add(basename(fileOf(id, e.format)));
    const busy = [...active.keys()];
    for (const name of names) {
      if (keep.has(name) || busy.some((id) => name.startsWith(`${id}.`))) continue;
      await removeFile(join(d.dir, name));
      if (startedIn !== epoch) return;
    }
    for (const [id, e] of previouslyIndexed) {
      if (index.get(id) !== e || active.has(id)) continue;
      if ((!favorites.has(id) && !d.store.isFavorite(id)) || !present.has(basename(fileOf(id, e.format)))) {
        index.delete(id);
        bytes -= e.bytes;
        d.store.removeDownload(id);
      }
    }
    failed.clear();
    limited = false;
    if (d.enabled()) for (const id of favorites) enqueue(id);
    else {
      pending.clear();
      for (const controller of active.values()) controller.abort();
    }
    pump();
    notify();
  }

  /** «Borrar todas las descargas»: vacía la cola, borra todo y descarta lo que esté bajando. */
  async function clear() {
    epoch++;
    const clearingEpoch = epoch;
    pending.clear();
    for (const controller of active.values()) controller.abort();
    const entries = [...index];
    index.clear();
    bytes = 0;
    limited = false;
    d.store.clearDownloads();
    const previous = clearing;
    clearing = (async () => {
      await previous;
      await Promise.all(entries.map(([id, e]) => removeFile(fileOf(id, e.format))));
    })();
    await clearing;
    if (clearingEpoch !== epoch) return;
    clearing = undefined;
    failed.clear();
    pump();
    notify();
  }

  /** Se resuelve cuando no queda cola ni descargas en curso. */
  const idle = (): Promise<void> => (pending.size || active.size ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve());

  async function prioritize<T>(operation: () => Promise<T>): Promise<T> {
    priority++;
    try {
      return await operation();
    } finally {
      priority--;
      pump();
      notify();
    }
  }

  return { local, state, onFavorite, reconcile, clear, idle, prioritize };
}
