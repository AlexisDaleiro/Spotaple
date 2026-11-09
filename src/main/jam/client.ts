import { estimateOffset, type ClockSample } from '../../shared/jam/clock';
import { encode } from '../../shared/jam/protocol';
import { PROTOCOL, type ClientMsg, type JamConnStatus, type JamErrorCode, type JamState, type ServerMsg } from '../../shared/jam/types';

export type { JamConnStatus };

export interface JamClientOpts {
  url: string;
  memberId: string;
  /** Secreto de este miembro en esta sala: con él se prueba que el `memberId` es suyo al reconectar. */
  key: string;
  name: string;
  /** Solo la primera conexión crea la sala; las reconexiones siempre se unen a la existente. */
  create: boolean;
  /** Solo pruebas: simula otra versión del protocolo. */
  protocol?: number;
  /** Solo pruebas: reloj local simulado. */
  now?: () => number;
  /** Solo pruebas: silencio del servidor tras el cual la conexión se da por muerta (45 s por defecto). */
  silentMs?: number;
}

export interface JamClientEvents {
  onState(s: JamState): void;
  /** `reason` acompaña a `'ended'`; sin motivo = no se pudo conectar o se perdió la conexión por completo. */
  onStatus(s: JamConnStatus, reason?: JamErrorCode): void;
  /** Errores que no terminan la sesión (por ejemplo `duplicate`). */
  onError?(code: JamErrorCode): void;
  /** Cada vez que se afina la estimación del reloj de la sala (ms, sala menos local). */
  onOffset?(offsetMs: number): void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
/** Tras tanto tiempo sin lograr reconectar se da la sesión por terminada. */
const GIVE_UP_MS = 120_000;
const SYNC_SAMPLES = 5;
const SYNC_GAP_MS = 150;
const RESYNC_MS = 30_000;
/** Si el servidor no dice nada en este tiempo la conexión se da por muerta (hay un ping cada 30 s). */
const SILENT_MS = 45_000;
/** Errores tras los cuales reintentar no sirve de nada. */
const FATAL: ReadonlySet<JamErrorCode> = new Set<JamErrorCode>(['no_room', 'protocol', 'code_taken', 'room_full', 'closed', 'forbidden']);

const isServerMsg = (m: unknown): m is ServerMsg => {
  const o = m as { t?: unknown; state?: { members?: unknown }; serverTime?: unknown; code?: unknown } | null;
  if (!o || typeof o !== 'object') return false;
  if (o.t === 'state') return !!o.state && Array.isArray(o.state.members);
  if (o.t === 'pong') return typeof o.serverTime === 'number';
  return o.t === 'error' && typeof o.code === 'string';
};

/**
 * Conexión de un miembro con una sala (local o de internet). Vive en el proceso main: el renderer no
 * toca la red. Reconecta solo, con espera creciente, y mantiene una estimación del reloj de la sala.
 */
export class JamClient {
  private ws: WebSocket | null = null;
  private status: JamConnStatus | null = null;
  private ended = false;
  private everConnected = false;
  private attempt = 0;
  private downSince: number | null = null;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private syncTimers: ReturnType<typeof setTimeout>[] = [];
  private resyncTimer?: ReturnType<typeof setInterval>;
  private watchdog?: ReturnType<typeof setInterval>;
  private lastHeard = 0;
  private samples: ClockSample[] = [];
  private readonly pending = new Map<number, number>();
  private pingSeq = 0;
  private offset = 0;
  private readonly clock: () => number;

  constructor(
    private readonly o: JamClientOpts,
    private readonly e: JamClientEvents,
  ) {
    this.clock = o.now ?? Date.now;
    this.open();
  }

  /** Reloj de la sala menos reloj local, en ms. */
  get offsetMs(): number {
    return this.offset;
  }

