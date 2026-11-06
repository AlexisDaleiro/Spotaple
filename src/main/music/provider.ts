import type { AlbumDetail, ArtistDetail, SearchResults } from '../../shared/types';

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
  resolveAudio(trackId: string): Promise<ResolvedAudio>;
  /** Olvida la fuente de audio guardada (la URL dejó de ser válida). */
  invalidate(trackId: string): void;
}
