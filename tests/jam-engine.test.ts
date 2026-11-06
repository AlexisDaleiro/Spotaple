import { describe, expect, it } from 'vitest';
import { createRoom, reduce, type EngineEvent, type EngineMsg } from '../src/shared/jam/engine';
import { LIMITS, type JamState } from '../src/shared/jam/types';
import type { Track } from '../src/shared/types';

const T = (n: number): Track => ({ id: `vid-${n}-xxxxx`, title: `Tema ${n}`, artists: [{ name: 'Artista' }] });
const room = (transferAdmin = true) => createRoom({ code: 'K7M2P', adminId: 'admin-1', adminName: 'Ana', transferAdmin }, 1000);
const run = (s: JamState, ev: EngineEvent, at = 2000) => reduce(s, ev, at);
const join = (s: JamState, id: string, name = id, at = 2000) => run(s, { type: 'join', memberId: id, name }, at).state;
const send = (s: JamState, from: string, m: EngineMsg, at = 3000) => run(s, { type: 'msg', from, msg: m }, at);
const withMara = () => join(room(), 'u-mara', 'Mara');
const add = (s: JamState, from: string, n: number, at?: 'end' | 'next' | 'now') => send(s, from, { t: 'queue.add', track: T(n), ...(at ? { at } : {}) }).state;
const ids = (s: JamState) => s.queue.map((i) => i.track.id);

describe('createRoom', () => {
  it('crea una sala ociosa con el admin como único miembro', () => {
    const s = room();
    expect(s).toMatchObject({ code: 'K7M2P', mode: 'admin-only', adminId: 'admin-1', queue: [], now: null, closed: false, halted: false, failures: 0, adminLostAt: null });
    expect(s.members).toEqual([{ id: 'admin-1', name: 'Ana', connected: true, joinedAt: 1000, lostAt: null, likesReceived: 0 }]);
  });
});

describe('join', () => {
  it('suma miembros y actualiza el nombre al reconectar con el mismo id', () => {
    let s = withMara();
    expect(s.members).toHaveLength(2);
    s = join(s, 'u-mara', 'Mara G.');
    expect(s.members).toHaveLength(2);
    expect(s.members.find((m) => m.id === 'u-mara')).toMatchObject({ name: 'Mara G.', connected: true });
  });

  it('rechaza un miembro nuevo con la sala llena, pero deja volver a uno existente', () => {
    let s = room();
    for (let i = 1; i < LIMITS.members; i++) s = join(s, `user-${i}-xxxxxx`);
    expect(s.members).toHaveLength(30);
    const full = run(s, { type: 'join', memberId: 'nuevo-1234', name: 'Nuevo' });
    expect(full.error).toBe('room_full');
    expect(full.state).toBe(s);
    expect(run(s, { type: 'join', memberId: 'user-1-xxxxxx', name: 'Otra vez' }).error).toBeUndefined();
  });

  it('el admin que reentra limpia adminLostAt', () => {
    let s = run(room(), { type: 'disconnect', memberId: 'admin-1' }, 5000).state;
    expect(s.adminLostAt).toBe(5000);
    s = run(s, { type: 'join', memberId: 'admin-1', name: 'Ana' }, 6000).state;
    expect(s.adminLostAt).toBeNull();
  });
});

