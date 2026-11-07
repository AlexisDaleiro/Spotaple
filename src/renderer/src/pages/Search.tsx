import { Disc3, ListMusic, Mic2, Music2, Search, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '../lib/format';
import { playAlbum, playArtist, playRemotePlaylist } from '../lib/actions';
import { player } from '../player/instance';
import { navigate } from '../stores/nav';
import { useSearch } from '../stores/search';
import { AlbumCard, ArtistCard, RemotePlaylistCard, Shelf } from '../components/Shelf';
import { Empty, ErrorState, RowsSkeleton } from '../components/States';
import { TrackList, TrackRow } from '../components/TrackRow';

type Tab = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';
export const SUGGESTIONS = ['Lo-fi', 'Rock nacional', 'Jazz clásico', 'Charly García', 'Éxitos de los 90', 'Bossa nova'];

export function Suggestions() {
  return (
    <div className="chips" aria-label="Sugerencias de búsqueda">
      {SUGGESTIONS.map((s) => (
        <button key={s} type="button" className="chip" onClick={() => navigate({ page: 'search', q: s })}>
          {s}
        </button>
      ))}
    </div>
  );
}

export function SearchPage({ q }: { q: string }) {
  const status = useSearch((s) => s.status);
  const results = useSearch((s) => s.results);
  const error = useSearch((s) => s.error);
  const run = useSearch((s) => s.run);
  const retry = useSearch((s) => s.retry);
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => run(q), [q, run]);
  useEffect(() => setTab('all'), [q]);

  if (!q.trim()) {
    return (
      <div className="page">
        <Empty
          heading="h1"
          icon={<Search size={26} />}
          title="Buscá canciones, artistas y álbumes"
          text="Escribí arriba y escuchala al instante, aunque no la tengas en tu compu."
          action={<Suggestions />}
        />
      </div>
    );
  }

  if (!results) {
    if (status === 'error') return <div className="page"><ErrorState message={error ?? 'No se pudo buscar.'} onRetry={retry} /></div>;
    return (
      <div className="page" aria-busy="true">
        <h1 className="h1">Resultados para «{q}»</h1>
        <RowsSkeleton n={7} />
      </div>
    );
  }

  const { songs, albums, artists, playlists } = results;
  const total = songs.length + albums.length + artists.length + playlists.length;
  const tabs: { id: Tab; label: string; n: number; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Todo', n: total, icon: <Search size={14} /> },
    { id: 'songs', label: 'Canciones', n: songs.length, icon: <Music2 size={14} /> },
    { id: 'artists', label: 'Artistas', n: artists.length, icon: <Mic2 size={14} /> },
    { id: 'albums', label: 'Álbumes', n: albums.length, icon: <Disc3 size={14} /> },
    { id: 'playlists', label: 'Playlists', n: playlists.length, icon: <ListMusic size={14} /> },
  ];

  const songsBlock = (list: typeof songs) => (
    <TrackList label="Canciones">
      {list.map((t, i) => (
        <TrackRow key={t.id} track={t} index={i} onPlay={() => player().playTracks(songs, songs.indexOf(t))} />
      ))}
    </TrackList>
  );

  return (
    <div className={cx('page', status === 'loading' && 'is-stale')} aria-busy={status === 'loading'}>
      <h1 className="h1">Resultados para «{results.query}»</h1>

      {status === 'error' && (
        <div className="notice notice--error" role="alert">
          {error} <button type="button" className="link link--accent" onClick={retry}>Reintentar</button>
        </div>
      )}
      {results.partial && status !== 'error' && (
        <div className="notice" role="status">
          Faltan algunos resultados porque una parte de la búsqueda falló.{' '}
          <button type="button" className="link link--accent" onClick={retry}>
            Reintentar
          </button>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Tipo de resultado">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={cx('tab', tab === t.id && 'is-active')} onClick={() => setTab(t.id)}>
            {t.icon}
            {t.label}
            <span className="tab__n">{t.n}</span>
          </button>
        ))}
      </div>

      {total === 0 ? (
        <Empty icon={<SearchX size={26} />} title={`No encontramos nada para «${results.query}»`} text="Revisá la ortografía o probá con el nombre del artista." />
      ) : (
        <>
          {(tab === 'all' || tab === 'songs') && songs.length > 0 && (
            <section aria-labelledby="sec-songs" className="section">
              <h2 id="sec-songs" className="h2">
                Canciones
              </h2>
              {songsBlock(tab === 'all' ? songs.slice(0, 6) : songs)}
              {tab === 'all' && songs.length > 6 && (
                <button type="button" className="btn btn--ghost section__more" onClick={() => setTab('songs')}>
                  Ver las {songs.length} canciones
                </button>
              )}
            </section>
          )}
          {(tab === 'all' || tab === 'artists') && artists.length > 0 && (
            <Shelf title="Artistas" id="sec-artists">
              {(tab === 'all' ? artists.slice(0, 8) : artists).map((a) => (
                <ArtistCard key={a.id} artist={a} onPlay={() => void playArtist(a.id)} />
              ))}
            </Shelf>
          )}
          {(tab === 'all' || tab === 'albums') && albums.length > 0 && (
            <Shelf title="Álbumes" id="sec-albums">
              {(tab === 'all' ? albums.slice(0, 8) : albums).map((a) => (
                <AlbumCard key={a.id} album={a} onPlay={() => void playAlbum(a.id)} />
              ))}
            </Shelf>
          )}
          {(tab === 'all' || tab === 'playlists') && playlists.length > 0 && (
            <Shelf title="Playlists" id="sec-playlists">
              {(tab === 'all' ? playlists.slice(0, 8) : playlists).map((p) => (
                <RemotePlaylistCard key={p.id} playlist={p} onPlay={() => void playRemotePlaylist(p.id)} />
              ))}
            </Shelf>
          )}
        </>
      )}
    </div>
  );
}
