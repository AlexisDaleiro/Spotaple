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
