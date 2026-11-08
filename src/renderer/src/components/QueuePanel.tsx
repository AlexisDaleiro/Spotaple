import { Ellipsis, GripVertical, ListMusic, X } from 'lucide-react';
import { Fragment, type KeyboardEvent } from 'react';
import type { JamItem, JamView } from '@shared/jam/types';
import { api } from '../api';
import { artistsText, cx, rowDuration } from '../lib/format';
import { useReorder } from '../lib/useReorder';
import { player, usePlayer } from '../player/instance';
import type { QueueItem } from '../player/queue';
import { inRoom, isAdmin, useJam } from '../stores/jam';
import { useUi, type MenuItem } from '../stores/ui';
import { Cover } from './Cover';
import { IconButton } from './IconButton';
import { onTrackContextMenu, openTrackMenu } from './ContextMenu';
import { Empty } from './States';

/** Foco al hermano anterior o siguiente que se pueda enfocar: salta los separadores (p. ej. «Radio automática»). */
function focusSibling(el: HTMLElement, dir: 'next' | 'prev') {
  const step = (e: HTMLElement) => (dir === 'next' ? e.nextElementSibling : e.previousElementSibling) as HTMLElement | null;
  let sib = step(el);
  while (sib && sib.tabIndex < 0) sib = step(sib);
  sib?.focus();
}

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
    else if (e.key === 'ArrowDown') focusSibling(e.currentTarget, 'next');
    else if (e.key === 'ArrowUp') focusSibling(e.currentTarget, 'prev');
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
      aria-label={`${t.title}, ${artistsText(t.artists)}${item.auto ? ', de la radio automática' : ''}${current ? ', sonando ahora' : ''}`}
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
      {api.platform === 'android' && <IconButton size="sm" icon={<Ellipsis size={17} />} label={`Opciones de «${t.title}»`} onClick={(e) => openTrackMenu(e, t, { extra })} />}
      {!current && <IconButton size="sm" tabIndex={-1} className="qrow__remove" icon={<X size={15} />} label={`Quitar «${t.title}» de la cola`} onClick={() => player().removeFromQueue(item.uid)} />}
    </li>
  );
}

function PersonalQueue() {
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
                  <Fragment key={it.uid}>
                    {it.auto && !upcoming[i - 1]?.auto && (
                      <li className="queue__divider" aria-hidden="true">
                        Radio automática
                      </li>
                    )}
                    <QueueRow item={it} absIndex={index + 1 + i} upcomingCount={upcoming.length} reorder={reorder(i)} />
                  </Fragment>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

const sendJam = (msg: unknown) => void api.jam.send(msg).catch(() => undefined);

/** Una fila de la cola de la sala: quién la pidió, y quitar/reordenar según el rol. */
function JamQueueRow({ item, view, reorder, current }: { item: JamItem; view: JamView; reorder?: ReturnType<ReturnType<typeof useReorder>>; current?: boolean }) {
  const t = item.track;
  const admin = isAdmin(view);
  const who = view.state?.members.find((m) => m.id === item.addedBy)?.name ?? 'alguien';
  const canRemove = !current && (admin || item.addedBy === view.selfId);
  const remove = () => sendJam({ t: 'queue.remove', itemId: item.itemId });
  const index = view.state?.queue.findIndex((queued) => queued.itemId === item.itemId) ?? -1;
  const move = (toIndex: number) => sendJam({ t: 'queue.move', itemId: item.itemId, toIndex });
  const extra: MenuItem[] = current
    ? []
    : [
        ...(admin
          ? [
              { label: 'Reproducir ahora', onSelect: () => sendJam({ t: 'queue.playNow', itemId: item.itemId }) },
              { label: 'Reproducir a continuación', onSelect: () => sendJam({ t: 'queue.playNext', itemId: item.itemId }) },
              { label: 'Mover arriba', disabled: index <= 0, onSelect: () => move(index - 1) },
              { label: 'Mover abajo', disabled: index < 0 || index >= (view.state?.queue.length ?? 0) - 1, onSelect: () => move(index + 1) },
            ]
          : []),
        ...(canRemove ? [{ label: 'Quitar de la cola', danger: true, onSelect: remove }] : []),
      ];
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Delete' && canRemove) remove();
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
      aria-label={`${t.title}, ${artistsText(t.artists)}, pedida por ${who}${current ? ', sonando ahora' : ''}`}
      onKeyDown={onKeyDown}
      onContextMenu={onTrackContextMenu(t, { extra })}
      {...reorder?.props}
    >
      {reorder && !current && <GripVertical size={14} className="qrow__grip" aria-hidden="true" />}
      <Cover src={t.thumbnail} size={40} label={t.title} />
      <div className="qrow__text">
        <span className="qrow__title">{t.title}</span>
        <span className="qrow__sub">
          {artistsText(t.artists)} · Pedida por {who}
        </span>
      </div>
      <span className="qrow__dur">{rowDuration(t.durationSec)}</span>
      {api.platform === 'android' && <IconButton size="sm" icon={<Ellipsis size={17} />} label={`Opciones de «${t.title}»`} onClick={(e) => openTrackMenu(e, t, { extra })} />}
      {canRemove && <IconButton size="sm" tabIndex={-1} className="qrow__remove" icon={<X size={15} />} label={`Quitar «${t.title}» de la cola`} onClick={remove} />}
    </li>
  );
}

/** Cola compartida de la sala: el admin reordena y quita; cada miembro quita solo lo que pidió. */
function JamQueue({ view }: { view: JamView }) {
  const toggle = useUi((s) => s.toggleQueue);
  const state = view.state!;
  const admin = isAdmin(view);
  const reorder = useReorder(state.queue.length, (from, to) => {
    const it = state.queue[from];
    if (it) sendJam({ t: 'queue.move', itemId: it.itemId, toIndex: to });
  });

  return (
    <aside className="queue" aria-label="Cola de la sala">
      <header className="queue__head">
        <h2 className="h2">Cola de la sala</h2>
        <IconButton size="sm" icon={<X size={16} />} label="Cerrar la cola" onClick={toggle} />
      </header>
      <div className="queue__scroll">
        {!state.now && state.queue.length === 0 ? (
          <Empty icon={<ListMusic size={24} />} title="La cola de la sala está vacía" text="Pedí canciones con el botón + de cada fila o con clic derecho." />
        ) : (
          <>
            {state.now && (
              <>
                <h3 className="queue__section">Reproduciendo ahora</h3>
                <ul className="queue__list" aria-label="Canción actual">
                  <JamQueueRow item={state.now.item} view={view} current />
                </ul>
              </>
            )}
            <div className="queue__section queue__section--row">
              <h3>A continuación{state.queue.length ? ` · ${state.queue.length}` : ''}</h3>
            </div>
            {state.halted && <p className="queue__hint">La sala se detuvo porque varias canciones seguidas no estaban disponibles. El admin puede pasar a la siguiente.</p>}
            {state.queue.length === 0 ? (
              <p className="queue__hint">No hay nada más en la cola de la sala.</p>
            ) : (
              <ul className="queue__list" aria-label="Próximas canciones">
                {state.queue.map((it, i) => (
                  <JamQueueRow key={it.itemId} item={it} view={view} reorder={admin ? reorder(i) : undefined} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** Dentro de una sala la cola es la de la sala; fuera, la personal. */
export function QueuePanel() {
  const view = useJam((s) => s.view);
  return inRoom(view) && view ? <JamQueue view={view} /> : <PersonalQueue />;
}
