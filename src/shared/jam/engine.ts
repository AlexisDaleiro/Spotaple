import { positionAt } from './clock';
import { LIMITS, type ClientMsg, type JamErrorCode, type JamItem, type JamMember, type JamMode, type JamNow, type JamState } from './types';

/**
 * Motor de sala: función pura `reduce(estado, evento, ahora)`. No toca red, reloj ni disco, así que
 * corre igual en el host local (main de Electron) y en el relé, y se prueba sin conexiones.
 */

/** Mensajes de miembros que llegan al motor (`hello` y `ping` los resuelve el host de conexiones). */
export type EngineMsg = Exclude<ClientMsg, { t: 'hello' | 'ping' }>;

export type EngineEvent =
  | { type: 'join'; memberId: string; name: string }
  | { type: 'msg'; from: string; msg: EngineMsg }
  | { type: 'disconnect'; memberId: string }
  | { type: 'tick' };

/** Con `error` el estado es el mismo objeto que entró: no hubo cambios. */
export interface EngineResult {
  state: JamState;
  error?: JamErrorCode;
}

const ok = (state: JamState): EngineResult => ({ state });
const fail = (state: JamState, error: JamErrorCode): EngineResult => ({ state, error });

export function createRoom(
  o: { code: string; adminId: string; adminName: string; transferAdmin: boolean; mode?: JamMode },
  nowMs: number,
): JamState {
  return {
    code: o.code,
    mode: o.mode ?? 'admin-only',
    adminId: o.adminId,
    adminLostAt: null,
    transferAdmin: o.transferAdmin,
    members: [{ id: o.adminId, name: o.adminName, connected: true, joinedAt: nowMs, lostAt: null, likesReceived: 0 }],
    queue: [],
    now: null,
    failures: 0,
    halted: false,
    closed: false,
    seq: 0,
    serverTime: nowMs,
  };
}

export const connectedCount = (s: JamState): number => s.members.filter((m) => m.connected).length;

/** Votos de miembros conectados que hacen falta para saltar: más de la mitad. */
export const skipThreshold = (s: JamState): number => Math.floor(connectedCount(s) / 2) + 1;

const oldestConnected = (members: JamMember[]): JamMember | undefined =>
  members.filter((m) => m.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];

const makeNow = (item: JamItem): JamNow => ({ item, status: 'loading', anchorMs: null, pausedAtSec: 0, skipVotes: [], likes: [] });

/** Toma el primer ítem de la cola como canción actual (o deja la sala ociosa). */
function advance(s: JamState): JamState {
  const [next, ...rest] = s.queue;
  return { ...s, queue: rest, now: next ? makeNow(next) : null };
}

/** Salta la canción si los votos de miembros conectados alcanzan el umbral (se llama cada vez que cambia el quórum). */
function evalSkip(s: JamState): JamState {
  if (!s.now) return s;
  const connected = new Set(s.members.filter((m) => m.connected).map((m) => m.id));
  const votes = s.now.skipVotes.filter((id) => connected.has(id)).length;
  return votes >= skipThreshold(s) ? advance(s) : s;
}

function removeMember(s: JamState, id: string): JamState {
  const members = s.members.filter((m) => m.id !== id);
  let next: JamState = { ...s, members, now: s.now ? { ...s.now, skipVotes: s.now.skipVotes.filter((v) => v !== id) } : null };
  if (id === s.adminId) {
    const heir = s.transferAdmin ? oldestConnected(members) : undefined;
    next = heir ? { ...next, adminId: heir.id, adminLostAt: null } : { ...next, closed: true };
  }
  return next;
}

function onJoin(s: JamState, memberId: string, name: string, nowMs: number): EngineResult {
  if (s.closed) return fail(s, 'closed');
  const existing = s.members.some((m) => m.id === memberId);
  if (!existing && s.members.length >= LIMITS.members) return fail(s, 'room_full');
  const members = existing
    ? s.members.map((m) => (m.id === memberId ? { ...m, name, connected: true, lostAt: null } : m))
    : [...s.members, { id: memberId, name, connected: true, joinedAt: nowMs, lostAt: null, likesReceived: 0 }];
  return ok({ ...s, members, adminLostAt: memberId === s.adminId ? null : s.adminLostAt });
}

