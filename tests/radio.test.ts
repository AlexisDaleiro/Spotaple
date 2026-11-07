import { describe, expect, it, vi } from 'vitest';
import { RADIO, artistKey, computeAffinity, createRadio, rankRadio, type RadioHistory, type RadioSource } from '../src/main/music/radio';
import type { Track } from '../src/shared/types';

const t = (id: string, title: string, artist: string, artistId?: string): Track => ({
  id,
  title,
  artists: [{ name: artist, ...(artistId ? { id: artistId } : {}) }],
});
const rank = (cands: Track[], ctx: Partial<Parameters<typeof rankRadio>[1]> = {}) => rankRadio(cands, { exclude: new Set(), affinity: new Map(), ...ctx });
const ids = (r: Track[]) => r.map((x) => x.id);

describe('rankRadio', () => {
  it('conserva el orden de YouTube cuando no hay afinidad', () => {
    expect(ids(rank([t('a1', 'A', 'Uno'), t('b1', 'B', 'Dos'), t('c1', 'C', 'Tres')]))).toEqual(['a1', 'b1', 'c1']);
  });

  it('descarta lo excluido y los duplicados por título + artista', () => {
    const cands = [t('x1', 'One More Time', 'Daft Punk'), t('x2', ' one more time ', 'daft punk'), t('y1', 'Otra', 'Otro')];
    expect(ids(rank(cands, { exclude: new Set(['y1']) }))).toEqual(['x1']);
  });

  it('la afinidad sube a un artista querido pero no lo pone primero', () => {
    const [a, b, c, d] = [t('a1', 'A', 'Uno'), t('b1', 'B', 'Dos'), t('c1', 'C', 'Tres'), t('d1', 'D', 'Cuatro')];
    const affinity = new Map([[artistKey(d.artists[0]!), 1000]]);
    expect(ids(rank([a, b, c, d], { affinity }))).toEqual(['a1', 'b1', 'd1', 'c1']);
  });

  it('nunca más de 2 seguidas del mismo artista', () => {
    const cands = [t('x1', 'T1', 'X'), t('x2', 'T2', 'X'), t('x3', 'T3', 'X'), t('y1', 'T4', 'Y'), t('z1', 'T5', 'Z')];
    expect(ids(rank(cands))).toEqual(['x1', 'x2', 'y1', 'x3', 'z1']);
  });

  it('cuenta a la semilla como la anterior', () => {
    const cands = [t('x1', 'T1', 'X'), t('x2', 'T2', 'X'), t('y1', 'T3', 'Y')];
    expect(ids(rank(cands, { seedArtist: { name: 'X' } }))).toEqual(['x1', 'y1', 'x2']);
  });

  it('si todos son del mismo artista igual los devuelve, y respeta el límite', () => {
    const cands = Array.from({ length: 10 }, (_, i) => t(`x${i}`, `T${i}`, 'X'));
    expect(ids(rank(cands.slice(0, 5)))).toEqual(['x0', 'x1', 'x2', 'x3', 'x4']);
    expect(rank(cands, { limit: 3 })).toHaveLength(3);
  });
});

describe('computeAffinity', () => {
  const NOW = Date.UTC(2026, 10, 7);
  const DAY = 86_400_000;

  it('una reproducción de ahora vale 1 y una de hace 45 días vale la mitad', () => {
    const artists = [{ id: 'UC1', name: 'Daft Punk' }];
    const a = computeAffinity({ plays: [{ artists, playedAt: NOW }, { artists, playedAt: NOW - 45 * DAY }], favorites: [] }, NOW);
    expect(a.get('UC1')).toBeCloseTo(1.5);
  });

  it('una favorita suma 3 y la clave es el nombre en minúsculas si no hay channel_id', () => {
    const a = computeAffinity({ plays: [], favorites: [{ artists: [{ name: 'Charly García' }] }] }, NOW);
    expect(a.get('charly garcía')).toBe(RADIO.FAVORITE_WEIGHT);
    expect(RADIO.FAVORITE_WEIGHT).toBe(3);
  });

  it('una canción con dos artistas acreditados suma a ambos', () => {
    const a = computeAffinity({ plays: [{ artists: [{ name: 'A' }, { name: 'B' }], playedAt: NOW }], favorites: [] }, NOW);
    expect(a.get('a')).toBeCloseTo(1);
    expect(a.get('b')).toBeCloseTo(1);
  });
});

