/**
 * Convierte los nodos parseados de YouTube.js en nuestros modelos.
 * Los nodos remotos son DATOS no confiables y a veces incompletos: todo es opcional y se recorta.
 * Campos verificados contra youtubei.js 18.3.0 (MusicResponsiveListItem, MusicTwoRowItem,
 * MusicResponsiveHeader). Ver README: "Qué devuelve YouTube Music".
 */
import type { AlbumSummary, ArtistRef, ArtistSummary, Track } from '../../../shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

const MAX = 300;

/** Texto de un `Text` de YouTube.js o de un string. */
export function txt(x: unknown): string {
  if (x == null) return '';
  const s = typeof x === 'string' ? x : typeof (x as { toString?: unknown }).toString === 'function' ? String(x) : '';
  return s === '[object Object]' ? '' : s.trim().slice(0, MAX);
}

/** Elige la miniatura de mayor ancho. El renderer la redimensiona con `thumbUrl`. */
export function bestThumb(thumbs: unknown): string | undefined {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined;
  const sorted = [...thumbs].filter((t) => typeof t?.url === 'string').sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const url = sorted[0]?.url as string | undefined;
  return url && url.startsWith('https://') ? url : undefined;
}

const flexText = (item: Node, i: number): string => txt(item?.flex_columns?.[i]?.title);

function toRefs(list: unknown): ArtistRef[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((a) => ({ id: typeof a?.channel_id === 'string' ? a.channel_id : undefined, name: txt(a?.name) }))
    .filter((a) => a.name && a.name !== 'N/A');
}

/** "Daft Punk • One More Time • 5:21" → partes. */
const parts = (s: string) => s.split('•').map((p) => p.trim()).filter(Boolean);

export interface TrackFallback {
  artists?: ArtistRef[];
  album?: { id?: string; title: string };
  thumbnail?: string;
}

/** Item de lista de canción/video musical → Track. Devuelve null si no hay un videoId usable. */
export function mapTrack(item: Node, fallback: TrackFallback = {}): Track | null {
  const id = typeof item?.id === 'string' ? item.id : undefined;
  if (!id || !/^[\w-]{6,24}$/.test(id)) return null;
  const title = txt(item.title) || flexText(item, 0);
  if (!title) return null;

  let artists = toRefs(item.artists);
  if (!artists.length) artists = toRefs(item.authors);
  if (!artists.length) {
    const sub = flexText(item, 1);
    const first = parts(sub)[0];
    if (first && first !== 'N/A') artists = [{ name: first.slice(0, 200) }];
  }
  if (!artists.length && fallback.artists?.length) artists = fallback.artists;

  let album: Track['album'];
  if (item.album?.name) album = { id: typeof item.album.id === 'string' ? item.album.id : undefined, title: txt(item.album.name) };
  else if (item.item_type === 'song' && flexText(item, 3)) album = { title: flexText(item, 3) };
  else album = fallback.album;

  const thumbs = Array.isArray(item.thumbnails) && item.thumbnails.length ? item.thumbnails : item.thumbnail?.contents;
  const seconds = item.duration?.seconds;
  return {
    id,
    title,
    artists,
    album,
    durationSec: typeof seconds === 'number' && seconds > 0 ? Math.round(seconds) : undefined,
    thumbnail: bestThumb(thumbs) ?? fallback.thumbnail,
  };
}

const KINDS = new Set(['Album', 'Single', 'EP']);

/** Álbum (de búsqueda o carrusel de artista) → AlbumSummary. */
export function mapAlbum(item: Node, fallbackArtist?: ArtistRef): AlbumSummary | null {
  const id = typeof item?.id === 'string' ? item.id : undefined;
  const title = txt(item?.title) || flexText(item, 0);
  if (!id || !title) return null;
  const sub = txt(item.subtitle) || flexText(item, 1);
  const p = parts(sub);
  const kind = p.find((x) => KINDS.has(x));
  const year = (typeof item.year === 'string' && item.year) || p.find((x) => /^\d{4}$/.test(x));
  let artists = toRefs(item.artists);
  if (!artists.length) artists = toRefs(item.authors);
  if (!artists.length) {
    const name = p.find((x) => !KINDS.has(x) && !/^\d{4}$/.test(x));
    if (name) artists = [{ name: name.slice(0, 200) }];
  }
  if (!artists.length && fallbackArtist) artists = [fallbackArtist];
  const thumbs = Array.isArray(item.thumbnail) ? item.thumbnail : item.thumbnail?.contents;
  return { id, title, artists, year, kind, thumbnail: bestThumb(thumbs) };
}

export function mapArtist(item: Node): ArtistSummary | null {
  const id = typeof item?.id === 'string' ? item.id : undefined;
  const name = txt(item?.name) || txt(item?.title) || flexText(item, 0);
  if (!id || !name) return null;
  const subtitle = (txt(item.subtitle) || flexText(item, 1)).replace(/^Artist\s*•\s*/i, '') || undefined;
  const thumbs = Array.isArray(item.thumbnail) ? item.thumbnail : item.thumbnail?.contents;
  return { id, name, subtitle, thumbnail: bestThumb(thumbs) };
}

/** Aplana los items de todas las secciones de un resultado de búsqueda. */
export function searchItems(search: Node): Node[] {
  const shelves: Node[] = Array.isArray(search?.contents) ? search.contents : [];
  return shelves.flatMap((s) => (Array.isArray(s?.contents) ? s.contents : []));
}

export const isTrackItem = (i: Node) => i?.item_type === 'song' || i?.item_type === 'video';
