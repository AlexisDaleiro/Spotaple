import { create } from 'zustand';
import type { OfflineState } from '@shared/offline';
import type { Track } from '@shared/types';
import { api } from '../api';

interface OfflineStore {
  /** Canciones con archivo en el disco. */
  ids: Set<string>;
  /** En cola o bajando ahora. */
  pending: number;
  /** Fallidas desde la última sincronización. */
  failed: number;
  bytes: number;
  /** Lo que informa el navegador; sin red solo suena lo descargado. */
  online: boolean;
  set(state: OfflineState): void;
  setOnline(online: boolean): void;
  /** ¿Se puede reproducir ahora? Con red todo; sin red, solo lo descargado. */
  reachable(trackId: string): boolean;
  /** Las canciones de `tracks` que se pueden reproducir ahora (todas con red). */
  playable(tracks: Track[]): Track[];
  /**
   * La cola para «reproducir desde esta canción»: sin red, solo las que se pueden reproducir, empezando por la
   * elegida; si la elegida no está descargada se deja la lista entera (el reproductor la salta con su aviso).
   */
  queueFrom(tracks: Track[], index: number): { tracks: Track[]; start: number };
}

export const useOffline = create<OfflineStore>((set, get) => ({
  ids: new Set(),
  pending: 0,
  failed: 0,
  bytes: 0,
  online: typeof navigator === 'undefined' || navigator.onLine !== false,
  set: (s) => set({ ids: new Set(s.ids), pending: s.pending, failed: s.failed, bytes: s.bytes }),
  setOnline: (online) => set({ online }),
  reachable: (trackId) => get().online || get().ids.has(trackId),
  playable: (tracks) => (get().online ? tracks : tracks.filter((t) => get().ids.has(t.id))),
  queueFrom: (tracks, index) => {
    const chosen = tracks[index];
    const list = get().playable(tracks);
    const start = chosen ? list.findIndex((t) => t.id === chosen.id) : -1;
    return start >= 0 ? { tracks: list, start } : { tracks, start: index };
  },
}));

/** Carga el estado, se suscribe a los cambios que empuja main y sigue la red: al volver, sincroniza las descargas. */
export async function startOfflineBridge(): Promise<void> {
  const store = useOffline.getState();
  window.addEventListener('offline', () => store.setOnline(false));
  window.addEventListener('online', () => {
    store.setOnline(true);
    void api.offline.sync().catch(() => undefined);
  });
  store.setOnline(navigator.onLine);
  try {
    store.set(await api.offline.state());
    await api.offline.subscribe((s) => store.set(s));
  } catch {
    /* sin puente: simplemente no hay descargas que mostrar */
  }
}
