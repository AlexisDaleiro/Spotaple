import type { Track } from '../../../shared/types';

/** Tope de canciones que se cargan de una playlist remota (YouTube las entrega en páginas de ~100). */
export const MAX_PLAYLIST_TRACKS = 200;

/** Lo mínimo de una página de playlist de youtubei.js que usa `collectPlaylistItems`. */
export interface PlaylistPage {
  contents?: unknown[];
  has_continuation: boolean;
  getContinuation(): Promise<PlaylistPage>;
}

/**
 * Junta las canciones de una playlist siguiendo las continuaciones hasta `max`. Los ítems que `map` no reconoce
 * (privados, eliminados) se omiten. `truncated` avisa que quedó algo afuera: por el tope, o porque una
 * continuación falló (en ese caso no se lanza: se devuelve lo ya cargado).
 */
export async function collectPlaylistItems(
  first: PlaylistPage,
  map: (item: unknown) => Track | null,
  max = MAX_PLAYLIST_TRACKS,
): Promise<{ tracks: Track[]; truncated: boolean }> {
  const tracks: Track[] = [];
  const add = (p: PlaylistPage) => {
    for (const item of p.contents ?? []) {
      const t = map(item);
      if (t) tracks.push(t);
    }
  };

  let page = first;
  let failed = false;
  add(page);
  while (page.has_continuation && tracks.length < max) {
    try {
      page = await page.getContinuation();
    } catch {
      failed = true;
      break;
    }
    add(page);
  }

  const over = tracks.length > max;
  if (over) tracks.length = max;
  return { tracks, truncated: failed || over || page.has_continuation };
}
