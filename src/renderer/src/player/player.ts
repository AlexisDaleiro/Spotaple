import { createStore } from 'zustand/vanilla';
import { audioUrl } from '@shared/api';
import type { PersistedPlayerState, PreparedAudio, RepeatMode, Track } from '@shared/types';
import {
  append,
  clearUpcoming,
  disableShuffle,
  enableShuffle,
  insertNext,
  makeItems,
  moveItem,
  nextIndex,
  prevIndex,
  removeItem,
  type QueueItem,
  type QueueState,
} from './queue';

/** idle: sin canción · loading: resolviendo la fuente · buffering: esperando datos · ended: terminó la cola. */
export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

export interface PlayerError {
  code: string;
  message: string;
}

/** Subconjunto de HTMLAudioElement que usa el reproductor (permite probarlo con un audio simulado). */
export interface AudioLike extends EventTarget {
  src: string;
  currentTime: number;
  readonly duration: number;
  volume: number;
  muted: boolean;
  readonly paused: boolean;
  readonly error: { code: number } | null;
  play(): Promise<void>;
  pause(): void;
}

export interface PlayerApi {
  prepare(trackId: string): Promise<PreparedAudio>;
  invalidate(trackId: string): Promise<void>;
  recordSelection(track: Track): Promise<void>;
  recordPlay(track: Track): Promise<void>;
}

export interface PlayerDeps {
  audio: AudioLike;
  api: PlayerApi;
  notify?: (message: string, kind?: 'info' | 'error') => void;
  urlFor?: (trackId: string) => string;
}

export interface PlayerState extends QueueState {
  status: PlayerStatus;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
  error: PlayerError | null;
}

