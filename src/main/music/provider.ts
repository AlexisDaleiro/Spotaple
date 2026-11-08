import type { StreamQuality } from '../../shared/settings';
import type { AlbumDetail, ArtistDetail, RemotePlaylistDetail, SearchResults, Track } from '../../shared/types';

/** Qué audio se pide: la calidad de streaming (Opus) o AAC. Con una variante explícita no rige el ajuste de calidad. */
export type AudioVariant = StreamQuality | 'aac';

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
  /** Canciones sugeridas a partir de una canción («radio»): la propia semilla viene primero. */
  getRadio(videoId: string): Promise<Track[]>;
  /**
   * `newPlay`: la canción empieza ahora (usa la calidad vigente y la fija para esa reproducción). Sin él, se respeta la fijada.
   * `variant`: pide ese audio exacto (descargas), sin mirar el ajuste de calidad ni fijar nada.
   */
  resolveAudio(trackId: string, opts?: { newPlay?: boolean; variant?: AudioVariant }): Promise<ResolvedAudio>;
  /** Olvida la fuente de audio guardada (la URL dejó de ser válida). */
  invalidate(trackId: string): void;
}
