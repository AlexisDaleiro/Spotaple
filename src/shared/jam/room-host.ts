import { createRoom, reduce } from './engine';
import { encode, parseClientMsg } from './protocol';
import { LIMITS, PROTOCOL, type ClientMsg, type JamErrorCode, type JamState, type ServerMsg } from './types';

/** Una conexión abierta, sea cual sea el transporte (socket de `ws`, socket de un Durable Object, un falso de pruebas). */
export interface Conn {
  send(data: string): void;
  close(): void;
}

/** Lo que el transporte le avisa al host sobre una conexión. */
export interface Session {
  receive(raw: string): void;
  closed(): void;
}

interface Peer {
  conn: Conn;
  memberId: string | null;
  stamps: number[];
  invalid: number;
  dead: boolean;
}

/** Una sala nunca creada se descarta a los 60 s (evita acumular salas por códigos que nadie usó). */
const UNCREATED_TTL_MS = 60_000;

/**
 * Conexiones de UNA sala sobre el motor puro: saludo y versión, validación, límite de tasa, difusión del
 * estado completo y vencimientos. No sabe de sockets ni de relojes reales: todo entra por `Conn` y `now`.
 */
export class RoomHost {
  private state: JamState | null = null;
  private readonly peers = new Set<Peer>();
  private readonly now: () => number;
  private readonly bornAt: number;
  private lastActivity: number;

  constructor(private readonly o: { code: string; transferAdmin: boolean; now?: () => number }) {
    this.now = o.now ?? Date.now;
    this.bornAt = this.lastActivity = this.now();
  }

  get created(): boolean {
    return this.state !== null;
  }

  get expired(): boolean {
    const t = this.now();
    if (!this.state) return t - this.bornAt >= UNCREATED_TTL_MS;
    return this.state.closed || t - this.lastActivity >= LIMITS.idleMs;
  }

  connect(conn: Conn): Session {
    const peer: Peer = { conn, memberId: null, stamps: [], invalid: 0, dead: false };
    this.peers.add(peer);
    return { receive: (raw) => this.receive(peer, raw), closed: () => this.kill(peer, true) };
  }

  /** Vencimientos (gracia del admin, miembros desconectados): el transporte lo llama cada pocos segundos. */
  sweep(): void {
    if (!this.state) return;
    const r = reduce(this.state, { type: 'tick' }, this.now());
    if (r.state !== this.state) this.commit(r.state);
  }

  private receive(peer: Peer, raw: string): void {
    if (peer.dead) return;
    const t = this.now();
    peer.stamps = peer.stamps.filter((x) => t - x < 1000);
    peer.stamps.push(t);
    if (peer.stamps.length > LIMITS.msgPerSec) return this.reject(peer, 'rate_limited');

    const msg = parseClientMsg(raw);
    if (!msg) {
      if (++peer.invalid >= LIMITS.maxInvalid) this.kill(peer, true);
      return;
    }
    this.lastActivity = t;

    if (msg.t === 'ping') return this.send(peer, { t: 'pong', id: msg.id, serverTime: t });
    if (msg.t === 'hello') return this.hello(peer, msg, t);
    if (!peer.memberId || !this.state) return this.reject(peer, 'bad_request');

    const r = reduce(this.state, { type: 'msg', from: peer.memberId, msg }, t);
    if (r.error) return this.send(peer, { t: 'error', code: r.error });
    this.commit(r.state);
    if (msg.t === 'leave') this.kill(peer, false);
  }

  private hello(peer: Peer, msg: Extract<ClientMsg, { t: 'hello' }>, t: number): void {
    if (peer.memberId) return;
    if (msg.protocol !== PROTOCOL) return this.reject(peer, 'protocol');

    if (msg.create) {
      if (this.state) return this.reject(peer, 'code_taken');
      peer.memberId = msg.memberId;
      return this.commit(createRoom({ code: this.o.code, adminId: msg.memberId, adminName: msg.name, transferAdmin: this.o.transferAdmin }, t));
    }

    if (!this.state) return this.reject(peer, 'no_room');
    const r = reduce(this.state, { type: 'join', memberId: msg.memberId, name: msg.name }, t);
    if (r.error) return this.reject(peer, r.error);
    // La misma persona reconectando antes de que caiga su socket viejo: la conexión nueva reemplaza a la vieja.
    for (const other of [...this.peers]) if (other !== peer && other.memberId === msg.memberId) this.kill(other, false);
    peer.memberId = msg.memberId;
    this.commit(r.state);
  }

  private send(peer: Peer, m: ServerMsg): void {
    try {
      peer.conn.send(encode(m));
    } catch {
      this.kill(peer, true);
    }
  }

  private reject(peer: Peer, code: JamErrorCode): void {
    this.send(peer, { t: 'error', code });
    this.kill(peer, true);
  }

  /** Guarda el estado nuevo y lo envía completo a todos los que ya saludaron. Una sala cerrada corta todas las conexiones. */
  private commit(next: JamState): void {
    this.state = next;
    const data = encode({ t: 'state', state: { ...next, serverTime: this.now() } });
    for (const p of [...this.peers]) {
      if (!p.memberId) continue;
      try {
        p.conn.send(data);
      } catch {
        this.kill(p, true);
      }
    }
    if (next.closed) for (const p of [...this.peers]) this.kill(p, false);
  }

  /** `notify`: avisar al motor de que el miembro se desconectó (falso cuando ya salió o lo reemplazó otra conexión). */
  private kill(peer: Peer, notify: boolean): void {
    if (peer.dead) return;
    peer.dead = true;
    this.peers.delete(peer);
    try {
      peer.conn.close();
    } catch {
      /* el socket ya estaba cerrado */
    }
    if (notify && peer.memberId && this.state) {
      const r = reduce(this.state, { type: 'disconnect', memberId: peer.memberId }, this.now());
      if (r.state !== this.state) this.commit(r.state);
    }
  }
}
