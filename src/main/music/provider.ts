import type { AlbumDetail, ArtistDetail, RemotePlaylistDetail, SearchResults } from '../../shared/types';

/** Fuente de audio temporal. NUNCA se persiste: la URL caduca y se resuelve de nuevo. */
export interface ResolvedAudio {
  url: string;
  mimeType: string;
  contentLength?: number;
  /** epoch ms desde el cual la URL se considera caducada. */
  expiresAt: number;
  durationSec?: number;
}

/**
 * Contrato del proveedor musical. Hoy existe una sola implementación (YouTube.js, no oficial);
 * cambiarla no debería tocar ni la interfaz ni la base de datos.
 */
export interface MusicProvider {
  search(query: string): Promise<SearchResults>;
  getAlbum(id: string): Promise<AlbumDetail>;
  getArtist(id: string): Promise<ArtistDetail>;
  /** Playlist de YouTube Music con sus canciones (hasta un tope; `truncated` avisa si había más). */
  getPlaylist(id: string): Promise<RemotePlaylistDetail>;
  /** `newPlay`: la canción empieza ahora (usa la calidad vigente y la fija para esa reproducción). Sin él, se respeta la fijada. */
  resolveAudio(trackId: string, opts?: { newPlay?: boolean }): Promise<ResolvedAudio>;
  /** Olvida la fuente de audio guardada (la URL dejó de ser válida). */
  invalidate(trackId: string): void;
}
