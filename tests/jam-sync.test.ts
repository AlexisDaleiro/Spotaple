import { describe, expect, it, vi } from 'vitest';
import { createRoom, reduce } from '../src/shared/jam/engine';
import { RoomHost, type Conn } from '../src/shared/jam/room-host';
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

  it('un pedido grande (un álbum) se reparte en el tiempo para no pasar el límite de 30 mensajes por segundo', () => {
    vi.useFakeTimers();
    try {
      const sent: JamOutMsg[] = [];
      createJamHook({ getView: () => view('u-mara', base()), send: (m) => void sent.push(m) }).request(tracks(45), 'end');
      expect(sent).toHaveLength(10);
      vi.advanceTimersByTime(4000);
      expect(sent).toHaveLength(45);
      expect(sent.at(-1)).toEqual({ t: 'queue.add', track: track(44) });
    } finally {
      vi.useRealTimers();
    }
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

  it('avisa que pidió a la sala, una canción o varias (Important del revisor)', () => {
    const notices: string[] = [];
    const hook = createJamHook({ getView: () => view('u-mara', base()), send: () => undefined, notify: (m) => notices.push(m) });
    hook.request([track(1)], 'end');
    hook.request([track(1), track(2), track(3)], 'end');
    expect(notices).toEqual(['Pedida a la sala', '3 canciones pedidas a la sala']);
  });

  it('un pedido de 45 canciones pasa por un RoomHost real sin que el límite de tasa lo corte (Important del revisor)', () => {
    vi.useFakeTimers();
    try {
      const host = new RoomHost({ code: 'K7M2P', transferAdmin: true });
      const conn = {
        sent: [] as string[],
        closed: false,
        send(data: string) {
          this.sent.push(data);
        },
        close() {
          this.closed = true;
        },
      };
      const session = host.connect(conn as Conn);
      session.receive(JSON.stringify({ t: 'hello', protocol: 1, memberId: 'u-mara-0001', name: 'Mara', create: true }));
      createJamHook({ getView: () => view('u-mara-0001', base()), send: (m) => session.receive(JSON.stringify(m)) }).request(tracks(45), 'end');
      vi.advanceTimersByTime(10_000);
      const msgs = conn.sent.map((x) => JSON.parse(x));
      expect(msgs.filter((m) => m.t === 'error')).toEqual([]);
      expect(conn.closed).toBe(false);
      expect(msgs.filter((m) => m.t === 'state').at(-1).state.queue).toHaveLength(44);
    } finally {
      vi.useRealTimers();
    }
  });
});

const roomTrack = (st: JamState) => st.now?.item.track.id;
/** Lo que mandó el admin, aplicado al motor: se comprueba el resultado en la sala y no solo el mensaje. */
const applyToRoom = (st: JamState, sent: JamOutMsg[]): JamState =>
  sent.reduce((s, m) => reduce(s, { type: 'msg', from: 'admin-1', msg: m as never }, CLOCK + 9000).state, st);

