// Modelos compartidos entre main, preload y renderer. Solo datos serializables.

/** Identificadores de YouTube Music: duraderos. Las URLs de audio NO se guardan nunca. */
export interface ArtistRef {
  id?: string;
  name: string;
}

export interface Track {
  /** videoId de YouTube (durable). */
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: { id?: string; title: string };
  durationSec?: number;
  /** URL base de portada (puede admitir redimensionado, ver `thumbUrl` en el renderer). */
  thumbnail?: string;
}

export interface AlbumSummary {
  id: string;
  title: string;
  artists: ArtistRef[];
  year?: string;
  thumbnail?: string;
  kind?: string;
}

export interface ArtistSummary {
  id: string;
  name: string;
  thumbnail?: string;
  subtitle?: string;
}

/** Playlist de YouTube Music vista en una búsqueda. La búsqueda no informa cuántas canciones tiene. */
export interface RemotePlaylistSummary {
  /** Id de YouTube Music (viene con prefijo `VL`); sirve tal cual para pedir la playlist. */
  id: string;
  title: string;
  author?: string;
  thumbnail?: string;
}

export interface RemotePlaylistDetail extends RemotePlaylistSummary {
  tracks: Track[];
  /** Cantidad total que declara la playlist (puede ser mayor que `tracks.length`). */
  trackCount?: number;
  /** true si la lista es más larga que el tope y se cargó solo el principio. */
  truncated: boolean;
}

export interface SearchResults {
  query: string;
  songs: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: RemotePlaylistSummary[];
  /** true si alguna de las búsquedas parciales falló y los resultados están incompletos. */
  partial: boolean;
}

export const SEARCH_CATEGORIES = ['song', 'album', 'artist', 'playlist'] as const;
export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

export interface AlbumDetail extends AlbumSummary {
  tracks: Track[];
}

export interface ArtistDetail extends ArtistSummary {
  description?: string;
  topSongs: Track[];
  albums: AlbumSummary[];
  singles: AlbumSummary[];
  /** «Fans might also like»: artistas parecidos (vacío si YouTube no trae la sección). */
  similar: ArtistSummary[];
}

export interface PlaylistSummary {
  id: number;
  name: string;
  trackCount: number;
  durationSec: number;
  /** Hasta 4 portadas para el mosaico. */
  covers: string[];
  updatedAt: number;
}

export interface PlaylistItem {
  itemId: number;
  track: Track;
}

export interface PlaylistDetail extends PlaylistSummary {
  items: PlaylistItem[];
}

export type RepeatMode = 'off' | 'all' | 'one';

export const MAX_QUEUE_ITEMS = 2000;

/** Estado del reproductor que sobrevive entre sesiones (la reproducción nunca se reanuda sola). */
export interface PersistedPlayerState {
  queue: Track[];
  index: number;
  positionSec: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Índices dentro de `queue` en el orden anterior a mezclarla. */
  originalOrder?: number[];
}

export type ErrorCode = 'network' | 'unavailable' | 'region' | 'parse' | 'unknown';

export interface IpcError {
  code: ErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export interface PreparedAudio {
  trackId: string;
  mimeType: string;
  durationSec?: number;
  /** Loudness en LUFS absolutos (un número: la URL nunca sale de main). */
  loudnessLkfs?: number;
}
