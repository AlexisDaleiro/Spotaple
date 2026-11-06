import { describe, expect, it, vi } from 'vitest';
import { createRoom } from '../src/shared/jam/engine';
import type { JamView } from '../src/shared/jam/types';
import { createPlayer, type JamHook } from '../src/renderer/src/player/player';
import { canAdvance, inRoom, isAdmin } from '../src/renderer/src/stores/jam';
import type { PreparedAudio } from '../src/shared/types';
import { FakeAudio, flush, ok, track, tracks } from './helpers/fake-audio';

function setup(active: boolean) {
  const audio = new FakeAudio();
  const api = {
    prepare: vi.fn(async (id: string) => ok(id)),
    invalidate: vi.fn(async () => undefined),
    recordSelection: vi.fn(async () => undefined),
    recordPlay: vi.fn(async () => undefined),
  };
  const jam: JamHook = { active: () => active, request: vi.fn() };
  const store = createPlayer({ audio, api, jam, urlFor: (id) => `test://${id}` });
  return { audio, api, jam, s: () => store.getState() };
}

describe('gancho de sala en el reproductor', () => {
  it('con la sala activa, reproducir una lista pide solo la canción elegida y no toca la cola propia', async () => {
    const { s, audio, jam } = setup(true);
    s().playTracks(tracks(3), 2);
    await flush();
    expect(jam.request).toHaveBeenCalledWith([track(2)], 'end');
    expect(s().items).toEqual([]);
    expect(s().status).toBe('idle');
    expect(audio.src).toBe('');
  });

  it('agregar a la cola pide todas al final, y "a continuación" las pide como next', async () => {
    const { s, jam } = setup(true);
    s().addToQueue([track(0), track(1)]);
    expect(jam.request).toHaveBeenLastCalledWith([track(0), track(1)], 'end');
    s().playNext([track(2)]);
    expect(jam.request).toHaveBeenLastCalledWith([track(2)], 'next');
    expect(s().items).toEqual([]);
  });

  it('sin sala activa todo sigue igual que antes', async () => {
    const { s, audio, jam } = setup(false);
    s().playTracks(tracks(3), 1);
    await flush();
    expect(audio.src).toBe('test://track000001');
    expect(s().status).toBe('playing');
    expect(jam.request).not.toHaveBeenCalled();
  });
});

describe('playAt', () => {
  it('reemplaza la cola por una canción y arranca en el segundo pedido, sin registrar selección', async () => {
    const { s, audio, api } = setup(true);
    s().playAt(track(0), 12);
    await flush();
    expect(s().items).toHaveLength(1);
    expect(audio.src).toBe('test://track000000');
    audio.loaded(200);
    expect(audio.currentTime).toBe(12);
    expect(api.recordSelection).not.toHaveBeenCalled();
  });
});

describe('stop', () => {
  it('descarta una carga en curso: no arranca sola después (Important del revisor)', async () => {
    const audio = new FakeAudio();
    let release!: (p: PreparedAudio) => void;
    const store = createPlayer({
      audio,
      api: {
        prepare: () => new Promise<PreparedAudio>((res) => (release = res)),
        invalidate: async () => undefined,
        recordSelection: async () => undefined,
        recordPlay: async () => undefined,
      },
      urlFor: (id) => `test://${id}`,
    });
    store.getState().playAt(track(0), 0);
    expect(store.getState().status).toBe('loading');
    store.getState().stop();
    release(ok(track(0).id));
    await flush();
    expect(audio.src).toBe('');
    expect(audio.paused).toBe(true);
    expect(store.getState().status).toBe('paused');
  });
});

describe('estado de la sala en el renderer', () => {
  const view = (patch: Partial<JamView>): JamView => ({
    status: 'connected',
    kind: 'local',
    invite: null,
    selfId: 'admin-1',
    name: 'Ana',
    offsetMs: 0,
    state: createRoom({ code: 'K7M2P', adminId: 'admin-1', adminName: 'Ana', transferAdmin: false }, 0),
    ...patch,
  });

  it('inRoom es cierto solo con estado y conexión viva (conectada o reconectando)', () => {
    expect(inRoom(null)).toBe(false);
    expect(inRoom(view({}))).toBe(true);
    expect(inRoom(view({ status: 'reconnecting' }))).toBe(true);
    expect(inRoom(view({ status: 'connecting', state: null }))).toBe(false);
    expect(inRoom(view({ status: 'ended' }))).toBe(false);
    expect(inRoom(view({ status: 'idle', state: null }))).toBe(false);
  });

  it('canAdvance: el admin puede pasar si algo suena o si la sala se detuvo con cola (Important del revisor)', () => {
    const idle = view({});
    expect(canAdvance(idle)).toBe(false);
    const item = { itemId: 'i9', track: track(1), addedBy: 'u-mara-0001', addedAt: 0 };
    const halted = view({ state: { ...idle.state!, halted: true, queue: [item] } });
    expect(canAdvance(halted)).toBe(true);
    expect(canAdvance({ ...halted, selfId: 'u-mara-0001' })).toBe(false);
    const playing = view({ state: { ...idle.state!, now: { item, status: 'playing', anchorMs: 0, pausedAtSec: 0, skipVotes: [], likes: [] } } });
    expect(canAdvance(playing)).toBe(true);
  });

  it('isAdmin compara el id propio con el del admin', () => {
    expect(isAdmin(view({}))).toBe(true);
    expect(isAdmin(view({ selfId: 'u-mara-0001' }))).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});
