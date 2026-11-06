import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JamClient, type JamConnStatus } from '../src/main/jam/client';
import { startNodeHost, type NodeHost } from '../src/main/jam/node-host';
import type { JamErrorCode, JamState } from '../src/shared/jam/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(15);
  }
  throw new Error('tiempo agotado');
};

const ADMIN = 'admin-00001';
const MARA = 'u-mara-0001';
const JUAN = 'u-juan-0001';

// Mismo servidor que usa el relé de internet: varias salas por código y el rol de admin se traspasa.
let host: NodeHost;
const clients: JamClient[] = [];
beforeEach(async () => {
  host = await startNodeHost({ port: 0, bindHost: '127.0.0.1', rooms: 'multi', transferAdmin: true });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await host.stop();
});

function member(code: string, memberId: string, name: string, create: boolean) {
  const states: JamState[] = [];
  const statuses: [JamConnStatus, JamErrorCode | undefined][] = [];
  const client = new JamClient(
    { url: `ws://127.0.0.1:${host.port}/${code}`, memberId, name, create },
    { onState: (s) => states.push(s), onStatus: (s, r) => statuses.push([s, r]) },
  );
  clients.push(client);
  return { client, last: () => states.at(-1), status: () => statuses.at(-1)?.[0], statuses };
}

describe('relé en Node (varias salas, traspaso de admin)', () => {
  it('si el admin sale, el miembro más antiguo queda como admin y la sala sigue', async () => {
    const a = member('AAAAA', ADMIN, 'Ana', true);
    await until(() => a.status() === 'connected');
    const mara = member('AAAAA', MARA, 'Mara', false);
    await until(() => mara.status() === 'connected');
    const juan = member('AAAAA', JUAN, 'Juan', false);
    await until(() => juan.last()?.members.length === 3);
    a.client.leave();
    await until(() => mara.last()?.adminId === MARA);
    expect(mara.last()?.closed).toBe(false);
    await until(() => juan.last()?.adminId === MARA);
  });

  it('unirse a un código que nadie creó termina con no_room', async () => {
    const m = member('BBBBB', MARA, 'Mara', false);
    await until(() => m.status() === 'ended');
    expect(m.statuses.at(-1)).toEqual(['ended', 'no_room']);
  });

  it('tras un corte, el admin recupera su rol dentro de la gracia', async () => {
    const a = member('AAAAA', ADMIN, 'Ana', true);
    await until(() => a.status() === 'connected');
    const mara = member('AAAAA', MARA, 'Mara', false);
    await until(() => mara.status() === 'connected');
    host.dropConnections();
    await until(() => a.statuses.some(([s]) => s === 'reconnecting'));
    await until(() => a.status() === 'connected' && mara.status() === 'connected', 8000);
    await until(() => mara.last()?.members.every((m) => m.connected) === true);
    expect(mara.last()?.adminId).toBe(ADMIN);
    expect(mara.last()?.adminLostAt).toBeNull();
  });
});
