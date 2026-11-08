import type {
  AlbumDetail,
  ArtistDetail,
  IpcResult,
  PersistedPlayerState,
  PlaylistDetail,
  PlaylistSummary,
  PreparedAudio,
  RemotePlaylistDetail,
  SearchResults,
  Track,
} from './types';
import type { JamView } from './jam/types';
import type { DiscoverState } from './discover';
import type { AudioFormat, ExportResult, OfflineState } from './offline';
import type { AppSettings } from './settings';
import type { UpdateState } from './updates';

/** Esquema de la URL que sirve el audio. El renderer solo conoce el videoId. */
export const AUDIO_SCHEME = 'spotaple-audio';
export const audioUrl = (trackId: string) => `${AUDIO_SCHEME}://track/${encodeURIComponent(trackId)}`;

/** Canales IPC. Única lista: main registra y preload invoca desde aquí. */
export const IPC = {
  search: 'music:search',
  album: 'music:album',
  artist: 'music:artist',
  remotePlaylist: 'music:remote-playlist',
  radio: 'music:radio',
  prepare: 'music:prepare',
  invalidate: 'music:invalidate',
  export: 'music:export',
  offlineGet: 'offline:get',
  offlineSync: 'offline:sync',
  offlineClear: 'offline:clear',
  discoverGet: 'discover:get',
  discoverRefresh: 'discover:refresh',
  tasteReset: 'taste:reset',
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
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  updatesGet: 'updates:get',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  updatesState: 'updates:state',
  jamCreate: 'jam:create',
  jamJoin: 'jam:join',
  jamLeave: 'jam:leave',
  jamSend: 'jam:send',
  jamView: 'jam:view',
  /** Evento main→renderer: la vista de la sala. */
  jamState: 'jam:state',
  /** Evento main→renderer: lo descargado y la cola de descargas. */
  offlineState: 'offline:state',
} as const;

/** API que el preload expone en `window.spotaple`. Cada método lanza `Error` con `.code` si falla. */
export interface SpotapleApi {
  music: {
    search(query: string): Promise<SearchResults>;
    album(id: string): Promise<AlbumDetail>;
    artist(id: string): Promise<ArtistDetail>;
    /** Playlist de YouTube Music (id tal como lo devuelve la búsqueda). */
    remotePlaylist(id: string): Promise<RemotePlaylistDetail>;
    /** Canciones sugeridas a partir de `seed`, sin lo que ya está en `excludeIds` ni lo escuchado hace poco. */
    radio(seed: Track, excludeIds: string[]): Promise<Track[]>;
    /** Resuelve la fuente de audio (si hace falta) y confirma que se puede reproducir. */
    prepare(trackId: string): Promise<PreparedAudio>;
    /** Descarta la fuente guardada: la URL ya no es válida y debe resolverse de nuevo. */
    invalidate(trackId: string): Promise<void>;
    /**
     * «Descargar canción»: main abre el diálogo «Guardar como» y deja la canción en el formato pedido.
     * `{ saved: false }` si la persona canceló el diálogo.
     */
    export(track: Track, format: AudioFormat): Promise<ExportResult>;
  };
  offline: {
    /** Lo descargado y la cola de descargas ahora mismo. */
    state(): Promise<OfflineState>;
    /** Pone el disco y la cola de acuerdo con las favoritas (por ejemplo, al volver la red). */
    sync(): Promise<void>;
    /** Borra todas las descargas del disco. */
    clear(): Promise<void>;
    /** Recibe cada cambio del estado. Un solo oyente: suscribirse otra vez reemplaza al anterior. */
    subscribe(cb: (state: OfflineState) => void): Promise<void>;
  };
  discover: {
    /** «Hecho para vos» tal como está guardado, sin tocar la red (las listas de un período anterior vienen con `stale`). */
    get(): Promise<DiscoverState>;
    /** Genera lo que falte del período vigente (una corrida a la vez) y devuelve el estado final; un fallo conserva lo anterior. */
    refresh(): Promise<DiscoverState>;
    /** «Reiniciar mis gustos»: ignora lo anterior para las listas y la radio, y vacía las listas. No borra historial ni favoritas. */
    resetTaste(): Promise<DiscoverState>;
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
    /** Canción que realmente empezó a sonar. `auto`: la puso la radio y avanzó sola (no cuenta como gusto). */
    recordPlay(track: Track, auto?: boolean): Promise<void>;
  };
  state: {
    load(): Promise<PersistedPlayerState | null>;
    save(state: PersistedPlayerState): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    /** Aplica un parche parcial; main descarta lo inválido y devuelve los ajustes completos. */
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  updates: {
    state(): Promise<UpdateState>;
    check(): Promise<void>;
    install(): Promise<void>;
    subscribe(cb: (state: UpdateState) => void): Promise<void>;
  };
  jam: {
    /** Crea una sala (local o por internet) y queda como admin. Lanza `Error` con un mensaje listo para mostrar. */
    create(o: { kind: 'local' | 'internet'; name: string }): Promise<JamView>;
    /** Se une con lo que la persona pegó (código de internet o `ip:puerto/CODIGO`). */
    join(o: { invite: string; name: string }): Promise<JamView>;
    leave(): Promise<void>;
    /** Mensaje de la sala (cola, votos, likes, transporte…); main lo valida de nuevo. */
    send(msg: unknown): Promise<void>;
    view(): Promise<JamView>;
    /** Recibe cada cambio de la vista. Un solo oyente: suscribirse otra vez reemplaza al anterior. */
    subscribe(cb: (view: JamView) => void): Promise<void>;
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