function onDisconnect(s: JamState, id: string, nowMs: number): JamState {
  const m = s.members.find((x) => x.id === id);
  if (!m || !m.connected) return s;
  let next: JamState = { ...s, members: s.members.map((x) => (x.id === id ? { ...x, connected: false, lostAt: nowMs } : x)) };
  if (id === s.adminId) {
    next = { ...next, adminLostAt: nowMs };
    // Sin admin no hay reloj de referencia: la canción queda congelada hasta que vuelva o se traspase el rol.
    if (next.now?.status === 'playing') next = { ...next, now: { ...next.now, status: 'paused', pausedAtSec: positionAt(next.now, nowMs) } };
  }
  return evalSkip(next);
}

/** Vencimientos: gracia del admin y miembros desconectados desde hace demasiado. Devuelve el mismo objeto si no hay nada que hacer. */
function onTick(s: JamState, nowMs: number): JamState {
  if (s.closed) return s;
  let next = s;
  if (next.adminLostAt !== null && nowMs - next.adminLostAt >= LIMITS.adminGraceMs) {
    if (!next.transferAdmin) return { ...next, closed: true };
    const heir = oldestConnected(next.members);
    if (heir) next = { ...next, adminId: heir.id, adminLostAt: null };
  }
  const stale = next.members.filter((m) => !m.connected && m.id !== next.adminId && m.lostAt !== null && nowMs - m.lostAt >= LIMITS.memberGraceMs);
  if (stale.length) next = evalSkip({ ...next, members: next.members.filter((m) => !stale.includes(m)) });
  return next;
}

function queueAdd(s: JamState, from: string, m: Extract<EngineMsg, { t: 'queue.add' }>, nowMs: number): EngineResult {
  const at = m.at ?? 'end';
  if (at !== 'end' && from !== s.adminId) return fail(s, 'forbidden');
  const id = m.track.id;
  if (s.now?.item.track.id === id || s.queue.some((i) => i.track.id === id)) return fail(s, 'duplicate');
  if (s.queue.length >= LIMITS.queue) return fail(s, 'queue_full');
  const seq = s.seq + 1;
  const item: JamItem = { itemId: `i${seq}`, track: m.track, addedBy: from, addedAt: nowMs };
  if (at === 'now') return ok({ ...s, seq, now: makeNow(item), halted: false, failures: 0 });
  if (s.now === null && !s.halted) return ok({ ...s, seq, now: makeNow(item) });
  return ok({ ...s, seq, queue: at === 'next' ? [item, ...s.queue] : [...s.queue, item] });
}

function transport(s: JamState, m: Extract<EngineMsg, { t: 'transport' }>, nowMs: number): EngineResult {
  if (m.action === 'next') return ok(advance({ ...s, halted: false, failures: 0 }));
  const now = s.now;
  if (!now || now.status === 'loading') return fail(s, 'bad_request');
  switch (m.action) {
    case 'pause':
      return now.status === 'paused' ? ok(s) : ok({ ...s, now: { ...now, status: 'paused', pausedAtSec: positionAt(now, nowMs) } });
    case 'play':
      return now.status === 'playing' ? ok(s) : ok({ ...s, now: { ...now, status: 'playing', anchorMs: nowMs - now.pausedAtSec * 1000 } });
    case 'seek': {
      const to = m.positionSec ?? 0;
      return ok({ ...s, now: now.status === 'paused' ? { ...now, pausedAtSec: to } : { ...now, anchorMs: nowMs - to * 1000 } });
    }
  }
}

function voteSkip(s: JamState, from: string, admin: boolean): EngineResult {
  if (!s.now) return fail(s, 'not_found');
  if (admin || from === s.now.item.addedBy) return ok(advance(s));
  if (s.now.skipVotes.includes(from)) return ok(s);
  return ok(evalSkip({ ...s, now: { ...s.now, skipVotes: [...s.now.skipVotes, from] } }));
}

