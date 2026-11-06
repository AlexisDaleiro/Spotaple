import { ListMusic, Pencil, Play, Plus, Trash2, ListPlus } from 'lucide-react';
import type { PlaylistSummary } from '@shared/types';
import { playPlaylist, queuePlaylist } from '../lib/actions';
import { useLibrary } from '../stores/library';
import { toast, useUi, type MenuItem } from '../stores/ui';
import { openMenuAt } from '../components/ContextMenu';
import { PlaylistCard } from '../components/Shelf';
import { Empty } from '../components/States';
import { openNewPlaylistDialog } from '../components/Sidebar';

export function renamePlaylistDialog(p: PlaylistSummary) {
  useUi.getState().openDialog({
    kind: 'prompt',
    title: 'Cambiar el nombre',
    label: 'Nombre',
    initial: p.name,
    confirmLabel: 'Guardar',
    onSubmit: (name) => useLibrary.getState().renamePlaylist(p.id, name),
  });
}

/** Elimina la playlist; con canciones pide confirmación, vacía se borra directo. */
export function deletePlaylistFlow(p: PlaylistSummary, after?: () => void) {
  const run = async () => {
    await useLibrary.getState().deletePlaylist(p.id);
    toast(`«${p.name}» eliminada`);
    after?.();
  };
  if (p.trackCount === 0) return void run();
  useUi.getState().openDialog({
    kind: 'confirm',
    title: `¿Eliminar «${p.name}»?`,
    message: `Se va a borrar la playlist y sus ${p.trackCount} canciones guardadas en ella. Las canciones en sí no se tocan, pero esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
    onConfirm: run,
  });
}

export const playlistMenu = (p: PlaylistSummary, after?: () => void): MenuItem[] => [
  { label: 'Reproducir', icon: <Play size={15} />, disabled: p.trackCount === 0, onSelect: () => void playPlaylist(p.id) },
  { label: 'Agregar a la cola', icon: <ListPlus size={15} />, disabled: p.trackCount === 0, onSelect: () => void queuePlaylist(p.id) },
  { separator: true },
  { label: 'Cambiar el nombre', icon: <Pencil size={15} />, onSelect: () => renamePlaylistDialog(p) },
  { label: 'Eliminar', icon: <Trash2 size={15} />, danger: true, onSelect: () => deletePlaylistFlow(p, after) },
];

export function PlaylistsPage() {
  const playlists = useLibrary((s) => s.playlists);
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="h1">Playlists</h1>
        <button type="button" className="btn btn--solid" onClick={() => openNewPlaylistDialog()}>
          <Plus size={16} /> Nueva playlist
        </button>
      </header>
      {playlists.length === 0 ? (
        <Empty
          icon={<ListMusic size={26} />}
          title="Creá tu primera playlist"
          text="Juntá canciones de distintos artistas y álbumes en una sola lista, y reordenalas como quieras."
          action={
            <button type="button" className="btn btn--accent" onClick={() => openNewPlaylistDialog()}>
              Nueva playlist
            </button>
          }
        />
      ) : (
        <div className="grid">
          {playlists.map((p) => (
            <PlaylistCard
              key={p.id}
              playlist={p}
              onPlay={() => void playPlaylist(p.id)}
              onContextMenu={(e) => (e.preventDefault(), openMenuAt(e, playlistMenu(p)))}
            />
          ))}
          <button type="button" className="card card--new" onClick={() => openNewPlaylistDialog()} aria-label="Nueva playlist">
            <span className="card__cover card__cover--new">
              <Plus size={28} aria-hidden="true" />
            </span>
            <span className="card__title">Nueva playlist</span>
          </button>
        </div>
      )}
      {playlists.length > 0 && <p className="hint">Clic derecho en una playlist para renombrarla, reproducirla o eliminarla.</p>}
    </div>
  );
}
