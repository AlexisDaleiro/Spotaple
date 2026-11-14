import { createStore } from 'zustand/vanilla';
import { audioUrl } from '@shared/api';
import { songKey } from '@shared/track';
import { MAX_QUEUE_ITEMS, type PersistedPlayerState, type PreparedAudio, type RepeatMode, type Track } from '@shared/types';
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
  readonly ended?: boolean;
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
  /** Recupera un stream que queda esperando datos sin emitir un error de audio. */
  stallTimeoutMs?: number;
  /** Esperas entre intentos si falla la conexión. Vacío si no se reintenta automáticamente. */
  reconnectDelaysMs?: readonly number[];
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
  reconnecting: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  muted: boolean;
  position: number;
  duration: number;
  error: PlayerError | null;
}

export interface PlayerActions {
  /** Reserva una elección manual mientras se carga un álbum o lista. */
  claimPlayback(): () => boolean;
  /** Reemplaza la cola. Un índice explícito conserva la canción elegida incluso con aleatorio. */
  playTracks(tracks: Track[], start?: number): void;
  /** Reemplaza la cola por esta canción y arranca en `startSec`. Lo usa el conductor de la sala; no pasa por el gancho jam. */
  playAt(track: Track, startSec: number): void;
  /** Corta el audio y descarta cualquier carga en curso (no arranca sola después); la cola no se toca. */
  stop(): void;
  /** Salta a un ítem de la cola actual. */
  playIndex(index: number): void;
  playNext(tracks: Track[]): void;
  addToQueue(tracks: Track[]): number;
  removeFromQueue(uid: string): void;
  moveInQueue(from: number, to: number): void;
  clearUpcoming(): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  networkRestored(): void;
  next(): void;
  prev(): void;
  seek(sec: number): void;
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
    let intent = 0;
    let pendingStart: number | null = null;
    let loadedUid: string | null = null; // ítem cuyo audio está cargado en el elemento
    let recordedFor: string | null = null; // ítem ya registrado en "sonó"
    let retriedUid: string | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let sourceDuration: number | undefined;
    let uninterruptedSince: number | undefined;
    let reconnect: { timer: ReturnType<typeof setTimeout>; run: () => void } | undefined;
    let reconnectAttempts = 0;
    let autoSkips = 0;
    let radioBusy = false; // hay un pedido de radio en curso
    let radioBlockedUid: string | null = null; // canción para la que la radio falló o no dio nada: no se reintenta
    let radioNetworkUid: string | null = null;
    let radioOnlineEpoch = 0;
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

    function clearStall() {
      clearTimeout(stallTimer);
      stallTimer = undefined;
    }

    function clearReconnect() {
      if (reconnect) clearTimeout(reconnect.timer);
      reconnect = undefined;
    }

    function scheduleReconnect(item: QueueItem): boolean {
      const delay = deps.reconnectDelaysMs?.[reconnectAttempts];
      if (delay === undefined || jam?.active() || deps.isDownloaded?.(item.track.id)) return false;
      const mine = ++token;
      reconnectAttempts++;
      retriedUid = item.uid;
      loadedUid = null;
      clearStall();
      clearReconnect();
      const run = () => {
        clearReconnect();
        if (mine !== token || cur()?.uid !== item.uid) return;
        void go(get().index, { user: false, startAt: get().position, retry: true });
      };
      reconnect = { timer: setTimeout(run, delay), run };
      set({ status: 'loading', reconnecting: true, error: null });
      endFade();
      audio.pause();
      return true;
    }

