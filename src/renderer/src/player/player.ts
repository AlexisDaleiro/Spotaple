import { createStore } from 'zustand/vanilla';
import { audioUrl } from '@shared/api';
import { songKey } from '@shared/track';
import type { PersistedPlayerState, PreparedAudio, RepeatMode, Track } from '@shared/types';
import {
  append,
  clearUpcoming,
  disableShuffle,
  enableShuffle,
  insertBeforeAuto,
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
  /** `auto`: la canción la puso la radio y avanzó sola (no la eligió el usuario). */
  recordPlay(track: Track, auto?: boolean): Promise<void>;
}

/**
 * Gancho de la sala del jam. Con la sala activa, pedir canciones no toca la cola propia sino la de la sala:
 * `how` indica dónde van ('next' y 'now' solo los puede pedir el admin; la sala lo valida).
 */
export interface JamHook {
  active(): boolean;
  request(tracks: Track[], how: 'end' | 'next' | 'now'): void;
}

/**
 * Radio automática: cuando quedan pocas canciones por sonar, el reproductor pide sugerencias a partir de la
 * canción actual (`excludeIds` = lo que ya está en la cola). `enabled` lee el ajuste en cada decisión.
 */
export interface RadioHook {
  enabled(): boolean;
  fetch(seed: Track, excludeIds: string[]): Promise<Track[]>;
}