describe('createRadio.next', () => {
  const NOW = Date.UTC(2026, 10, 7);
  const seed = t('seed1', 'Seed', 'Daft Punk', 'UC1');
  const make = (over: Partial<RadioSource> = {}, hist: Partial<RadioHistory> = {}) => {
    const source: RadioSource = { getRadio: vi.fn(async () => []), getArtist: vi.fn(async () => ({ topSongs: [] })), ...over };
    const history: RadioHistory = { recentPlayIds: vi.fn(() => []), affinityInputs: vi.fn(() => ({ plays: [], favorites: [] })), ...hist };
    return { source, history, radio: createRadio({ source, history, now: () => NOW }) };
  };

  it('quita la semilla, lo encolado y lo reproducido hace poco', async () => {
    const { radio } = make(
      { getRadio: vi.fn(async () => [seed, t('a1', 'A', 'Uno'), t('b1', 'B', 'Dos'), t('c1', 'C', 'Tres')]) },
      { recentPlayIds: () => ['b1'] },
    );
    expect(ids(await radio.next(seed, ['a1']))).toEqual(['c1']);
  });

  it('descarta otras versiones de la canción que suena (mismo título y artista, otro id)', async () => {
    const twin = t('v2xxxx', ' seed ', 'daft punk', 'UC1');
    const { radio } = make({ getRadio: vi.fn(async () => [twin, t('o1', 'Otra', 'Otro')]) });
    expect(ids(await radio.next(seed, []))).toEqual(['o1']);
  });

  it('entrega a lo sumo un lote y lee el historial con los límites del motor', async () => {
    const many = Array.from({ length: 30 }, (_, i) => t(`n${i}`, `T${i}`, `Artista ${i}`));
    const { radio, history } = make({ getRadio: vi.fn(async () => many) });
    expect(await radio.next(seed, [])).toHaveLength(RADIO.BATCH);
    expect(history.recentPlayIds).toHaveBeenCalledWith(RADIO.RECENT_PLAYS);
    expect(history.affinityInputs).toHaveBeenCalledWith(RADIO.AFFINITY_PLAYS);
  });

  it('sin sugerencias usa las canciones populares del artista de la semilla', async () => {
    const { radio, source } = make({ getArtist: vi.fn(async () => ({ topSongs: [seed, t('p1', 'P1', 'Daft Punk'), t('p2', 'P2', 'Daft Punk', 'UC1')] })) });
    expect(ids(await radio.next(seed, []))).toEqual(['p1', 'p2']);
    expect(source.getArtist).toHaveBeenCalledWith('UC1');
  });

  it('un error de red se propaga sin probar el respaldo', async () => {
    const { radio, source } = make({ getRadio: vi.fn(async () => Promise.reject(Object.assign(new Error('sin red'), { code: 'network' }))) });
    await expect(radio.next(seed, [])).rejects.toMatchObject({ code: 'network' });
    expect(source.getArtist).not.toHaveBeenCalled();
  });

  it('otro error con respaldo disponible: devuelve el respaldo', async () => {
    const { radio } = make({
      getRadio: vi.fn(async () => Promise.reject(Object.assign(new Error('parse'), { code: 'parse' }))),
      getArtist: vi.fn(async () => ({ topSongs: [t('p1', 'P1', 'Daft Punk')] })),
    });
    expect(ids(await radio.next(seed, []))).toEqual(['p1']);
  });

  it('si fallan los dos, lanza el primer error', async () => {
    const { radio } = make({
      getRadio: vi.fn(async () => Promise.reject(new Error('uno'))),
      getArtist: vi.fn(async () => Promise.reject(new Error('dos'))),
    });
    await expect(radio.next(seed, [])).rejects.toThrow('uno');
  });

  it('semilla sin channel_id y sin sugerencias: lista vacía, sin probar el respaldo', async () => {
    const { radio, source } = make();
    expect(await radio.next(t('seed2', 'Sin id', 'Alguien'), [])).toEqual([]);
    expect(source.getArtist).not.toHaveBeenCalled();
  });
});
