import { ChevronDown, Heart, ListMusic, Pause, Play, Repeat, Repeat1, Share2, Shuffle, SkipBack, SkipForward, ThumbsUp, Volume1, Volume2, VolumeX, Vote } from 'lucide-react';
import { useState } from 'react';
import { skipThreshold } from '@shared/jam/engine';
import type { JamView } from '@shared/jam/types';
import { trackLink } from '@shared/track';
import { api } from '../api';
import { nextIndex } from '../player/queue';
import { artistsText, cx, formatTime } from '../lib/format';
import { shareTrack } from '../lib/actions';
import { player, usePlayer } from '../player/instance';
import { canAdvance, inRoom, isAdmin, useJam } from '../stores/jam';
import { useLibrary } from '../stores/library';
import { navigate } from '../stores/nav';
import { useUi } from '../stores/ui';
import { Cover } from './Cover';
import { IconButton } from './IconButton';
import { ArtistLinks } from './TrackRow';
import { Spinner } from './States';

interface SliderProps {
  value: number;
  max: number;
  step?: number;
  label: string;
  valueText: (v: number) => string;
  disabled?: boolean;
  /** true: confirma en cada cambio (volumen). false: confirma al soltar (posición). */
  live?: boolean;
  onCommit: (v: number) => void;
  onScrub?: (v: number | null) => void;
  className?: string;
}

