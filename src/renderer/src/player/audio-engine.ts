import { crossfadeCurve, EQ_BANDS } from '@shared/audio';

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
  /** Baja el volumen del elemento de 1 a 0 en `sec` segundos (potencia constante); el elemento sigue sonando. */
  fadeOut(el: HTMLAudioElement, sec: number): void;
  /** Sube el volumen del elemento de 0 a 1 en `sec` segundos (potencia constante). */
  fadeIn(el: HTMLAudioElement, sec: number): void;
  /** Cancela cualquier rampa del elemento y lo deja en volumen 1. */
  unfade(el: HTMLAudioElement): void;
  /** Diagnóstico: último nodo antes de la salida. */
  readonly tap: AudioNode;
  readonly elements: readonly HTMLAudioElement[];
  /** Diagnóstico: el nodo de ganancia de cada elemento (los e2e leen su valor). */
  readonly trackGains: ReadonlyMap<HTMLAudioElement, GainNode>;
  /** Diagnóstico: el nodo de fundido de cada elemento. */
  readonly fadeGains: ReadonlyMap<HTMLAudioElement, GainNode>;
}

const CURVE_POINTS = 64;
/** Una rampa más corta que esto no es un fundido (y `setValueCurveAtTime` no acepta duración 0). */
const MIN_FADE_S = 0.05;

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
    const fadeGains = new Map<HTMLAudioElement, GainNode>();
    for (const el of elements) {
      const gain = ctx.createGain();
      const fade = ctx.createGain();
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(fade);
      fade.connect(preamp);
      trackGains.set(el, gain);
      fadeGains.set(el, fade);
      // Con la política de autoplay de la app el contexto arranca en marcha; esto cubre que quede suspendido.
      el.addEventListener('play', () => void ctx.resume());
    }
    if (ctx.state === 'suspended') void ctx.resume();

    const ramp = (el: HTMLAudioElement, dir: 'in' | 'out', sec: number) => {
      const g = fadeGains.get(el)?.gain;
      if (!g) return;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueCurveAtTime(crossfadeCurve(CURVE_POINTS, dir), ctx.currentTime, Math.max(sec, MIN_FADE_S));
    };

    return {
      setEq({ on, gains, preamp: preampDb }) {
        const t = ctx.currentTime;
        preamp.gain.setTargetAtTime(on ? dbToGain(preampDb) : 1, t, SMOOTH_S);
        filters.forEach((f, i) => f.gain.setTargetAtTime(on ? (Number.isFinite(gains[i]) ? gains[i]! : 0) : 0, t, SMOOTH_S));
      },
      setTrackGainDb(el, db) {
        trackGains.get(el)?.gain.setTargetAtTime(dbToGain(db), ctx.currentTime, SMOOTH_S);
      },
      fadeOut(el, sec) {
        ramp(el, 'out', sec);
      },
      fadeIn(el, sec) {
        ramp(el, 'in', sec);
      },
      unfade(el) {
        const g = fadeGains.get(el)?.gain;
        if (!g) return;
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(1, ctx.currentTime);
      },
      tap,
      elements,
      trackGains,
      fadeGains,
    };
  } catch {
    void ctx.close().catch(() => undefined);
    return null;
  }
}
