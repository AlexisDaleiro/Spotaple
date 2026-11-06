import { ListPlus, Play, Shuffle } from 'lucide-react';
import { api } from '../api';
import { formatTotal, plural, totalDuration } from '../lib/format';
import { useResource } from '../lib/useResource';
import { player } from '../player/instance';
import { navigate } from '../stores/nav';
import { toastQueued } from '../lib/actions';
import { Cover } from '../components/Cover';
import { Hero } from '../components/Shelf';
import { Empty, ErrorState, RowsSkeleton } from '../components/States';
import { IconButton } from '../components/IconButton';
import { TrackList, TrackRow } from '../components/TrackRow';

export function AlbumPage({ id }: { id: string }) {
  const res = useResource(() => api.music.album(id), [id]);
  const album = res.data;

  if (res.error) return <div className="page"><ErrorState message={res.error} onRetry={res.reload} /></div>;
  if (!album) {
    return (
      <div className="page" aria-busy="true">
        <RowsSkeleton n={8} />
      </div>
    );
  }

  const { tracks } = album;
  const play = (shuffle: boolean) => {
    if (!tracks.length) return;
    if (shuffle !== player().shuffle) player().toggleShuffle();
    player().playTracks(tracks, 0);
  };
  const kind = album.kind === 'Single' ? 'Sencillo' : album.kind === 'EP' ? 'EP' : 'Álbum';

  return (
    <div className="page">
      <Hero
        cover={<Cover src={album.thumbnail} size={200} label={album.title} />}
        kind={kind}
        title={album.title}
        meta={
          <>
            {album.artists.map((a, i) => (
              <span key={a.name}>
                {i > 0 && ', '}
                {a.id ? (
                  <button type="button" className="link link--strong" onClick={() => navigate({ page: 'artist', id: a.id! })}>
                    {a.name}
                  </button>
                ) : (
                  <strong>{a.name}</strong>
                )}
              </span>
            ))}
            {album.year && ` · ${album.year}`}
            {` · ${plural(tracks.length, 'canción', 'canciones')}`}
            {totalDuration(tracks) !== undefined && ` · ${formatTotal(totalDuration(tracks)!)}`}
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn--accent btn--lg" disabled={!tracks.length} onClick={() => play(false)}>
              <Play size={18} fill="currentColor" /> Reproducir
            </button>
            <IconButton variant="solid" size="lg" icon={<Shuffle size={18} />} label="Reproducir en orden aleatorio" disabled={!tracks.length} onClick={() => play(true)} />
            <IconButton
              variant="solid"
              size="lg"
              icon={<ListPlus size={18} />}
              label="Agregar el álbum a la cola"
              disabled={!tracks.length}
              onClick={() => (player().addToQueue(tracks), toastQueued(tracks.length))}
            />
          </>
        }
      />

      {tracks.length === 0 ? (
        <Empty icon={<Play size={24} />} title="Este álbum no tiene canciones disponibles" text="YouTube Music no devolvió la lista de temas." />
      ) : (
        <TrackList label={`Canciones de ${album.title}`} showAlbum={false}>
          {tracks.map((t, i) => (
            <TrackRow key={`${t.id}-${i}`} track={t} index={i} showAlbum={false} showCover={false} onPlay={() => player().playTracks(tracks, i)} />
          ))}
        </TrackList>
      )}
    </div>
  );
}
