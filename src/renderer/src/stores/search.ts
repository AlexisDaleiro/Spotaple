import { create } from 'zustand';
import { SEARCH_CATEGORIES, type SearchResults } from '@shared/types';
import { api, errorMessage } from '../api';
import { discoverSearch, type SearchDiscovery } from '../lib/search-discovery';

interface SearchState {
  /** Consulta cuyo resultado se está mostrando o cargando. */
  query: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  results: SearchResults | null;
  discovery: SearchDiscovery | null;
  error: string | null;
  run(query: string): void;
  retry(): void;
  cancel(query: string): void;
}

const cache = new Map<string, { results: SearchResults; discovery?: SearchDiscovery }>();
const CACHE_MAX = 20;
const searchFields = { song: 'songs', album: 'albums', artist: 'artists', playlist: 'playlists' } as const;
let token = 0;
let activeRequest: string | undefined;

export const useSearch = create<SearchState>((set, get) => ({
  query: '',
  status: 'idle',
  results: null,
  discovery: null,
  error: null,

  run(raw) {
    const query = raw.trim();
    get().cancel(get().query);
    const mine = ++token; // cualquier respuesta con otro número es de una búsqueda vieja y se descarta
    if (!query) return set({ query: '', status: 'idle', results: null, discovery: null, error: null });
    const hit = cache.get(query.toLowerCase());
    const current = () => mine === token;
    const expand = (results: SearchResults) => {
      void discoverSearch(results, api.music, current, (discovery) => {
        if (current()) set({ discovery });
      }).then((discovery) => {
        if (!current() || !discovery) return;
        const entry = cache.get(query.toLowerCase());
        if (entry) entry.discovery = discovery;
      }).catch(() => undefined);
    };
    if (hit) {
      set({ query, status: 'ready', results: { ...hit.results, query }, discovery: hit.discovery ?? null, error: null });
      if (!hit.discovery) expand(hit.results);
      return;
    }

    set({ query, status: 'loading', results: get().query === query ? get().results : null, discovery: null, error: null });
    const requestId = activeRequest = crypto.randomUUID();
    const done = (results: SearchResults) => {
      if (mine !== token) return;
      // Un resultado parcial (alguna búsqueda falló) no se cachea: el reintento puede completarlo.
      if (!results.partial) {
        cache.set(query.toLowerCase(), { results });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      }
      set({ status: 'ready', results, error: null });
      expand(results);
    };
    const fail = (error: unknown) => {
      if (mine === token) set({ status: 'error', error: errorMessage(error), results: null });
    };
    let results: SearchResults = { query, songs: [], albums: [], artists: [], playlists: [], partial: false };
    const requests = SEARCH_CATEGORIES.map(async (category) => {
      const section = await api.music.search(query, category, requestId);
      if (mine !== token) return;
      const field = searchFields[category];
      results = { ...results, [field]: section[field] };
      set({ results });
    });
    void Promise.allSettled(requests).then((responses) => {
      if (mine !== token) return;
      activeRequest = undefined;
      const errors = responses.filter((response) => response.status === 'rejected');
      if (errors.length === responses.length) fail(errors[0]!.reason);
      else done({ ...results, partial: errors.length > 0 });
    });
  },
  retry() {
    const { query } = get();
    cache.delete(query.toLowerCase());
    get().run(query);
  },
  cancel(raw) {
    const query = raw.trim();
    if (get().query !== query) return;
    token++;
    const requestId = activeRequest;
    activeRequest = undefined;
    if (requestId) {
      set({ status: 'idle', results: null });
      void api.music.cancelSearch(requestId).catch(() => undefined);
    }
  },
}));
