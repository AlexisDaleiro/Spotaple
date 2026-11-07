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