describe('queue.add', () => {
  it('en una sala ociosa la canción pasa directo a now', () => {
    const { state } = send(withMara(), 'u-mara', { t: 'queue.add', track: T(1) });
    expect(state.queue).toEqual([]);
    expect(state.now).toMatchObject({ status: 'loading', anchorMs: null });
    expect(state.now?.item).toMatchObject({ addedBy: 'u-mara', track: T(1) });
  });

  it('la segunda va al final de la cola', () => {
    const s = add(add(withMara(), 'u-mara', 1), 'u-mara', 2);
    expect(ids(s)).toEqual([T(2).id]);
  });

  it('rechaza duplicados de la que suena y de la cola', () => {
    const s = add(add(withMara(), 'u-mara', 1), 'u-mara', 2);
    expect(send(s, 'u-mara', { t: 'queue.add', track: T(1) }).error).toBe('duplicate');
    expect(send(s, 'u-mara', { t: 'queue.add', track: T(2) }).error).toBe('duplicate');
  });

  it('rechaza con la cola llena (200 ítems)', () => {
    let s = withMara();
    for (let i = 1; i <= 201; i++) {
      const r = send(s, 'u-mara', { t: 'queue.add', track: T(i) });
      expect(r.error).toBeUndefined();
      s = r.state;
    }
    expect(s.queue).toHaveLength(200);
    expect(send(s, 'u-mara', { t: 'queue.add', track: T(999) }).error).toBe('queue_full');
  });

  it('el admin puede pedir "next" y "now"; un miembro no', () => {
    let s = add(add(add(withMara(), 'u-mara', 1), 'u-mara', 2), 'u-mara', 3);
    expect(ids(add(s, 'admin-1', 4, 'next'))).toEqual([T(4).id, T(2).id, T(3).id]);
    s = add(s, 'admin-1', 5, 'now');
    expect(s.now?.item.track.id).toBe(T(5).id);
    expect(s.now?.status).toBe('loading');
    expect(send(s, 'u-mara', { t: 'queue.add', track: T(6), at: 'next' }).error).toBe('forbidden');
  });

  it('un extraño que no es miembro no puede pedir', () => {
    expect(send(room(), 'intruso-123', { t: 'queue.add', track: T(1) }).error).toBe('forbidden');
  });
});

describe('queue.remove / move / playNext / playNow', () => {
  const base = () => add(add(add(add(withMara(), 'u-mara', 1), 'u-mara', 2), 'admin-1', 3), 'u-mara', 4);
  const itemOf = (s: JamState, n: number) => s.queue.find((i) => i.track.id === T(n).id)!.itemId;

  it('el dueño quita lo suyo; otro miembro no; el admin quita cualquiera', () => {
    const s = join(base(), 'u-juan', 'Juan');
    expect(send(s, 'u-juan', { t: 'queue.remove', itemId: itemOf(s, 2) }).error).toBe('forbidden');
    expect(ids(send(s, 'u-mara', { t: 'queue.remove', itemId: itemOf(s, 2) }).state)).toEqual([T(3).id, T(4).id]);
    expect(ids(send(s, 'admin-1', { t: 'queue.remove', itemId: itemOf(s, 4) }).state)).toEqual([T(2).id, T(3).id]);
    expect(send(s, 'admin-1', { t: 'queue.remove', itemId: 'no-existe' }).error).toBe('not_found');
  });

  it('solo el admin mueve; el índice se limita al último', () => {
    const s = base();
    expect(send(s, 'u-mara', { t: 'queue.move', itemId: itemOf(s, 2), toIndex: 0 }).error).toBe('forbidden');
    expect(ids(send(s, 'admin-1', { t: 'queue.move', itemId: itemOf(s, 4), toIndex: 0 }).state)).toEqual([T(4).id, T(2).id, T(3).id]);
    expect(ids(send(s, 'admin-1', { t: 'queue.move', itemId: itemOf(s, 2), toIndex: 99 }).state)).toEqual([T(3).id, T(4).id, T(2).id]);
  });

  it('playNext deja el ítem primero; playNow lo vuelve now y descarta el anterior', () => {
    const s = base();
    expect(ids(send(s, 'admin-1', { t: 'queue.playNext', itemId: itemOf(s, 4) }).state)).toEqual([T(4).id, T(2).id, T(3).id]);
    expect(send(s, 'u-mara', { t: 'queue.playNext', itemId: itemOf(s, 4) }).error).toBe('forbidden');
    const now = send(s, 'admin-1', { t: 'queue.playNow', itemId: itemOf(s, 3) }).state;
    expect(now.now?.item.track.id).toBe(T(3).id);
    expect(now.now).toMatchObject({ status: 'loading', skipVotes: [], likes: [] });
    expect(ids(now)).toEqual([T(2).id, T(4).id]);
  });
});

describe('mode.set', () => {
  it('lo cambia el admin; un miembro no', () => {
    const s = withMara();
    expect(send(s, 'admin-1', { t: 'mode.set', mode: 'everyone' }).state.mode).toBe('everyone');
    expect(send(s, 'u-mara', { t: 'mode.set', mode: 'everyone' }).error).toBe('forbidden');
  });
});

