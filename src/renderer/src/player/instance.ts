import { useStore } from 'zustand';
import { api } from '../api';
import { artistsText, thumbUrl } from '../lib/format';
import { useJam } from '../stores/jam';
import { useOffline } from '../stores/offline';
import { settingsStore } from '../stores/settings';
import { toast } from '../stores/ui';
import { normalizationGainDb } from '@shared/audio';
import { createAudioEngine } from './audio-engine';
import { createJamHook } from './jam-sync';
import { createPlayer, type PlayerActions, type PlayerState } from './player';

/**
 * Una sola instancia de reproducción para toda la app: vive fuera de React, así que cambiar de
 * pantalla o desmontar componentes nunca reinicia ni duplica el audio.
 */
const audio = new Audio();
audio.preload = 'auto';
// Web Audio (ecualizador) exige un medio con CORS: sin esto emite silencio. Va antes de cualquier `src`; main responde
// con `Access-Control-Allow-Origin` (ver audio-protocol.ts).
audio.crossOrigin = 'anonymous';

// Motor de sonido: ecualizador y ganancia por canción. Si Web Audio no está, `engine` es null y el audio suena como siempre.
const engine = createAudioEngine([audio]);
let loudness: number | undefined; // LUFS de la canción en curso
const applyNormalization = () => engine?.setTrackGainDb(audio, settingsStore.getState().settings.normalize ? normalizationGainDb(loudness) : 0);
if (engine) {
  const applyEq = () => {
    const s = settingsStore.getState().settings;
    engine.setEq({ on: s.eqOn, gains: s.eqGains, preamp: s.eqPreamp });
  };
  let seen = settingsStore.getState().settings;
  applyEq();
  settingsStore.subscribe((state) => {
    if (state.settings === seen) return;
    seen = state.settings;
    applyEq();
    applyNormalization(); // activar o apagar «Normalizar» con una canción sonando vale al instante
  });
  // Diagnóstico (mismo interruptor que los eventos del audio): los e2e leen el grafo desde acá.
  try {
    if (localStorage.getItem('debugAudio') === '1') (globalThis as { __spotapleAudio?: unknown }).__spotapleAudio = engine;
  } catch {
    /* sin acceso a localStorage: sin diagnóstico */
  }
}

// Diagnóstico opcional: en la consola, `localStorage.debugAudio = '1'` y recargar traza los eventos del audio.
try {
  if (localStorage.getItem('debugAudio') === '1') {
    for (const ev of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'ended', 'error', 'emptied', 'abort']) {
      audio.addEventListener(ev, () => {
        const b = Array.from({ length: audio.buffered.length }, (_, i) => `${audio.buffered.start(i).toFixed(0)}-${audio.buffered.end(i).toFixed(0)}`).join(',');
        const s = Array.from({ length: audio.seekable.length }, (_, i) => `${audio.seekable.start(i).toFixed(0)}-${audio.seekable.end(i).toFixed(0)}`).join(',');
        console.debug(`[audio:${ev}] t=${audio.currentTime.toFixed(1)} dur=${audio.duration} ready=${audio.readyState} net=${audio.networkState} buffered=[${b}] seekable=[${s}] err=${audio.error?.code ?? '-'}`);
      });
    }
  }
} catch {
  /* sin acceso a localStorage: sin diagnóstico */
}

export const playerStore = createPlayer({
  audio,
  api: {
    prepare: (id) => api.music.prepare(id),
    invalidate: (id) => api.music.invalidate(id),
    recordSelection: (t) => api.library.recordSelection(t),
    recordPlay: (t, auto?: boolean) => api.library.recordPlay(t, auto),
  },
  notify: (message, kind) => toast(message, kind === 'error' ? 'error' : 'info'),
  onPrepared: (prepared) => {
    loudness = prepared.loudnessLkfs;
    applyNormalization();
  },
  // Sin red solo suenan las canciones descargadas: lo demás se salta con aviso.
  reachable: (id) => useOffline.getState().reachable(id),
  isDownloaded: (id) => useOffline.getState().ids.has(id),
  // Radio automática: el ajuste se lee en cada decisión, así que apagarla vale al instante.
  radio: { enabled: () => settingsStore.getState().settings.radio, fetch: (seed, ids) => api.music.radio(seed, ids) },
  // Dentro de una sala, pedir canciones las manda a la sala (ver jam-sync.ts).
  jam: createJamHook({
    getView: () => useJam.getState().view,
    send: (m) => void api.jam.send(m).catch(() => undefined),
    notify: (message) => toast(message, 'success'),
  }),
});

/** Mientras hay sala la cola del reproductor es la de la sala: no se guarda como cola personal. */
export const persistence = { suspended: false };

export const usePlayer = <T>(selector: (s: PlayerState & PlayerActions) => T): T => useStore(playerStore, selector);
export const player = () => playerStore.getState();

/** Estado actual de la pista en curso (o undefined). */
export const currentItem = (s: PlayerState) => s.items[s.index];

/** Restaura cola/selección/volumen y empieza a guardarlos. La reproducción NO arranca sola. */
export async function startPlayerPersistence() {
  try {
    playerStore.getState().hydrate(await api.state.load());
  } catch {
    /* sin estado previo: se arranca limpio */
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSave = 0;
  let last = playerStore.getState();

  const save = () => {
    timer = undefined;
    if (persistence.suspended) return;
    lastSave = Date.now();
    api.state.save(playerStore.getState().snapshot()).catch(() => undefined);
  };
  const schedule = (delay: number) => {
    if (timer === undefined) timer = setTimeout(save, delay);
  };

  playerStore.subscribe((s) => {
    const structural =
      s.items !== last.items || s.index !== last.index || s.volume !== last.volume || s.muted !== last.muted || s.repeat !== last.repeat || s.shuffle !== last.shuffle;
    const status = s.status !== last.status;
    last = s;
    if (structural) schedule(400);
    else if (status && (s.status === 'paused' || s.status === 'ended')) schedule(100);
    else if (s.status === 'playing' && Date.now() - lastSave > 5000) schedule(0); // posición cada ~5 s
  });

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    save();
  };
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

/** Teclas multimedia y tarjeta del sistema (Windows). */
export function startMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const p = () => playerStore.getState();
  ms.setActionHandler('play', () => p().togglePlay());
  ms.setActionHandler('pause', () => p().togglePlay());
  ms.setActionHandler('nexttrack', () => p().next());
  ms.setActionHandler('previoustrack', () => p().prev());
  ms.setActionHandler('seekto', (d) => d.seekTime !== undefined && p().seek(d.seekTime));

  let lastId = '';
  playerStore.subscribe((s) => {
    const item = currentItem(s);
    if (item && item.uid !== lastId) {
      lastId = item.uid;
      const art = thumbUrl(item.track.thumbnail, 256);
      ms.metadata = new MediaMetadata({
        title: item.track.title,
        artist: artistsText(item.track.artists),
        album: item.track.album?.title ?? '',
        artwork: art ? [{ src: art, sizes: '256x256' }] : [],
      });
    }
    ms.playbackState = s.status === 'playing' || s.status === 'buffering' ? 'playing' : item ? 'paused' : 'none';
  });
}
