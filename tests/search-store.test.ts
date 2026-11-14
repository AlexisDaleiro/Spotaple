import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_CATEGORIES, type SearchCategory, type SearchResults } from '../src/shared/types';
import { useSearch } from '../src/renderer/src/stores/search';

const { search, cancelSearch } = vi.hoisted(() => ({ search: vi.fn(), cancelSearch: vi.fn(async () => undefined) }));
vi.mock('../src/renderer/src/api', () => ({
  api: { platform: 'win32', music: { search, cancelSearch } },
  errorMessage: (error: Error) => error.message,
}));

function controlledSearch() {
  const requests = new Map<string, { resolve(value: SearchResults): void; reject(error: Error): void }>();
  search.mockImplementation((query: string, category: SearchCategory) => {
    return new Promise<SearchResults>((resolve, reject) => {
      requests.set(`${query}:${category}`, { resolve, reject });
    });
  });
  const result = (query: string): SearchResults => ({ query, songs: [], albums: [], artists: [], playlists: [], partial: false });
  return {
    songs(query: string) {
      requests.get(`${query}:song`)!.resolve({
        ...result(query), songs: [{ id: 'track000000', title: query, artists: [] }],
      });
    },
    finish(query: string) {
      for (const category of SEARCH_CATEGORIES) requests.get(`${query}:${category}`)!.resolve(result(query));
    },
    fail(query: string, category: SearchCategory) {
      requests.get(`${query}:${category}`)!.reject(new Error('Falló la categoría'));
    },
  };
}

afterEach(() => {
  useSearch.getState().cancel(useSearch.getState().query);
  useSearch.setState({ query: '', status: 'idle', results: null, error: null });
  vi.clearAllMocks();
});

describe('búsqueda de escritorio', () => {
  it('muestra canciones aunque siga esperando las demás categorías', async () => {
    const pending = controlledSearch();
    useSearch.getState().run('Primera consulta');
    pending.songs('Primera consulta');
    await vi.waitFor(() => expect(useSearch.getState().results?.songs[0]?.title).toBe('Primera consulta'));
    expect(useSearch.getState().status).toBe('loading');
    pending.fail('Primera consulta', 'playlist');
    pending.finish('Primera consulta');
    await vi.waitFor(() => expect(useSearch.getState().status).toBe('ready'));
    expect(useSearch.getState().results?.partial).toBe(true);
  });

  it('cancela la consulta anterior e ignora sus resultados tardíos', async () => {
    const pending = controlledSearch();
    useSearch.getState().run('Consulta anterior');
    pending.songs('Consulta anterior');
    await vi.waitFor(() => expect(useSearch.getState().results?.songs[0]?.title).toBe('Consulta anterior'));
    useSearch.getState().run('Consulta nueva');
    expect(cancelSearch).toHaveBeenCalledWith(search.mock.calls[0]?.[2]);
    expect(search.mock.calls[4]?.[2]).not.toBe(search.mock.calls[0]?.[2]);
    pending.songs('Consulta nueva');
    pending.finish('Consulta nueva');
    pending.finish('Consulta anterior');
    await vi.waitFor(() => expect(useSearch.getState().status).toBe('ready'));
    expect(useSearch.getState().results?.songs[0]?.title).toBe('Consulta nueva');
  });

  it('retira los resultados anteriores cuando cambia la consulta', async () => {
    const pending = controlledSearch();
    useSearch.getState().run('Consulta completa');
    pending.songs('Consulta completa');
    pending.finish('Consulta completa');
    await vi.waitFor(() => expect(useSearch.getState().status).toBe('ready'));

    useSearch.getState().run('Otra consulta');
    expect(useSearch.getState()).toMatchObject({ query: 'Otra consulta', status: 'loading', results: null });
  });
});
