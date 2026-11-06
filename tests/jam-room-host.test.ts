import { describe, expect, it } from 'vitest';
import { RoomHost, type Conn } from '../src/shared/jam/room-host';
import { LIMITS, type JamState, type ServerMsg } from '../src/shared/jam/types';
import type { Track } from '../src/shared/types';

class FakeConn implements Conn {
  sent: ServerMsg[] = [];
  closes = 0;
  send(data: string) {
    this.sent.push(JSON.parse(data) as ServerMsg);
  }
  close() {
    this.closes++;
  }
  get closed() {
    return this.closes > 0;
  }
  states() {
    return this.sent.flatMap((m) => (m.t === 'state' ? [m.state] : []));
  }
  last(): JamState {
    return this.states().at(-1)!;
  }
  errors() {
    return this.sent.flatMap((m) => (m.t === 'error' ? [m.code] : []));
  }
}

const ADMIN = 'admin-00001';
const MARA = 'u-mara-0001';
const T = (n: number): Track => ({ id: `vid-${n}-xxxxx`, title: `Tema ${n}`, artists: [{ name: 'Artista' }] });
const hello = (memberId: string, name: string, extra: object = {}) => JSON.stringify({ t: 'hello', protocol: 1, memberId, name, ...extra });
const add = (n: number) => JSON.stringify({ t: 'queue.add', track: T(n) });

function setup() {
  let t = 1000;
  const host = new RoomHost({ code: 'K7M2P', transferAdmin: true, now: () => t });
  const advance = (ms: number) => (t += ms);
  const admin = new FakeConn();
  const sAdmin = host.connect(admin);
  sAdmin.receive(hello(ADMIN, 'Ana', { create: true }));
  const joinMara = () => {
    const c = new FakeConn();
    const s = host.connect(c);
    s.receive(hello(MARA, 'Mara'));
    return { c, s };
  };
  return { host, advance, admin, sAdmin, joinMara, time: () => t };
}

describe('hello', () => {
  it('el primer create crea la sala y quien llama queda como admin', () => {
    const { admin, host } = setup();
    expect(host.created).toBe(true);
    expect(admin.last()).toMatchObject({ code: 'K7M2P', adminId: ADMIN });
  });

  it('un segundo create recibe code_taken y se cierra', () => {
    const { host } = setup();
    const c = new FakeConn();
    host.connect(c).receive(hello('otro-000001', 'Otro', { create: true }));
    expect(c.errors()).toEqual(['code_taken']);
    expect(c.closed).toBe(true);
  });

  it('unirse a una sala inexistente da no_room y cierra', () => {
    const host = new RoomHost({ code: 'K7M2P', transferAdmin: true });
    const c = new FakeConn();
    host.connect(c).receive(hello(MARA, 'Mara'));
    expect(c.errors()).toEqual(['no_room']);
    expect(c.closed).toBe(true);
  });

  it('un protocolo distinto da protocol y cierra', () => {
    const { host } = setup();
    const c = new FakeConn();
    host.connect(c).receive(JSON.stringify({ t: 'hello', protocol: 2, memberId: MARA, name: 'Mara' }));
    expect(c.errors()).toEqual(['protocol']);
    expect(c.closed).toBe(true);
  });

  it('cualquier mensaje antes de hello, salvo ping, da bad_request y cierra', () => {
    const { host } = setup();
    const c = new FakeConn();
    host.connect(c).receive(add(1));
    expect(c.errors()).toEqual(['bad_request']);
    expect(c.closed).toBe(true);
  });

  it('ping responde pong con el reloj de la sala, incluso antes de hello', () => {
    const { host, time } = setup();
    const c = new FakeConn();
    host.connect(c).receive(JSON.stringify({ t: 'ping', id: 7 }));
    expect(c.sent).toEqual([{ t: 'pong', id: 7, serverTime: time() }]);
    expect(c.closed).toBe(false);
  });
});

