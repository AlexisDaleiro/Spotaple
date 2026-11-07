import { BookmarkPlus, ListMusic, ListPlus, Play, Shuffle } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../api';
import { formatTotal, plural, totalDuration } from '../lib/format';
import { toastQueued } from '../lib/actions';
import { useResource } from '../lib/useResource';
import { player } from '../player/instance';
import { useLibrary } from '../stores/library';
import { Cover } from '../components/Cover';
import { IconButton } from '../components/IconButton';
import { Hero } from '../components/Shelf';
import { Empty, ErrorState, RowsSkeleton } from '../components/States';
import { TrackList, TrackRow } from '../components/TrackRow';

/** Playlist de YouTube Music (de solo lectura): se reproduce entera o se guarda como playlist propia. */
export function RemotePlaylistPage({ id, author }: { id: string; author?: string }) {
  const res = useResource(() => api.music.remotePlaylist(id), [id]);
  const [saving, setSaving] = useState(false);
  // Guarda síncrona: dos clics seguidos llegan antes de que `saving` se vea y no deben crear dos playlists.
  const busy = useRef(false);
  const detail = res.data;

  if (res.error) return <div className="page"><ErrorState message={res.error} onRetry={res.reload} /></div>;
  if (!detail) {
    return (
      <div className="page" aria-busy="true">
        <RowsSkeleton n={8} />
      </div>
    );
  }

  const { tracks } = detail;
  const play = (shuffle: boolean) => {
    if (!tracks.length) return;
    if (shuffle !== player().shuffle) player().toggleShuffle();
    player().playTracks(tracks, 0);
  };
  const save = async () => {
    if (busy.current || !tracks.length) return;
    busy.current = true;
    setSaving(true);
    try {
      const lib = useLibrary.getState();
      const created = await lib.createPlaylist(detail.title);
      if (created) await lib.addToPlaylist(created, tracks);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <Hero
        cover={<Cover src={detail.thumbnail} size={200} label={detail.title} />}
        kind="Playlist"
        title={detail.title}
        meta={
          <>
            {author && (
              <>
                <strong>{author}</strong>
                {' · '}
              </>
            )}
            {plural(tracks.length, 'canción', 'canciones')}
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
              label="Agregar la playlist a la cola"
              disabled={!tracks.length}
              onClick={() => (player().addToQueue(tracks), toastQueued(tracks.length))}
            />
            <button type="button" className="btn btn--solid btn--lg" disabled={!tracks.length || saving} onClick={() => void save()}>
              <BookmarkPlus size={18} /> {saving ? 'Guardando…' : 'Guardar en mi biblioteca'}
            </button>
          </>
        }
      />

      {detail.truncated && (
        <div className="notice" role="status">
          Mostrando las primeras {tracks.length}
          {detail.trackCount ? ` de ${detail.trackCount}` : ''} canciones de esta playlist.
        </div>
      )}

      {tracks.length === 0 ? (
        <Empty icon={<ListMusic size={24} />} title="Esta playlist no tiene canciones disponibles" text="YouTube Music no devolvió canciones para esta playlist." />
      ) : (
        <TrackList label={`Canciones de ${detail.title}`} showAlbum={false}>
          {tracks.map((t, i) => (
            <TrackRow key={`${t.id}-${i}`} track={t} index={i} showAlbum={false} onPlay={() => player().playTracks(tracks, i)} />
          ))}
        </TrackList>
      )}
    </div>
  );
}
