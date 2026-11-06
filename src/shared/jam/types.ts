import type { Track } from '../types';

/** Versión del protocolo: una sala rechaza a quien hable otra. */
export const PROTOCOL = 1;

export const LIMITS = {
  members: 30,
  queue: 200,
  /** Largo máximo del nombre visible. */
  name: 24,
  adminGraceMs: 60_000,
  memberGraceMs: 600_000,
  /** Una sala sin actividad durante este tiempo se descarta (6 h). */
  idleMs: 21_600_000,
  /** Canciones "no disponibles" seguidas antes de detener la sala. */
  maxFailures: 3,
  msgPerSec: 30,
  maxMsgBytes: 8192,
  /** Mensajes inválidos que se toleran por conexión antes de cortarla. */
  maxInvalid: 20,
} as const;

/** admin-only: suena solo en la PC del admin · everyone: suena sincronizado en todas. */
export type JamMode = 'admin-only' | 'everyone';

export interface JamMember {
  id: string;
  name: string;
  connected: boolean;
  joinedAt: number;
  /** Instante en que se desconectó (null si está conectado). */
  lostAt: number | null;
  /** Likes recibidos por las canciones que pidió. */
  likesReceived: number;
}

export interface JamItem {
  itemId: string;
  track: Track;
  addedBy: string;
  addedAt: number;
}

export interface JamNow {
  item: JamItem;
  status: 'loading' | 'playing' | 'paused';
  /** Instante de la sala en que la posición 0 habría ocurrido (null hasta que el admin informa que suena). */
  anchorMs: number | null;
  pausedAtSec: number;
  skipVotes: string[];
  likes: string[];
}

export interface JamState {
  code: string;
  mode: JamMode;
  adminId: string;
  adminLostAt: number | null;
  /** true: si el admin se va, el rol pasa a otro (relé). false: la sala termina (host local). */
  transferAdmin: boolean;
  members: JamMember[];
  queue: JamItem[];
  now: JamNow | null;
  /** Canciones "no disponibles" seguidas. */
  failures: number;
  /** Tras demasiados fallos seguidos: sin canción actual hasta que el admin actúe. */
  halted: boolean;
  closed: boolean;
  /** Contador para generar `itemId` de forma determinista. */
  seq: number;
  /** Reloj de la sala en el momento de enviar este estado. */
  serverTime: number;
}

export type JamErrorCode =
  | 'bad_request'
  | 'protocol'
  | 'room_full'
  | 'queue_full'
  | 'duplicate'
  | 'forbidden'
  | 'not_found'
  | 'no_room'
  | 'code_taken'
  | 'closed'
  | 'rate_limited';

export type ClientMsg =
  | { t: 'hello'; protocol: number; memberId: string; name: string; create?: boolean }
  | { t: 'queue.add'; track: Track; at?: 'end' | 'next' | 'now' }
  | { t: 'queue.remove'; itemId: string }
  | { t: 'queue.move'; itemId: string; toIndex: number }
  | { t: 'queue.playNext'; itemId: string }
  | { t: 'queue.playNow'; itemId: string }
  | { t: 'vote.skip' }
  | { t: 'like.toggle' }
  | { t: 'mode.set'; mode: JamMode }
  | { t: 'transport'; action: 'play' | 'pause' | 'next' | 'seek'; positionSec?: number }
  | { t: 'playing'; itemId: string; positionSec: number }
  | { t: 'ended'; itemId: string }
  | { t: 'unavailable'; itemId: string }
  | { t: 'ping'; id: number }
  | { t: 'leave' }
  | { t: 'close' };

export type ServerMsg =
  | { t: 'state'; state: JamState }
  | { t: 'pong'; id: number; serverTime: number }
  | { t: 'error'; code: JamErrorCode };

export type JamConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'ended';

/** Lo que el renderer ve de la sala: su estado, más la conexión y la identidad propia. */
export interface JamView {
  status: 'idle' | JamConnStatus;
  /** Acompaña a `'ended'`: por qué terminó (sin motivo = no se pudo conectar o se perdió la conexión). */
  reason?: JamErrorCode;
  kind: 'local' | 'internet' | null;
  invite: string | null;
  selfId: string;
  name: string;
  /** Reloj de la sala menos reloj local, en ms. */
  offsetMs: number;
  state: JamState | null;
  /** Último error que no terminó la sesión; `n` crece con cada uno para que la interfaz avise cada vez. */
  error?: { code: JamErrorCode; n: number };
}
