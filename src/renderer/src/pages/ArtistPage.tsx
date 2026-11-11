import { Play, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { playAlbum, playCollection } from '../lib/actions';
import { useResource } from '../lib/useResource';
import { player } from '../player/instance';
import { Cover } from '../components/Cover';
import { AlbumCard, Hero, Shelf } from '../components/Shelf';
import { ErrorState, RowsSkeleton } from '../components/States';
import { IconButton } from '../components/IconButton';
import { TrackList, TrackRow } from '../components/TrackRow';

export function ArtistPage({ id }: { id: string }) {
  const res = useResource(() => api.music.artist(id), [id]);
  const [more, setMore] = useState(false);
  const artist = res.data;

  if (res.error) return <div className="page"><ErrorState message={res.error} onRetry={res.reload} /></div>;
  if (!artist) return <div className="page" aria-busy="true"><RowsSkeleton n={6} /></div>;

  const { topSongs } = artist;
  const play = (shuffle: boolean) => playCollection(topSongs, shuffle);

  return (
    <div className="page">
      <Hero
        cover={<Cover src={artist.thumbnail} size={200} round label={artist.name} />}
        kind="Artista"
        title={artist.name}
        actions={
          topSongs.length > 0 && (
            <>
              <button type="button" className="btn btn--accent btn--lg" onClick={() => play(false)}>
                <Play size={18} fill="currentColor" /> Reproducir
              </button>
              <IconButton variant="solid" size="lg" icon={<Shuffle size={18} />} label="Reproducir en orden aleatorio" onClick={() => play(true)} />
            </>
          )
        }
      >
        {artist.description && (
          <p className={more ? 'hero__desc' : 'hero__desc is-clamped'}>
            {artist.description}{' '}
            <button type="button" className="link link--accent" onClick={() => setMore(!more)}>
              {more ? 'Ver menos' : 'Ver más'}
            </button>
          </p>
        )}
      </Hero>

      {topSongs.length > 0 && (
        <section aria-labelledby="sec-top" className="section">
          <h2 id="sec-top" className="h2">
            Populares
          </h2>
          <TrackList label={`Canciones populares de ${artist.name}`}>
            {topSongs.map((t, i) => (
              <TrackRow key={t.id} track={t} index={i} onPlay={() => player().playTracks(topSongs, i)} />
            ))}
          </TrackList>
        </section>
      )}

      {artist.albums.length > 0 && (
        <Shelf title="Álbumes" id="sec-albums">
          {artist.albums.map((a) => (
            <AlbumCard key={a.id} album={a} onPlay={() => void playAlbum(a.id)} />
          ))}
        </Shelf>
      )}
      {artist.singles.length > 0 && (
        <Shelf title="Sencillos y EP" id="sec-singles">
          {artist.singles.map((a) => (
            <AlbumCard key={a.id} album={a} onPlay={() => void playAlbum(a.id)} />
          ))}
        </Shelf>
      )}
    </div>
  );
}
