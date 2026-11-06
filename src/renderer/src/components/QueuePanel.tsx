import { GripVertical, ListMusic, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { artistsText, cx, rowDuration } from '../lib/format';
import { useReorder } from '../lib/useReorder';
import { player, usePlayer } from '../player/instance';
import type { QueueItem } from '../player/queue';
import { useUi, type MenuItem } from '../stores/ui';
import { Cover } from './Cover';
import { IconButton } from './IconButton';
import { onTrackContextMenu, openTrackMenu } from './ContextMenu';
import { Empty } from './States';

function QueueRow({
  item,
  absIndex,
  current,
  upcomingCount,
  reorder,
}: {
  item: QueueItem;
  absIndex: number;
  current?: boolean;
  upcomingCount?: number;
  reorder?: ReturnType<ReturnType<typeof useReorder>>;
}) {
  const sounding = usePlayer((s) => current && (s.status === 'playing' || s.status === 'buffering'));
  const t = item.track;
  const extra: MenuItem[] = current
    ? []
    : [
        { label: 'Mover arriba', disabled: !upcomingCount || absIndex <= player().index + 1, onSelect: () => player().moveInQueue(absIndex, absIndex - 1) },
        { label: 'Mover abajo', disabled: absIndex >= player().items.length - 1, onSelect: () => player().moveInQueue(absIndex, absIndex + 1) },
        { label: 'Quitar de la cola', danger: true, onSelect: () => player().removeFromQueue(item.uid) },
      ];
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') player().playIndex(absIndex);
    else if (e.key === 'Delete' && !current) player().removeFromQueue(item.uid);
    else if (e.key === 'ArrowDown') (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
    else if (e.key === 'ArrowUp') (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = e.currentTarget.getBoundingClientRect();
      openTrackMenu({ clientX: r.left + 60, clientY: r.top + r.height / 2 }, t, { extra });
    } else return;
    e.preventDefault();
  };
  return (
    <li
      className={cx('qrow', current && 'is-current', reorder?.dragging && 'is-dragging', reorder?.dropBefore && 'drop-before', reorder?.dropAfter && 'drop-after')}
      tabIndex={0}
      aria-label={`${t.title}, ${artistsText(t.artists)}${current ? ', sonando ahora' : ''}`}
      onDoubleClick={() => player().playIndex(absIndex)}
      onKeyDown={onKeyDown}
      onContextMenu={onTrackContextMenu(t, { extra })}
      {...reorder?.props}
    >
      {!current && <GripVertical size={14} className="qrow__grip" aria-hidden="true" />}
      <Cover src={t.thumbnail} size={40} label={t.title} />
      <button type="button" className="qrow__text" tabIndex={-1} onClick={() => player().playIndex(absIndex)}>
        <span className={cx('qrow__title', sounding && 'is-sounding')}>{t.title}</span>
        <span className="qrow__sub">{artistsText(t.artists)}</span>
      </button>
      <span className="qrow__dur">{rowDuration(t.durationSec)}</span>
      {!current && <IconButton size="sm" tabIndex={-1} className="qrow__remove" icon={<X size={15} />} label={`Quitar «${t.title}» de la cola`} onClick={() => player().removeFromQueue(item.uid)} />}
    </li>
  );
}

export function QueuePanel() {
  const items = usePlayer((s) => s.items);
  const index = usePlayer((s) => s.index);
  const toggle = useUi((s) => s.toggleQueue);

  const current = items[index];
  const upcoming = items.slice(index + 1);
  const reorder = useReorder(upcoming.length, (from, to) => player().moveInQueue(index + 1 + from, index + 1 + to));

  return (
    <aside className="queue" aria-label="Cola de reproducción">
      <header className="queue__head">
        <h2 className="h2">Cola</h2>
        <IconButton size="sm" icon={<X size={16} />} label="Cerrar la cola" onClick={toggle} />
      </header>
      <div className="queue__scroll">
        {!current ? (
          <Empty icon={<ListMusic size={24} />} title="La cola está vacía" text="Agregá canciones con el botón + de cada fila o con clic derecho." />
        ) : (
          <>
            <h3 className="queue__section">Reproduciendo ahora</h3>
            <ul className="queue__list" aria-label="Canción actual">
              <QueueRow item={current} absIndex={index} current />
            </ul>
            <div className="queue__section queue__section--row">
              <h3>A continuación{upcoming.length ? ` · ${upcoming.length}` : ''}</h3>
              {upcoming.length > 0 && (
                <button type="button" className="link link--accent" onClick={() => player().clearUpcoming()}>
                  Limpiar
                </button>
              )}
            </div>
            {upcoming.length === 0 ? (
              <p className="queue__hint">No hay nada más en la cola. Cuando termine esta canción, la reproducción se detiene.</p>
            ) : (
              <ul className="queue__list" aria-label="Próximas canciones">
                {upcoming.map((it, i) => (
                  <QueueRow key={it.uid} item={it} absIndex={index + 1 + i} upcomingCount={upcoming.length} reorder={reorder(i)} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
