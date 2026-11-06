import { Heart, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { nextIndex } from '../player/queue';
import { artistsText, cx, formatTime } from '../lib/format';
import { player, usePlayer } from '../player/instance';
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

function Progress() {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const status = usePlayer((s) => s.status);
  const hasItem = usePlayer((s) => s.index >= 0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const shown = scrubbing ?? position;
  const seekable = hasItem && duration > 0 && status !== 'loading';
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

export function PlayerBar() {
  const item = usePlayer((s) => s.items[s.index]);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const hasNext = usePlayer((s) => nextIndex(s.items.length, s.index, s.repeat, false) !== null);
  const queueOpen = useUi((s) => s.queueOpen);
  const fav = useLibrary((s) => (item ? s.favoriteIds.has(item.track.id) : false));

  const loading = status === 'loading';
  const sounding = status === 'playing' || status === 'buffering';
  const effective = muted ? 0 : volume;
  const VolIcon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2;
  const repeatLabel = repeat === 'off' ? 'Repetir: desactivado' : repeat === 'all' ? 'Repetir: toda la cola' : 'Repetir: una canción';

  return (
    <footer className="player" aria-label="Reproductor">
      <div className="player__now">
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
              {status === 'error' && error ? (
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
            <span>Elegí una canción para empezar</span>
          </div>
        )}
      </div>

      <div className="player__center">
        <div className="player__controls">
          <IconButton icon={<Shuffle size={17} />} label={shuffle ? 'Aleatorio: activado' : 'Aleatorio: desactivado'} pressed={shuffle} onClick={() => player().toggleShuffle()} />
          <IconButton icon={<SkipBack size={19} fill="currentColor" />} label="Canción anterior" disabled={!item} onClick={() => player().prev()} />
          <button
            type="button"
            className="play-btn"
            aria-label={sounding ? 'Pausar' : 'Reproducir'}
            title={sounding ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
            disabled={!item}
            onClick={() => player().togglePlay()}
          >
            {loading ? <Spinner size={18} /> : sounding ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="play-btn__glyph" />}
          </button>
          <IconButton icon={<SkipForward size={19} fill="currentColor" />} label="Canción siguiente" disabled={!item || !hasNext} onClick={() => player().next()} />
          <IconButton
            icon={repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
            label={repeatLabel}
            pressed={repeat !== 'off'}
            onClick={() => player().cycleRepeat()}
          />
        </div>
        <Progress />
      </div>

      <div className="player__right">
        <IconButton icon={<ListMusic size={18} />} label={queueOpen ? 'Ocultar la cola' : 'Mostrar la cola'} pressed={queueOpen} onClick={() => useUi.getState().toggleQueue()} />
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