/** Control deslizante nativo (teclado y lectores de pantalla incluidos) con relleno por CSS. */
function Slider({ value, max, step = 1, label, valueText, disabled, live, onCommit, onScrub, className }: SliderProps) {
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? value;
  const set = (v: number | null) => (setScrub(v), onScrub?.(v));
  const commit = () => {
    if (scrub !== null) onCommit(scrub);
    set(null);
  };
  return (
    <input
      type="range"
      className={cx('slider', className)}
      min={0}
      max={max || 1}
      step={step}
      value={Math.min(shown, max || 1)}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText(shown)}
      style={{ '--pct': `${max ? (Math.min(shown, max) / max) * 100 : 0}%` } as React.CSSProperties}
      onChange={(e) => (live ? onCommit(Number(e.target.value)) : set(Number(e.target.value)))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}

function Progress({ locked }: { locked?: boolean }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const status = usePlayer((s) => s.status);
  const hasItem = usePlayer((s) => s.index >= 0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const shown = scrubbing ?? position;
  const seekable = hasItem && duration > 0 && status !== 'loading' && !locked;
  return (
    <div className="progress">
      <span className="progress__time" aria-hidden="true">
        {formatTime(hasItem ? shown : 0)}
      </span>
      <Slider
        className="slider--progress"
        label="Posición de reproducción"
        value={position}
        max={duration}
        disabled={!seekable}
        valueText={(v) => `${formatTime(v)} de ${formatTime(duration)}`}
        onScrub={setScrubbing}
        onCommit={(v) => player().seek(v)}
      />
      <span className="progress__time" aria-hidden="true">
        {hasItem && duration > 0 ? formatTime(duration) : '–:––'}
      </span>
      {status === 'buffering' && (
        <span className="progress__buffer" role="status" aria-label="Esperando datos">
          <Spinner size={13} />
        </span>
      )}
    </div>
  );
}

const sendJam = (msg: unknown) => void api.jam.send(msg).catch(() => undefined);

/** Votar para saltar y dar like: solo con una sala viva y una canción sonando. */
function JamButtons({ view }: { view: JamView }) {
  const state = view.state!;
  const now = state.now!;
  const connected = new Set(state.members.filter((m) => m.connected).map((m) => m.id));
  const votes = now.skipVotes.filter((id) => connected.has(id)).length;
  const need = skipThreshold(state);
  // El admin y quien pidió la canción la saltan directo; el resto vota.
  const direct = isAdmin(view) || now.item.addedBy === view.selfId;
  const voted = now.skipVotes.includes(view.selfId);
  const liked = now.likes.includes(view.selfId);
  const skipLabel = direct ? 'Saltar esta canción' : `Votar para saltar (${votes} de ${need})`;
  return (
    <>
      <button
        type="button"
        className={cx('jam-counter-btn', 'jam-skip', voted && 'is-on')}
        aria-label={skipLabel}
        title={skipLabel}
        aria-pressed={direct ? undefined : voted}
        onClick={() => sendJam({ t: 'vote.skip' })}
      >
        <Vote size={17} aria-hidden="true" />
        {!direct && (
          <span>
            {votes}/{need}
          </span>
        )}
      </button>
      <button
        type="button"
        className={cx('jam-counter-btn', 'jam-like', liked && 'is-on')}
        aria-label={`Me gusta esta elección (${now.likes.length})`}
        title="Me gusta esta elección"
        aria-pressed={liked}
        onClick={() => sendJam({ t: 'like.toggle' })}
      >
        <ThumbsUp size={17} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
        <span>{now.likes.length}</span>
      </button>
    </>
  );
}

export function PlayerBar() {
  const localItem = usePlayer((s) => s.items[s.index]);
  const view = useJam((s) => s.view);
  const room = inRoom(view) ? view : null;
  const admin = isAdmin(room);
  const now = room?.state?.now ?? null;
  // En una sala se muestra la canción de la sala, aunque el reproductor local de un miembro esté vacío ("Solo admin").
  const item = room ? (now ? { track: now.item.track } : undefined) : localItem;
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const hasNext = usePlayer((s) => nextIndex(s.items.length, s.index, s.repeat, false) !== null);
  const queueOpen = useUi((s) => s.queueOpen);
  const mobile = api.platform === 'android';
  const expanded = useUi((s) => mobile && s.mobilePlayerOpen);
  const fav = useLibrary((s) => (item ? s.favoriteIds.has(item.track.id) : false));
  // En una sala solo el admin controla la reproducción.
  const locked = room !== null && !admin;
  const lockTitle = 'Solo el admin controla la reproducción';

  const loading = status === 'loading';
  const sounding = status === 'playing' || status === 'buffering';
  const effective = muted ? 0 : volume;
  const VolIcon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2;
  const repeatLabel = repeat === 'off' ? 'Repetir: desactivado' : repeat === 'all' ? 'Repetir: toda la cola' : 'Repetir: una canción';
  const share = item && trackLink(item.track.id)
    ? <IconButton icon={<Share2 size={17} />} label="Compartir canción" onClick={() => void shareTrack(item.track)} />
    : null;

  return (
    <footer
      className={cx('player', mobile && (expanded ? 'player--expanded' : 'player--compact'), mobile && !expanded && !item && !room && 'player--empty')}
      aria-label="Reproductor"
    >
      {expanded && (
        <div className="player__mobile-head">
          <IconButton icon={<ChevronDown size={24} />} label="Cerrar reproductor" autoFocus onClick={() => useUi.setState({ mobilePlayerOpen: false })} />
          <span>Reproduciendo</span>
        </div>
      )}
      <div className="player__now">
        {mobile && !expanded && (item || room) && (
          <button type="button" className="player__open" aria-label="Abrir reproductor" onClick={() => useUi.setState({ mobilePlayerOpen: true })} />
        )}
        {item ? (
          <>
            <Cover src={item.track.thumbnail} size={56} label={item.track.title} className="player__cover" />
            <div className="player__meta">
              {item.track.album?.id ? (
                <button type="button" className="player__title link" onClick={() => navigate({ page: 'album', id: item.track.album!.id! })} title={item.track.title}>
                  {item.track.title}
                </button>
              ) : (
                <span className="player__title" title={item.track.title}>
                  {item.track.title}
                </span>
              )}
              {status === 'error' && error && !locked ? (
                <span className="player__error" role="alert">
                  <span className="player__error-msg" title={error.message}>
                    {error.message}
                  </span>
                  <button type="button" className="link link--accent" onClick={() => player().togglePlay()}>
                    Reintentar
                  </button>
                </span>
              ) : (
                <span className="player__artist" title={artistsText(item.track.artists)}>
                  <ArtistLinks artists={item.track.artists} />
                </span>
              )}
              {room && now && <span className="jam-req">Pedida por {room.state?.members.find((m) => m.id === now.item.addedBy)?.name ?? 'alguien'}</span>}
            </div>
            <IconButton
              className={cx('player__fav', fav && 'is-faved')}
              icon={<Heart size={18} fill={fav ? 'currentColor' : 'none'} />}
              label={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
              pressed={fav}
              onClick={() => void useLibrary.getState().toggleFavorite(item.track)}
            />
          </>
        ) : (
          <div className="player__idle">
            <span className="player__idle-cover" aria-hidden="true" />
            <span>
              {room
                ? room.state?.halted
                  ? admin
                    ? 'La sala se detuvo: pasá a la siguiente'
                    : 'La sala se detuvo: el admin tiene que pasar a la siguiente'
                  : 'Nadie pidió nada todavía'
                : 'Elegí una canción para empezar'}
            </span>
          </div>
        )}
      </div>

      <div className="player__center">
        <div className="player__controls">
          <IconButton icon={<Shuffle size={17} />} label={shuffle ? 'Aleatorio: activado' : 'Aleatorio: desactivado'} pressed={shuffle} disabled={room !== null} onClick={() => player().toggleShuffle()} />
          <IconButton icon={<SkipBack size={19} fill="currentColor" />} label="Canción anterior" disabled={!item || room !== null} onClick={() => player().prev()} />
          <button
            type="button"
            className="play-btn"
            aria-label={sounding ? 'Pausar' : 'Reproducir'}
            title={locked ? lockTitle : sounding ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
            disabled={locked || !item}
            onClick={() => player().togglePlay()}
          >
            {loading ? <Spinner size={18} /> : sounding ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="play-btn__glyph" />}
          </button>
          <IconButton
            className="player__next"
            icon={<SkipForward size={19} fill="currentColor" />}
            label="Canción siguiente"
            {...(locked ? { title: lockTitle } : {})}
            disabled={room ? !canAdvance(room) : !item || !hasNext}
            onClick={() => (room ? sendJam({ t: 'transport', action: 'next' }) : player().next())}
          />
          <IconButton
            icon={repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
            label={repeatLabel}
            pressed={repeat !== 'off'}
            disabled={room !== null}
            onClick={() => player().cycleRepeat()}
          />
          {!mobile && share}
        </div>
        <Progress locked={locked} />
      </div>

      <div className="player__right">
        {room && now && <JamButtons view={room} />}
        <IconButton icon={<ListMusic size={18} />} label={queueOpen ? 'Ocultar la cola' : 'Mostrar la cola'} pressed={queueOpen} onClick={() => useUi.getState().toggleQueue()} />
        {mobile && share}
        <div className="volume">
          <IconButton icon={<VolIcon size={18} />} label={muted ? 'Activar sonido' : 'Silenciar'} onClick={() => player().toggleMute()} />
          <Slider
            className="slider--volume"
            label="Volumen"
            value={effective}
            max={1}
            step={0.01}
            live
            valueText={(v) => `${Math.round(v * 100)}%`}
            onCommit={(v) => player().setVolume(v)}
          />
        </div>
      </div>
    </footer>
  );
}
