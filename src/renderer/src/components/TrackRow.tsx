import { Ellipsis, Heart, ListPlus, Pause, Play } from 'lucide-react';
import { Fragment, type KeyboardEvent, type MouseEvent } from 'react';
import type { ArtistRef, Track } from '@shared/types';
import { artistsText, cx, rowDuration } from '../lib/format';
import type { ReorderItem } from '../lib/useReorder';
import { player, usePlayer } from '../player/instance';
import { useLibrary } from '../stores/library';
import { navigate } from '../stores/nav';
import type { MenuItem } from '../stores/ui';
import { Cover } from './Cover';
import { onTrackContextMenu, openTrackMenu } from './ContextMenu';
import { IconButton } from './IconButton';

export function ArtistLinks({ artists }: { artists: ArtistRef[] }) {
  if (!artists.length) return <>Artista desconocido</>;
  return (
    <>
      {artists.map((a, i) => (
        <Fragment key={`${a.name}-${i}`}>
          {i > 0 && ', '}
          {a.id ? (
            <button
              type="button"
              className="link"
              tabIndex={-1}
              onClick={(e) => (e.stopPropagation(), navigate({ page: 'artist', id: a.id! }))}
            >
              {a.name}
            </button>
          ) : (
            a.name
          )}
        </Fragment>
      ))}
    </>
  );
}

function Equalizer() {
  return (
    <span className="eq" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

interface Props {
  track: Track;
  /** Posición visible (0-based). */
  index: number;
  /** "Reproducir desde esta canción": la lista sabe qué cola corresponde. */
  onPlay: () => void;
  showAlbum?: boolean;
  showCover?: boolean;
  menuExtra?: MenuItem[];
  reorder?: ReorderItem;
}

export function TrackRow({ track, index, onPlay, showAlbum = true, showCover = true, menuExtra, reorder }: Props) {
  // null = no es la canción actual; si lo es, su estado.
  const status = usePlayer((s) => (s.items[s.index]?.track.id === track.id ? s.status : null));
  const fav = useLibrary((s) => s.favoriteIds.has(track.id));
  const current = status !== null && status !== 'idle';
  const sounding = status === 'playing' || status === 'buffering';

  const activate = () => (current ? player().togglePlay() : onPlay());
  const menuOpts = { onPlay, extra: menuExtra };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    const li = e.currentTarget;
    if (e.key === 'Enter') onPlay();
    else if (e.key === 'ArrowDown') (li.nextElementSibling as HTMLElement | null)?.focus();
    else if (e.key === 'ArrowUp') (li.previousElementSibling as HTMLElement | null)?.focus();
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = li.getBoundingClientRect();
      openTrackMenu({ clientX: r.left + 80, clientY: r.top + r.height / 2 }, track, menuOpts);
    } else return;
    e.preventDefault();
  };

  const stop = (fn: () => void) => (e: MouseEvent) => (e.stopPropagation(), fn());

  return (
    <li
      className={cx('row', current && 'is-current', reorder?.dragging && 'is-dragging', reorder?.dropBefore && 'drop-before', reorder?.dropAfter && 'drop-after', !showAlbum && 'row--no-album')}
      tabIndex={0}
      aria-label={`${track.title}, ${artistsText(track.artists)}`}
      onDoubleClick={onPlay}
      onKeyDown={onKeyDown}
      onContextMenu={onTrackContextMenu(track, menuOpts)}
      {...reorder?.props}
    >
      <div className="row__lead">
        <span className="row__num" aria-hidden="true">
          {sounding ? <Equalizer /> : index + 1}
        </span>
        <button
          type="button"
          className="row__play"
          tabIndex={-1}
          aria-label={current ? (sounding ? `Pausar «${track.title}»` : `Reanudar «${track.title}»`) : `Reproducir desde «${track.title}»`}
          onClick={stop(activate)}
        >
          {sounding ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
      </div>

      <div className="row__main">
        {showCover && <Cover src={track.thumbnail} size={40} label={track.title} />}
        <div className="row__text">
          <span className="row__title">{track.title}</span>
          <span className="row__sub">
            <ArtistLinks artists={track.artists} />
          </span>
        </div>
      </div>

      {showAlbum && (
        <div className="row__album">
          {track.album?.id ? (
            <button type="button" className="link" tabIndex={-1} onClick={stop(() => navigate({ page: 'album', id: track.album!.id! }))}>
              {track.album.title}
            </button>
          ) : (
            track.album?.title
          )}
        </div>
      )}

      <div className="row__actions">
        <IconButton size="sm" tabIndex={-1} className="row__queue" icon={<ListPlus size={16} />} label="Agregar a la cola" onClick={stop(() => player().addToQueue([track]))} />
        <IconButton
          size="sm"
          tabIndex={-1}
          className={cx('row__fav', fav && 'is-faved')}
          icon={<Heart size={16} fill={fav ? 'currentColor' : 'none'} />}
          label={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          pressed={fav}
          onClick={stop(() => void useLibrary.getState().toggleFavorite(track))}
        />
      </div>

      <span className="row__dur">{rowDuration(track.durationSec)}</span>

      <IconButton
        size="sm"
        tabIndex={-1}
        className="row__more"
        icon={<Ellipsis size={16} />}
        label="Más opciones"
        onClick={(e) => (e.stopPropagation(), openTrackMenu(e, track, menuOpts))}
      />
    </li>
  );
}

/** Lista de canciones: contenedor con cabecera sticky y consulta de contenedor para ocultar el álbum. */
export function TrackList({ children, showAlbum = true, label }: { children: React.ReactNode; showAlbum?: boolean; label: string }) {
  return (
    <div className={cx('tracklist', !showAlbum && 'tracklist--no-album')}>
      <div className="tracklist__head" aria-hidden="true">
        <span className="th-num">#</span>
        <span>Título</span>
        {showAlbum && <span className="th-album">Álbum</span>}
        <span className="th-actions" />
        <span className="th-dur">Duración</span>
        <span className="th-more" />
      </div>
      <ul className="tracklist__body" aria-label={label}>
        {children}
      </ul>
    </div>
  );
}
