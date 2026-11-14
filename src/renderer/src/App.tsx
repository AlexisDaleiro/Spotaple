import { useEffect, useLayoutEffect, useRef } from 'react';
import { dispatchPlayback, player } from './player/instance';
import { playbackActive } from './player/transport';
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
import { GeneratedPage } from './pages/GeneratedPage';
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
    case 'generated':
      return <GeneratedPage kind={route.kind} slot={route.slot} />;
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
      if (e.defaultPrevented) return;
      const ui = useUi.getState();
      if (ui.dialog || ui.menu) return;
      const el = e.target as HTMLElement | null;
      const typing = isEditable(el);
      const p = player();
      const k = e.key;

      if (k === 'Escape') {
        if (!typing && (ui.queueOpen || ui.playerOpen)) {
          e.preventDefault();
          if (ui.queueOpen) ui.toggleQueue();
          else ui.setPlayerOpen(false);
        }
      } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') {
        e.preventDefault();
        useUi.getState().focusSearch();
      } else if (typing) {
        return;
      } else if (e.altKey && k === 'ArrowLeft') {
        e.preventDefault();
        useNav.getState().back();
      } else if (e.altKey && k === 'ArrowRight') {
        e.preventDefault();
        useNav.getState().forward();
      } else if ((e.ctrlKey || e.metaKey) && k === 'ArrowRight') {
        e.preventDefault();
        dispatchPlayback('next');
      } else if ((e.ctrlKey || e.metaKey) && k === 'ArrowLeft') {
        e.preventDefault();
        dispatchPlayback('prev');
      } else if ((e.ctrlKey || e.metaKey) && (k === 'ArrowUp' || k === 'ArrowDown')) {
        e.preventDefault();
        p.setVolume(p.volume + (k === 'ArrowUp' ? 0.05 : -0.05));
      } else if (k === '/') {
        e.preventDefault();
        useUi.getState().focusSearch();
      } else if (k === ' ' && !isActivatable(el)) {
        e.preventDefault();
        dispatchPlayback(playbackActive(p.status) ? 'pause' : 'play');
      } else if (e.shiftKey && (k === 'ArrowRight' || k === 'ArrowLeft')) {
        e.preventDefault();
        dispatchPlayback('seek', p.position + (k === 'ArrowRight' ? 10 : -10));
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

const scrollMemory = new WeakMap<Route, number>();

/** Recuerda el scroll por posición del historial y lo restaura cuando el contenido ya tiene altura. */
function useScrollMemory(ref: React.RefObject<HTMLDivElement | null>, route: Route) {
  useLayoutEffect(() => useNav.subscribe((next, previous) => {
    if (next.route !== previous.route && ref.current) scrollMemory.set(previous.route, ref.current.scrollTop);
  }), [ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = scrollMemory.get(route) ?? 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const content = el.firstElementChild;
    const observer = content ? new ResizeObserver(() => apply()) : undefined;
    const apply = () => {
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) <= 2) observer?.disconnect();
    };
    apply();
    if (target > 0 && Math.abs(el.scrollTop - target) > 2 && content && observer) {
      observer.observe(content);
      timer = setTimeout(() => observer.disconnect(), 5000);
    }
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [ref, route]);
}

export function App() {
  const route = useNav((s) => s.route);
  const i = useNav((s) => s.i);
  const queueOpen = useUi((s) => s.queueOpen);
  const playerOpen = useUi((s) => s.playerOpen);
  const dialogOpen = useUi((s) => Boolean(s.dialog));
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => void useLibrary.getState().init(), []);
  useEffect(() => useNav.subscribe((current, previous) => {
    if (current.route !== previous.route && useUi.getState().playerOpen) useUi.getState().setPlayerOpen(false);
  }), []);
  useGlobalShortcuts();
  useScrollMemory(scroller, route);

  return (
    <div className="app" data-queue={queueOpen} data-player-expanded={playerOpen}>
      <a className="skip-link" href="#main" inert={playerOpen || dialogOpen} onClick={(e) => (e.preventDefault(), scroller.current?.focus())}>
        Saltar al contenido
      </a>
      <TopBar inert={playerOpen || dialogOpen} />
      <Sidebar inert={playerOpen || dialogOpen} />
      <main className="main" id="main" inert={playerOpen || dialogOpen}>
        <OfflineBanner />
        <div className="main__scroll" ref={scroller} tabIndex={-1}>
          <div className="page-enter" key={`${i}:${route.page}:${'id' in route ? route.id : ''}`}>
            <Page route={route} />
          </div>
        </div>
      </main>
      {queueOpen && <QueuePanel inert={dialogOpen} />}
      <PlayerBar inert={dialogOpen} />
      <Toasts />
      <MenuHost />
      <DialogHost />
    </div>
  );
}
