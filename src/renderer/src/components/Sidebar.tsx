import { Heart, House, Library, ListMusic, Plus, Radio, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/format';
import { inRoom, useJam } from '../stores/jam';
import { useLibrary } from '../stores/library';
import { navigate, useNav, type Route } from '../stores/nav';
import { useUi } from '../stores/ui';
import { PlaylistCover } from './Shelf';

function NavItem({ icon, label, active, onClick, className, badge }: { icon: ReactNode; label: string; active: boolean; onClick: () => void; className?: string; badge?: ReactNode }) {
  return (
    <button type="button" className={cx('nav-item', active && 'is-active', className)} aria-current={active ? 'page' : undefined} title={label} onClick={onClick}>
      <span className="nav-item__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="nav-item__label">{label}</span>
      {badge}
    </button>
  );
}

export function openNewPlaylistDialog(onCreated?: (id: number) => void) {
  useUi.getState().openDialog({
    kind: 'prompt',
    title: 'Nueva playlist',
    label: 'Nombre',
    initial: 'Mi playlist',
    confirmLabel: 'Crear',
    onSubmit: async (name) => {
      const p = await useLibrary.getState().createPlaylist(name);
      if (p) {
        navigate({ page: 'playlist', id: p.id });
        onCreated?.(p.id);
      }
    },
  });
}

export function Sidebar() {
  const route = useNav((s) => s.route);
  const playlists = useLibrary((s) => s.playlists);
  const favCount = useLibrary((s) => s.favoriteIds.size);
  const jam = useJam((s) => s.view);
  const go = (r: Route) => () => navigate(r);
  const onFavorites = route.page === 'library' && route.tab !== 'history';

  return (
    <nav className="sidebar" aria-label="Navegación principal">
      <div className="sidebar__main">
        <NavItem icon={<House size={20} />} label="Inicio" active={route.page === 'home'} onClick={go({ page: 'home' })} />
        <NavItem
          icon={<Search size={20} />}
          label="Buscar"
          active={route.page === 'search'}
          onClick={() => {
            if (route.page !== 'search') navigate({ page: 'search', q: '' });
            useUi.getState().focusSearch();
          }}
        />
        <NavItem icon={<Library size={20} />} label="Biblioteca" active={route.page === 'library'} onClick={go({ page: 'library' })} />
        <NavItem icon={<ListMusic size={20} />} label="Playlists" active={route.page === 'playlists'} onClick={go({ page: 'playlists' })} />
        <NavItem
          className="jam-entry"
          icon={<Radio size={20} />}
          label="Jam"
          active={route.page === 'jam'}
          onClick={go({ page: 'jam' })}
          badge={inRoom(jam) ? <span className="jam-dot" role="img" aria-label={`Sala ${jam?.state?.code} activa`} /> : undefined}
        />
      </div>

      <div className="sidebar__lists">
        <div className="sidebar__head">
          <span>Tus listas</span>
          <button type="button" className="ibtn ibtn--sm ibtn--ghost" aria-label="Nueva playlist" title="Nueva playlist" onClick={() => openNewPlaylistDialog()}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        <ul className="sidebar__scroll">
          <li>
            <button type="button" className={cx('pl-item', onFavorites && 'is-active')} title="Favoritos" onClick={go({ page: 'library', tab: 'favorites' })}>
              <span className="pl-item__art pl-item__art--fav" aria-hidden="true">
                <Heart size={15} fill="currentColor" />
              </span>
              <span className="pl-item__text">
                <span className="pl-item__name">Favoritos</span>
                <span className="pl-item__sub">Lista · {favCount}</span>
              </span>
            </button>
          </li>
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={cx('pl-item', route.page === 'playlist' && route.id === p.id && 'is-active')}
                title={p.name}
                onClick={go({ page: 'playlist', id: p.id })}
              >
                <span className="pl-item__art">
                  <PlaylistCover covers={p.covers.slice(0, 1)} name={p.name} />
                </span>
                <span className="pl-item__text">
                  <span className="pl-item__name">{p.name}</span>
                  <span className="pl-item__sub">Playlist · {p.trackCount}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