describe('disconnect / leave / close', () => {
  it('desconectar marca al miembro y, si es el admin, adminLostAt', () => {
    const s = run(withMara(), { type: 'disconnect', memberId: 'u-mara' }, 7000).state;
    expect(s.members.find((m) => m.id === 'u-mara')).toMatchObject({ connected: false, lostAt: 7000 });
    expect(s.adminLostAt).toBeNull();
    expect(run(s, { type: 'disconnect', memberId: 'admin-1' }, 8000).state.adminLostAt).toBe(8000);
  });

  it('un miembro que sale deja su cola', () => {
    const s = add(add(withMara(), 'u-mara', 1), 'u-mara', 2);
    const left = send(s, 'u-mara', { t: 'leave' }).state;
    expect(left.members.map((m) => m.id)).toEqual(['admin-1']);
    expect(ids(left)).toEqual([T(2).id]);
  });

  it('el admin que sale traspasa al conectado más antiguo (relé) o cierra la sala (local)', () => {
    let s = join(join(room(true), 'u-mara', 'Mara', 2000), 'u-juan', 'Juan', 3000);
    const moved = send(s, 'admin-1', { t: 'leave' }).state;
    expect(moved.adminId).toBe('u-mara');
    expect(moved.adminLostAt).toBeNull();
    expect(moved.closed).toBe(false);
    s = join(room(false), 'u-mara', 'Mara');
    expect(send(s, 'admin-1', { t: 'leave' }).state.closed).toBe(true);
  });

  it('close lo hace el admin; después todo mensaje da "closed"', () => {
    const s = withMara();
    expect(send(s, 'u-mara', { t: 'close' }).error).toBe('forbidden');
    const closed = send(s, 'admin-1', { t: 'close' }).state;
    expect(closed.closed).toBe(true);
    expect(send(closed, 'u-mara', { t: 'queue.add', track: T(1) }).error).toBe('closed');
  });
});

/** Ana (admin), Mara, Eli, Luz y Juan conectados; Luz pidió la que suena (T1) y en cola quedan T2, T3 y T4. */
const five = () => {
  let s = room();
  for (const [id, at] of [['u-mara', 2000], ['u-eli', 2100], ['u-luz', 2200], ['u-juan', 2300]] as const) s = join(s, id, id, at);
  s = add(s, 'u-luz', 1);
  for (const n of [2, 3, 4]) s = add(s, 'u-mara', n);
  return s;
};
const nowId = (s: JamState) => s.now!.item.itemId;
const playing = (s: JamState, at = 50_000, pos = 3) => send(s, 'admin-1', { t: 'playing', itemId: nowId(s), positionSec: pos }, at).state;
const nowTrack = (s: JamState) => s.now?.item.track.id;

describe('playing', () => {
  it('el admin ancla el reloj y reinicia los fallos', () => {
    const p = playing(five(), 50_000, 3);
    expect(p.now).toMatchObject({ status: 'playing', anchorMs: 47_000 });
    expect(p.failures).toBe(0);
  });

  it('un miembro no puede informar y un itemId ajeno se ignora sin error', () => {
    const s = five();
    expect(send(s, 'u-mara', { t: 'playing', itemId: nowId(s), positionSec: 3 }).error).toBe('forbidden');
    const r = send(s, 'admin-1', { t: 'playing', itemId: 'otro', positionSec: 3 });
    expect(r.error).toBeUndefined();
    expect(r.state).toBe(s);
  });
});

describe('ended (Review Focus 2)', () => {
  it('avanza una sola vez aunque llegue repetido', () => {
    const s = five();
    const first = nowId(s);
    const a = send(s, 'admin-1', { t: 'ended', itemId: first }).state;
    expect(nowTrack(a)).toBe(T(2).id);
    const b = send(a, 'admin-1', { t: 'ended', itemId: first });
    expect(b.error).toBeUndefined();
    expect(b.state).toBe(a);
    expect(nowTrack(b.state)).toBe(T(2).id);
  });

  it('con la cola vacía deja la sala ociosa', () => {
    const s = add(withMara(), 'u-mara', 1);
    expect(send(s, 'admin-1', { t: 'ended', itemId: nowId(s) }).state.now).toBeNull();
  });

  it('solo lo informa el admin', () => {
    const s = five();
    expect(send(s, 'u-mara', { t: 'ended', itemId: nowId(s) }).error).toBe('forbidden');
  });
});

