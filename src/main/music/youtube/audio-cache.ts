import type { StreamQuality } from '../../../shared/settings';
import type { AudioVariant, ResolvedAudio } from '../provider';

const VARIANTS: readonly AudioVariant[] = ['high', 'saver', 'aac'];

/**
 * Caché de audio ya resuelto. La clave incluye la variante: una URL resuelta en Alta no se reutiliza
 * en Ahorro ni en AAC (ni al revés), así que cambiar el ajuste no necesita vaciar nada.
 */
export function createAudioCache(now: () => number) {
  const map = new Map<string, ResolvedAudio>();
  const key = (variant: AudioVariant, trackId: string) => `${variant}:${trackId}`;
  return {
    get(variant: AudioVariant, trackId: string): ResolvedAudio | undefined {
      const hit = map.get(key(variant, trackId));
      return hit && hit.expiresAt > now() ? hit : undefined;
    },
    set(variant: AudioVariant, trackId: string, audio: ResolvedAudio): void {
      map.set(key(variant, trackId), audio);
    },
    /** La URL dejó de valer: se olvida en todas las variantes. */
    invalidate(trackId: string): void {
      for (const v of VARIANTS) map.delete(key(v, trackId));
    },
  };
}

/**
 * Calidad con la que empezó a sonar cada canción. Los pedidos de rangos de esa reproducción (saltos de posición,
 * reintentos) la reutilizan: cambiar el ajuste a mitad de una canción no mezcla bytes de dos archivos distintos.
 * Con tope: al pasarse olvida la más vieja.
 */
export function createQualityLock(max = 200) {
  const map = new Map<string, StreamQuality>();
  return {
    lock(trackId: string, quality: StreamQuality): void {
      map.delete(trackId);
      map.set(trackId, quality);
      if (map.size > max) map.delete(map.keys().next().value as string);
    },
    get(trackId: string): StreamQuality | undefined {
      return map.get(trackId);
    },
  };
}
