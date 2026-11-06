import type { Track } from '@shared/types';
import { api, errorMessage } from '../api';
import { player } from '../player/instance';
import { toast } from '../stores/ui';

/** Acciones que primero necesitan datos (álbum, artista, playlist) y luego tocan el reproductor. */
async function withTracks(load: () => Promise<Track[]>, then: (tracks: Track[]) => void, empty = 'No hay canciones para reproducir.') {
  try {
    const tracks = await load();
    if (!tracks.length) return toast(empty);
    then(tracks);
  } catch (e) {
    toast(errorMessage(e), 'error');
  }
}

export const playAlbum = (id: string) => withTracks(async () => (await api.music.album(id)).tracks, (t) => player().playTracks(t, 0));
export const queueAlbum = (id: string) =>
  withTracks(
    async () => (await api.music.album(id)).tracks,
    (t) => {
      player().addToQueue(t);
      toast(`${t.length} canciones agregadas a la cola`, 'success');
    },
  );
export const playArtist = (id: string) => withTracks(async () => (await api.music.artist(id)).topSongs, (t) => player().playTracks(t, 0), 'Este artista no tiene canciones populares.');
export const playPlaylist = (id: number) => withTracks(async () => (await api.library.playlist(id)).items.map((i) => i.track), (t) => player().playTracks(t, 0), 'La playlist está vacía.');
export const queuePlaylist = (id: number) =>
  withTracks(
    async () => (await api.library.playlist(id)).items.map((i) => i.track),
    (t) => {
      player().addToQueue(t);
      toast(`${t.length} canciones agregadas a la cola`, 'success');
    },
    'La playlist está vacía.',
  );
