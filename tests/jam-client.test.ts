import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoom } from '../src/shared/jam/engine';
import { JamClient, type JamClientOpts, type JamConnStatus } from '../src/main/jam/client';
import { startNodeHost, type NodeHost } from '../src/main/jam/node-host';
import type { JamErrorCode, JamState } from '../src/shared/jam/types';
import type { Track } from '../src/shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = (n: number): Track => ({ id: `vid-${n}-xxxxx`, title: `Tema ${n}`, artists: [{ name: 'Artista' }] });
const ADMIN = 'admin-00001';
const MARA = 'u-mara-0001';

const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(15);
  }
  throw new Error('tiempo agotado');
};

const hosts: NodeHost[] = [];
const clients: JamClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const h of hosts.splice(0)) await h.stop();
});
const host = async () => {
  const h = await startNodeHost({ port: 0, bindHost: '127.0.0.1', rooms: 'single', singleCode: 'K7M2P', transferAdmin: false });
  hosts.push(h);
  return h;
};

function make(h: { port: number }, o: Partial<JamClientOpts> & { memberId: string; name: string; create: boolean }) {
  const statuses: [JamConnStatus, JamErrorCode | undefined][] = [];
  const states: JamState[] = [];
  const errors: JamErrorCode[] = [];
  const client = new JamClient(
    { url: `ws://127.0.0.1:${h.port}/K7M2P`, ...o },
    { onState: (s) => states.push(s), onStatus: (s, r) => statuses.push([s, r]), onError: (c) => errors.push(c) },
  );
  clients.push(client);
  return { client, statuses, states, errors, last: () => states.at(-1), status: () => statuses.at(-1)?.[0] };
}

describe('JamClient', () => {
  it('crea la sala, conecta y estima el desfase del reloj local', async () => {
    const h = await host();
    const a = make(h, { memberId: ADMIN, name: 'Ana', create: true, now: () => Date.now() + 5000 });
    await until(() => a.status() === 'connected');
    expect(a.last()?.adminId).toBe(ADMIN);
    await until(() => Math.abs(a.client.offsetMs + 5000) < 300);
  });

  it('se reconecta solo tras un corte, sin duplicar al miembro', async () => {
    const h = await host();
    const a = make(h, { memberId: ADMIN, name: 'Ana', create: true });
    await until(() => a.status() === 'connected');
    h.dropConnections();
    await until(() => a.statuses.some(([s]) => s === 'reconnecting'));
    await until(() => a.status() === 'connected', 5000);
    expect(a.last()?.members).toHaveLength(1);
    expect(a.last()?.members[0]).toMatchObject({ id: ADMIN, connected: true });
  });

  it('unirse a una sala que no existe termina con no_room', async () => {
    const h = await host();
    const a = make(h, { memberId: MARA, name: 'Mara', create: false });
    await until(() => a.status() === 'ended');
    expect(a.statuses.at(-1)).toEqual(['ended', 'no_room']);
  });

  it('un protocolo distinto termina con protocol', async () => {
    const h = await host();
    make(h, { memberId: ADMIN, name: 'Ana', create: true });
    const m = make(h, { memberId: MARA, name: 'Mara', create: false, protocol: 2 });
    await until(() => m.status() === 'ended');
    expect(m.statuses.at(-1)).toEqual(['ended', 'protocol']);
  });

  it('leave quita al miembro de la sala y termina el cliente', async () => {
    const h = await host();
    const a = make(h, { memberId: ADMIN, name: 'Ana', create: true });
    await until(() => a.status() === 'connected');
    const m = make(h, { memberId: MARA, name: 'Mara', create: false });
    await until(() => m.status() === 'connected');
    await until(() => a.last()?.members.length === 2);
    m.client.leave();
    await until(() => a.last()?.members.length === 1);
    expect(m.status()).toBe('ended');
  });

  it('los errores que no terminan la sesión llegan por onError', async () => {
    const h = await host();
    const a = make(h, { memberId: ADMIN, name: 'Ana', create: true });
    await until(() => a.status() === 'connected');
    a.client.send({ t: 'queue.add', track: T(1) });
    a.client.send({ t: 'queue.add', track: T(1) });
    await until(() => a.errors.length > 0);
    expect(a.errors).toEqual(['duplicate']);
    expect(a.status()).toBe('connected');
  });

  it('si nunca logró conectar, termina sin motivo en vez de reintentar para siempre', async () => {
    const a = make({ port: 1 }, { memberId: ADMIN, name: 'Ana', create: true });
    await until(() => a.status() === 'ended', 5000);
    expect(a.statuses.at(-1)).toEqual(['ended', undefined]);
  });

  it('si el servidor deja de contestar, detecta la conexión muerta y reintenta (Important del revisor)', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => wss.once('listening', () => r()));
    // Saluda una vez y después calla: no contesta ni los ping.
    wss.on('connection', (ws) =>
      ws.on('message', (raw) => {
        if (JSON.parse(String(raw)).t === 'hello') {
          ws.send(JSON.stringify({ t: 'state', state: createRoom({ code: 'K7M2P', adminId: ADMIN, adminName: 'Ana', transferAdmin: false }, 0) }));
        }
      }),
    );
    try {
      const a = make({ port: (wss.address() as AddressInfo).port }, { memberId: ADMIN, name: 'Ana', create: true, silentMs: 300 });
      await until(() => a.status() === 'connected');
      await until(() => a.statuses.some(([s]) => s === 'reconnecting'), 4000);
    } finally {
      wss.close();
    }
  });
});
