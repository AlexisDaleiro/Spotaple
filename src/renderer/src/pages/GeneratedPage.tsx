import { BookmarkPlus, ListMusic, ListPlus, Play, Shuffle } from 'lucide-react';
import { useRef, useState } from 'react';
import type { GeneratedKind } from '@shared/discover';
import { playCollection, toastQueued } from '../lib/actions';
import { formatTotal, plural, totalDuration } from '../lib/format';
import { player } from '../player/instance';
import { useDiscover } from '../stores/discover';
import { useLibrary } from '../stores/library';
import { navigate } from '../stores/nav';
import { IconButton } from '../components/IconButton';
import { Hero, PlaylistCover } from '../components/Shelf';
import { Empty } from '../components/States';
import { TrackList, TrackRow } from '../components/TrackRow';

/** Lista de «Hecho para vos» (de solo lectura): se reproduce entera, se agrega a la cola o se guarda como playlist propia. */
export function GeneratedPage({ kind, slot }: { kind: GeneratedKind; slot: string }) {
  const list = useDiscover((s) => s.state.lists.find((l) => l.kind === kind && l.slot === slot));
  const [saving, setSaving] = useState(false);
  // Guarda síncrona: dos clics seguidos llegan antes de que `saving` se vea y no deben crear dos playlists.
  const busy = useRef(false);

  if (!list) {
    return (
      <div className="page">
        <Empty
          icon={<ListMusic size={24} />}
          title="Esta lista ya no está disponible"
          text="Las listas se renuevan con el tiempo o al reiniciar tus gustos. Volvé a Inicio para ver las nuevas."
          action={
            <button type="button" className="btn btn--solid" onClick={() => navigate({ page: 'home' })}>
              Ir a Inicio
            </button>
          }
        />
      </div>
    );
  }

  const { tracks } = list;
  const covers = tracks.map((t) => t.thumbnail).filter((x): x is string => !!x).slice(0, 4);
  const play = (shuffle: boolean) => playCollection(tracks, shuffle);
  const save = async () => {
    if (busy.current || !tracks.length) return;
    busy.current = true;
    setSaving(true);
    try {
      const lib = useLibrary.getState();
      const created = await lib.createPlaylist(list.title);
      if (created) await lib.addToPlaylist(created, tracks);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <Hero
        cover={<PlaylistCover covers={covers} name={list.title} size={200} />}
        kind="Hecho para vos"
        title={list.title}
        meta={
          <>
            {list.subtitle && `${list.subtitle} · `}
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
              label="Agregar la lista a la cola"
              disabled={!tracks.length}
              onClick={() => toastQueued(player().addToQueue(tracks))}
            />
            <button type="button" className="btn btn--solid btn--lg" disabled={!tracks.length || saving} onClick={() => void save()}>
              <BookmarkPlus size={18} /> {saving ? 'Guardando…' : 'Guardar en mi biblioteca'}
            </button>
          </>
        }
      />

      <TrackList label={`Canciones de ${list.title}`} showAlbum={false}>
        {tracks.map((t, i) => (
          <TrackRow key={`${t.id}-${i}`} track={t} index={i} showAlbum={false} onPlay={() => player().playTracks(tracks, i)} />
        ))}
      </TrackList>
    </div>
  );
}
