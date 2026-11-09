import { afterEach, describe, expect, it } from 'vitest';
import { createJamSession } from '../src/main/jam/session';
import type { JamView } from '../src/shared/jam/types';
import type { Track } from '../src/shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = (n: number): Track => ({ id: `vid-${n}-xxxxx`, title: `Tema ${n}`, artists: [{ name: 'Artista' }] });

const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(15);
  }
  throw new Error('tiempo agotado');
};

const sessions: ReturnType<typeof createJamSession>[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.leave();
});

function make(settings = new Map<string, unknown>(), relayUrl = 'ws://127.0.0.1:1') {
  const views: JamView[] = [];
  const session = createJamSession({
    settings: {
      get: <V>(k: string) => (settings.has(k) ? (settings.get(k) as V) : null),
      set: (k, v) => void settings.set(k, v),
    },
    relayUrl,
    emit: (v) => views.push(v),
  });
  sessions.push(session);
  return { session, settings, views };
}

/** El invite usa la IP de la LAN; en pruebas se conecta por loopback para no depender de la red. */
const loopback = (invite: string) => invite.replace(/^[^:]+/, '127.0.0.1');

describe('createJamSession', () => {
  it('crea una sala local, guarda la identidad y la reutiliza en otra sesión', async () => {
    const a = make();
    const v = await a.session.create({ kind: 'local', name: 'Ana' });
    expect(v.status).toBe('connected');
    expect(v.state?.adminId).toBe(v.selfId);
    expect(v.invite).toMatch(/^\d+\.\d+\.\d+\.\d+:\d+\/[2-9A-HJKMNP-Z]{5}$/);
    expect(a.settings.get('jam_member_id')).toBe(v.selfId);
    expect(a.settings.get('jam_name')).toBe('Ana');
    expect(make(a.settings).session.view().selfId).toBe(v.selfId);
  });

  it('un miembro se une con la invitación y ve al admin; si el admin sale, la sala local termina', async () => {
    const a = make();
    const created = await a.session.create({ kind: 'local', name: 'Ana' });
    const b = make();
    const joined = await b.session.join({ invite: loopback(created.invite!), name: 'Mara' });
    expect(joined.state?.members).toHaveLength(2);
    await until(() => a.session.view().state?.members.length === 2);
    await a.session.leave();
    await until(() => b.session.view().status === 'ended');
    expect(b.session.view().reason).toBe('closed');
  });

  it('quien copia el id del admin pero no tiene su clave no entra a la sala', async () => {
    const a = make();
    const created = await a.session.create({ kind: 'local', name: 'Ana' });
    const intruso = make(new Map<string, unknown>([['jam_member_id', created.selfId]]));
    await expect(intruso.session.join({ invite: loopback(created.invite!), name: 'Intruso' })).rejects.toThrow();
    expect(a.session.view().status).toBe('connected');
    expect(a.session.view().state?.adminId).toBe(created.selfId);
  });

  it('la misma identidad guardada (id y clave) sí vuelve a entrar', async () => {
    const a = make();
    const created = await a.session.create({ kind: 'local', name: 'Ana' });
    const vuelta = await make(a.settings).session.join({ invite: loopback(created.invite!), name: 'Ana' });
    expect(vuelta.status).toBe('connected');
    expect(vuelta.state?.adminId).toBe(created.selfId);
  });

  it('rechaza invitaciones inválidas y un relé inalcanzable con mensajes claros', async () => {
    const a = make();
    await expect(a.session.join({ invite: 'xx', name: 'Mara' })).rejects.toThrow('La invitación no es válida. Revisá el código o la dirección.');
    await expect(a.session.create({ kind: 'internet', name: 'Ana' })).rejects.toThrow(/^No se pudo conectar/);
    await expect(a.session.create({ kind: 'local', name: '' })).rejects.toThrow('Escribí un nombre');
  });

  it('send ignora hello y mensajes inventados; mode.set del admin cambia la sala y se recuerda', async () => {
    const a = make();
    await a.session.create({ kind: 'local', name: 'Ana' });
    a.session.send({ t: 'hello', protocol: 1, memberId: 'otro-id-0001', name: 'X' });
    a.session.send({ t: 'nope' });
    a.session.send('basura');
    a.session.send({ t: 'mode.set', mode: 'everyone' });
    await until(() => a.session.view().state?.mode === 'everyone');
    expect(a.session.view().state?.members).toHaveLength(1);
    expect(a.settings.get('jam_last_mode')).toBe('everyone');

    const b = make(a.settings);
    const v = await b.session.create({ kind: 'local', name: 'Ana' });
    await until(() => b.session.view().state?.mode === 'everyone');
    expect(v.kind).toBe('local');
  });

  it('un error que no termina la sesión llega en view.error con un contador', async () => {
    const a = make();
    await a.session.create({ kind: 'local', name: 'Ana' });
    a.session.send({ t: 'queue.add', track: T(1) });
    a.session.send({ t: 'queue.add', track: T(1) });
    await until(() => a.session.view().error?.code === 'duplicate');
    expect(a.session.view().error?.n).toBe(1);
  });

  it('al cerrar la app un miembro queda desconectado (no sale) y vuelve con la misma identidad', async () => {
    const a = make();
    const created = await a.session.create({ kind: 'local', name: 'Ana' });
    const b = make();
    await b.session.join({ invite: loopback(created.invite!), name: 'Mara' });
    await until(() => a.session.view().state?.members.length === 2);
    await b.session.leave({ quit: true });
    await until(() => a.session.view().state?.members.find((m) => m.name === 'Mara')?.connected === false);
    expect(a.session.view().state?.members).toHaveLength(2);

    const again = make(b.settings);
    await again.session.join({ invite: loopback(created.invite!), name: 'Mara' });
    await until(() => a.session.view().state?.members.find((m) => m.name === 'Mara')?.connected === true);
    expect(a.session.view().state?.members).toHaveLength(2);
  });

  it('leave deja la sesión ociosa y sin estado', async () => {
    const a = make();
    await a.session.create({ kind: 'local', name: 'Ana' });
    await a.session.leave();
    expect(a.session.view()).toMatchObject({ status: 'idle', state: null, invite: null, kind: null });
  });
});
