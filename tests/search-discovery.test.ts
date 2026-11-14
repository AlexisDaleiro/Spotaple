import { describe, expect, it, vi } from 'vitest';
import { discoverSearch } from '../src/renderer/src/lib/search-discovery';
import type { ArtistSummary, SearchResults, Track } from '../src/shared/types';

const romeo = { id: 'romeo-santos', name: 'Romeo Santos' };
const prince = { id: 'prince-royce', name: 'Prince Royce' };
const srv = { id: 'stevie-ray-vaughan', name: 'Stevie Ray Vaughan' };
const buddy = { id: 'buddy-guy', name: 'Buddy Guy' };
const makeTrack = (id: string, title: string, artist: ArtistSummary): Track => ({ id, title, artists: [artist] });
const results = (query: string, artists: ArtistSummary[], songs: Track[]): SearchResults =>
  ({ query, artists, songs, albums: [], playlists: [], partial: false });

describe('descubrimiento en búsqueda', () => {
  it.each([
    ['Romeo', romeo, prince, 'Propuesta indecente', 'Darte un beso'],
    ['SRV', srv, buddy, 'Pride and Joy', 'Damn Right, I’ve Got the Blues'],
  ])('amplía %s con artistas y canciones relacionados sin duplicar resultados', async (query, artist, related, title, relatedTitle) => {
    const song = makeTrack('search-track', title, artist);
    const recommendation = makeTrack('radio-track', relatedTitle, related);
    const music = {
      artist: vi.fn(async () => ({ ...artist, topSongs: [song], albums: [], singles: [], similar: [related, artist] })),
      radio: vi.fn(async () => [song, recommendation, { ...recommendation, id: 'otra-version' }]),
    };
    expect(await discoverSearch(results(query, [artist], [song]), music, () => true)).toEqual({
      artists: [related], songs: [recommendation],
    });
    expect(music.artist).toHaveBeenCalledWith(artist.id);
    expect(music.radio).toHaveBeenCalledWith(song, [song.id]);
  });

  it('usa la radio de una canción exacta aunque falle el perfil', async () => {
    const song = makeTrack('search-track', 'Pride and Joy', srv);
    const similar = makeTrack('radio-track', 'Let Me Love You Baby', buddy);
    const music = {
      artist: vi.fn(async () => { throw new Error('Sin respuesta'); }),
      radio: vi.fn(async () => [similar]),
    };
    const discovery = await discoverSearch(results(song.title, [], [song]), music, () => true);
    expect(discovery).toEqual({ artists: [buddy], songs: [similar] });
  });

  it('elige al artista respaldado por el catálogo frente a un nombre literal secundario', async () => {
    const literal = { id: 'romeo-homonym', name: 'Romeo' };
    const first = makeTrack('first-track', 'Que Se Mueran', romeo);
    const another = makeTrack('second-track', 'Perjurio', romeo);
    const recommendation = makeTrack('radio-track', 'Darte un beso', prince);
    const music = {
      artist: vi.fn(async () => ({ ...romeo, topSongs: [first, another], albums: [], singles: [], similar: [prince] })),
      radio: vi.fn(async () => [recommendation]),
    };
    await discoverSearch(results('Romeo', [romeo, literal], [first, makeTrack('wrong-track', 'Romeo', literal), another]), music, () => true);
    expect(music.artist).toHaveBeenCalledWith(romeo.id);
    expect(music.radio).toHaveBeenCalledWith(first, expect.any(Array));
  });

  it('interpreta SRV como Stevie Ray Vaughan cuando la mayoría de las canciones coinciden', async () => {
    const literal = { id: 'srv-homonym', name: 'Srv' };
    const first = makeTrack('first-track', 'Pride and Joy', srv);
    const another = makeTrack('second-track', 'Little Wing', srv);
    const music = {
      artist: vi.fn(async () => ({ ...srv, topSongs: [first, another], albums: [], singles: [], similar: [buddy] })),
      radio: vi.fn(async () => []),
    };
    await discoverSearch(results('SRV', [srv, literal], [first, another, makeTrack('wrong-track', 'PEGAÍTA', literal)]), music, () => true);
    expect(music.artist).toHaveBeenCalledWith(srv.id);
  });

  it('omite recomendaciones de consultas sin coincidencias claras', async () => {
    const music = { artist: vi.fn(), radio: vi.fn() };
    const unrelated = results('bachata de los 90', [prince], [makeTrack('catalog-track', 'Darte un beso', prince)]);
    expect(await discoverSearch(unrelated, music, () => true)).toBeUndefined();
    expect(music.artist).not.toHaveBeenCalled();
    expect(music.radio).not.toHaveBeenCalled();
  });

  it('usa canciones populares del artista en vez de una canción homónima ajena', async () => {
    const other = { id: 'basement-jaxx', name: 'Basement Jaxx' };
    const popular = makeTrack('popular-track', 'Propuesta indecente', romeo);
    const music = {
      artist: vi.fn(async () => ({ ...romeo, topSongs: [popular], albums: [], singles: [], similar: [prince] })),
      radio: vi.fn(async () => []),
    };
    await discoverSearch(results('Romeo', [romeo], [makeTrack('same-title', 'Romeo', other)]), music, () => true);
    expect(music.radio).toHaveBeenCalledWith(popular, ['same-title']);
  });

  it('publica canciones relacionadas mientras el perfil sigue cargando', async () => {
    const song = makeTrack('search-track', 'Propuesta indecente', romeo);
    const related = makeTrack('radio-track', 'Darte un beso', prince);
    const profile = { ...romeo, topSongs: [song], albums: [], singles: [], similar: [prince] };
    let release!: (value: typeof profile) => void;
    const music = {
      artist: vi.fn(() => new Promise<typeof profile>((resolve) => { release = resolve; })),
      radio: vi.fn(async () => [related]),
    };
    const update = vi.fn();
    const discovery = discoverSearch(results('Romeo', [romeo], [song]), music, () => true, update);
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ artists: [prince], songs: [related] }));
    release(profile);
    await discovery;
  });
});