export interface PlayerDeps {
  audio: AudioLike;
  api: PlayerApi;
  jam?: JamHook;
  radio?: RadioHook;
  notify?: (message: string, kind?: 'info' | 'error') => void;
  urlFor?: (trackId: string) => string;
  /**
   * ¿Se puede reproducir esta canción ahora? Sin red solo suenan las descargadas: lo demás se salta (con el mismo tope
   * que las no disponibles) sin pedirle nada a main.
   */
  reachable?: (trackId: string) => boolean;
  /**
   * ¿Esta canción tiene archivo en el disco? Cubre el caso en que el sistema dice que hay red pero no hay salida a
   * internet: un error de red al preparar una canción no descargada salta a las descargadas que siguen.
   */
  isDownloaded?: (trackId: string) => boolean;
  /**
   * Se llama justo antes de asignar la fuente al audio que va a sonar: el motor de sonido le pone la ganancia de
   * normalización a esa canción (`prepared.loudnessLkfs`).
   */
  onPrepared?: (prepared: PreparedAudio, audio: AudioLike) => void;
  /**
   * Fundido cruzado: con `audio2` y `crossfade` el reproductor alterna entre los dos elementos y, cuando faltan
   * `seconds()` segundos, arranca la siguiente en el libre mientras la actual se apaga. `fadeOut` y `fadeIn` mueven el
   * volumen de cada elemento durante `sec` segundos (la actual sigue sonando); `unfade` los deja otra vez en 1.
   * Sin estos dos, no hay fundido y todo funciona como siempre.
   */
  audio2?: AudioLike;
  crossfade?: {
    seconds(): number;
    fadeOut(el: AudioLike, sec: number): void;
    fadeIn(el: AudioLike, sec: number): void;
    unfade(el: AudioLike): void;
  };
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
  /** Reemplaza la cola por esta canción y arranca en `startSec`. Lo usa el conductor de la sala; no pasa por el gancho jam. */
  playAt(track: Track, startSec: number): void;
  /** Corta el audio y descarta cualquier carga en curso (no arranca sola después); la cola no se toca. */
  stop(): void;
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
/** La radio se pide cuando quedan menos de tantas canciones por sonar. */
const RADIO_REFILL_BELOW = 3;
const RESTART_THRESHOLD_S = 3;
/** La fuente de la siguiente se precarga cuando faltan menos de «fundido + esto» segundos. */
const PREFETCH_LEAD_S = 10;
/** Margen para pausar el elemento que se apagó, después de que termina su rampa. */
const FADE_END_MARGIN_MS = 150;

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

export function createPlayer(deps: PlayerDeps) {
  const { api } = deps;
  // Con fundido hay dos elementos que se alternan: `audio` es el que suena ahora y `spare` el libre.
  let audio = deps.audio;
  let spare = deps.audio2;
  const cf = deps.crossfade;
  const urlFor = deps.urlFor ?? audioUrl;
  const notify = deps.notify ?? (() => undefined);
  const jam = deps.jam;
  const radio = deps.radio;

  const store = createStore<PlayerState & PlayerActions>((set, get) => {
    // --- estado interno de la "única instancia responsable de la reproducción"
    let token = 0; // cada elección nueva invalida las cargas anteriores: gana la última
    let pendingStart: number | null = null;
    let loadedUid: string | null = null; // ítem cuyo audio está cargado en el elemento
    let recordedFor: string | null = null; // ítem ya registrado en "sonó"
    let retriedUid: string | null = null;
    let autoSkips = 0;
    let radioBusy = false; // hay un pedido de radio en curso
    let radioBlockedUid: string | null = null; // canción para la que la radio falló o no dio nada: no se reintenta
    let playedAuto = false; // la reproducción en curso la puso la radio y avanzó sola
    let radioEpoch = 0; // sube con «Limpiar»: una respuesta de radio anterior ya no vale
    let fading: { out: AudioLike; timer: ReturnType<typeof setTimeout> } | null = null; // el elemento que se está apagando
    let fadeTriedUid: string | null = null; // canción para la que ya se intentó el fundido (salió o falló): no se repite
    let prefetchedUid: string | null = null; // canción cuya siguiente ya se precargó

    const cur = (): QueueItem | undefined => get().items[get().index];
    const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);
    const applyVolume = () => {
      const { volume, muted } = get();
      for (const el of spare ? [audio, spare] : [audio]) {
        el.volume = volume * volume; // curva perceptual: el volumen se oye más natural que lineal
        el.muted = muted;
      }
    };

    /** Corta ya el elemento que se estaba apagando (si lo hay) y lo deja listo para volver a usarse. */
    function endFade() {
      if (!fading) return;
      const { out, timer } = fading;
      fading = null;
      clearTimeout(timer);
      cf?.unfade(out);
      out.pause();
    }

    /**
     * Fundido cruzado: a `seconds()` del final arranca la siguiente en el otro elemento y la actual se apaga. Solo con
     * dos elementos, sin sala, sin «repetir una», con una siguiente distinta y una canción de al menos 2 × el fundido.
     * También precarga la fuente de la siguiente (`PREFETCH_LEAD_S` antes) para que el arranque sea inmediato.
     */
    function maybeCrossfade() {
      const sec = cf?.seconds() ?? 0;
      const s = get();
      const item = cur();
      if (!cf || !spare || sec <= 0 || !item || s.status !== 'playing' || fading || jam?.active() || s.repeat === 'one') return;
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur < 2 * sec) return;
      const ni = nextIndex(s.items.length, s.index, s.repeat, true);
      if (ni === null || ni === s.index) return;
      const remaining = dur - audio.currentTime;
      if (prefetchedUid !== item.uid && remaining <= sec + PREFETCH_LEAD_S) {
        prefetchedUid = item.uid;
        quiet(api.prepare(s.items[ni]!.track.id));
      }
      if (remaining > sec || fadeTriedUid === item.uid) return;
      fadeTriedUid = item.uid;
      void go(ni, { user: false, fade: Math.max(Math.min(sec, remaining), 0.1) });
    }

    /**
     * Radio automática: si quedan menos de 3 por sonar, la radio está activada, no hay sala ni repetición, y no hay un
     * pedido en curso ni falló ya para esta canción, pide sugerencias y las agrega al final marcadas como `auto`.
     */
    function maybeRefill() {
      const item = cur();
      const s = get();
      if (!radio || !item || !radio.enabled() || jam?.active() || s.repeat !== 'off') return;
      if (s.items.length - s.index - 1 >= RADIO_REFILL_BELOW || radioBusy || radioBlockedUid === item.uid) return;
      radioBusy = true;
      const epoch = radioEpoch;
      // La canción para la que se pidió ya no está en la cola (la reemplazaron): esa respuesta no sirve.
      const gone = () => !get().items.some((i) => i.uid === item.uid);
      radio.fetch(item.track, s.items.map((i) => i.track.id)).then(
        (tracks) => {
          radioBusy = false;
          if (epoch !== radioEpoch) return; // «Limpiar» entre medio: la persona vació la cola a propósito
          if (gone()) return maybeRefill(); // se reemplazó la cola: pedir para la canción que suena ahora
          if (jam?.active() || !radio.enabled()) return; // cambió el contexto mientras llegaba
          const queue = get().items;
          const haveIds = new Set(queue.map((i) => i.track.id));
          const haveSongs = new Set(queue.map((i) => songKey(i.track)));
          // La cola pudo cambiar mientras tanto, y otra versión de la misma canción (otro id) tampoco vale.
          const fresh = tracks.filter((t) => !haveIds.has(t.id) && !haveSongs.has(songKey(t)));
          if (!fresh.length) {
            radioBlockedUid = item.uid;
            return;
          }
          const first = queue.length;
          commit(append(qs(), makeItems(fresh, true)));
          // La cola ya había terminado mientras llegaba la respuesta: sigue sola.
          if (get().status === 'ended' && cur()?.uid === item.uid) void go(first, { user: false });
        },
        (e) => {
          radioBusy = false;
          if (epoch !== radioEpoch) return;
          if (gone()) return maybeRefill();
          radioBlockedUid = item.uid;
          // Sin internet no hay nada que avisar: la cola simplemente termina.
          if ((e as { code?: string } | null)?.code !== 'network') notify('No pudimos sumar canciones sugeridas.');
        },
      );
    }

    function patchDuration(uid: string, durationSec: number) {
      const patch = (list: QueueItem[]) => list.map((i) => (i.uid === uid ? { ...i, track: { ...i.track, durationSec } } : i));
      const { original } = get();
      set({ items: patch(get().items), original: original ? patch(original) : null, duration: durationSec });
    }

    /**
     * Sin salida a internet aunque el sistema diga que hay red: un error de red en una canción no descargada, con otras
     * descargadas más adelante en la cola, se trata como «no disponible» (se salta, con el tope de siempre).
     */
    function skippableOffline(e: unknown, item: QueueItem): PlayerError | null {
      const downloaded = deps.isDownloaded;
      if (!downloaded || (e as { code?: string } | null)?.code !== 'network' || downloaded(item.track.id)) return null;
      const s = get();
      if (!s.items.slice(s.index + 1).some((i) => downloaded(i.track.id))) return null;
      return { code: 'unavailable', message: 'Sin conexión: esta canción no está descargada.' };
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

    async function go(index: number, opts: { user: boolean; startAt?: number; retry?: boolean; fade?: number }) {
      const item = get().items[index];
      if (!item) return;
      const mine = ++token;
      // Fundido: la fuente se pide ANTES de tocar el estado. Si no se puede (sin red o falla), la canción actual sigue
      // sonando sin avisos y termina por el camino de siempre; `fadeTriedUid` evita reintentarlo.
      let early: PreparedAudio | undefined;
      const fade = !opts.user && opts.fade ? opts.fade : 0;
      if (fade) {
        if (deps.reachable && !deps.reachable(item.track.id)) return;
        try {
          early = await api.prepare(item.track.id);
        } catch {
          return;
        }
        if (mine !== token) return;
      }
      if (opts.user) {
        retriedUid = null;
        autoSkips = 0;
      }
      if (!opts.retry) recordedFor = null;
      pendingStart = opts.startAt && opts.startAt > 0 ? opts.startAt : null;
      loadedUid = null;
      set({ index, status: 'loading', error: null, position: opts.startAt ?? 0, duration: item.track.durationSec ?? 0 });
      if (fade && early && spare) {
        // La actual no se corta: pasa a ser la que se apaga y el elemento libre toma la nueva.
        endFade();
        const out = audio;
        audio = spare;
        spare = out;
        fading = { out, timer: setTimeout(endFade, fade * 1000 + FADE_END_MARGIN_MS) };
        cf?.fadeOut(out, fade);
        cf?.fadeIn(audio, fade);
      } else {
        fadeTriedUid = null;
        prefetchedUid = null;
        endFade();
        audio.pause(); // lo que sonaba se corta ya; la elección nueva no espera
      }
      playedAuto = item.auto === true && !opts.user;
      maybeRefill();
      if (opts.user) quiet(api.recordSelection(item.track));

      if (deps.reachable && !deps.reachable(item.track.id)) {
        return fail({ code: 'unavailable', message: 'Sin conexión: esta canción no está descargada.' }, item);
      }

      let prepared: PreparedAudio;
      try {
        prepared = early ?? (await api.prepare(item.track.id));
      } catch (e) {
        if (mine !== token) return;
        return fail(skippableOffline(e, item) ?? e, item);
      }
      if (mine !== token) return; // el usuario eligió otra mientras tanto
      // YouTube no siempre informa la duración en las listas; la fuente de audio sí la trae.
      if (!item.track.durationSec && prepared.durationSec) patchDuration(item.uid, Math.round(prepared.durationSec));
      loadedUid = item.uid;
      deps.onPrepared?.(prepared, audio);
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
        // Terminó la cola: si la radio puede seguir, la pide y retoma sola cuando llega.
        if (auto) maybeRefill();
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
    // Los dos elementos escuchan, pero solo cuenta el que suena ahora: lo que diga el que se apaga no mueve el estado.
    const on = (name: string, fn: () => void) => {
      for (const el of spare ? [audio, spare] : [audio]) el.addEventListener(name, () => el === audio && fn());
    };
    on('playing', () => {
      const item = cur();
      if (!item || loadedUid !== item.uid) return;
      set({ status: 'playing', error: null });
      autoSkips = 0;
      if (recordedFor !== item.uid) {
        recordedFor = item.uid; // empezó a sonar de verdad
        quiet(api.recordPlay(item.track, playedAuto));
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
      maybeCrossfade();
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
        // En una sala, "reproducir" una lista es pedir solo la canción elegida: no se inunda la cola de todos.
        if (jam?.active()) return jam.request([tracks[Math.min(Math.max(start, 0), tracks.length - 1)]!], 'end');
        let q: QueueState = { items: makeItems(tracks), index: Math.min(Math.max(start, 0), tracks.length - 1), original: null };
        if (get().shuffle) q = enableShuffle(q);
        commit(q);
        void go(q.index, { user: true });
      },
      playAt(track, startSec) {
        commit({ items: makeItems([track]), index: 0, original: null });
        void go(0, { user: false, startAt: startSec });
      },
      stop() {
        token++; // una carga que todavía resuelve la fuente ya no es la vigente: no pondrá el audio
        pendingStart = null;
        loadedUid = null;
        endFade();
        audio.pause();
        set({ status: get().index >= 0 ? 'paused' : 'idle', error: null });
      },
      playIndex(index) {
        if (index >= 0 && index < get().items.length) void go(index, { user: true });
      },
      playNext(tracks) {
        if (!tracks.length) return;
        if (jam?.active()) return jam.request(tracks, 'next');
        commit(insertNext(qs(), makeItems(tracks)));
        settleEmpty();
      },
      addToQueue(tracks) {
        if (!tracks.length) return;
        if (jam?.active()) return jam.request(tracks, 'end');
        commit(insertBeforeAuto(qs(), makeItems(tracks))); // lo que pide el usuario va antes de lo que puso la radio
        settleEmpty();
      },
      removeFromQueue(uid) {
        const { state, wasCurrent } = removeItem(qs(), uid);
        commit(state);
        if (!wasCurrent) return;
        if (state.items.length === 0) {
          token++;
          endFade();
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
        radioEpoch++; // una respuesta de radio que venía en camino ya no vale
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
        else {
          endFade(); // pausar corta también la canción que se estaba apagando
          audio.pause();
        }
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
        const repeat = order[(order.indexOf(get().repeat) + 1) % order.length]!;
        set({ repeat });
        // Apagar la repetición es la forma de arreglar un «repetir» olvidado: la radio retoma desde ya.
        if (repeat === 'off') maybeRefill();
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
