import { Clock, FileAudio, Heart, Play, Shuffle } from 'lucide-react';
import { api } from '../api';
import { playCollection } from '../lib/actions';
import { cx, formatTotal, plural, totalDuration } from '../lib/format';
import { useResource } from '../lib/useResource';
import { player } from '../player/instance';
import { useLibrary } from '../stores/library';
import { inRoom, useJam } from '../stores/jam';
import { navigate } from '../stores/nav';
import { useOffline } from '../stores/offline';
import { toast, useUi } from '../stores/ui';
import { Empty, ErrorState, RowsSkeleton } from '../components/States';
import { TrackList, TrackRow } from '../components/TrackRow';

export function LibraryPage({ tab = 'favorites' }: { tab?: 'favorites' | 'history' }) {
  const version = useLibrary((s) => s.version);
  const inJam = useJam((s) => inRoom(s.view));
  const favs = useResource(() => api.library.favorites(), [version]);
  const history = useResource(() => api.library.recentPlays(100), [tab === 'history' ? 'h' : 'f']);
  const res = tab === 'favorites' ? favs : history;
  const tracks = res.data ?? [];
  const offlineIds = useOffline((s) => s.ids);
  const pending = useOffline((s) => s.pending);
  const failed = useOffline((s) => s.failed);
  const downloaded = tab === 'favorites' ? tracks.filter((t) => offlineIds.has(t.id)).length : 0;

  // Sin red solo suenan las descargadas: «Reproducir» y «Aleatorio» arman la cola con esas.
  const play = (shuffle: boolean) => {
    const list = useOffline.getState().playable(tracks);
    if (!list.length) return toast('Sin conexión: ninguna de estas canciones está descargada.');
    playCollection(list, shuffle);
  };
  const playFrom = (i: number) => {
    const q = useOffline.getState().queueFrom(tracks, i);
    player().playTracks(q.tracks, q.start);
  };

  return (
    <div className="page">
      <h1 className="h1">Biblioteca</h1>
      <div className="tabs" role="tablist" aria-label="Secciones de la biblioteca">
        <button type="button" role="tab" aria-selected={tab === 'favorites'} className={cx('tab', tab === 'favorites' && 'is-active')} onClick={() => navigate({ page: 'library', tab: 'favorites' }, { replace: true })}>
          <Heart size={14} /> Favoritos
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={cx('tab', tab === 'history' && 'is-active')} onClick={() => navigate({ page: 'library', tab: 'history' }, { replace: true })}>
          <Clock size={14} /> Historial
        </button>
      </div>
      {api.platform === 'android' && !inJam && (
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event('spotaple:open-local'))}>
            <FileAudio size={16} /> Abrir audio del teléfono
          </button>
        </div>
      )}

      {res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : res.loading && !res.data ? (
        <RowsSkeleton n={6} />
      ) : tracks.length === 0 ? (
        tab === 'favorites' ? (
          <Empty
            icon={<Heart size={26} />}
            title="Todavía no tenés favoritas"
            text="Tocá el corazón de cualquier canción para guardarla acá."
            action={
              <button type="button" className="btn btn--solid" onClick={() => (navigate({ page: 'search', q: '' }), useUi.getState().focusSearch())}>
                Buscar música
              </button>
            }
          />
        ) : (
          <Empty icon={<Clock size={26} />} title="Tu historial está vacío" text="Acá aparecen las canciones que realmente empezaron a sonar." />
        )
      ) : (
        <>
          <div className="toolbar">
            <button type="button" className="btn btn--accent" onClick={() => play(false)}>
              <Play size={16} fill="currentColor" /> Reproducir
            </button>
            <button type="button" className="btn" onClick={() => play(true)}>
              <Shuffle size={16} /> Aleatorio
            </button>
            <span className="toolbar__meta">
              {plural(tracks.length, 'canción', 'canciones')}
              {totalDuration(tracks) !== undefined && ` · ${formatTotal(totalDuration(tracks)!)}`}
              {downloaded > 0 && ` · ${downloaded} sin conexión`}
              {tab === 'favorites' && pending > 0 && ` · bajando ${pending}`}
              {tab === 'favorites' && failed > 0 && ` · ${failed} sin poder descargar`}
            </span>
          </div>
          <TrackList label={tab === 'favorites' ? 'Favoritos' : 'Historial'}>
            {tracks.map((t, i) => (
              <TrackRow key={t.id} track={t} index={i} onPlay={() => playFrom(i)} />
            ))}
          </TrackList>
        </>
      )}
    </div>
  );
}
