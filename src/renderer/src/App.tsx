import { useEffect, useLayoutEffect, useRef } from 'react';
import { player } from './player/instance';
import { useLibrary } from './stores/library';
import { useNav, type Route } from './stores/nav';
import { useUi } from './stores/ui';
import { DialogHost } from './components/Dialogs';
import { MenuHost } from './components/ContextMenu';
import { OfflineBanner } from './components/OfflineBanner';
import { PlayerBar } from './components/PlayerBar';
import { QueuePanel } from './components/QueuePanel';
import { Sidebar } from './components/Sidebar';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { AlbumPage } from './pages/AlbumPage';
import { ArtistPage } from './pages/ArtistPage';
import { HomePage } from './pages/Home';
import { JamPage } from './pages/Jam';
import { LibraryPage } from './pages/Library';
import { PlaylistPage } from './pages/PlaylistPage';
import { PlaylistsPage } from './pages/Playlists';
import { RemotePlaylistPage } from './pages/RemotePlaylistPage';
import { SearchPage } from './pages/Search';
import { SettingsPage } from './pages/Settings';

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'home':
      return <HomePage />;
    case 'search':
      return <SearchPage q={route.q} />;
    case 'library':
      return <LibraryPage tab={route.tab} />;
    case 'playlists':
      return <PlaylistsPage />;
    case 'playlist':
      return <PlaylistPage id={route.id} />;
    case 'album':
      return <AlbumPage id={route.id} />;
    case 'artist':
      return <ArtistPage id={route.id} />;
    case 'jam':
      return <JamPage />;
    case 'settings':
      return <SettingsPage />;
    case 'remotePlaylist':
      return <RemotePlaylistPage id={route.id} author={route.author} />;
  }
}

/** Teclas que no deben dispararse mientras se escribe o se opera otro control. */
const isEditable = (el: HTMLElement | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
const isActivatable = (el: HTMLElement | null) =>
  !!el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'menuitem' || el.getAttribute('role') === 'tab');

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = isEditable(el);
      const p = player();
      const k = e.key;

      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') {
        e.preventDefault();
        useUi.getState().focusSearch();
      } else if (e.altKey && k === 'ArrowLeft') {
        e.preventDefault();
        useNav.getState().back();
      } else if (e.altKey && k === 'ArrowRight') {
        e.preventDefault();
        useNav.getState().forward();
      } else if ((e.ctrlKey || e.metaKey) && k === 'ArrowRight') {
        e.preventDefault();
        p.next();
      } else if ((e.ctrlKey || e.metaKey) && k === 'ArrowLeft') {
        e.preventDefault();
        p.prev();
      } else if ((e.ctrlKey || e.metaKey) && (k === 'ArrowUp' || k === 'ArrowDown')) {
        e.preventDefault();
        p.setVolume(p.volume + (k === 'ArrowUp' ? 0.05 : -0.05));
      } else if (typing) {
        return;
      } else if (k === '/') {
        e.preventDefault();
        useUi.getState().focusSearch();
      } else if (k === ' ' && !isActivatable(el)) {
        e.preventDefault();
        p.togglePlay();
      } else if (e.shiftKey && (k === 'ArrowRight' || k === 'ArrowLeft')) {
        e.preventDefault();
        p.seekBy(k === 'ArrowRight' ? 10 : -10);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && k.toLowerCase() === 'm') {
        p.toggleMute();
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && k.toLowerCase() === 'q') {
        useUi.getState().toggleQueue();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const scrollMemory = new Map<number, number>();

/** Recuerda el scroll por posición del historial y lo restaura cuando el contenido ya tiene altura. */
function useScrollMemory(ref: React.RefObject<HTMLDivElement | null>, i: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = scrollMemory.get(i) ?? 0;
    let tries = 0;
    const apply = () => {
      el.scrollTop = target;
      if (target > 0 && Math.abs(el.scrollTop - target) > 2 && tries++ < 16) timer = setTimeout(apply, 50);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    apply();
    return () => {
      clearTimeout(timer);
      scrollMemory.set(i, el.scrollTop);
    };
  }, [ref, i]);
}

export function App() {
  const route = useNav((s) => s.route);
  const i = useNav((s) => s.i);
  const queueOpen = useUi((s) => s.queueOpen);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => void useLibrary.getState().init(), []);
  useGlobalShortcuts();
  useScrollMemory(scroller, i);

  return (
    <div className="app" data-queue={queueOpen}>
      <a className="skip-link" href="#main" onClick={(e) => (e.preventDefault(), scroller.current?.focus())}>
        Saltar al contenido
      </a>
      <TopBar />
      <Sidebar />
      <main className="main" id="main">
        <OfflineBanner />
        <div className="main__scroll" ref={scroller} tabIndex={-1}>
          <div className="page-enter" key={`${i}:${route.page}:${'id' in route ? route.id : ''}`}>
            <Page route={route} />
          </div>
        </div>
      </main>
      {queueOpen && <QueuePanel />}
      <PlayerBar />
      <Toasts />
      <MenuHost />
      <DialogHost />
    </div>
  );
}
