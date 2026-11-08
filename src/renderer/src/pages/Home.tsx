import { Disc3, Play } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../api';
import { cx } from '../lib/format';
import { useResource } from '../lib/useResource';
import { player } from '../player/instance';
import { discoverStore, useDiscover } from '../stores/discover';
import { useLibrary } from '../stores/library';
import { navigate } from '../stores/nav';
import { useSettings } from '../stores/settings';
import { useUi } from '../stores/ui';
import { playPlaylist } from '../lib/actions';
import { Cover } from '../components/Cover';
import { ArtistCard, GeneratedCard, PlaylistCard, Shelf, TrackCard } from '../components/Shelf';
import { CardsSkeleton, Empty } from '../components/States';
import { TrackList, TrackRow } from '../components/TrackRow';
import { Suggestions } from './Search';

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

export function HomePage() {
  const version = useLibrary((s) => s.version);
  const playlists = useLibrary((s) => s.playlists);
  const recent = useResource(() => api.library.recentPlays(24), [version]);
  const favs = useResource(() => api.library.favorites(), [version]);
  const forYouOn = useSettings((s) => s.settings.forYou);
  const discover = useDiscover((s) => s.state);

  // «Hecho para vos»: se ve enseguida lo guardado y se pide a main que genere lo que falte (una corrida a la vez; sin
  // internet se siguen viendo las listas anteriores y se reintenta la próxima vez que se abra Inicio).
  useEffect(() => {
    if (!forYouOn) return;
    void discoverStore.getState().load().then(() => discoverStore.getState().refresh());
  }, [forYouOn]);
  const showForYou = forYouOn && discover.enabled && discover.ready;

  const recents = recent.data ?? [];
  const favorites = favs.data ?? [];
  const loading = recent.loading || favs.loading;
  const empty = !loading && recents.length === 0 && favorites.length === 0 && playlists.length === 0;

  if (empty) {
    return (
      <div className="page page--home">
        <Empty
          heading="h1"
          icon={<Disc3 size={30} />}
          title="Tu música empieza acá"
          text="Buscá una canción y escuchala al instante. Lo que reproduzcas, tus favoritas y tus playlists van a aparecer en esta pantalla."
          action={
            <>
              <button type="button" className="btn btn--accent btn--lg" onClick={() => (navigate({ page: 'search', q: '' }), useUi.getState().focusSearch())}>
                Buscar música
              </button>
              <Suggestions />
            </>
          }
        />
      </div>
    );
  }

  const quick = recents.slice(0, 6);
  return (
    <div className={cx('page page--home', loading && 'is-stale')}>
      <h1 className="h1">{greeting()}</h1>

      {/* Nunca se dibuja una sección vacía ni un esqueleto: sin datos suficientes, «Hecho para vos» simplemente no aparece. */}
      {showForYou && discover.lists.length > 0 && (
        <Shelf title="Hecho para vos" id="sec-foryou">
          {discover.lists.map((l) => (
            <GeneratedCard key={`${l.kind}-${l.slot}`} list={l} onPlay={() => player().playTracks(l.tracks, 0)} />
          ))}
        </Shelf>
      )}

      {showForYou && discover.artists.length > 0 && (
        <Shelf title="Artistas que podrías escuchar" id="sec-artists">
          {discover.artists.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </Shelf>
      )}

      {quick.length > 0 && (
        <section aria-labelledby="sec-continue" className="section">
          <h2 id="sec-continue" className="h2">
            Continuar escuchando
          </h2>
          <div className="quick">
            {quick.map((t, i) => (
              <button key={t.id} type="button" className="quick__tile" onClick={() => player().playTracks(recents, i)} aria-label={`Reproducir «${t.title}»`}>
                <Cover src={t.thumbnail} size={56} label={t.title} />
                <span className="quick__title">{t.title}</span>
                <span className="quick__play" aria-hidden="true">
                  <Play size={16} fill="currentColor" />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {recents.length > 6 && (
        <Shelf title="Escuchado recientemente" id="sec-recent">
          {recents.slice(6).map((t, i) => (
            <TrackCard key={t.id} track={t} onPlay={() => player().playTracks(recents, i + 6)} />
          ))}
        </Shelf>
      )}

      {favorites.length > 0 && (
        <section aria-labelledby="sec-favs" className="section">
          <header className="shelf__head">
            <h2 id="sec-favs" className="h2">
              Tus favoritas
            </h2>
            <button type="button" className="link link--accent" onClick={() => navigate({ page: 'library', tab: 'favorites' })}>
              Ver todas ({favorites.length})
            </button>
          </header>
          <TrackList label="Favoritas" showAlbum={false}>
            {favorites.slice(0, 5).map((t, i) => (
              <TrackRow key={t.id} track={t} index={i} showAlbum={false} onPlay={() => player().playTracks(favorites, i)} />
            ))}
          </TrackList>
        </section>
      )}

      {playlists.length > 0 && (
        <Shelf
          title="Tus playlists"
          id="sec-playlists"
          action={
            <button type="button" className="link link--accent" onClick={() => navigate({ page: 'playlists' })}>
              Ver todas
            </button>
          }
        >
          {playlists.slice(0, 10).map((p) => (
            <PlaylistCard key={p.id} playlist={p} onPlay={() => void playPlaylist(p.id)} />
          ))}
        </Shelf>
      )}

      {loading && recents.length === 0 && <CardsSkeleton n={6} />}
    </div>
  );
}