export interface PlayerActions {
  /** Reemplaza la cola y reproduce desde `start` ("reproducir desde esta canción"). */
  playTracks(tracks: Track[], start?: number): void;
  /** Salta a un ítem de la cola actual. */
  playIndex(index: number): void;
  playNext(tracks: Track[]): void;
  addToQueue(tracks: Track[]): void;
  removeFromQueue(uid: string): void;
  moveInQueue(from: number, to: number): void;
  clearUpcoming(): void;
  togglePlay(): void;
  next(): void;
  prev(): void;
  seek(sec: number): void;
  seekBy(delta: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  cycleRepeat(): void;
  toggleShuffle(): void;
  hydrate(saved: PersistedPlayerState | null): void;
  snapshot(): PersistedPlayerState;
}

export type PlayerStore = ReturnType<typeof createPlayer>;

const MAX_AUTO_SKIPS = 3;
const RESTART_THRESHOLD_S = 3;

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

export function createPlayer(deps: PlayerDeps) {
  const { audio, api } = deps;
  const urlFor = deps.urlFor ?? audioUrl;
  const notify = deps.notify ?? (() => undefined);

  const store = createStore<PlayerState & PlayerActions>((set, get) => {
    // --- estado interno de la "única instancia responsable de la reproducción"
    let token = 0; // cada elección nueva invalida las cargas anteriores: gana la última
    let pendingStart: number | null = null;
    let loadedUid: string | null = null; // ítem cuyo audio está cargado en el elemento
    let recordedFor: string | null = null; // ítem ya registrado en "sonó"
    let retriedUid: string | null = null;
    let autoSkips = 0;

    const cur = (): QueueItem | undefined => get().items[get().index];
    const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);
    const applyVolume = () => {
      const { volume, muted } = get();
      audio.volume = volume * volume; // curva perceptual: el volumen se oye más natural que lineal
      audio.muted = muted;
    };

    function patchDuration(uid: string, durationSec: number) {
      const patch = (list: QueueItem[]) => list.map((i) => (i.uid === uid ? { ...i, track: { ...i.track, durationSec } } : i));
      const { original } = get();
      set({ items: patch(get().items), original: original ? patch(original) : null, duration: durationSec });
    }

    function fail(e: unknown, item: QueueItem) {
      const code = (e as { code?: string })?.code ?? 'unknown';
      const message = (e as Error)?.message || 'No se pudo reproducir esta canción.';
      set({ status: 'error', error: { code, message } });
      const trackSpecific = code === 'unavailable' || code === 'region';
      const s = get();
      if (trackSpecific && autoSkips < MAX_AUTO_SKIPS && nextIndex(s.items.length, s.index, s.repeat, false) !== null) {
        autoSkips++;
        notify(`«${item.track.title}» no está disponible. Pasando a la siguiente.`, 'error');
        go(nextIndex(s.items.length, s.index, s.repeat, false)!, { user: false });
      } else {
        notify(message, 'error');
      }
    }

    async function go(index: number, opts: { user: boolean; startAt?: number; retry?: boolean }) {
      const item = get().items[index];
      if (!item) return;
      const mine = ++token;
      if (opts.user) {
        retriedUid = null;
        autoSkips = 0;
      }
      if (!opts.retry) recordedFor = null;
      pendingStart = opts.startAt && opts.startAt > 0 ? opts.startAt : null;
      loadedUid = null;
      set({ index, status: 'loading', error: null, position: opts.startAt ?? 0, duration: item.track.durationSec ?? 0 });
      audio.pause(); // lo que sonaba se corta ya; la elección nueva no espera
      if (opts.user) quiet(api.recordSelection(item.track));

      let prepared: PreparedAudio;
      try {
        prepared = await api.prepare(item.track.id);
      } catch (e) {
        if (mine !== token) return;
        return fail(e, item);
      }
      if (mine !== token) return; // el usuario eligió otra mientras tanto
      // YouTube no siempre informa la duración en las listas; la fuente de audio sí la trae.
      if (!item.track.durationSec && prepared.durationSec) patchDuration(item.uid, Math.round(prepared.durationSec));
      loadedUid = item.uid;
      audio.src = urlFor(item.track.id);
      try {
        await audio.play();
      } catch (e) {
        if (mine !== token || isAbort(e)) return;
        fail(e, item);
      }
    }

    /** Avanza por fin de canción (`auto`) o por salto de error. */
    function advance(auto: boolean) {
      const s = get();
      const ni = nextIndex(s.items.length, s.index, s.repeat, auto);
      if (ni === null) {
        audio.pause();
        set({ status: 'ended', position: get().duration });
        return;
      }
      if (auto && ni === s.index) {
        // repetir una: se reinicia el mismo audio sin volver a resolver la fuente
        recordedFor = null;
        audio.currentTime = 0;
        set({ position: 0 });
        audio.play().catch(() => undefined);
        return;
      }
      void go(ni, { user: false });
    }

    // --- eventos del elemento de audio
    const on = (name: string, fn: () => void) => audio.addEventListener(name, fn);
    on('playing', () => {
      const item = cur();
      if (!item || loadedUid !== item.uid) return;
      set({ status: 'playing', error: null });
      autoSkips = 0;
      if (recordedFor !== item.uid) {
        recordedFor = item.uid; // empezó a sonar de verdad
        quiet(api.recordPlay(item.track));
      }
    });
    on('pause', () => {
      const { status } = get();
      if (status === 'playing' || status === 'buffering') set({ status: 'paused' });
    });
    on('waiting', () => {
      if (get().status === 'playing') set({ status: 'buffering' });
    });
    on('timeupdate', () => {
      const { status } = get();
      if (status === 'loading' || status === 'idle' || status === 'error') return;
      set({ position: audio.currentTime });
    });
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0 && get().status !== 'idle') set({ duration: audio.duration });
      if (pendingStart !== null && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(pendingStart, audio.duration);
        pendingStart = null;
      }
    };
    on('loadedmetadata', onMeta);
    on('durationchange', onMeta);
    on('ended', () => {
      if (get().status === 'loading') return;
      set({ position: get().duration });
      advance(true);
    });
    on('error', () => {
      const item = cur();
      if (!item || loadedUid !== item.uid) return;
      if (retriedUid !== item.uid) {
        // La fuente pudo caducar: se descarta, se resuelve de nuevo y se retoma donde estaba.
        retriedUid = item.uid;
        const at = get().position;
        quiet(api.invalidate(item.track.id));
        void go(get().index, { user: false, startAt: at, retry: true });
        return;
      }
      const network = audio.error?.code === 2;
      fail(
        {
          code: network ? 'network' : 'unavailable',
          message: network
            ? 'Se cortó la conexión mientras sonaba. Revisá tu internet y tocá reproducir.'
            : 'No se pudo reproducir esta canción. Probá con otra.',
        },
        item,
      );
    });

    const commit = (q: QueueState) => set({ items: q.items, index: q.index, original: q.original });
    const qs = (): QueueState => ({ items: get().items, index: get().index, original: get().original });

    /** Si no había canción actual, la cola nueva deja la primera lista (sin reproducir). */
    const settleEmpty = () => {
      const s = get();
      if (s.index < 0 && s.items.length) set({ index: 0, status: 'paused', position: 0, duration: s.items[0]!.track.durationSec ?? 0 });
    };

