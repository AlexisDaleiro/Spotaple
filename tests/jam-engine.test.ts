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
