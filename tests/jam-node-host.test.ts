import { afterEach, describe, expect, it } from 'vitest';
import { lanAddresses, startNodeHost, type NodeHost } from '../src/main/jam/node-host';
import type { ServerMsg } from '../src/shared/jam/types';
import type { Track } from '../src/shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = (n: number): Track => ({ id: `vid-${n}-xxxxx`, title: `Tema ${n}`, artists: [{ name: 'Artista' }] });
const ADMIN = 'admin-00001';
const MARA = 'u-mara-0001';

class Client {
  msgs: ServerMsg[] = [];
  ws: WebSocket;
  opened: Promise<void>;
  closedEvent = false;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => this.msgs.push(JSON.parse(String(e.data)) as ServerMsg);
    this.ws.onclose = () => (this.closedEvent = true);
    this.opened = new Promise<void>((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('no conectó'));
    });
    this.opened.catch(() => undefined);
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  hello(memberId: string, name: string, create = false) {
    this.send({ t: 'hello', protocol: 1, memberId, name, ...(create ? { create: true } : {}) });
  }
  async until(pred: (m: ServerMsg) => boolean, ms = 2000): Promise<ServerMsg> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = this.msgs.find(pred);
      if (found) return found;
      await sleep(10);
    }
    throw new Error(`tiempo agotado; mensajes: ${JSON.stringify(this.msgs).slice(0, 300)}`);
  }
}

const hosts: NodeHost[] = [];
const clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  for (const h of hosts.splice(0)) await h.stop();
});
const start = async (o: Parameters<typeof startNodeHost>[0]) => {
  const h = await startNodeHost(o);
  hosts.push(h);
  return h;
};
const connect = (url: string) => {
  const c = new Client(url);
  clients.push(c);
  return c;
};

describe('host de una sala (red local)', () => {
  it('acepta solo la ruta de su código y deja que Mara pida una canción al admin', async () => {
    const host = await start({ port: 0, bindHost: '127.0.0.1', rooms: 'single', singleCode: 'K7M2P', transferAdmin: false });
    const admin = connect(`ws://127.0.0.1:${host.port}/K7M2P`);
    await admin.opened;
    admin.hello(ADMIN, 'Ana', true);
    const first = await admin.until((m) => m.t === 'state');
    expect(first.t === 'state' && first.state.adminId).toBe(ADMIN);

    const intruso = connect(`ws://127.0.0.1:${host.port}/ZZZZZ`);
    await expect(intruso.opened).rejects.toThrow();

    const mara = connect(`ws://127.0.0.1:${host.port}/K7M2P`);
    await mara.opened;
    mara.hello(MARA, 'Mara');
    await mara.until((m) => m.t === 'state');
    mara.send({ t: 'queue.add', track: T(1) });
    const seen = await admin.until((m) => m.t === 'state' && m.state.now?.item.track.id === T(1).id, 1000);
    expect(seen.t).toBe('state');
  });
});

describe('host de varias salas (relé)', () => {
  it('mantiene las salas separadas y rechaza crear un código ocupado', async () => {
    const host = await start({ port: 0, bindHost: '127.0.0.1', rooms: 'multi', transferAdmin: true });
    const url = (code: string) => `ws://127.0.0.1:${host.port}/${code}`;
    const a = connect(url('AAAAA'));
    const b = connect(url('BBBBB'));
    await Promise.all([a.opened, b.opened]);
    a.hello(ADMIN, 'Ana', true);
    b.hello('admin-00002', 'Beto', true);
    await a.until((m) => m.t === 'state');
    await b.until((m) => m.t === 'state');
    a.send({ t: 'queue.add', track: T(1) });
    await a.until((m) => m.t === 'state' && m.state.now !== null);
    await sleep(100);
    const bStates = b.msgs.flatMap((m) => (m.t === 'state' ? [m.state] : []));
    expect(bStates.at(-1)?.now).toBeNull();

    const dup = connect(url('AAAAA'));
    await dup.opened;
    dup.hello('otro-000001', 'Otro', true);
    const err = await dup.until((m) => m.t === 'error');
    expect(err).toEqual({ t: 'error', code: 'code_taken' });
  });
});

describe('utilidades', () => {
  it('lanAddresses devuelve IPv4 que no son de loopback', () => {
    for (const ip of lanAddresses()) {
      expect(ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      expect(ip.startsWith('127.')).toBe(false);
    }
  });

  it('stop cierra los sockets abiertos y dropConnections los corta desde el servidor', async () => {
    const host = await start({ port: 0, bindHost: '127.0.0.1', rooms: 'multi', transferAdmin: true });
    const a = connect(`ws://127.0.0.1:${host.port}/AAAAA`);
    await a.opened;
    host.dropConnections();
    for (let i = 0; i < 50 && !a.closedEvent; i++) await sleep(20);
    expect(a.closedEvent).toBe(true);

    const b = connect(`ws://127.0.0.1:${host.port}/BBBBB`);
    await b.opened;
    await host.stop();
    hosts.pop();
    for (let i = 0; i < 50 && !b.closedEvent; i++) await sleep(20);
    expect(b.closedEvent).toBe(true);
  });
});
