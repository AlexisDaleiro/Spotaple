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

export interface SearchResults {
  query: string;
  songs: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  /** true si alguna de las búsquedas parciales falló y los resultados están incompletos. */
  partial: boolean;
}

export interface AlbumDetail extends AlbumSummary {
  tracks: Track[];
}

export interface ArtistDetail extends ArtistSummary {
  description?: string;
  topSongs: Track[];
  albums: AlbumSummary[];
  singles: AlbumSummary[];
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

/** Estado del reproductor que sobrevive entre sesiones (la reproducción nunca se reanuda sola). */
export interface PersistedPlayerState {
  queue: Track[];
  index: number;
  positionSec: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
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
}