function toggleLike(s: JamState, from: string): EngineResult {
  const now = s.now;
  if (!now) return fail(s, 'not_found');
  const had = now.likes.includes(from);
  const likes = had ? now.likes.filter((id) => id !== from) : [...now.likes, from];
  const members = s.members.map((m) => (m.id === now.item.addedBy ? { ...m, likesReceived: Math.max(0, m.likesReceived + (had ? -1 : 1)) } : m));
  return ok({ ...s, members, now: { ...now, likes } });
}

function onMsg(s: JamState, from: string, m: EngineMsg, nowMs: number): EngineResult {
  if (s.closed) return fail(s, 'closed');
  if (!s.members.some((x) => x.id === from)) return fail(s, 'forbidden');
  const admin = from === s.adminId;
  const adminOnly = (f: () => EngineResult): EngineResult => (admin ? f() : fail(s, 'forbidden'));

  switch (m.t) {
    case 'leave':
      return ok(evalSkip(removeMember(s, from)));
    case 'close':
      return adminOnly(() => ok({ ...s, closed: true }));
    case 'mode.set':
      return adminOnly(() => ok({ ...s, mode: m.mode }));
    case 'queue.add':
      return queueAdd(s, from, m, nowMs);
    case 'queue.remove': {
      const item = s.queue.find((i) => i.itemId === m.itemId);
      if (!item) return fail(s, 'not_found');
      if (!admin && item.addedBy !== from) return fail(s, 'forbidden');
      return ok({ ...s, queue: s.queue.filter((i) => i.itemId !== m.itemId) });
    }
    case 'queue.move':
      return adminOnly(() => {
        const at = s.queue.findIndex((i) => i.itemId === m.itemId);
        if (at < 0) return fail(s, 'not_found');
        const queue = [...s.queue];
        const [item] = queue.splice(at, 1);
        queue.splice(Math.min(Math.max(m.toIndex, 0), queue.length), 0, item!);
        return ok({ ...s, queue });
      });
    case 'queue.playNext':
      return adminOnly(() => {
        const item = s.queue.find((i) => i.itemId === m.itemId);
        if (!item) return fail(s, 'not_found');
        return ok({ ...s, queue: [item, ...s.queue.filter((i) => i.itemId !== m.itemId)] });
      });
    case 'queue.playNow':
      return adminOnly(() => {
        const item = s.queue.find((i) => i.itemId === m.itemId);
        if (!item) return fail(s, 'not_found');
        return ok({ ...s, queue: s.queue.filter((i) => i.itemId !== m.itemId), now: makeNow(item), halted: false, failures: 0 });
      });
    case 'playing':
      return adminOnly(() => {
        // Un aviso de otra canción (tardío o repetido) no cambia nada.
        if (!s.now || s.now.item.itemId !== m.itemId) return ok(s);
        return ok({ ...s, failures: 0, now: { ...s.now, status: 'playing', anchorMs: nowMs - m.positionSec * 1000, pausedAtSec: 0 } });
      });
    case 'ended':
      return adminOnly(() => (s.now?.item.itemId === m.itemId ? ok(advance({ ...s, failures: 0 })) : ok(s)));
    case 'unavailable':
      return adminOnly(() => {
        if (s.now?.item.itemId !== m.itemId) return ok(s);
        const failures = s.failures + 1;
        return failures >= LIMITS.maxFailures ? ok({ ...s, failures, halted: true, now: null }) : ok(advance({ ...s, failures }));
      });
    case 'transport':
      return adminOnly(() => transport(s, m, nowMs));
    case 'vote.skip':
      return voteSkip(s, from, admin);
    case 'like.toggle':
      return toggleLike(s, from);
  }
}

export function reduce(s: JamState, ev: EngineEvent, nowMs: number): EngineResult {
  switch (ev.type) {
    case 'join':
      return onJoin(s, ev.memberId, ev.name, nowMs);
    case 'disconnect':
      return ok(onDisconnect(s, ev.memberId, nowMs));
    case 'msg':
      return onMsg(s, ev.from, ev.msg, nowMs);
    case 'tick':
      return ok(onTick(s, nowMs));
  }
}
