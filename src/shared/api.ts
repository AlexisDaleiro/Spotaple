import type {
  AlbumDetail,
  ArtistDetail,
  IpcResult,
  PersistedPlayerState,
  PlaylistDetail,
  PlaylistSummary,
  PreparedAudio,
  SearchResults,
  Track,
} from './types';

/** Esquema de la URL que sirve el audio. El renderer solo conoce el videoId. */
export const AUDIO_SCHEME = 'spotaple-audio';
export const audioUrl = (trackId: string) => `${AUDIO_SCHEME}://track/${encodeURIComponent(trackId)}`;

/** Canales IPC. Única lista: main registra y preload invoca desde aquí. */
export const IPC = {
  search: 'music:search',
  album: 'music:album',
  artist: 'music:artist',
  prepare: 'music:prepare',
  invalidate: 'music:invalidate',
  favorites: 'lib:favorites',
  favoriteIds: 'lib:favorite-ids',
  toggleFavorite: 'lib:toggle-favorite',
  playlists: 'lib:playlists',
  playlist: 'lib:playlist',
  createPlaylist: 'lib:create-playlist',
  renamePlaylist: 'lib:rename-playlist',
  deletePlaylist: 'lib:delete-playlist',
  addToPlaylist: 'lib:add-to-playlist',
  removeFromPlaylist: 'lib:remove-from-playlist',
  reorderPlaylist: 'lib:reorder-playlist',
  recentPlays: 'lib:recent-plays',
  recordSelection: 'lib:record-selection',
  recordPlay: 'lib:record-play',
  loadPlayerState: 'state:load',
  savePlayerState: 'state:save',
} as const;

/** API que el preload expone en `window.spotaple`. Cada método lanza `Error` con `.code` si falla. */
export interface SpotapleApi {
  music: {
    search(query: string): Promise<SearchResults>;
    album(id: string): Promise<AlbumDetail>;
    artist(id: string): Promise<ArtistDetail>;
    /** Resuelve la fuente de audio (si hace falta) y confirma que se puede reproducir. */
    prepare(trackId: string): Promise<PreparedAudio>;
    /** Descarta la fuente guardada: la URL ya no es válida y debe resolverse de nuevo. */
    invalidate(trackId: string): Promise<void>;
  };
  library: {
    favorites(): Promise<Track[]>;
    favoriteIds(): Promise<string[]>;
    toggleFavorite(track: Track): Promise<boolean>;
    playlists(): Promise<PlaylistSummary[]>;
    playlist(id: number): Promise<PlaylistDetail>;
    createPlaylist(name: string): Promise<PlaylistSummary>;
    renamePlaylist(id: number, name: string): Promise<void>;
    deletePlaylist(id: number): Promise<void>;
    /** Devuelve cuántas canciones se agregaron (las repetidas se omiten). */
    addToPlaylist(id: number, tracks: Track[]): Promise<number>;
    removeFromPlaylist(id: number, itemId: number): Promise<void>;
    reorderPlaylist(id: number, orderedItemIds: number[]): Promise<void>;
    recentPlays(limit: number): Promise<Track[]>;
    /** Canción elegida por el usuario (aunque no llegue a sonar). */
    recordSelection(track: Track): Promise<void>;
    /** Canción que realmente empezó a sonar. */
    recordPlay(track: Track): Promise<void>;
  };
  state: {
    load(): Promise<PersistedPlayerState | null>;
    save(state: PersistedPlayerState): Promise<void>;
  };
  platform: 'win32' | 'darwin' | 'linux';
}

/**
 * Lo que realmente cruza el contextBridge: cada método resuelve un `IpcResult`.
 * (Las clases Error pierden sus propiedades al cruzar el puente, por eso el error viaja como dato
 * y el renderer lo vuelve a convertir en `Error` con `.code`.)
 */
type Wrap<T> = T extends (...a: infer A) => Promise<infer R>
  ? (...a: A) => Promise<IpcResult<R>>
  : T extends object
    ? { [K in keyof T]: Wrap<T[K]> }
    : T;
export type SpotapleBridge = Wrap<SpotapleApi>;

declare global {
  interface Window {
    spotapleBridge: SpotapleBridge;
  }
}
