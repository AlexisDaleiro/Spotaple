import type { StreamQuality } from '../../../shared/settings';
import type { ResolvedAudio } from '../provider';

/**
 * Caché de audio ya resuelto. La clave incluye la calidad: una URL resuelta en Alta no se reutiliza
 * en Ahorro (ni al revés), así que cambiar el ajuste no necesita vaciar nada.
 */
export function createAudioCache(now: () => number) {
  const map = new Map<string, ResolvedAudio>();
  const key = (quality: StreamQuality, trackId: string) => `${quality}:${trackId}`;
  return {
    get(quality: StreamQuality, trackId: string): ResolvedAudio | undefined {
      const hit = map.get(key(quality, trackId));
      return hit && hit.expiresAt > now() ? hit : undefined;
    },
    set(quality: StreamQuality, trackId: string, audio: ResolvedAudio): void {
      map.set(key(quality, trackId), audio);
    },
    /** La URL dejó de valer: se olvida en ambas calidades. */
    invalidate(trackId: string): void {
      map.delete(key('high', trackId));
      map.delete(key('saver', trackId));
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
