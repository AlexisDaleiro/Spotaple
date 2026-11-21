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

it('busca videos musicales si las canciones separan el título y el artista en resultados distintos', async () => {
  const wrongArtist = { id: 'song0000001', item_type: 'song', title: 'I Smell a Rat', artists: [{ name: 'Big Mama Thornton' }] };
  const matchingVideo = { id: 'video000001', item_type: 'video', title: 'Buddy Guy - I Smell a Rat', authors: [{ name: 'Canal de blues' }] };
  const fetchImpl = vi.fn<typeof fetch>(async (url) => {
    const type = new URL(String(url)).searchParams.get('type');
    return Response.json({ contents: [{ contents: type === 'song' ? [wrongArtist] : [matchingVideo, matchingVideo] }] });
  });
  const provider = createYouTubeProvider({ fetch: fetchImpl });
  const result = await provider.search('I Smell a Rat Buddy Guy', 'song');
  expect(result.songs.map((song) => song.id)).toEqual([matchingVideo.id, wrongArtist.id]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('sube la canción de catálogo que coincide con el título y el artista', async () => {
  const other = { id: 'song0000001', item_type: 'song', title: 'I Smell a Rat', artists: [{ name: 'Big Mama Thornton' }] };
  const correct = { id: 'song0000002', item_type: 'song', title: 'I Smell a Rat', artists: [{ name: 'Buddy Guy' }] };
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ contents: [{ contents: [other, correct] }] }));
  const result = await createYouTubeProvider({ fetch: fetchImpl }).search('I Smell a Rat Buddy Guy', 'song');
  expect(result.songs.map((song) => song.id)).toEqual([correct.id, other.id]);
  expect(fetchImpl).toHaveBeenCalledOnce();
});
