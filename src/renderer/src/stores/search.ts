import { create } from 'zustand';
import type { SearchResults } from '@shared/types';
import { api, errorMessage } from '../api';

interface SearchState {
  /** Consulta cuyo resultado se está mostrando o cargando. */
  query: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  results: SearchResults | null;
  error: string | null;
  run(query: string): void;
  retry(): void;
}

const cache = new Map<string, SearchResults>();
const CACHE_MAX = 20;
let token = 0;

export const useSearch = create<SearchState>((set, get) => ({
  query: '',
  status: 'idle',
  results: null,
  error: null,

  run(raw) {
    const query = raw.trim();
    const mine = ++token; // cualquier respuesta con otro número es de una búsqueda vieja y se descarta
    if (!query) return set({ query: '', status: 'idle', results: null, error: null });
    const hit = cache.get(query.toLowerCase());
    if (hit) return set({ query, status: 'ready', results: hit, error: null });

    set({ query, status: 'loading', error: null });
    api.music.search(query).then(
      (results) => {
        if (mine !== token) return;
        // Un resultado parcial (alguna búsqueda falló) no se cachea: el reintento puede completarlo.
        if (!results.partial) {
          cache.set(query.toLowerCase(), results);
          if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
        }
        set({ status: 'ready', results, error: null });
      },
      (e) => {
        if (mine !== token) return;
        set({ status: 'error', error: errorMessage(e), results: null });
      },
    );
  },
  retry() {
    const { query } = get();
    cache.delete(query.toLowerCase());
    get().run(query);
  },
}));
