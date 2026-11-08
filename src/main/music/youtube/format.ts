import type { AudioVariant } from '../provider';

/** Subconjunto de las opciones de `chooseFormat` de youtubei.js que usamos para audio. */
interface AudioFormatOptions {
  type: 'audio';
  quality: string;
  format?: string;
  codec?: string;
}

/**
 * Elige el formato de audio según la calidad pedida. Siempre prueba Opus primero (Chromium lo reproduce
 * nativamente) y, si el video no tiene, cae a cualquier formato: el mejor en Alta, el más liviano en Ahorro.
 * `aac` es el mejor mp4 (itag 140) y no tiene alternativa: si no hay, falla.
 */
export function chooseAudioFormat<F>(info: { chooseFormat(o: AudioFormatOptions): F }, variant: AudioVariant): F {
  if (variant === 'aac') return info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
  const quality = variant;
  const q = quality === 'saver' ? 'bestefficiency' : 'best';
  try {
    return info.chooseFormat({ type: 'audio', quality: q, format: 'any', codec: 'opus' });
  } catch {
    return info.chooseFormat(quality === 'saver' ? { type: 'audio', quality: q, format: 'any' } : { type: 'audio', quality: q });
  }
}

/** LUFS reales que YouTube mide por canción; fuera de este rango el dato no es creíble. */
const LOUDNESS_RANGE = { min: -60, max: 0 };

/**
 * Loudness de la canción en LUFS absolutos. Se prefiere el del formato (`track_absolute_loudness_lkfs`) y, si no
 * viene, el `perceptual_loudness_db` de la info (VISIONOS no trae `loudness_db`). Un valor basura da `undefined`.
 */
export function loudnessOf(
  info: { player_config?: { audio_config?: { perceptual_loudness_db?: number } } },
  format: { track_absolute_loudness_lkfs?: number },
): number | undefined {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= LOUDNESS_RANGE.min && v <= LOUDNESS_RANGE.max;
  const own = format.track_absolute_loudness_lkfs;
  const fallback = info.player_config?.audio_config?.perceptual_loudness_db;
  return ok(own) ? own : ok(fallback) ? fallback : undefined;
}
