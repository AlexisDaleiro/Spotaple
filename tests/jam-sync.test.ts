import { describe, expect, it, vi } from 'vitest';
import { createRoom, reduce } from '../src/shared/jam/engine';
import type { JamState, JamView } from '../src/shared/jam/types';
import type { PreparedAudio } from '../src/shared/types';
import { createJamHook, startJamSync, type JamOutMsg } from '../src/renderer/src/player/jam-sync';
import { createPlayer } from '../src/renderer/src/player/player';
import { FakeAudio, flush, ok, track, tracks } from './helpers/fake-audio';

/** Reloj local fijo: así la posición esperada de un seguidor es exacta. */
const CLOCK = 1_000_000;

const base = (): JamState => {
  const st = createRoom({ code: 'K7M2P', adminId: 'admin-1', adminName: 'Ana', transferAdmin: true }, 0);
  return reduce(st, { type: 'join', memberId: 'u-mara', name: 'Mara' }, 1).state;
};
const withSong = (st: JamState, n = 0): JamState => reduce(st, { type: 'msg', from: 'u-mara', msg: { t: 'queue.add', track: track(n) } }, 2).state;
/** El admin informa que la canción suena en `pos`, justo ahora (CLOCK). */
const anchored = (st: JamState, pos: number): JamState =>
  reduce(st, { type: 'msg', from: 'admin-1', msg: { t: 'playing', itemId: st.now!.item.itemId, positionSec: pos } }, CLOCK).state;
const everyone = (st: JamState): JamState => ({ ...st, mode: 'everyone' });
const view = (selfId: string, state: JamState | null, patch: Partial<JamView> = {}): JamView => ({
  status: 'connected',
  kind: 'local',
  invite: null,
  selfId,
  name: selfId,
  offsetMs: 0,
  state,
  ...patch,
});

function setup(prepare?: (id: string) => Promise<PreparedAudio>) {
  const audio = new FakeAudio();
  const api = {
    prepare: vi.fn(prepare ?? (async (id: string) => ok(id))),
    invalidate: vi.fn(async () => undefined),
    recordSelection: vi.fn(async () => undefined),
    recordPlay: vi.fn(async () => undefined),
  };
  const store = createPlayer({ audio, api, urlFor: (id) => `test://${id}` });
  let current: JamView | null = null;
  const listeners = new Set<(v: JamView | null) => void>();
  const sent: JamOutMsg[] = [];
  const flags = { persistenceSuspended: false };
  startJamSync({
    player: store,
    getView: () => current,
    subscribe: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    send: (m) => sent.push(m),
    now: () => CLOCK,
    setPersistenceSuspended: (v) => (flags.persistenceSuspended = v),
    driftEveryMs: 1_000_000,
  });
  const setView = (v: JamView | null) => {
    current = v;
    listeners.forEach((l) => l(v));
  };
  return { audio, api, store, s: () => store.getState(), sent, flags, setView };
}

describe('el admin conduce su reproductor y avisa a la sala', () => {
  it('carga la canción actual, informa que suena y que terminó', async () => {
    const { s, audio, sent, setView } = setup();
    setView(view('admin-1', withSong(base())));
    expect(s().items[0]?.track.id).toBe(track(0).id);
    await flush();
    expect(audio.src).toBe('test://track000000');
    expect(sent).toContainEqual({ t: 'playing', itemId: 'i1', positionSec: 0 });
    audio.ended();
    await flush();
    expect(sent).toContainEqual({ t: 'ended', itemId: 'i1' });
    expect(sent.some((m) => m.t === 'transport')).toBe(false);
  });

  it('una canción no disponible se informa como unavailable', async () => {
    const { sent, setView } = setup(async () => {
      throw Object.assign(new Error('no disponible'), { code: 'unavailable' });
    });
    setView(view('admin-1', withSong(base())));
    await flush();
    expect(sent).toContainEqual({ t: 'unavailable', itemId: 'i1' });
  });

  it('pausar con la sala sonando envía transport pause', async () => {
    const { s, sent, setView } = setup();
    const loading = withSong(base());
    setView(view('admin-1', loading));
    await flush();
    setView(view('admin-1', anchored(loading, 0)));
    s().togglePlay();
    await flush();
    expect(sent.filter((m) => m.t === 'transport')).toEqual([{ t: 'transport', action: 'pause' }]);
  });

  it('mover la posición con la sala sonando envía transport seek', async () => {
    const { s, sent, setView } = setup();
    const loading = withSong(base());
    setView(view('admin-1', loading));
    await flush();
    setView(view('admin-1', anchored(loading, 0)));
    s().seek(60);
    expect(sent).toContainEqual({ t: 'transport', action: 'seek', positionSec: 60 });
  });

  it('si el admin se reconecta a mitad de canción no se reinicia (Review Focus 5)', async () => {
    const { s, api, audio, setView } = setup();
    const st = anchored(withSong(base()), 3);
    setView(view('admin-1', st));
    await flush();
    const uid = s().items[0]!.uid;
    setView(view('admin-1', st, { status: 'reconnecting' }));
    setView(view('admin-1', st));
    await flush();
    expect(api.prepare).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe('test://track000000');
    expect(s().items[0]!.uid).toBe(uid);
  });
});