describe('unavailable', () => {
  const fail1 = (s: JamState) => send(s, 'admin-1', { t: 'unavailable', itemId: nowId(s) }).state;
  const halted = () => fail1(fail1(fail1(five())));

  it('avanza dos veces y a la tercera detiene la sala sin tocar el resto de la cola', () => {
    const one = fail1(five());
    expect(one).toMatchObject({ failures: 1, halted: false });
    expect(nowTrack(one)).toBe(T(2).id);
    const h = halted();
    expect(h).toMatchObject({ failures: 3, halted: true, now: null });
    expect(ids(h)).toEqual([T(4).id]);
  });

  it('un playing entre fallos reinicia el contador', () => {
    const s = fail1(playing(fail1(five())));
    expect(s.failures).toBe(1);
  });

  it('detenida no arranca sola y el admin la destraba', () => {
    const h = halted();
    const added = add(h, 'u-mara', 9);
    expect(added.now).toBeNull();
    expect(ids(added)).toEqual([T(4).id, T(9).id]);
    const next = send(h, 'admin-1', { t: 'transport', action: 'next' }).state;
    expect(next.halted).toBe(false);
    expect(nowTrack(next)).toBe(T(4).id);
  });
});

describe('transport', () => {
  it('pausa, reanuda y salta con el reloj de la sala', () => {
    let s = playing(five(), 50_000, 3);
    s = send(s, 'admin-1', { t: 'transport', action: 'pause' }, 60_000).state;
    expect(s.now).toMatchObject({ status: 'paused', pausedAtSec: 13 });
    s = send(s, 'admin-1', { t: 'transport', action: 'play' }, 70_000).state;
    expect(s.now).toMatchObject({ status: 'playing', anchorMs: 57_000 });
    s = send(s, 'admin-1', { t: 'transport', action: 'seek', positionSec: 100 }, 80_000).state;
    expect(s.now?.anchorMs).toBe(-20_000);
    s = send(s, 'admin-1', { t: 'transport', action: 'pause' }, 81_000).state;
    s = send(s, 'admin-1', { t: 'transport', action: 'seek', positionSec: 5 }, 82_000).state;
    expect(s.now).toMatchObject({ status: 'paused', pausedAtSec: 5 });
  });

  it('pausar mientras carga es inválido, un miembro no controla y next avanza', () => {
    const s = five();
    expect(send(s, 'admin-1', { t: 'transport', action: 'pause' }).error).toBe('bad_request');
    expect(send(s, 'u-mara', { t: 'transport', action: 'next' }).error).toBe('forbidden');
    expect(nowTrack(send(s, 'admin-1', { t: 'transport', action: 'next' }).state)).toBe(T(2).id);
  });
});

describe('vote.skip', () => {
  const vote = (s: JamState, from: string) => send(s, from, { t: 'vote.skip' }).state;
  const drop = (s: JamState, id: string, at: number) => run(s, { type: 'disconnect', memberId: id }, at).state;

  it('salta al reunir más de la mitad de los conectados y los votos repetidos no suman', () => {
    let s = vote(vote(five(), 'u-mara'), 'u-mara');
    expect(s.now?.skipVotes).toEqual(['u-mara']);
    s = vote(s, 'u-eli');
    expect(nowTrack(s)).toBe(T(1).id);
    s = vote(s, 'u-juan');
    expect(nowTrack(s)).toBe(T(2).id);
    expect(s.now?.skipVotes).toEqual([]);
  });

  it('el admin y quien la pidió saltan directo', () => {
    expect(nowTrack(vote(five(), 'admin-1'))).toBe(T(2).id);
    expect(nowTrack(vote(five(), 'u-luz'))).toBe(T(2).id);
  });

  it('recalcula el umbral cuando se van miembros', () => {
    let s = vote(vote(five(), 'u-mara'), 'u-eli');
    s = drop(s, 'u-juan', 9000);
    expect(nowTrack(s)).toBe(T(1).id);
    s = drop(s, 'u-luz', 9100);
    expect(nowTrack(s)).toBe(T(2).id);
  });

  it('los votos de desconectados no cuentan', () => {
    let s = drop(vote(five(), 'u-mara'), 'u-mara', 9000);
    s = vote(vote(s, 'u-eli'), 'u-juan');
    expect(nowTrack(s)).toBe(T(1).id);
  });

  it('sin canción actual da not_found', () => {
    expect(send(withMara(), 'u-mara', { t: 'vote.skip' }).error).toBe('not_found');
  });
});