    return {
      status: 'idle',
      items: [],
      index: -1,
      original: null,
      repeat: 'off',
      shuffle: false,
      volume: 0.8,
      muted: false,
      position: 0,
      duration: 0,
      error: null,

      playTracks(tracks, start = 0) {
        if (!tracks.length) return;
        let q: QueueState = { items: makeItems(tracks), index: Math.min(Math.max(start, 0), tracks.length - 1), original: null };
        if (get().shuffle) q = enableShuffle(q);
        commit(q);
        void go(q.index, { user: true });
      },
      playIndex(index) {
        if (index >= 0 && index < get().items.length) void go(index, { user: true });
      },
      playNext(tracks) {
        if (!tracks.length) return;
        commit(insertNext(qs(), makeItems(tracks)));
        settleEmpty();
      },
      addToQueue(tracks) {
        if (!tracks.length) return;
        commit(append(qs(), makeItems(tracks)));
        settleEmpty();
      },
      removeFromQueue(uid) {
        const { state, wasCurrent } = removeItem(qs(), uid);
        commit(state);
        if (!wasCurrent) return;
        if (state.items.length === 0) {
          token++;
          audio.pause();
          loadedUid = null;
          set({ index: -1, status: 'idle', position: 0, duration: 0, error: null });
        } else {
          void go(state.index, { user: false });
        }
      },
      moveInQueue(from, to) {
        commit(moveItem(qs(), from, to));
      },
      clearUpcoming() {
        commit(clearUpcoming(qs()));
      },

      togglePlay() {
        const s = get();
        const item = cur();
        if (!item || s.status === 'loading') return;
        // Sesión restaurada, error o cola terminada: no hay audio cargado que reanudar.
        if (loadedUid !== item.uid || s.status === 'error' || s.status === 'ended') {
          void go(s.index, { user: true, startAt: s.status === 'ended' || s.status === 'error' ? 0 : s.position });
          return;
        }
        if (audio.paused) audio.play().catch((e) => !isAbort(e) && fail(e, item));
        else audio.pause();
      },
      next() {
        const s = get();
        const ni = nextIndex(s.items.length, s.index, s.repeat, false);
        if (ni !== null) void go(ni, { user: true });
      },
      prev() {
        const s = get();
        if (s.index < 0) return;
        if (s.position > RESTART_THRESHOLD_S) return get().seek(0);
        const pi = prevIndex(s.items.length, s.index, s.repeat);
        if (pi === null) get().seek(0);
        else void go(pi, { user: true });
      },
      seek(sec) {
        const s = get();
        const item = cur();
        if (!item) return;
        const max = s.duration > 0 ? s.duration : Infinity;
        const t = Math.min(Math.max(sec, 0), max);
        set({ position: t });
        if (loadedUid === item.uid) audio.currentTime = t; // si no hay audio cargado, se aplica al reproducir
      },
      seekBy(delta) {
        get().seek(get().position + delta);
      },
      setVolume(v) {
        const volume = Math.min(1, Math.max(0, v));
        set({ volume, muted: volume === 0 ? get().muted : false });
        applyVolume();
      },
      toggleMute() {
        set({ muted: !get().muted });
        applyVolume();
      },
      cycleRepeat() {
        const order: RepeatMode[] = ['off', 'all', 'one'];
        set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length]! });
      },
      toggleShuffle() {
        const on = !get().shuffle;
        commit(on ? enableShuffle(qs()) : disableShuffle(qs()));
        set({ shuffle: on });
      },

      hydrate(saved) {
        if (!saved) return;
        const items = makeItems(saved.queue);
        const index = items.length ? Math.min(Math.max(saved.index, 0), items.length - 1) : -1;
        set({
          items,
          index,
          original: null,
          repeat: saved.repeat,
          shuffle: saved.shuffle,
          volume: saved.volume,
          muted: saved.muted,
          // La reproducción nunca arranca sola: queda lista en pausa, en la posición guardada.
          status: index >= 0 ? 'paused' : 'idle',
          position: index >= 0 ? saved.positionSec : 0,
          duration: items[index]?.track.durationSec ?? 0,
        });
        applyVolume();
      },
      snapshot() {
        const s = get();
        return {
          queue: s.items.map((i) => i.track),
          index: Math.max(s.index, 0),
          positionSec: Math.floor(s.position),
          volume: s.volume,
          muted: s.muted,
          repeat: s.repeat,
          shuffle: s.shuffle,
        };
      },
    };
  });

  return store;
}