  send(m: Exclude<ClientMsg, { t: 'hello' }>): void {
    if (this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  /** Sale de la sala (el servidor quita al miembro) y termina el cliente. */
  leave(): void {
    this.send({ t: 'leave' });
    this.end();
  }

  /** Termina el cliente sin avisar a la sala: el servidor lo verá como una desconexión. */
  close(): void {
    this.end();
  }

  private setStatus(s: JamConnStatus, reason?: JamErrorCode): void {
    if (s === this.status && s !== 'ended') return;
    this.status = s;
    this.e.onStatus(s, reason);
  }

  private open(): void {
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.o.url);
    this.ws = ws;
    let gotState = false;

    ws.onopen = () => {
      const hello: ClientMsg = {
        t: 'hello',
        protocol: this.o.protocol ?? PROTOCOL,
        memberId: this.o.memberId,
        key: this.o.key,
        name: this.o.name,
        ...(this.o.create && !this.everConnected ? { create: true } : {}),
      };
      ws.send(encode(hello));
    };
    ws.onmessage = (ev) => {
      let m: unknown;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!isServerMsg(m)) return;
      this.lastHeard = Date.now();
      if (m.t === 'state') {
        if (!gotState) {
          gotState = true;
          this.onConnected();
        }
        this.e.onState(m.state);
        if (m.state.closed) this.end('closed');
      } else if (m.t === 'pong') {
        this.onPong(m.id, m.serverTime);
      } else if (FATAL.has(m.code)) {
        this.end(m.code);
      } else {
        this.e.onError?.(m.code);
      }
    };
    ws.onclose = () => {
      if (ws === this.ws) this.onDrop();
    };
    ws.onerror = () => undefined; // el cierre que sigue lo maneja onDrop
  }

  private onConnected(): void {
    this.everConnected = true;
    this.attempt = 0;
    this.downSince = null;
    this.setStatus('connected');
    this.runSync();
    this.resyncTimer ??= setInterval(() => this.runSync(), RESYNC_MS);
    const silent = this.o.silentMs ?? SILENT_MS;
    this.lastHeard = Date.now();
    this.watchdog ??= setInterval(() => this.checkAlive(silent), Math.max(50, Math.min(5000, silent / 3)));
  }

  private onDrop(): void {
    if (this.ended) return;
    this.stopSync();
    if (!this.everConnected) return this.end();
    this.downSince ??= Date.now();
    if (Date.now() - this.downSince > GIVE_UP_MS) return this.end();
    this.setStatus('reconnecting');
    const delay = BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)]!;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private runSync(): void {
    this.samples = [];
    for (const t of this.syncTimers) clearTimeout(t);
    this.syncTimers = Array.from({ length: SYNC_SAMPLES }, (_, i) => setTimeout(() => this.ping(), i * SYNC_GAP_MS));
  }

  private ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const id = ++this.pingSeq;
    this.pending.set(id, this.clock());
    this.ws.send(encode({ t: 'ping', id }));
  }

  private onPong(id: number, serverTime: number): void {
    const sentAt = this.pending.get(id);
    if (sentAt === undefined) return;
    this.pending.delete(id);
    this.samples.push({ sentAt, serverTime, receivedAt: this.clock() });
    this.offset = estimateOffset(this.samples);
    this.e.onOffset?.(this.offset);
  }

  /** Una conexión TCP medio abierta no avisa que murió: si el servidor calla demasiado se da por caída y se reintenta. */
  private checkAlive(silent: number): void {
    if (this.ended || Date.now() - this.lastHeard <= silent) return;
    const dead = this.ws;
    this.ws = null; // el `onclose` tardío del socket muerto ya no cuenta
    try {
      dead?.close();
    } catch {
      /* ya estaba cerrado */
    }
    this.onDrop();
  }

  private stopSync(): void {
    for (const t of this.syncTimers) clearTimeout(t);
    this.syncTimers = [];
    clearInterval(this.resyncTimer);
    this.resyncTimer = undefined;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
    this.pending.clear();
  }

  private end(reason?: JamErrorCode): void {
    if (this.ended) return;
    this.ended = true;
    this.stopSync();
    clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ya estaba cerrado */
    }
    this.setStatus('ended', reason);
  }
}
