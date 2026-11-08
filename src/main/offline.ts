import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AUDIO_FORMATS, type AudioFormat, type OfflineState } from '../shared/offline';
import type { Store } from './db/store';
import { downloadTo } from './download';
import type { MusicProvider } from './music/provider';

export interface OfflineDeps {
  /** `userData/offline`. */
  dir: string;
  store: Pick<Store, 'favoriteIds' | 'downloads' | 'addDownload' | 'removeDownload' | 'clearDownloads' | 'trackDuration' | 'setLoudness'>;
  provider: MusicProvider;
  fetchImpl: typeof fetch;
  /** Ajuste «descargar las favoritas automáticamente»; se lee en cada decisión. */
  enabled: () => boolean;
  /** Se llama con el estado completo tras cada cambio (no por byte). */
  emit: (state: OfflineState) => void;
  concurrency?: number;
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
  const pending: string[] = [];
  const active = new Set<string>();
  const failed = new Set<string>();
  const idleWaiters: (() => void)[] = [];
  /** Sube con `clear()`: una descarga que empezó antes ya no vale y se descarta al terminar. */
  let epoch = 0;

  const fileOf = (id: string, format: AudioFormat) => join(d.dir, `${id}.${AUDIO_FORMATS[format].ext}`);

  function state(): OfflineState {
    let bytes = 0;
    for (const e of index.values()) bytes += e.bytes;
    return { ids: [...index.keys()], pending: pending.length + active.size, failed: failed.size, bytes };
  }
  const notify = () => d.emit(state());

  /** Qué archivo suena para esta canción (sin tocar el disco: si falta, el protocolo cae a la red y `reconcile` lo corrige). */
  function local(id: string): { file: string; mimeType: string; durationSec?: number } | null {
    const e = index.get(id);
    if (!e) return null;
    return { file: fileOf(id, e.format), mimeType: AUDIO_FORMATS[e.format].mime, durationSec: d.store.trackDuration(id) };
  }

  function pump() {
    while (active.size < concurrency && pending.length) {
      const id = pending.shift()!;
      active.add(id);
      void run(id);
    }
    if (!active.size && !pending.length) idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  async function run(id: string) {
    const startedIn = epoch;
    try {
      const out = await downloadTo({ provider: d.provider, fetchImpl: d.fetchImpl, id, variant: 'high', destFor: (f) => fileOf(id, f) });
      // Pudo dejar de ser favorita (o la persona borró todo) mientras bajaba: el archivo ya no se quiere.
      if (startedIn === epoch && d.store.favoriteIds().includes(id)) {
        d.store.addDownload(id, out.format, out.bytes);
        if (out.loudnessLkfs !== undefined) d.store.setLoudness(id, out.loudnessLkfs);
        index.set(id, { format: out.format, bytes: out.bytes });
      } else {
        await removeFile(out.dest);
      }
    } catch {
      if (startedIn === epoch) failed.add(id);
    } finally {
      active.delete(id);
      pump();
      notify();
    }
  }

  function enqueue(id: string) {
    if (index.has(id) || active.has(id) || pending.includes(id)) return;
    failed.delete(id);
    pending.push(id);
    pump();
    notify();
  }

  /** Olvida la descarga: primero el índice (el protocolo deja de servirla) y después el archivo, sin fallar si está en uso. */
  async function forget(id: string) {
    const e = index.get(id);
    index.delete(id);
    d.store.removeDownload(id);
    if (e) await removeFile(fileOf(id, e.format));
  }

  /** Avisa que la canción pasó a ser (o dejó de ser) favorita; `toggleFavorite` ya la guardó o quitó en la base. */
  async function onFavorite(id: string, isFavorite: boolean) {
    if (isFavorite) {
      failed.delete(id);
      if (d.enabled()) enqueue(id);
      return;
    }
    const at = pending.indexOf(id);
    if (at >= 0) pending.splice(at, 1);
    failed.delete(id);
    await forget(id);
    notify();
  }

  /**
   * Pone el disco, el índice y la cola de acuerdo con las favoritas (al abrir la app, al volver la red y al cambiar el
   * ajuste): borra `.part`, archivos sueltos y descargas de canciones que ya no son favoritas; quita las filas cuyo
   * archivo falta; y baja las favoritas que no tienen archivo (si el ajuste está activo).
   */
  async function reconcile() {
    await mkdir(d.dir, { recursive: true });
    const favorites = new Set(d.store.favoriteIds());
    const names = await readdir(d.dir);
    const present = new Set(names);
    const keep = new Set<string>();
    for (const [id, e] of index) if (favorites.has(id)) keep.add(basename(fileOf(id, e.format)));
    const busy = [...active];
    for (const name of names) {
      if (keep.has(name) || busy.some((id) => name.startsWith(`${id}.`))) continue;
      await removeFile(join(d.dir, name));
    }
    for (const [id, e] of [...index]) {
      if (!favorites.has(id) || !present.has(basename(fileOf(id, e.format)))) {
        index.delete(id);
        d.store.removeDownload(id);
      }
    }
    failed.clear();
    if (d.enabled()) for (const id of favorites) enqueue(id);
    else pending.length = 0;
    notify();
  }

  /** «Borrar todas las descargas»: vacía la cola, borra todo y descarta lo que esté bajando. */
  async function clear() {
    epoch++;
    pending.length = 0;
    const entries = [...index];
    index.clear();
    d.store.clearDownloads();
    await Promise.all(entries.map(([id, e]) => removeFile(fileOf(id, e.format))));
    failed.clear();
    notify();
  }

  /** Se resuelve cuando no queda cola ni descargas en curso. */
  const idle = (): Promise<void> => (pending.length || active.size ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve());

  return { local, state, onFavorite, reconcile, clear, idle };
}
