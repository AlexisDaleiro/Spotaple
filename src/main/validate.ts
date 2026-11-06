import type { ArtistRef, PersistedPlayerState, Track } from '../shared/types';
import { MusicError } from './music/youtube/errors';

/**
 * Todo lo que llega del renderer se valida antes de tocar la base de datos: el renderer puede
 * tener errores y los títulos/URLs vienen de una fuente remota, así que se tratan como datos.
 */
const bad = () => new MusicError('unknown', 'Solicitud inválida.');

export const str = (v: unknown, max = 200): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw bad();
  return v;
};
export const id = (v: unknown): string => {
  const s = str(v, 64);
  if (!/^[\w-]+$/.test(s)) throw bad();
  return s;
};
export const int = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw bad();
  return v;
};

export function sanitizeTrack(v: unknown): Track {
  const t = v as Partial<Track> | null;
  if (!t || typeof t !== 'object') throw bad();
  const trackId = str(t.id, 24);
  if (!/^[\w-]{6,24}$/.test(trackId)) throw bad();
  if (!Array.isArray(t.artists) || t.artists.length > 12) throw bad();
  const artists: ArtistRef[] = t.artists.map((a) => ({
    id: typeof a?.id === 'string' && a.id.length <= 64 ? a.id : undefined,
    name: str(a?.name, 200),
  }));
  // Solo https: nada de file:, data: ni javascript: llega a la base de datos.
  const thumb = typeof t.thumbnail === 'string' && t.thumbnail.startsWith('https://') && t.thumbnail.length <= 600 ? t.thumbnail : undefined;
  return {
    id: trackId,
    title: str(t.title, 300),
    artists,
    album: t.album?.title ? { id: typeof t.album.id === 'string' ? t.album.id.slice(0, 64) : undefined, title: str(t.album.title, 300) } : undefined,
    durationSec: typeof t.durationSec === 'number' && t.durationSec >= 0 ? Math.round(t.durationSec) : undefined,
    thumbnail: thumb,
  };
}

export function sanitizePlayerState(v: unknown): PersistedPlayerState {
  const s = v as Partial<PersistedPlayerState> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.queue) || s.queue.length > 2000) throw bad();
  const queue = s.queue.map(sanitizeTrack);
  const num = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  return {
    queue,
    index: Math.round(num(s.index, 0, 0, Math.max(0, queue.length - 1))),
    positionSec: num(s.positionSec, 0, 0, 86_400),
    volume: num(s.volume, 0.8, 0, 1),
    muted: s.muted === true,
    repeat: s.repeat === 'all' || s.repeat === 'one' ? s.repeat : 'off',
    shuffle: s.shuffle === true,
  };
}
