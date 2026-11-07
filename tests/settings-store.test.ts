import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../src/renderer/src/stores/settings';
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings';

function make(initial: AppSettings = DEFAULT_SETTINGS) {
  const api = {
    get: vi.fn(async () => initial),
    set: vi.fn(async (patch: Partial<AppSettings>) => ({ ...initial, ...patch })),
  };
  const apply = vi.fn();
  const onError = vi.fn();
  const store = createSettingsStore({ api, apply, onError });
  return { api, apply, onError, store };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('store de ajustes del renderer', () => {
  it('load guarda lo que devuelve la API y lo aplica', async () => {
    const { store, apply } = make({ ...DEFAULT_SETTINGS, theme: 'claro' });
    await store.getState().load();
    expect(store.getState().settings.theme).toBe('claro');
    expect(store.getState().loaded).toBe(true);
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'claro' }));
  });

  it('update aplica al instante y persiste recién a los 250 ms', async () => {
    const { store, apply, api } = make();
    store.getState().update({ theme: 'claro' });
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'claro' }));
    expect(api.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(api.set).toHaveBeenCalledTimes(1);
    expect(api.set).toHaveBeenCalledWith({ theme: 'claro' });
  });

  it('cambios seguidos se juntan en una sola llamada', async () => {
    const { store, api } = make();
    store.getState().update({ accent: '#111111' });
    store.getState().update({ textScale: 1.1 });
    await vi.advanceTimersByTimeAsync(250);
    expect(api.set).toHaveBeenCalledTimes(1);
    expect(api.set).toHaveBeenCalledWith({ accent: '#111111', textScale: 1.1 });
  });

  it('flush persiste de inmediato', async () => {
    const { store, api } = make();
    store.getState().update({ density: 'compact' });
    await store.getState().flush();
    expect(api.set).toHaveBeenCalledWith({ density: 'compact' });
    await vi.advanceTimersByTimeAsync(500);
    expect(api.set).toHaveBeenCalledTimes(1);
  });

  it('si guardar falla avisa con el mensaje del error y no revierte lo que se ve', async () => {
    const { store, api, onError } = make();
    api.set.mockRejectedValueOnce(new Error('boom'));
    store.getState().update({ theme: 'oceano' });
    await vi.advanceTimersByTimeAsync(250);
    expect(onError).toHaveBeenCalledWith('boom');
    expect(store.getState().settings.theme).toBe('oceano');
  });

  it('reapply vuelve a aplicar los ajustes actuales', async () => {
    const { store, apply } = make();
    store.getState().update({ theme: 'medianoche' });
    apply.mockClear();
    store.getState().reapply();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ theme: 'medianoche' }));
  });
});
