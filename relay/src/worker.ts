/**
 * Relé del Jam en Cloudflare: un Worker que enruta `/<CODIGO>` a un Durable Object por sala, que corre el mismo
 * motor (`RoomHost`) que la app usa en red local. Usa WebSockets normales (sin hibernación): el estado vive en
 * memoria y si el objeto se evacúa la sala termina. Alcanza para una oficina; ver relay/README.md.
 */
import { isRoomCode } from '../../src/shared/jam/invite';
import { RoomHost } from '../../src/shared/jam/room-host';

interface Env {
  ROOMS: DurableObjectNamespace;
}

/** Cada cuánto el objeto revisa vencimientos (gracia del admin, miembros caídos, expiración). */
const SWEEP_MS = 15_000;

const codeOf = (req: Request) => new URL(req.url).pathname.replace(/^\//, '');

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const code = codeOf(req);
    if (!isRoomCode(code)) return new Response('Not Found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Upgrade Required', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
};

export class Room implements DurableObject {
  private host: RoomHost | null = null;

  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    this.host ??= new RoomHost({ code: codeOf(req), transferAdmin: true });
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const session = this.host.connect({ send: (data) => server.send(data), close: () => server.close() });
    server.addEventListener('message', (e) => typeof e.data === 'string' && session.receive(e.data));
    server.addEventListener('close', () => session.closed());
    server.addEventListener('error', () => session.closed());
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    if (!this.host) return;
    this.host.sweep();
    if (this.host.expired) {
      this.host = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}
