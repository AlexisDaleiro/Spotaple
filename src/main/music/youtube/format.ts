import type { StreamQuality } from '../../../shared/settings';

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
 */
export function chooseAudioFormat<F>(info: { chooseFormat(o: AudioFormatOptions): F }, quality: StreamQuality): F {
  const q = quality === 'saver' ? 'bestefficiency' : 'best';
  try {
    return info.chooseFormat({ type: 'audio', quality: q, format: 'any', codec: 'opus' });
  } catch {
    return info.chooseFormat(quality === 'saver' ? { type: 'audio', quality: q, format: 'any' } : { type: 'audio', quality: q });
  }
}
