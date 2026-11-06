import { sanitizeTrack } from '../track';
import { LIMITS, type ClientMsg, type ServerMsg } from './types';

const isItemId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
const isSec = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 86_400;

/** Nombre visible: recortado, de 1 a `LIMITS.name` caracteres y sin caracteres de control. */
export function sanitizeName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length < 1 || s.length > LIMITS.name || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

function build(o: Record<string, unknown>): ClientMsg | null {
  switch (o['t']) {
    case 'hello': {
      const name = sanitizeName(o['name']);
      const memberId = o['memberId'];
      if (!Number.isInteger(o['protocol']) || typeof memberId !== 'string' || !/^[\w-]{8,64}$/.test(memberId) || !name) return null;
      return { t: 'hello', protocol: o['protocol'] as number, memberId, name, ...(o['create'] === true ? { create: true } : {}) };
    }
    case 'queue.add': {
      const at = o['at'];
      if (at !== undefined && at !== 'end' && at !== 'next' && at !== 'now') return null;
      return { t: 'queue.add', track: sanitizeTrack(o['track']), ...(at ? { at } : {}) };
    }
    case 'queue.remove':
    case 'queue.playNext':
    case 'queue.playNow':
    case 'ended':
    case 'unavailable':
      return isItemId(o['itemId']) ? ({ t: o['t'], itemId: o['itemId'] } as ClientMsg) : null;
    case 'queue.move': {
      const to = o['toIndex'];
      return isItemId(o['itemId']) && Number.isInteger(to) && (to as number) >= 0 && (to as number) <= 1000
        ? { t: 'queue.move', itemId: o['itemId'], toIndex: to as number }
        : null;
    }
    case 'vote.skip':
    case 'like.toggle':
    case 'leave':
    case 'close':
      return { t: o['t'] };
    case 'mode.set':
      return o['mode'] === 'admin-only' || o['mode'] === 'everyone' ? { t: 'mode.set', mode: o['mode'] } : null;
    case 'transport': {
      const action = o['action'];
      const pos = o['positionSec'];
      if (action !== 'play' && action !== 'pause' && action !== 'next' && action !== 'seek') return null;
      if (pos !== undefined && !isSec(pos)) return null;
      if (action === 'seek' && pos === undefined) return null;
      return { t: 'transport', action, ...(pos !== undefined ? { positionSec: pos } : {}) };
    }
    case 'playing':
      return isItemId(o['itemId']) && isSec(o['positionSec']) ? { t: 'playing', itemId: o['itemId'], positionSec: o['positionSec'] } : null;
    case 'ping': {
      const id = o['id'];
      return Number.isInteger(id) && (id as number) >= 0 ? { t: 'ping', id: id as number } : null;
    }
    default:
      return null;
  }
}

/** Mensaje del cliente ya validado, o null si es JSON inválido, de más de `LIMITS.maxMsgBytes`, de tipo desconocido o con campos inválidos. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > LIMITS.maxMsgBytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  try {
    return build(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

export const encode = (m: ClientMsg | ServerMsg): string => JSON.stringify(m);
