// Constantes y funciones puras del sonido (ecualizador, normalización y fundido). Sin Web Audio: se prueban en node.

/** Frecuencias centrales de las 10 bandas del ecualizador, en Hz. */
export const EQ_BANDS: readonly number[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
/** Cada banda y el preamplificador van de −12 a +12 dB. */
export const EQ_RANGE_DB = 12;
/** Objetivo de la normalización: la referencia de YouTube. */
export const NORMALIZE_TARGET_LKFS = -14;
/** Lo máximo que la normalización baja una canción. */
const NORMALIZE_MAX_CUT_DB = 12;

export interface EqPreset {
  id: string;
  label: string;
  gains: readonly number[];
  /** Compensa el mayor realce del preset para que no sature. */
  preamp: number;
}

export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 'plano', label: 'Plano', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  { id: 'graves', label: 'Más graves', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preamp: -6 },
  { id: 'agudos', label: 'Más agudos', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6], preamp: -6 },
  { id: 'voz', label: 'Voz', gains: [-2, -2, -1, 0, 2, 3, 3, 2, 0, -1], preamp: -3 },
  { id: 'rock', label: 'Rock', gains: [4, 3, 2, 0, -1, -1, 1, 3, 4, 4], preamp: -4 },
  { id: 'pop', label: 'Pop', gains: [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1], preamp: -4 },
  { id: 'electronica', label: 'Electrónica', gains: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5], preamp: -5 },
];

/** El preset cuyos valores coinciden exactos con los dados, o `null` («Personalizado»). */
export function presetFor(gains: readonly number[], preamp: number): EqPreset | null {
  return EQ_PRESETS.find((p) => p.preamp === preamp && p.gains.length === gains.length && p.gains.every((g, i) => g === gains[i])) ?? null;
}

/**
 * Ganancia (dB) que lleva una canción de `lkfs` LUFS hacia el objetivo: solo baja (sin limitador, subir saturaría) y
 * nunca más de 12 dB. Sin loudness, o con un valor que no es un número, no hay ajuste.
 */
export function normalizationGainDb(lkfs: number | undefined): number {
  if (lkfs === undefined || !Number.isFinite(lkfs)) return 0;
  return Math.min(0, Math.max(-NORMALIZE_MAX_CUT_DB, NORMALIZE_TARGET_LKFS - lkfs));
}

/** Curva de potencia constante para el fundido: `out` baja de 1 a 0 (coseno) y `in` sube de 0 a 1 (seno). */
export function crossfadeCurve(points: number, dir: 'in' | 'out'): Float32Array {
  const curve = new Float32Array(points);
  const last = Math.max(points - 1, 1);
  for (let i = 0; i < points; i++) {
    const t = (i / last) * (Math.PI / 2);
    curve[i] = dir === 'in' ? Math.sin(t) : Math.cos(t);
  }
  return curve;
}
