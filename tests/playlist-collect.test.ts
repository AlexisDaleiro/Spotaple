import { describe, expect, it, vi } from 'vitest';
import { collectPlaylistItems, type PlaylistPage } from '../src/main/music/youtube/playlist';
import type { Track } from '../src/shared/types';

const track = (n: number): Track => ({ id: `video${String(n).padStart(6, '0')}`, title: `T${n}`, artists: [] });
/** Los números válidos son canciones; los negativos simulan ítems sin video (privados o eliminados). */
const map = (item: unknown): Track | null => (typeof item === 'number' && item >= 0 ? track(item) : null);
/** Página falsa: `next` es la siguiente, o `undefined` si es la última. */
const page = (ids: number[], next?: PlaylistPage) => ({
  contents: ids as unknown[],
  has_continuation: Boolean(next),
  getContinuation: vi.fn(async () => next as PlaylistPage),
});
const titles = (r: { tracks: Track[] }) => r.tracks.map((t) => t.title);

describe('collectPlaylistItems', () => {
  it('una sola página sin continuación: todo y sin aviso', async () => {
    const r = await collectPlaylistItems(page([1, 2, 3]), map);
    expect(titles(r)).toEqual(['T1', 'T2', 'T3']);
    expect(r.truncated).toBe(false);
  });

  it('sigue las continuaciones hasta el tope y avisa que hay más', async () => {
    const third = page([7, 8, 9]);
    const second = page([4, 5, 6], third);
    const first = page([1, 2, 3], second);
    const r = await collectPlaylistItems(first, map, 5);
    expect(titles(r)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(r.truncated).toBe(true);
    expect(first.getContinuation).toHaveBeenCalledTimes(1);
    expect(second.getContinuation).not.toHaveBeenCalled();
  });

  it('si la lista entra justo en el tope no avisa', async () => {
    const r = await collectPlaylistItems(page([1, 2, 3], page([4, 5, 6])), map, 6);
    expect(r.tracks).toHaveLength(6);
    expect(r.truncated).toBe(false);
  });

  it('descarta ítems que no son canciones (privados, eliminados)', async () => {
    const r = await collectPlaylistItems(page([1, -1, 2]), map);
    expect(titles(r)).toEqual(['T1', 'T2']);
    expect(r.truncated).toBe(false);
  });

  it('si una continuación falla devuelve lo cargado y avisa, sin lanzar', async () => {
    const broken: PlaylistPage = {
      contents: [1, 2, 3],
      has_continuation: true,
      getContinuation: async () => {
        throw new Error('sin red');
      },
    };
    const r = await collectPlaylistItems(broken, map);
    expect(titles(r)).toEqual(['T1', 'T2', 'T3']);
    expect(r.truncated).toBe(true);
  });

  it('primera página vacía o sin contenido: sin canciones y sin aviso', async () => {
    expect(await collectPlaylistItems(page([]), map)).toEqual({ tracks: [], truncated: false });
    const sinContenido: PlaylistPage = { has_continuation: false, getContinuation: async () => sinContenido };
    expect(await collectPlaylistItems(sinContenido, map)).toEqual({ tracks: [], truncated: false });
  });
});
