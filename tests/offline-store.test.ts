import { beforeEach, describe, expect, it } from 'vitest';
import { useOffline } from '../src/renderer/src/stores/offline';
import type { Track } from '../src/shared/types';

const t = (id: string): Track => ({ id, title: id, artists: [{ name: 'Artista' }] });

beforeEach(() => useOffline.setState({ ids: new Set(['abajo1']), online: true, pending: 0, failed: 0, bytes: 0 }));

describe('useOffline', () => {
  it('con red todo es alcanzable', () => {
    expect(useOffline.getState().reachable('abajo1')).toBe(true);
    expect(useOffline.getState().reachable('otra99')).toBe(true);
  });

  it('sin red solo lo descargado es alcanzable', () => {
    useOffline.getState().setOnline(false);
    expect(useOffline.getState().reachable('abajo1')).toBe(true);
    expect(useOffline.getState().reachable('otra99')).toBe(false);
  });

  it('playable devuelve todo con red y solo lo descargado sin ella', () => {
    const list = [t('abajo1'), t('otra99')];
    expect(useOffline.getState().playable(list)).toEqual(list);
    useOffline.getState().setOnline(false);
    expect(useOffline.getState().playable(list)).toEqual([list[0]]);
  });

  it('queueFrom: con red deja la lista y la posición como están', () => {
    const list = [t('abajo1'), t('otra99'), t('otra98')];
    expect(useOffline.getState().queueFrom(list, 1)).toEqual({ tracks: list, start: 1 });
  });

  it('queueFrom: sin red usa solo lo descargado y arranca en la elegida', () => {
    useOffline.setState({ ids: new Set(['a1', 'c3']), online: false });
    const list = [t('a1'), t('b2'), t('c3')];
    expect(useOffline.getState().queueFrom(list, 2)).toEqual({ tracks: [list[0], list[2]], start: 1 });
  });

  it('queueFrom: sin red y con una elegida que no está descargada deja la lista entera (se salta sola)', () => {
    useOffline.setState({ ids: new Set(['a1']), online: false });
    const list = [t('a1'), t('b2')];
    expect(useOffline.getState().queueFrom(list, 1)).toEqual({ tracks: list, start: 1 });
  });

  it('set copia el estado que informa main', () => {
    useOffline.getState().set({ ids: ['a1', 'b2'], pending: 3, failed: 1, bytes: 42 });
    const s = useOffline.getState();
    expect([...s.ids]).toEqual(['a1', 'b2']);
    expect([s.pending, s.failed, s.bytes]).toEqual([3, 1, 42]);
  });
});
