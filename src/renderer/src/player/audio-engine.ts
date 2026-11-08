import { EQ_BANDS } from '@shared/audio';

export interface EqState {
  on: boolean;
  /** dB por banda (`EQ_BANDS`). */
  gains: readonly number[];
  /** dB. */
  preamp: number;
}

/**
 * Grafo de Web Audio de la app: por cada `<audio>` `fuente → ganancia de la canción`, y un bus común
 * `preamplificador → 10 filtros → salida`. No conoce al reproductor ni los ajustes: quien lo crea le pasa los valores.
 */
export interface AudioEngine {
  setEq(eq: EqState): void;
  /** Ganancia de normalización del elemento, en dB (≤ 0). */
  setTrackGainDb(el: HTMLAudioElement, db: number): void;
  /** Diagnóstico: último nodo antes de la salida. */
  readonly tap: AudioNode;
  readonly elements: readonly HTMLAudioElement[];
  /** Diagnóstico: el nodo de ganancia de cada elemento (los e2e leen su valor). */
  readonly trackGains: ReadonlyMap<HTMLAudioElement, GainNode>;
}

const dbToGain = (db: number) => 10 ** ((Number.isFinite(db) ? db : 0) / 20);
/** Constante de tiempo de los cambios (s): suave para que mover un control no haga chasquidos. */
const SMOOTH_S = 0.015;

/**
 * Conecta los elementos al grafo. Devuelve `null` si Web Audio no está o falla antes de tocar los elementos (así el
 * `<audio>` suena como siempre). Ojo: una vez conectado, un elemento solo suena a través del grafo.
 * Requiere que el medio sea CORS (`crossOrigin="anonymous"`); si no, Web Audio emite silencio.
 */
export function createAudioEngine(elements: HTMLAudioElement[]): AudioEngine | null {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  try {
    const preamp = ctx.createGain();
    let prev: AudioNode = preamp;
    const filters = EQ_BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1;
      f.gain.value = 0;
      prev.connect(f);
      prev = f;
      return f;
    });
    const tap = ctx.createGain();
    prev.connect(tap);
    tap.connect(ctx.destination);

    const trackGains = new Map<HTMLAudioElement, GainNode>();
    for (const el of elements) {
      const gain = ctx.createGain();
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(preamp);
      trackGains.set(el, gain);
      // Con la política de autoplay de la app el contexto arranca en marcha; esto cubre que quede suspendido.
      el.addEventListener('play', () => void ctx.resume());
    }
    if (ctx.state === 'suspended') void ctx.resume();

    return {
      setEq({ on, gains, preamp: preampDb }) {
        const t = ctx.currentTime;
        preamp.gain.setTargetAtTime(on ? dbToGain(preampDb) : 1, t, SMOOTH_S);
        filters.forEach((f, i) => f.gain.setTargetAtTime(on ? (Number.isFinite(gains[i]) ? gains[i]! : 0) : 0, t, SMOOTH_S));
      },
      setTrackGainDb(el, db) {
        trackGains.get(el)?.gain.setTargetAtTime(dbToGain(db), ctx.currentTime, SMOOTH_S);
      },
      tap,
      elements,
      trackGains,
    };
  } catch {
    void ctx.close().catch(() => undefined);
    return null;
  }
}