describe('like.toggle', () => {
  const likes = (s: JamState, id: string) => s.members.find((m) => m.id === id)?.likesReceived;

  it('suma y quita el like y acredita a quien pidió la canción', () => {
    let s = send(five(), 'u-mara', { t: 'like.toggle' }).state;
    expect(s.now?.likes).toEqual(['u-mara']);
    expect(likes(s, 'u-luz')).toBe(1);
    s = send(s, 'u-mara', { t: 'like.toggle' }).state;
    expect(s.now?.likes).toEqual([]);
    expect(likes(s, 'u-luz')).toBe(0);
  });

  it('sin canción actual da not_found y el total se conserva al avanzar', () => {
    expect(send(withMara(), 'u-mara', { t: 'like.toggle' }).error).toBe('not_found');
    let s = send(five(), 'u-mara', { t: 'like.toggle' }).state;
    s = send(s, 'admin-1', { t: 'transport', action: 'next' }).state;
    expect(likes(s, 'u-luz')).toBe(1);
  });
});

describe('tick', () => {
  const lost = (transfer: boolean) => {
    const s = join(join(room(transfer), 'u-mara', 'Mara', 2000), 'u-juan', 'Juan', 3000);
    return run(s, { type: 'disconnect', memberId: 'admin-1' }, 5000).state;
  };

  it('traspasa el rol al conectado más antiguo al vencer la gracia (relé)', () => {
    const s = lost(true);
    expect(run(s, { type: 'tick' }, 64_999).state).toBe(s);
    const t = run(s, { type: 'tick' }, 65_000).state;
    expect(t.adminId).toBe('u-mara');
    expect(t.adminLostAt).toBeNull();
  });

  it('la sala local termina al vencer la gracia', () => {
    expect(run(lost(false), { type: 'tick' }, 65_000).state.closed).toBe(true);
  });

  it('quita a los no-admin desconectados hace 10 minutos y conserva sus ítems', () => {
    let s = add(add(withMara(), 'u-mara', 1), 'u-mara', 2);
    s = run(s, { type: 'disconnect', memberId: 'u-mara' }, 10_000).state;
    expect(run(s, { type: 'tick' }, 609_999).state.members.map((m) => m.id)).toEqual(['admin-1', 'u-mara']);
    const t = run(s, { type: 'tick' }, 610_000).state;
    expect(t.members.map((m) => m.id)).toEqual(['admin-1']);
    expect(ids(t)).toEqual([T(2).id]);
  });
});

describe('admin a mitad de canción (Review Focus 5)', () => {
  it('queda en pausa congelada y se reancla al volver, sin tocar la cola', () => {
    let s = playing(five(), 50_000, 3);
    s = run(s, { type: 'disconnect', memberId: 'admin-1' }, 60_000).state;
    expect(s.now).toMatchObject({ status: 'paused', pausedAtSec: 13 });
    s = run(s, { type: 'join', memberId: 'admin-1', name: 'Ana' }, 70_000).state;
    expect(s.adminId).toBe('admin-1');
    expect(s.now?.status).toBe('paused');
    expect(ids(s)).toEqual([T(2).id, T(3).id, T(4).id]);
    s = send(s, 'admin-1', { t: 'playing', itemId: nowId(s), positionSec: 14 }, 71_000).state;
    expect(s.now).toMatchObject({ status: 'playing', anchorMs: 57_000 });
    expect(ids(s)).toEqual([T(2).id, T(3).id, T(4).id]);
  });
});
