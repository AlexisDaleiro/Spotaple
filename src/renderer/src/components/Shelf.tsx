import { Play } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import type { AlbumSummary, ArtistSummary, PlaylistSummary, RemotePlaylistSummary, Track } from '@shared/types';
import { artistsText, plural } from '../lib/format';
import { navigate } from '../stores/nav';
import { Cover } from './Cover';
import { openTrackMenu } from './ContextMenu';

export function Shelf({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="shelf" aria-labelledby={id}>
      <header className="shelf__head">
        <h2 id={id} className="h2">
          {title}
        </h2>
        {action}
      </header>
      <div className="shelf__row">{children}</div>
    </section>
  );
}

interface CardProps {
  cover?: string;
  /** Texto para el marcador de portada y el nombre accesible. */
  name: string;
  subtitle: string;
  round?: boolean;
  onOpen: () => void;
  onPlay?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** Cuando la portada es un mosaico propio (playlists). */
  coverNode?: ReactNode;
}

export function MediaCard({ cover, name, subtitle, round, onOpen, onPlay, onContextMenu, coverNode }: CardProps) {
  return (
    <div className="card" onContextMenu={onContextMenu}>
      {/* Sin aria-label: el nombre sale del contenido (título y subtítulo). Un aria-label con otro separador no contiene el texto visible. */}
      <button type="button" className="card__body" onClick={onOpen}>
        <span className="card__cover">{coverNode ?? <Cover src={cover} size="fill" round={round} label={name} />}</span>
        <span className="card__title">{name}</span>
        <span className="card__sub">{subtitle}</span>
      </button>
      {onPlay && (
        <button type="button" className="card__play" aria-label={`Reproducir ${name}`} onClick={onPlay}>
          <Play size={18} fill="currentColor" />
        </button>
      )}
    </div>
  );
}

export const albumSubtitle = (a: AlbumSummary) =>
  ['Álbum', a.year, a.artists.length ? artistsText(a.artists) : undefined].filter(Boolean).join(' · ');

export function AlbumCard({ album, onPlay }: { album: AlbumSummary; onPlay?: () => void }) {
  return (
    <MediaCard
      cover={album.thumbnail}
      name={album.title}
      subtitle={albumSubtitle({ ...album, artists: album.artists })}
      onOpen={() => navigate({ page: 'album', id: album.id })}
      onPlay={onPlay}
    />
  );
}

export function ArtistCard({ artist, onPlay }: { artist: ArtistSummary; onPlay?: () => void }) {
  return (
    <MediaCard
      round
      cover={artist.thumbnail}
      name={artist.name}
      subtitle={['Artista', artist.subtitle].filter(Boolean).join(' · ')}
      onOpen={() => navigate({ page: 'artist', id: artist.id })}
      onPlay={onPlay}
    />
  );
}

/** Mosaico 2×2 (o portada única) de una playlist. */
export function PlaylistCover({ covers, name, size = 'fill' }: { covers: string[]; name: string; size?: number | 'fill' }) {
  if (covers.length < 4) return <Cover src={covers[0]} size={size} label={name} />;
  return (
    <div className="mosaic" style={size === 'fill' ? undefined : { width: size, height: size }}>
      {covers.slice(0, 4).map((c, i) => (
        <Cover key={i} src={c} size="fill" label={`${name}${i}`} />
      ))}
    </div>
  );
}

export function PlaylistCard({ playlist, onPlay, onContextMenu }: { playlist: PlaylistSummary; onPlay?: () => void; onContextMenu?: (e: MouseEvent) => void }) {
  return (
    <MediaCard
      name={playlist.name}
      subtitle={`Playlist · ${plural(playlist.trackCount, 'canción', 'canciones')}`}
      coverNode={<PlaylistCover covers={playlist.covers} name={playlist.name} />}
      onOpen={() => navigate({ page: 'playlist', id: playlist.id })}
      onPlay={playlist.trackCount ? onPlay : undefined}
      onContextMenu={onContextMenu}
    />
  );
}

/** Playlist de YouTube Music encontrada en la búsqueda: se abre en su página; el autor viaja en la ruta (la cabecera no lo trae). */
export function RemotePlaylistCard({ playlist, onPlay }: { playlist: RemotePlaylistSummary; onPlay?: () => void }) {
  return (
    <MediaCard
      cover={playlist.thumbnail}
      name={playlist.title}
      subtitle={['Playlist', playlist.author].filter(Boolean).join(' · ')}
      onOpen={() => navigate({ page: 'remotePlaylist', id: playlist.id, author: playlist.author })}
      onPlay={onPlay}
    />
  );
}

/** Cabecera de álbum / artista / playlist: portada protagonista, título, metadatos y acciones. */
export function Hero({ cover, kind, title, meta, actions, children }: { cover: ReactNode; kind: string; title: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="hero">
      <div className="hero__cover">{cover}</div>
      <div className="hero__body">
        <span className="hero__kind">{kind}</span>
        <h1 className="hero__title">{title}</h1>
        {meta && <div className="hero__meta">{meta}</div>}
        {children}
        {actions && <div className="hero__actions">{actions}</div>}
      </div>
    </header>
  );
}

/** Tarjeta de canción para "escuchado recientemente": reproducir directo, abrir menú con clic derecho. */
export function TrackCard({ track, onPlay }: { track: Track; onPlay: () => void }) {
  return (
    <MediaCard
      cover={track.thumbnail}
      name={track.title}
      subtitle={artistsText(track.artists)}
      onOpen={onPlay}
      onPlay={onPlay}
      onContextMenu={(e) => (e.preventDefault(), openTrackMenu(e, track, { onPlay }))}
    />
  );
}
