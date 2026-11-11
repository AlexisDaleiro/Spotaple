import type { ArtistRef, Track } from './types';

/**
 * Valida una canción que llega de fuera (el renderer, o un miembro de una sala del jam): los títulos y
 * URLs vienen de una fuente remota, así que se tratan como datos. Código puro, sin Electron ni Node:
 * lo comparten main y el relé.
 */
const bad = () => new Error('Solicitud inválida.');

/** Clave estable de un artista: su `channel_id` si lo tiene, si no el nombre en minúsculas. */
export const artistKey = (a: ArtistRef): string => a.id ?? a.name.trim().toLowerCase();

/**
 * «La misma canción» para no repetirla: título + artista principal. Una misma canción puede tener varios ids de
 * YouTube (la de álbum y la del video), así que comparar por id no alcanza.
 */
export const songKey = (t: Pick<Track, 'title' | 'artists'>): string => `${t.title.trim().toLowerCase()}|${t.artists[0] ? artistKey(t.artists[0]) : ''}`;

const str = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw bad();
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
/** Enlace público para una pista del catálogo de YouTube Music. */
export const trackLink = (id: string): string | null =>
  /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://music.youtube.com/watch?v=${id}` : null;
