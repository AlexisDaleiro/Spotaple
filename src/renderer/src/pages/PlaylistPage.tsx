import { ArrowDown, ArrowUp, ListMusic, ListPlus, Pencil, Play, Shuffle, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PlaylistItem } from '@shared/types';
import { api, errorMessage } from '../api';
import { formatTotal, plural, totalDuration } from '../lib/format';
import { useReorder } from '../lib/useReorder';
import { useResource } from '../lib/useResource';
import { player } from '../player/instance';
import { useLibrary } from '../stores/library';
import { navigate } from '../stores/nav';
import { useOffline } from '../stores/offline';
import { playCollection, toastQueued } from '../lib/actions';
import { toast, useUi, type MenuItem } from '../stores/ui';
import { Hero, PlaylistCover } from '../components/Shelf';
import { Empty, ErrorState, RowsSkeleton } from '../components/States';
import { TrackList, TrackRow } from '../components/TrackRow';
import { IconButton } from '../components/IconButton';
import { deletePlaylistFlow, renamePlaylistDialog } from './Playlists';

export function PlaylistPage({ id }: { id: number }) {
  const version = useLibrary((s) => s.version);
  const res = useResource(() => api.library.playlist(id), [id, version]);
  const playlist = res.data;
  // Copia local para reordenar sin parpadeo; se vuelve a sincronizar cuando llegan datos nuevos.
  const [items, setItems] = useState<PlaylistItem[]>([]);
  useEffect(() => setItems(playlist?.items ?? []), [playlist]);

  const tracks = items.map((i) => i.track);

  const move = async (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    setItems(next);
    try {
      await api.library.reorderPlaylist(id, next.map((i) => i.itemId));
    } catch (e) {
      toast(errorMessage(e), 'error');
      res.reload();
    }
  };
  const reorder = useReorder(items.length, move);

  const remove = async (itemId: number) => {
    try {
      await api.library.removeFromPlaylist(id, itemId);
      await useLibrary.getState().refreshPlaylists();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (res.error && !playlist) return <div className="page"><ErrorState message={res.error} onRetry={res.reload} /></div>;
  if (!playlist) return <div className="page"><RowsSkeleton n={6} /></div>;

  // Sin red solo suenan las descargadas: «Reproducir» y «Aleatorio» arman la cola con esas.
  const play = (shuffle: boolean) => {
    if (!tracks.length) return;
    const list = useOffline.getState().playable(tracks);
    if (!list.length) return toast('Sin conexión: ninguna canción de esta playlist está descargada.');
    playCollection(list, shuffle);
  };
  const playFrom = (i: number) => {
    const q = useOffline.getState().queueFrom(tracks, i);
    player().playTracks(q.tracks, q.start);
  };
  const summary = { ...playlist, trackCount: items.length };

  return (
    <div className="page">
      <Hero
        cover={<PlaylistCover covers={items.map((i) => i.track.thumbnail).filter((x): x is string => !!x).slice(0, 4)} name={playlist.name} size={200} />}
        kind="Playlist"
        title={
          <button type="button" className="hero__rename" onClick={() => renamePlaylistDialog(playlist)} title="Cambiar el nombre">
            {playlist.name}
            <Pencil size={16} aria-hidden="true" />
          </button>
        }
        meta={
          <>
            {plural(items.length, 'canción', 'canciones')}
            {totalDuration(tracks) !== undefined && ` · ${formatTotal(totalDuration(tracks)!)}`}
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn--accent btn--lg" disabled={!items.length} onClick={() => play(false)}>
              <Play size={18} fill="currentColor" /> Reproducir
            </button>
            <IconButton variant="solid" size="lg" icon={<Shuffle size={18} />} label="Reproducir en orden aleatorio" disabled={!items.length} onClick={() => play(true)} />
            <IconButton variant="solid" size="lg" icon={<ListPlus size={18} />} label="Agregar toda la playlist a la cola" disabled={!items.length} onClick={() => (player().addToQueue(tracks), toastQueued(items.length))} />
            <IconButton variant="solid" size="lg" icon={<Pencil size={17} />} label="Cambiar el nombre" onClick={() => renamePlaylistDialog(playlist)} />
            <IconButton variant="solid" size="lg" icon={<Trash2 size={17} />} label="Eliminar playlist" onClick={() => deletePlaylistFlow(summary, () => navigate({ page: 'playlists' }, { replace: true }))} />
          </>
        }
      />

      {items.length === 0 ? (
        <Empty
          icon={<ListMusic size={26} />}
          title="Esta playlist está vacía"
          text="Buscá canciones y agregalas con clic derecho → Agregar a playlist."
          action={
            <button type="button" className="btn btn--solid" onClick={() => (navigate({ page: 'search', q: '' }), useUi.getState().focusSearch())}>
              Buscar música
            </button>
          }
        />
      ) : (
        <>
          <TrackList label={`Canciones de ${playlist.name}`}>
            {items.map((it, i) => {
              const extra: MenuItem[] = [
                { label: 'Mover arriba', icon: <ArrowUp size={15} />, disabled: i === 0, onSelect: () => void move(i, i - 1) },
                { label: 'Mover abajo', icon: <ArrowDown size={15} />, disabled: i === items.length - 1, onSelect: () => void move(i, i + 1) },
                { label: 'Quitar de esta playlist', icon: <X size={15} />, danger: true, onSelect: () => void remove(it.itemId) },
              ];
              return <TrackRow key={it.itemId} track={it.track} index={i} reorder={reorder(i)} menuExtra={extra} onPlay={() => playFrom(i)} />;
            })}
          </TrackList>
          <p className="hint">Arrastrá una fila para reordenar, o usá clic derecho → Mover arriba / abajo.</p>
        </>
      )}
    </div>
  );
}
