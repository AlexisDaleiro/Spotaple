import { create } from 'zustand';
import type { PlaylistSummary, Track } from '@shared/types';
import { api, errorMessage } from '../api';
import { toast } from './ui';

interface LibraryState {
  favoriteIds: Set<string>;
  playlists: PlaylistSummary[];
  /** Sube cuando cambia favoritos o playlists: las pantallas lo usan para recargarse. */
  version: number;
  init(): Promise<void>;
  isFavorite(id: string): boolean;
  toggleFavorite(track: Track): Promise<void>;
  refreshPlaylists(): Promise<void>;
  createPlaylist(name: string): Promise<PlaylistSummary | null>;
  renamePlaylist(id: number, name: string): Promise<void>;
  deletePlaylist(id: number): Promise<void>;
  addToPlaylist(playlist: PlaylistSummary, tracks: Track[]): Promise<void>;
}

export const useLibrary = create<LibraryState>((set, get) => {
  const bump = () => set({ version: get().version + 1 });
  return {
    favoriteIds: new Set(),
    playlists: [],
    version: 0,

    async init() {
      try {
        const [ids, playlists] = await Promise.all([api.library.favoriteIds(), api.library.playlists()]);
        set({ favoriteIds: new Set(ids), playlists });
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    isFavorite: (id) => get().favoriteIds.has(id),

    async toggleFavorite(track) {
      const before = get().favoriteIds;
      const optimistic = new Set(before);
      const adding = !optimistic.has(track.id);
      if (adding) optimistic.add(track.id);
      else optimistic.delete(track.id);
      set({ favoriteIds: optimistic });
      try {
        const isNow = await api.library.toggleFavorite(track);
        const final = new Set(get().favoriteIds);
        if (isNow) final.add(track.id);
        else final.delete(track.id);
        set({ favoriteIds: final });
        bump();
        toast(isNow ? 'Agregada a favoritos' : 'Quitada de favoritos', 'success');
      } catch (e) {
        set({ favoriteIds: before });
        toast(errorMessage(e), 'error');
      }
    },

    async refreshPlaylists() {
      try {
        set({ playlists: await api.library.playlists() });
        bump();
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    async createPlaylist(name) {
      try {
        const p = await api.library.createPlaylist(name);
        await get().refreshPlaylists();
        return p;
      } catch (e) {
        toast(errorMessage(e), 'error');
        return null;
      }
    },
    async renamePlaylist(id, name) {
      try {
        await api.library.renamePlaylist(id, name);
        await get().refreshPlaylists();
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    async deletePlaylist(id) {
      try {
        await api.library.deletePlaylist(id);
        await get().refreshPlaylists();
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    async addToPlaylist(playlist, tracks) {
      try {
        const added = await api.library.addToPlaylist(playlist.id, tracks);
        await get().refreshPlaylists();
        if (added === 0) toast(tracks.length === 1 ? `Ya estaba en «${playlist.name}»` : `Ya estaban en «${playlist.name}»`);
        else toast(added === 1 ? `Agregada a «${playlist.name}»` : `${added} canciones agregadas a «${playlist.name}»`, 'success');
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
  };
});
