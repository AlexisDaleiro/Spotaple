import { ArrowLeft, ChevronRight, CircleUserRound, Disc3, Download, Heart, ListEnd, ListMusic, ListPlus, Play, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { AUDIO_FORMATS, type AudioFormat } from '@shared/offline';
import type { Track } from '@shared/types';
import { exportTrack } from '../lib/actions';
import { cx } from '../lib/format';
import { player } from '../player/instance';
import { inRoom, isAdmin, useJam } from '../stores/jam';
import { useLibrary } from '../stores/library';
import { navigate } from '../stores/nav';
import { useOffline } from '../stores/offline';
import { settingsStore } from '../stores/settings';
import { useUi, type MenuItem } from '../stores/ui';

export interface TrackMenuOptions {
  /** "Reproducir desde aquí": cada lista sabe qué cola corresponde. */
  onPlay?: () => void;
  /** Acciones propias del contexto (quitar de la playlist, mover…). Van arriba del todo. */
  extra?: MenuItem[];
}

export function trackMenuItems(track: Track, opts: TrackMenuOptions = {}): MenuItem[] {
  const lib = useLibrary.getState();
  const fav = lib.isFavorite(track.id);
  const artist = track.artists.find((a) => a.id);

  const playlistItems: MenuItem[] = [
    {
      label: 'Nueva playlist…',
      icon: <Plus size={15} />,
      onSelect: () =>
        useUi.getState().openDialog({
          kind: 'prompt',
          title: 'Nueva playlist',
          label: 'Nombre',
          initial: track.title,
          confirmLabel: 'Crear y agregar',
          onSubmit: async (name) => {
            const p = await lib.createPlaylist(name);
            if (p) await useLibrary.getState().addToPlaylist(p, [track]);
          },
        }),
    },
    ...(lib.playlists.length ? [{ separator: true } as MenuItem] : []),
    ...lib.playlists.map<MenuItem>((p) => ({
      label: p.name,
      icon: <ListMusic size={15} />,
      onSelect: () => void useLibrary.getState().addToPlaylist(p, [track]),
    })),
  ];

  // «Descargar canción»: el formato de Ajustes va primero. Sin red solo se puede guardar lo que ya está descargado (en Opus).
  const offline = useOffline.getState();
  const preferred = settingsStore.getState().settings.exportFormat;
  const formats: AudioFormat[] = preferred === 'aac' ? ['aac', 'opus'] : ['opus', 'aac'];
  const downloadItems = formats.map<MenuItem>((f) => ({
    label: AUDIO_FORMATS[f].label,
    disabled: !offline.online && f === 'aac',
    onSelect: () => void exportTrack(track, f),
  }));

  // Dentro de una sala "agregar a la cola" es pedir a la sala (el reproductor lo enruta); "como siguiente" es cosa del admin.
  const jam = useJam.getState().view;
  const queueItems: MenuItem[] = inRoom(jam)
    ? [
        { label: 'Pedir a la sala', icon: <ListPlus size={15} />, onSelect: () => (player().addToQueue([track]), void 0) },
        ...(isAdmin(jam) ? [{ label: 'Pedir como siguiente', icon: <ListEnd size={15} />, onSelect: () => (player().playNext([track]), void 0) }] : []),
      ]
    : [
        ...(opts.onPlay ? [{ label: 'Reproducir desde esta canción', icon: <Play size={15} />, onSelect: opts.onPlay }] : []),
        { label: 'Reproducir a continuación', icon: <ListEnd size={15} />, onSelect: () => (player().playNext([track]), void 0) },
        { label: 'Agregar a la cola', icon: <ListPlus size={15} />, onSelect: () => (player().addToQueue([track]), void 0) },
      ];

  return [
    ...(opts.extra?.length ? [...opts.extra, { separator: true } as MenuItem] : []),
    ...queueItems,
    { separator: true },
    {
      label: fav ? 'Quitar de favoritos' : 'Agregar a favoritos',
      icon: <Heart size={15} fill={fav ? 'currentColor' : 'none'} />,
      onSelect: () => void lib.toggleFavorite(track),
    },
    { label: 'Agregar a playlist', icon: <ListMusic size={15} />, submenu: playlistItems },
    { label: 'Descargar canción', icon: <Download size={15} />, disabled: !offline.reachable(track.id), submenu: downloadItems },
    { separator: true },
    { label: 'Ir al álbum', icon: <Disc3 size={15} />, disabled: !track.album?.id, onSelect: () => navigate({ page: 'album', id: track.album!.id! }) },
    { label: 'Ir al artista', icon: <CircleUserRound size={15} />, disabled: !artist, onSelect: () => navigate({ page: 'artist', id: artist!.id! }) },
  ];
}

/** Abre el menú de canción en el cursor (clic derecho) o junto a un botón. */
export function openTrackMenu(at: { clientX: number; clientY: number }, track: Track, opts?: TrackMenuOptions) {
  useUi.getState().openMenu(at.clientX, at.clientY, trackMenuItems(track, opts));
}

export const onTrackContextMenu = (track: Track, opts?: TrackMenuOptions) => (e: ReactMouseEvent) => {
  e.preventDefault();
  openTrackMenu(e, track, opts);
};

/** Menú genérico (playlists, álbumes…). */
export const openMenuAt = (at: { clientX: number; clientY: number }, items: MenuItem[]) =>
  useUi.getState().openMenu(at.clientX, at.clientY, items);

export function MenuHost() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState<{ title: string; items: MenuItem[] }[]>([]);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const opener = useRef<HTMLElement | null>(null);

  const level = stack.at(-1);
  const items = level ? level.items : (menu?.items ?? []);

  // Reinicia al abrir uno nuevo y recuerda quién tenía el foco para devolvérselo.
  useEffect(() => {
    setStack([]);
    if (menu) opener.current = document.activeElement as HTMLElement | null;
  }, [menu]);

  // Mantiene el menú dentro de la ventana.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu, items]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [menu, level]);

  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, close]);

  if (!menu) return null;

  const dismiss = () => {
    close();
    opener.current?.focus?.();
  };
  const choose = (it: MenuItem) => {
    if (it.disabled) return;
    if (it.submenu) return setStack([...stack, { title: it.label ?? '', items: it.submenu }]);
    close();
    it.onSelect?.();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus();
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus();
    else if (e.key === 'Escape') dismiss();
    else if (e.key === 'ArrowLeft' && stack.length) setStack(stack.slice(0, -1));
    else if (e.key === 'Tab') dismiss();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {level && (
        <button type="button" role="menuitem" className="menu__item menu__back" onClick={() => setStack(stack.slice(0, -1))}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span>{level.title}</span>
        </button>
      )}
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu__sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={cx('menu__item', it.danger && 'is-danger')}
            disabled={it.disabled}
            onClick={() => choose(it)}
          >
            <span className="menu__icon" aria-hidden="true">
              {it.icon}
            </span>
            <span className="menu__label">{it.label}</span>
            {it.hint && <span className="menu__hint">{it.hint}</span>}
            {it.submenu && <ChevronRight size={14} aria-hidden="true" className="menu__chev" />}
          </button>
        ),
      )}
    </div>
  );
}
