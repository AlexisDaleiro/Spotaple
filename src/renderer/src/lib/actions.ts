import type { AudioFormat } from '@shared/offline';
import type { Track } from '@shared/types';
import { trackLink } from '@shared/track';
import { api, errorMessage } from '../api';
import { player } from '../player/instance';
import { inRoom, useJam } from '../stores/jam';
import { useOffline } from '../stores/offline';
import { toast } from '../stores/ui';

export async function shareTrack(track: Track): Promise<void> {
  const url = trackLink(track.id);
  if (!url) return;
  try {
    if (window.SpotapleAndroid) {
      window.SpotapleAndroid.shareTrack(url);
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Enlace de la canción copiado.', 'success');
  } catch {
    toast('No se pudo compartir el enlace de la canción.', 'error');
  }
}

/** "N canciones agregadas a la cola". Dentro de una sala el aviso ("pedidas a la sala") lo da el propio pedido. */
export const toastQueued = (count: number) => {
  if (!inRoom(useJam.getState().view)) toast(`${count} canciones agregadas a la cola`, 'success');
};

/** «Descargar canción»: main abre «Guardar como»; si la persona cancela no pasa nada, y si guarda se avisa dónde quedó. */
export async function exportTrack(track: Track, format: AudioFormat): Promise<void> {
  try {
    const res = await api.music.export(track, format);
    if (res.saved) toast(`Guardada: ${res.name}`, 'success');
  } catch (e) {
    toast(errorMessage(e), 'error');
  }
}

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
      toastQueued(t.length);
    },
  );
export const playArtist = (id: string) => withTracks(async () => (await api.music.artist(id)).topSongs, (t) => player().playTracks(t, 0), 'Este artista no tiene canciones populares.');
export const playRemotePlaylist = (id: string) =>
  withTracks(async () => (await api.music.remotePlaylist(id)).tracks, (t) => player().playTracks(t, 0), 'Esta playlist no tiene canciones disponibles.');
/** Sin red solo suenan las descargadas: la cola se arma con esas, y si no hay ninguna se avisa. */
export const playPlaylist = (id: number) =>
  withTracks(
    async () => (await api.library.playlist(id)).items.map((i) => i.track),
    (t) => {
      const list = useOffline.getState().playable(t);
      if (!list.length) return toast('Sin conexión: ninguna canción de esta playlist está descargada.');
      player().playTracks(list, 0);
    },
    'La playlist está vacía.',
  );
export const queuePlaylist = (id: number) =>
  withTracks(
    async () => (await api.library.playlist(id)).items.map((i) => i.track),
    (t) => {
      player().addToQueue(t);
      toastQueued(t.length);
    },
    'La playlist está vacía.',
  );
