import { describe, expect, it, vi } from 'vitest';
import type { DiscoverState } from '../src/shared/discover';
import { createDiscoverStore } from '../src/renderer/src/stores/discover';

const state = (over: Partial<DiscoverState> = {}): DiscoverState => ({ enabled: true, ready: true, updating: false, lists: [], artists: [], ...over });
const artists = [{ id: 'UC1abcdef', name: 'Uno' }];

describe('createDiscoverStore', () => {
  it('arranca vacío y sin el ajuste activo', () => {
    const store = createDiscoverStore({ get: vi.fn(), refresh: vi.fn() });
    expect(store.getState().state).toEqual({ enabled: false, ready: false, updating: false, lists: [], artists: [] });
  });

  it('load deja lo que devuelve get', async () => {
    const store = createDiscoverStore({ get: async () => state({ artists }), refresh: vi.fn() });
    await store.getState().load();
    expect(store.getState().state.artists).toEqual(artists);
  });

  it('refresh reemplaza el estado con el resultado', async () => {
    const store = createDiscoverStore({ get: async () => state(), refresh: async () => state({ artists }) });
    await store.getState().refresh();
    expect(store.getState().state.artists).toEqual(artists);
  });

  it('si refresh falla no lanza y conserva lo que había', async () => {
    const store = createDiscoverStore({ get: async () => state({ artists }), refresh: async () => Promise.reject(new Error('sin red')) });
    await store.getState().load();
    await expect(store.getState().refresh()).resolves.toBeUndefined();
    expect(store.getState().state.artists).toEqual(artists);
  });

  it('si load falla no lanza y conserva lo que había', async () => {
    const store = createDiscoverStore({ get: async () => Promise.reject(new Error('sin puente')), refresh: vi.fn() });
    await expect(store.getState().load()).resolves.toBeUndefined();
    expect(store.getState().state.enabled).toBe(false);
  });

  it('dos refresh simultáneos llaman a la API una sola vez, y uno posterior vuelve a llamar', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const refresh = vi.fn(async () => (await gate, state({ artists })));
    const store = createDiscoverStore({ get: async () => state(), refresh });
    const a = store.getState().refresh();
    const b = store.getState().refresh();
    expect(a).toBe(b);
    release();
    await Promise.all([a, b]);
    expect(refresh).toHaveBeenCalledTimes(1);
    await store.getState().refresh();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('set reemplaza el estado (lo usa «Reiniciar mis gustos»)', () => {
    const store = createDiscoverStore({ get: vi.fn(), refresh: vi.fn() });
    store.getState().set(state({ ready: false }));
    expect(store.getState().state.ready).toBe(false);
  });
});
