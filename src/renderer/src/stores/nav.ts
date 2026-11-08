import { create } from 'zustand';
import type { GeneratedKind } from '@shared/discover';

export type Route =
  | { page: 'home' }
  | { page: 'search'; q: string }
  | { page: 'library'; tab?: 'favorites' | 'history' }
  | { page: 'playlists' }
  | { page: 'playlist'; id: number }
  | { page: 'album'; id: string }
  | { page: 'artist'; id: string }
  | { page: 'jam' }
  | { page: 'settings' }
  | { page: 'remotePlaylist'; id: string; author?: string }
  | { page: 'generated'; kind: GeneratedKind; slot: string };

interface NavState {
  stack: Route[];
  i: number;
  route: Route;
  go(route: Route, opts?: { replace?: boolean }): void;
  back(): void;
  forward(): void;
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);
const MAX_STACK = 60;

export const useNav = create<NavState>((set, get) => ({
  stack: [{ page: 'home' }],
  i: 0,
  route: { page: 'home' },
  go(route, opts) {
    const { stack, i } = get();
    if (same(stack[i]!, route)) return;
    if (opts?.replace) {
      const next = [...stack];
      next[i] = route;
      set({ stack: next, route });
      return;
    }
    const next = [...stack.slice(0, i + 1), route].slice(-MAX_STACK);
    set({ stack: next, i: next.length - 1, route });
  },
  back() {
    const { stack, i } = get();
    if (i > 0) set({ i: i - 1, route: stack[i - 1]! });
  },
  forward() {
    const { stack, i } = get();
    if (i < stack.length - 1) set({ i: i + 1, route: stack[i + 1]! });
  },
}));

export const navigate = (route: Route, opts?: { replace?: boolean }) => useNav.getState().go(route, opts);
export const canGoBack = (s: NavState) => s.i > 0;
export const canGoForward = (s: NavState) => s.i < s.stack.length - 1;
