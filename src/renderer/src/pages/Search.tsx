import { Disc3, ListMusic, Mic2, Music2, Search, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Track } from '@shared/types';
import { api } from '../api';
import { cx } from '../lib/format';
import { playAlbum, playArtist, playRemotePlaylist } from '../lib/actions';
import { player, usePlayer } from '../player/instance';
import { navigate } from '../stores/nav';
import { useOffline } from '../stores/offline';
import { useSearch } from '../stores/search';
import { useSettings } from '../stores/settings';
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
  const mobile = api.platform === 'android';
  const query = q.trim();
  const status = useSearch((s) => s.query === query ? s.status : 'loading');
  const results = useSearch((s) => s.query === query ? s.results : null);
  const discovery = useSearch((s) => s.query === query ? s.discovery : null);
  const error = useSearch((s) => s.error);
  const run = useSearch((s) => s.run);
  const cancel = useSearch((s) => s.cancel);
  const retry = useSearch((s) => s.retry);
  // La radio puede arrancar desde una canción suelta. Aleatorio y repetir usan la lista de resultados.
  const radio = useSettings((s) => s.settings.radio);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const soloWithRadio = !mobile && radio && repeat === 'off' && !shuffle;
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => {
    run(q);
    return () => cancel(q);
  }, [q, run, cancel]);
  useEffect(() => setTab('all'), [q]);

  if (!query) {
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
  const relatedSongs = discovery?.songs ?? [];
  const relatedArtists = discovery?.artists ?? [];
  const total = songs.length + albums.length + artists.length + playlists.length;
  const tabs: { id: Tab; label: string; n: number; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Todo', n: total + relatedSongs.length + relatedArtists.length, icon: <Search size={14} /> },
    { id: 'songs', label: 'Canciones', n: songs.length + relatedSongs.length, icon: <Music2 size={14} /> },
    { id: 'artists', label: 'Artistas', n: artists.length + relatedArtists.length, icon: <Mic2 size={14} /> },
    { id: 'albums', label: 'Álbumes', n: albums.length, icon: <Disc3 size={14} /> },
    { id: 'playlists', label: 'Playlists', n: playlists.length, icon: <ListMusic size={14} /> },
  ];
  const selected = tabs.find((filter) => filter.id === tab);

  const playResult = (track: Track, queue: Track[]) => {
    if (soloWithRadio) {
      player().playTracks([track], 0);
    } else {
      const { tracks, start } = useOffline.getState().queueFrom(queue, queue.indexOf(track));
      player().playTracks(tracks, start);
    }
  };

  const songsBlock = (list: Track[], queue = songs, label = 'Canciones') => (
    <TrackList label={label}>
      {list.map((t, i) => (
        <TrackRow key={t.id} track={t} index={i} onPlay={() => playResult(t, queue)} />
      ))}
    </TrackList>
  );

  return (
    <div className="page">
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

      <div className="tabs search-filters" role="tablist" aria-label="Tipo de resultado">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={cx('tab', tab === t.id && 'is-active')} onClick={() => setTab(t.id)}>
            {t.icon}
            {t.label}
            <span className="tab__n">{t.n}</span>
          </button>
        ))}
      </div>

      {status === 'loading' && (total === 0 || selected?.n === 0) ? (
        <div aria-busy="true"><RowsSkeleton n={5} /></div>
      ) : total === 0 ? (
        <Empty icon={<SearchX size={26} />} title={`No encontramos nada para «${results.query}»`} text="Revisá la ortografía o probá con el nombre del artista." />
      ) : selected?.n === 0 ? (
        <Empty icon={<SearchX size={26} />} title={`Sin resultados en ${selected.label.toLowerCase()}`} />
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
          {(tab === 'all' || tab === 'artists') && relatedArtists.length > 0 && (
            <Shelf title="Artistas relacionados" id="sec-related-artists">
              {relatedArtists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} onPlay={() => void playArtist(artist.id)} />
              ))}
            </Shelf>
          )}
          {(tab === 'all' || tab === 'songs') && relatedSongs.length > 0 && (
            <section aria-labelledby="sec-related-songs" className="section">
              <h2 id="sec-related-songs" className="h2">Canciones relacionadas</h2>
              {songsBlock(relatedSongs, relatedSongs, 'Canciones relacionadas')}
            </section>
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