describe('el admin que se reconecta se reancla a la sala (Critical del revisor)', () => {
  it('si la sala quedó en pausa mientras el admin seguía sonando, se lo cuenta al volver', async () => {
    const { s, sent, setView } = setup();
    const st = anchored(withSong(base()), 3);
    setView(view('admin-1', st));
    await flush();
    sent.length = 0;
    setView(view('admin-1', st, { status: 'reconnecting' }));
    // Al caerse el admin el servidor congela la canción; al volver llega un estado nuevo (serverTime mayor) en pausa.
    const frozen = reduce(st, { type: 'disconnect', memberId: 'admin-1' }, CLOCK + 5000).state;
    const back = reduce(frozen, { type: 'join', memberId: 'admin-1', name: 'Ana' }, CLOCK + 7000).state;
    expect(back.now?.status).toBe('paused');
    setView(view('admin-1', { ...back, serverTime: CLOCK + 8000 }));
    expect(s().status).toBe('playing');
    expect(sent).toContainEqual(expect.objectContaining({ t: 'playing', itemId: 'i1' }));
    expect(applyToRoom(back, sent).now?.status).toBe('playing');
  });

  it('si la canción terminó durante el corte, avisa "ended" al volver y la sala avanza', async () => {
    const { audio, sent, setView } = setup();
    const playingState = anchored(withSong(withSong(base(), 0), 1), 3);
    setView(view('admin-1', playingState));
    await flush();
    setView(view('admin-1', playingState, { status: 'reconnecting' }));
    sent.length = 0;
    audio.ended(); // sin conexión: el aviso no puede salir
    expect(sent).toEqual([]);
    setView(view('admin-1', { ...playingState, serverTime: CLOCK + 5000 }));
    expect(sent).toContainEqual({ t: 'ended', itemId: 'i1' });
    expect(roomTrack(applyToRoom(playingState, sent))).toBe(track(1).id);
  });
});

describe('un admin nuevo arranca en la posición de la sala (Important del revisor)', () => {
  it('no reinicia la canción en 0 ni reancla a todos en 0', async () => {
    const { audio, sent, setView } = setup();
    setView(view('admin-1', anchored(withSong(base()), 100)));
    await flush();
    audio.loaded(300);
    expect(audio.currentTime).toBe(100);
    expect(sent).toContainEqual({ t: 'playing', itemId: 'i1', positionSec: 100 });
  });
});

describe('salir de la sala mientras una canción carga (Important del revisor)', () => {
  it('no deja audio fantasma: la carga pendiente se descarta', async () => {
    let release!: (p: PreparedAudio) => void;
    const pending = new Promise<PreparedAudio>((res) => (release = res));
    const { s, audio, setView } = setup(() => pending);
    setView(view('admin-1', withSong(base())));
    expect(s().status).toBe('loading');
    setView(null);
    release(ok('track000000'));
    await flush();
    expect(audio.src).toBe('');
    expect(audio.paused).toBe(true);
    expect(s().status).not.toBe('playing');
  });
});

describe('un seguidor no suena si la sala no está sonando (Important del revisor)', () => {
  it('con la sala en pausa se queda en pausa aunque su audio termine de cargar', async () => {
    const { s, audio, setView } = setup();
    const st = everyone(anchored(withSong(base()), 42));
    setView(view('u-mara', { ...st, now: { ...st.now!, status: 'paused', pausedAtSec: 42 } }));
    await flush();
    audio.loaded(300);
    expect(audio.paused).toBe(true);
    expect(s().status).toBe('paused');
  });

  it('arranca recién cuando la sala pasa a sonar', async () => {
    const { s, audio, setView } = setup();
    setView(view('u-mara', everyone(withSong(base()))));
    await flush();
    audio.loaded(300);
    expect(audio.paused).toBe(true);
    setView(view('u-mara', everyone(anchored(withSong(base()), 5))));
    await flush();
    expect(audio.paused).toBe(false);
    expect(s().status).toBe('playing');
  });

  it('reanuda aunque la sala empiece a sonar antes de que el navegador confirme la pausa (hallado con el .exe empaquetado)', async () => {
    const { s, audio, setView } = setup();
    audio.manualPause = true; // como en un navegador real: el evento 'pause' llega después de pause()
    setView(view('u-mara', everyone(withSong(base()))));
    await flush(); // el audio del seguidor empieza y, con la sala cargando, se lo pausa
    expect(audio.paused).toBe(true);
    expect(s().status).toBe('playing'); // todavía no llegó el evento 'pause'
    setView(view('u-mara', everyone(anchored(withSong(base()), 5)))); // la sala empieza a sonar antes de esa confirmación
    audio.firePause();
    await flush();
    expect(audio.paused).toBe(false);
    expect(s().status).toBe('playing');
  });
});