describe('un seguidor reproduce solo en el modo "Todas"', () => {
  it('en "Solo admin" no carga nada; al pasar a "Todas" empieza en la posición de la sala', async () => {
    const { s, audio, setView } = setup();
    const st = anchored(withSong(base()), 100);
    setView(view('u-mara', st));
    await flush();
    expect(s().items).toEqual([]);
    expect(audio.src).toBe('');
    setView(view('u-mara', everyone(st)));
    await flush();
    expect(audio.src).toBe('test://track000000');
    audio.loaded(300);
    expect(audio.currentTime).toBe(100);
  });

  it('corrige con un salto solo cuando se desvía más de 0,5 s', async () => {
    const { s, audio, setView } = setup();
    const st = everyone(anchored(withSong(base()), 100));
    setView(view('u-mara', st));
    await flush();
    audio.loaded(300);
    expect(s().status).toBe('playing');
    audio.currentTime = 95;
    audio.dispatchEvent(new Event('timeupdate'));
    setView(view('u-mara', st));
    expect(audio.currentTime).toBe(100);
    audio.currentTime = 100.3;
    audio.dispatchEvent(new Event('timeupdate'));
    setView(view('u-mara', st));
    expect(audio.currentTime).toBe(100.3);
  });

  it('se pausa si la sala se pausa y al pasar a "Solo admin"', async () => {
    const { s, audio, setView } = setup();
    const st = everyone(anchored(withSong(base()), 10));
    setView(view('u-mara', st));
    await flush();
    audio.loaded(300);
    expect(s().status).toBe('playing');
    setView(view('u-mara', { ...st, now: { ...st.now!, status: 'paused', pausedAtSec: 12 } }));
    expect(audio.paused).toBe(true);
    setView(view('u-mara', st));
    await flush();
    expect(audio.paused).toBe(false);
    setView(view('u-mara', { ...st, mode: 'admin-only' }));
    expect(audio.paused).toBe(true);
  });
});

describe('entrar y salir de la sala', () => {
  it('guarda la cola personal, deja repeat y shuffle apagados y todo vuelve al salir', async () => {
    const { s, flags, setView } = setup();
    s().playTracks(tracks(3), 1);
    await flush();
    s().cycleRepeat();
    s().cycleRepeat();
    s().toggleShuffle();
    const before = { ids: s().items.map((i) => i.track.id), index: s().index, repeat: s().repeat, shuffle: s().shuffle };
    expect(before.repeat).toBe('one');
    expect(before.shuffle).toBe(true);

    setView(view('admin-1', base()));
    expect(flags.persistenceSuspended).toBe(true);
    expect(s().repeat).toBe('off');
    expect(s().shuffle).toBe(false);
    expect(s().items).toEqual([]);

    setView(null);
    expect(flags.persistenceSuspended).toBe(false);
    expect({ ids: s().items.map((i) => i.track.id), index: s().index, repeat: s().repeat, shuffle: s().shuffle }).toEqual(before);
    expect(s().status).toBe('paused');
  });

  it('una sala terminada también devuelve la cola personal', async () => {
    const { s, flags, setView } = setup();
    s().playTracks(tracks(2), 0);
    await flush();
    setView(view('admin-1', base()));
    setView(view('admin-1', base(), { status: 'ended', reason: 'closed' }));
    expect(flags.persistenceSuspended).toBe(false);
    expect(s().items).toHaveLength(2);
  });
});

describe('createJamHook', () => {
  it('está activo solo en una sala viva', () => {
    const none = createJamHook({ getView: () => null, send: () => undefined });
    const ended = createJamHook({ getView: () => view('u-mara', base(), { status: 'ended' }), send: () => undefined });
    const live = createJamHook({ getView: () => view('u-mara', base()), send: () => undefined });
    expect([none.active(), ended.active(), live.active()]).toEqual([false, false, true]);
  });

  it('un miembro pide al final aunque pida "next"; el admin respeta "next" y conserva el orden', () => {
    const sent: JamOutMsg[] = [];
    const send = (m: JamOutMsg) => void sent.push(m);
    createJamHook({ getView: () => view('u-mara', base()), send }).request([track(1), track(2)], 'next');
    expect(sent).toEqual([
      { t: 'queue.add', track: track(1) },
      { t: 'queue.add', track: track(2) },
    ]);
    sent.length = 0;
    createJamHook({ getView: () => view('admin-1', base()), send }).request([track(1), track(2)], 'next');
    expect(sent).toEqual([
      { t: 'queue.add', track: track(2), at: 'next' },
      { t: 'queue.add', track: track(1), at: 'next' },
    ]);
  });
});