    function watchStall() {
      const item = cur();
      if (!deps.stallTimeoutMs || stallTimer !== undefined || !item || loadedUid !== item.uid ||
        deps.isDownloaded?.(item.track.id)) return;
      const mine = token;
      stallTimer = setTimeout(() => {
        stallTimer = undefined;
        const status = get().status;
        if (mine !== token || cur()?.uid !== item.uid || audio.paused ||
          (status !== 'buffering' && status !== 'loading' && status !== 'playing')) return;
        recoverAudio(item, true);
      }, deps.stallTimeoutMs);
    }

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
      const onlineEpoch = radioOnlineEpoch;
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
          const state = qs();
          const added = fresh.slice(0, MAX_QUEUE_ITEMS - (queue.length - state.index));
          const drop = Math.max(0, queue.length + added.length - MAX_QUEUE_ITEMS);
          const discarded = new Set(queue.slice(0, drop).map((item) => item.uid));
          const kept = queue.slice(drop);
          const first = kept.length;
          commit(append({
            items: kept,
            index: state.index - drop,
            original: state.original?.filter((item) => !discarded.has(item.uid)) ?? null,
          }, makeItems(added, true)));
          // La cola ya había terminado mientras llegaba la respuesta: sigue sola.
          if (get().status === 'ended' && cur()?.uid === item.uid) void go(first, { user: false });
        },
        (e) => {
          radioBusy = false;
          if (epoch !== radioEpoch) return;
          if (gone()) return maybeRefill();
          radioBlockedUid = item.uid;
          if ((e as { code?: string } | null)?.code === 'network') {
            radioNetworkUid = item.uid;
            if (radioOnlineEpoch !== onlineEpoch) retryRadioAfterNetwork();
          } else notify('No pudimos sumar canciones sugeridas.');
        },
      );
    }

    function patchDuration(uid: string, durationSec: number) {
      const patch = (list: QueueItem[]) => list.map((i) => (i.uid === uid ? { ...i, track: { ...i.track, durationSec } } : i));
      const { original } = get();
      set({ items: patch(get().items), original: original ? patch(original) : null, duration: durationSec });
    }

    function retryRadioAfterNetwork() {
      if (radioNetworkUid === null || cur()?.uid !== radioNetworkUid || radioBlockedUid !== radioNetworkUid) return;
      radioNetworkUid = null;
      radioBlockedUid = null;
      if (get().status !== 'paused') maybeRefill();
    }

    function skipToDownload(item: QueueItem): boolean {
      const downloaded = deps.isDownloaded;
      if (!downloaded || downloaded(item.track.id) || jam?.active()) return false;
      const s = get();
      let next = s.items.findIndex((entry, index) => index > s.index && downloaded(entry.track.id));
      if (next < 0 && s.repeat === 'all') {
        next = s.items.findIndex((entry, index) => index < s.index && downloaded(entry.track.id));
      }
      if (next < 0) return false;
      notify(`«${item.track.title}» no está disponible. Pasando a la siguiente.`, 'error');
      void go(next, { user: false });
      return true;
    }

    function fail(e: unknown, item: QueueItem, duringPlayback = false) {
      if (cur()?.uid !== item.uid) return;
      const code = (e as { code?: string })?.code ?? 'unknown';
      if (code === 'network' && get().position === 0 && skipToDownload(item)) return;
      if (code === 'network') {
        if (scheduleReconnect(item)) return;
        if (duringPlayback && skipToDownload(item)) return;
      }
      const message = (e as Error)?.message || 'No se pudo reproducir esta canción.';
      set({ status: 'error', reconnecting: false, error: { code, message } });
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
      const current = token;
      // Fundido: la fuente se pide ANTES de tocar el estado. Si no se puede (sin red o falla), la canción actual sigue
      // sonando sin avisos y termina por el camino de siempre; `fadeTriedUid` evita reintentarlo.
      let early: PreparedAudio | undefined;
      const fade = !opts.user && opts.fade ? opts.fade : 0;
      if (fade) {
        if (deps.reachable && !deps.reachable(item.track.id)) return;
        const from = cur();
        try {
          early = await api.prepare(item.track.id);
        } catch {
          return;
        }
        if (current !== token) return;
        // En la espera la persona pudo pausar, volver atrás o cambiar la cola: se vuelve a decidir con lo de ahora.
        const s = get();
        const ni = nextIndex(s.items.length, s.index, s.repeat, true);
        const unchanged =
          !!from && s.status === 'playing' && cur()?.uid === from.uid && !jam?.active() && s.repeat !== 'one' && ni !== null && s.items[ni]?.uid === item.uid && audio.duration - audio.currentTime <= fade + 1;
        if (!unchanged || ni === null) {
          fadeTriedUid = null;
          return;
        }
        index = ni;
      }
      const mine = ++token;
      if (opts.user) {
        retriedUid = null;
        autoSkips = 0;
      }
      clearStall();
      clearReconnect();
      if (opts.user || !opts.retry) reconnectAttempts = 0;
      if (!opts.retry) recordedFor = null;
      uninterruptedSince = undefined;
      pendingStart = null;
      loadedUid = null;
      set({
        index, status: 'loading', reconnecting: Boolean(opts.retry && deps.reconnectDelaysMs),
        error: null, position: opts.startAt ?? 0, duration: item.track.durationSec ?? 0,
      });
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
        cf?.unfade(audio); // si venía subiendo en un fundido, la que va a sonar arranca en volumen pleno
        audio.pause(); // lo que sonaba se corta ya; la elección nueva no espera
      }
      playedAuto = item.auto === true && !opts.user;
      maybeRefill();
      if (opts.user && !opts.retry) quiet(api.recordSelection(item.track));

      if (!opts.retry && deps.reachable && !deps.reachable(item.track.id)) {
        if (skipToDownload(item)) return;
        if (deps.reconnectDelaysMs && !jam?.active()) {
          return fail({ code: 'network', message: 'Sin conexión para reproducir esta canción.' }, item);
        }
        return fail({ code: 'unavailable', message: 'Sin conexión: esta canción no está descargada.' }, item);
      }

      let prepared: PreparedAudio;
      try {
        if (opts.retry) {
          await api.invalidate(item.track.id).catch(() => undefined);
          if (mine !== token) return;
        }
        prepared = early ?? (await api.prepare(item.track.id));
      } catch (e) {
        if (mine !== token) return;
        return fail(e, item);
      }
      if (mine !== token) return; // el usuario eligió otra mientras tanto
      // YouTube no siempre informa la duración en las listas; la fuente de audio sí la trae.
      if (!item.track.durationSec && prepared.durationSec) patchDuration(item.uid, Math.round(prepared.durationSec));
      pendingStart = get().position || null;
      sourceDuration = prepared.durationSec || item.track.durationSec;
      loadedUid = item.uid;
      deps.onPrepared?.(prepared, audio);
      audio.src = urlFor(item.track.id);
      watchStall();
      try {
        await audio.play();
      } catch (e) {
        if (mine !== token || isAbort(e)) return;
        if (deps.stallTimeoutMs && !deps.isDownloaded?.(item.track.id) &&
          (e as { name?: string })?.name === 'NotSupportedError') recoverAudio(item, false);
        else fail(e, item);
      }
    }

    function recoverAudio(item: QueueItem, stalled: boolean) {
      if (retriedUid !== item.uid) {
        retriedUid = item.uid;
        void go(get().index, { user: false, startAt: get().position, retry: true });
        return;
      }
      const network = stalled || audio.error?.code === 2 ||
        Boolean(deps.reconnectDelaysMs && !deps.isDownloaded?.(item.track.id) &&
          (audio.error == null || audio.error.code === 4));
      fail({
        code: network ? 'network' : 'unavailable',
        message: network
          ? 'Se cortó la conexión mientras sonaba. Revisá tu internet y tocá reproducir.'
          : 'No se pudo reproducir esta canción. Probá con otra.',
      }, item, true);
      if (stalled && get().status === 'error') {
        token++;
        loadedUid = null;
        audio.pause();
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
        const item = cur();
        const mine = token;
        audio.play().catch((e) => {
          if (item && mine === token && !isAbort(e)) fail(e, item);
        });
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
      clearStall();
      uninterruptedSince = undefined;
      set({ status: 'playing', reconnecting: false, error: null });
      watchStall();
      autoSkips = 0;
      if (recordedFor !== item.uid) {
        recordedFor = item.uid; // empezó a sonar de verdad
        quiet(api.recordPlay(item.track, playedAuto));
      }
    });
    on('pause', () => {
      if (!audio.paused) return;
      clearStall();
      uninterruptedSince = undefined;
      const { status } = get();
      if (!audio.ended && (status === 'playing' || status === 'buffering')) set({ status: 'paused' });
    });
    on('waiting', () => {
      uninterruptedSince = undefined;
      if (get().status === 'playing') set({ status: 'buffering' });
      watchStall();
    });
    on('timeupdate', () => {
      const { status, position } = get();
      if (status === 'loading' || status === 'idle' || status === 'error') return;
      set({ position: audio.currentTime });
      if (audio.currentTime > position && (status === 'buffering' || status === 'playing')) {
        clearStall();
        watchStall();
        if (deps.reconnectDelaysMs && retriedUid && status === 'playing') {
          uninterruptedSince ??= position;
          if (audio.currentTime - uninterruptedSince >= 30) {
            retriedUid = null;
            reconnectAttempts = 0;
            uninterruptedSince = undefined;
          }
        }
      }
      maybeCrossfade();
    });
    const onMeta = () => {
      if (loadedUid === null || loadedUid !== cur()?.uid) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0 && get().status !== 'idle') set({ duration: audio.duration });
      if (pendingStart !== null && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(pendingStart, audio.duration);
        pendingStart = null;
      }
    };
    on('loadedmetadata', onMeta);
    on('durationchange', onMeta);
    on('ended', () => {
      const s = get();
      const item = cur();
      if (s.status === 'loading' || s.status === 'idle' || s.status === 'error' || !item || loadedUid !== item.uid) return;
      clearStall();
      // Un archivo truncado puede disparar "ended" en vez de "error". No saltar de pista si le falta audio.
      const expected = sourceDuration;
      if (deps.stallTimeoutMs && !deps.isDownloaded?.(item.track.id) && expected &&
        audio.currentTime > 0 && expected - audio.currentTime > Math.max(8, expected * 0.08)) {
        const position = audio.currentTime;
        set({ position });
        recoverAudio(item, true);
        return;
      }
      set({ position: get().duration });
      advance(true);
    });
    on('error', () => {
      const item = cur();
      if (!item || loadedUid !== item.uid) return;
      clearStall();
      recoverAudio(item, false);
    });

    const commit = (q: QueueState) => set({ items: q.items, index: q.index, original: q.original });
    const qs = (): QueueState => ({ items: get().items, index: get().index, original: get().original });
    const queueLimitMessage = `La cola admite hasta ${MAX_QUEUE_ITEMS.toLocaleString('es-UY')} canciones.`;
    const fittingTracks = (tracks: Track[]) => {
      const remaining = Math.max(0, MAX_QUEUE_ITEMS - get().items.length);
      if (tracks.length <= remaining) return tracks;
      notify(queueLimitMessage);
      return tracks.slice(0, remaining);
    };

    /** Si no había canción actual, la cola nueva deja la primera lista (sin reproducir). */
    const settleEmpty = () => {
      const s = get();
      if (s.index < 0 && s.items.length) set({ index: 0, status: 'paused', position: 0, duration: s.items[0]!.track.durationSec ?? 0 });
    };

    return {
      status: 'idle',
      reconnecting: false,
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

      claimPlayback() {
        const mine = ++intent;
        return () => mine === intent;
      },
      playTracks(tracks, start) {
        if (!tracks.length) return;
        intent++;
        const shuffle = get().shuffle;
        const selected = Math.min(Math.max(start ?? 0, 0), tracks.length - 1);
        // En una sala, "reproducir" una lista es pedir solo la canción elegida: no se inunda la cola de todos.
        if (jam?.active()) return jam.request([tracks[selected]!], 'end');
        const index = start === undefined && shuffle ? Math.floor(Math.random() * tracks.length) : selected;
        const offset = Math.min(index, Math.max(0, tracks.length - MAX_QUEUE_ITEMS));
        if (tracks.length > MAX_QUEUE_ITEMS) notify(queueLimitMessage);
        let q: QueueState = {
          items: makeItems(tracks.slice(offset, offset + MAX_QUEUE_ITEMS)),
          index: index - offset,
          original: null,
        };
        if (shuffle) q = enableShuffle(q);
        commit(q);
        void go(q.index, { user: true });
      },
      playAt(track, startSec) {
        commit({ items: makeItems([track]), index: 0, original: null });
        void go(0, { user: false, startAt: startSec });
      },
      stop() {
        intent++;
        clearStall();
        clearReconnect();
        token++; // una carga que todavía resuelve la fuente ya no es la vigente: no pondrá el audio
        pendingStart = null;
        loadedUid = null;
        endFade();
        audio.pause();
        set({ status: get().index >= 0 ? 'paused' : 'idle', reconnecting: false, error: null });
      },
      playIndex(index) {
        if (index >= 0 && index < get().items.length) {
          intent++;
          void go(index, { user: true });
        }
      },
      playNext(tracks) {
        if (!tracks.length) return;
        if (jam?.active()) return jam.request(tracks, 'next');
        const add = fittingTracks(tracks);
        if (!add.length) return;
        commit(insertNext(qs(), makeItems(add)));
        settleEmpty();
      },
      addToQueue(tracks) {
        if (!tracks.length) return 0;
        if (jam?.active()) {
          jam.request(tracks, 'end');
          return 0;
        }
        const add = fittingTracks(tracks);
        if (!add.length) return 0;
        commit(insertBeforeAuto(qs(), makeItems(add))); // lo que pide el usuario va antes de lo que puso la radio
        settleEmpty();
        return add.length;
      },
      removeFromQueue(uid) {
        const { state, wasCurrent } = removeItem(qs(), uid);
        commit(state);
        if (!wasCurrent) return;
        if (state.items.length === 0) {
          get().stop();
          set({ position: 0, duration: 0 });
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

      play() {
        intent++;
        const s = get();
        const item = cur();
        if (!item || s.status === 'loading') return;
        // Sesión restaurada, error o cola terminada: no hay audio cargado que reanudar.
        if (loadedUid !== item.uid || s.status === 'error' || s.status === 'ended') {
          const retry = s.status === 'error' && s.error?.code === 'network';
          const restart = s.status === 'ended' || (s.status === 'error' && !retry);
          void go(s.index, { user: true, startAt: restart ? 0 : s.position, retry });
          return;
        }
        const mine = token;
        if (audio.paused) audio.play().catch((e) => {
          if (mine === token && !isAbort(e)) fail(e, item);
        });
      },
      pause() {
        intent++;
        clearStall();
        if (get().status === 'loading') {
          get().stop();
        } else if (!audio.paused) {
          endFade(); // pausar corta también la canción que se estaba apagando
          audio.pause();
        }
      },
      togglePlay() {
        const s = get();
        if (s.status === 'loading') return;
        if (loadedUid === cur()?.uid && !audio.paused && s.status !== 'error' && s.status !== 'ended') s.pause();
        else s.play();
      },
      networkRestored() {
        radioOnlineEpoch++;
        reconnect?.run();
        retryRadioAfterNetwork();
      },
      next() {
        intent++;
        const s = get();
        const ni = nextIndex(s.items.length, s.index, s.repeat, false);
        if (ni !== null) void go(ni, { user: true });
      },
      prev() {
        intent++;
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
        uninterruptedSince = undefined;
        set({ position: t });
        if (loadedUid === item.uid) audio.currentTime = t; // si no hay audio cargado, se aplica al reproducir
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
        clearStall();
        clearReconnect();
        const items = makeItems(saved.queue);
        const index = items.length ? Math.min(Math.max(saved.index, 0), items.length - 1) : -1;
        set({
          items,
          index,
          original: saved.shuffle && saved.originalOrder ? saved.originalOrder.map((i) => items[i]!) : null,
          repeat: saved.repeat,
          shuffle: saved.shuffle,
          volume: saved.volume,
          muted: saved.muted,
          // La reproducción nunca arranca sola: queda lista en pausa, en la posición guardada.
          status: index >= 0 ? 'paused' : 'idle',
          reconnecting: false,
          position: index >= 0 ? saved.positionSec : 0,
          duration: items[index]?.track.durationSec ?? 0,
        });
        applyVolume();
      },
      snapshot() {
        const s = get();
        const positions = s.original ? new Map(s.items.map((item, i) => [item.uid, i])) : null;
        return {
          queue: s.items.map((i) => i.track),
          index: Math.max(s.index, 0),
          positionSec: Math.floor(s.position),
          volume: s.volume,
          muted: s.muted,
          repeat: s.repeat,
          shuffle: s.shuffle,
          ...(positions && s.original && { originalOrder: s.original.map((item) => positions.get(item.uid)!) }),
        };
      },
    };
  });

  return store;
}
