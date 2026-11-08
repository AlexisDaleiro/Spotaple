import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { DiscoverState } from '@shared/discover';
import { api } from '../api';

export interface DiscoverApi {
  get(): Promise<DiscoverState>;
  refresh(): Promise<DiscoverState>;
}

export interface DiscoverStoreState {
  state: DiscoverState;
  /** Lo que hay guardado (sin red). Un fallo no cambia nada. */
  load(): Promise<void>;
  /** Pide a main que genere lo que falte. Los llamados simultáneos comparten la corrida; un fallo conserva lo anterior sin avisar. */
  refresh(): Promise<void>;
  set(state: DiscoverState): void;
}

export const EMPTY_DISCOVER: DiscoverState = { enabled: false, ready: false, updating: false, lists: [], artists: [] };

export function createDiscoverStore(deps: DiscoverApi) {
  let inflight: Promise<void> | null = null;
  return createStore<DiscoverStoreState>((set) => ({
    state: EMPTY_DISCOVER,
    set: (state) => set({ state }),
    async load() {
      try {
        set({ state: await deps.get() });
      } catch {
        /* sin puente o sin datos: Inicio simplemente no muestra «Hecho para vos» */
      }
    },
    refresh() {
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          set({ state: await deps.refresh() });
        } catch {
          /* sin internet u otro fallo: se siguen viendo las listas anteriores y se reintenta la próxima vez que se abra Inicio */
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
  }));
}

export const discoverStore = createDiscoverStore({ get: () => api.discover.get(), refresh: () => api.discover.refresh() });
export const useDiscover = <T>(selector: (s: DiscoverStoreState) => T): T => useStore(discoverStore, selector);