describe('conexiones y difusión', () => {
  it('un cambio aceptado llega a todos y un error solo al emisor', () => {
    const { admin, joinMara } = setup();
    const { c: mara, s } = joinMara();
    s.receive(add(1));
    expect(admin.last().now?.item.track.id).toBe(T(1).id);
    expect(mara.last().now?.item.track.id).toBe(T(1).id);
    const before = admin.sent.length;
    s.receive(add(1));
    expect(mara.errors()).toEqual(['duplicate']);
    expect(admin.sent.length).toBe(before);
  });

  it('el estado difundido lleva el reloj de la sala en serverTime', () => {
    const { admin, joinMara, advance } = setup();
    advance(500);
    joinMara();
    expect(admin.last().serverTime).toBe(1500);
  });

  it('la misma persona conectada dos veces deja un solo miembro y la conexión nueva reemplaza a la vieja (Review Focus 1)', () => {
    const { admin, joinMara } = setup();
    const { c: vieja } = joinMara();
    const enVieja = vieja.sent.length;
    const { c: nueva, s } = joinMara();
    expect(vieja.closed).toBe(true);
    expect(admin.last().members.map((m) => m.id)).toEqual([ADMIN, MARA]);
    expect(admin.last().members.find((m) => m.id === MARA)?.connected).toBe(true);
    s.receive(add(2));
    expect(nueva.last().now?.item.track.id).toBe(T(2).id);
    expect(vieja.sent.length).toBe(enVieja);
  });

  it('cerrar el socket marca al miembro como desconectado y lo difunde', () => {
    const { admin, joinMara } = setup();
    const { s } = joinMara();
    s.closed();
    expect(admin.last().members.find((m) => m.id === MARA)?.connected).toBe(false);
  });

  it('leave quita al miembro y cierra su conexión', () => {
    const { admin, joinMara } = setup();
    const { c, s } = joinMara();
    s.receive(JSON.stringify({ t: 'leave' }));
    expect(c.closed).toBe(true);
    expect(admin.last().members.map((m) => m.id)).toEqual([ADMIN]);
  });

  it('close del admin difunde el estado final y corta todas las conexiones', () => {
    const { admin, sAdmin, joinMara, host } = setup();
    const { c } = joinMara();
    sAdmin.receive(JSON.stringify({ t: 'close' }));
    expect(c.last().closed).toBe(true);
    expect(c.closed && admin.closed).toBe(true);
    expect(host.expired).toBe(true);
  });
});

describe('límites', () => {
  it('más de 30 mensajes en 1 s dan rate_limited y cierran', () => {
    const { host } = setup();
    const c = new FakeConn();
    const s = host.connect(c);
    for (let i = 0; i < LIMITS.msgPerSec + 1; i++) s.receive(JSON.stringify({ t: 'ping', id: i }));
    expect(c.errors()).toEqual(['rate_limited']);
    expect(c.closed).toBe(true);
  });

  it('20 mensajes inválidos cortan la conexión; 19 no', () => {
    const { host } = setup();
    const c = new FakeConn();
    const s = host.connect(c);
    for (let i = 0; i < LIMITS.maxInvalid - 1; i++) s.receive('basura');
    expect(c.closed).toBe(false);
    s.receive('basura');
    expect(c.closed).toBe(true);
  });
});

describe('vencimientos', () => {
  it('sweep traspasa el rol cuando vence la gracia del admin', () => {
    const { sAdmin, joinMara, advance, host } = setup();
    const { c } = joinMara();
    sAdmin.closed();
    advance(LIMITS.adminGraceMs);
    host.sweep();
    expect(c.last().adminId).toBe(MARA);
  });

  it('expira por inactividad (6 h) y una sala nunca creada expira a los 60 s', () => {
    const { host, advance } = setup();
    advance(LIMITS.idleMs - 1);
    expect(host.expired).toBe(false);
    advance(1);
    expect(host.expired).toBe(true);

    let t = 0;
    const vacia = new RoomHost({ code: 'AAAAA', transferAdmin: true, now: () => t });
    t = 59_999;
    expect(vacia.expired).toBe(false);
    t = 60_000;
    expect(vacia.expired).toBe(true);
  });
});

describe('conexiones muertas (Important del revisor)', () => {
  it('sweep corta a quien lleva más de 75 s callado y lo marca como desconectado', () => {
    const { host, advance, admin, sAdmin, joinMara } = setup();
    const { c: mara } = joinMara();
    advance(40_000);
    sAdmin.receive(JSON.stringify({ t: 'ping', id: 1 }));
    advance(40_000); // Mara lleva 80 s sin hablar; el admin, 40 s
    host.sweep();
    expect(mara.closed).toBe(true);
    expect(admin.closed).toBe(false);
    expect(admin.last().members.find((m) => m.id === MARA)?.connected).toBe(false);
  });
});
