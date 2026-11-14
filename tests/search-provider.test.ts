import { expect, it, vi } from 'vitest';
import { createYouTubeProvider } from '../src/main/music/youtube/provider';

vi.mock('youtubei.js', () => ({
  Innertube: {
    create: async (options: { fetch: typeof fetch }) => ({
      music: {
        search: (query: string, { type }: { type: string }) => {
          const url = new URL('https://music.example.test/search');
          url.searchParams.set('query', query);
          url.searchParams.set('type', type);
          return options.fetch(url).then((response) => response.json());
        },
      },
    }),
  },
  Log: { setLevel: vi.fn(), Level: { NONE: 0 } },
  Platform: { shim: {} },
  UniversalCache: class {},
}));

it('limita la búsqueda a una categoría y cancela su conexión al cambiar de consulta', async () => {
  const fetchImpl = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
  }));
  const provider = createYouTubeProvider({ fetch: fetchImpl });
  const controller = new AbortController();
  const request = provider.search('Tema', 'song', controller.signal);
  const rejected = expect(request).rejects.toBeDefined();
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
  const [url, options] = fetchImpl.mock.calls[0]!;
  expect(new URL(String(url)).searchParams.get('type')).toBe('song');
  expect(options?.signal?.aborted).toBe(false);
  controller.abort();
  await rejected;
  expect(options?.signal?.aborted).toBe(true);
});
