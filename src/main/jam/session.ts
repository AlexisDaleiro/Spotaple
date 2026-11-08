import { randomUUID } from 'node:crypto';
import { jamErrorMessage } from '../../shared/jam/errors';
import { formatInvite, newRoomCode, parseInvite } from '../../shared/jam/invite';
import { parseClientMsg, sanitizeName } from '../../shared/jam/protocol';
import type { JamErrorCode, JamMode, JamView } from '../../shared/jam/types';
import { JamClient } from './client';
import { lanAddresses, startLocalHost, type NodeHost } from './node-host';

export interface JamSessionDeps {
  settings: { get<V>(key: string): V | null; set(key: string, value: unknown): void };
  relayUrl: string;
  /** Con relé propio, solo se crean salas de internet después de configurarlo. */
  hostRelayUrl?: () => string | null;
  /** Se llama con la vista completa cada vez que algo cambia. */
  emit(view: JamView): void;
  newId?: () => string;
  localAddress?: () => string;
}

export type JamSession = ReturnType<typeof createJamSession>;

/** Falló el intento de conectar; `reason` permite reintentar solo cuando el código ya estaba en uso. */
class StartError extends Error {
  constructor(
    message: string,
    readonly reason?: JamErrorCode,
  ) {
    super(message);
  }
}

const NEED_NAME = 'Escribí un nombre de hasta 24 caracteres.';

/**
 * La sala en la que está esta app (como mucho una): crea o se une, conserva la identidad en `settings`,
 * valida lo que manda el renderer y empuja la vista completa cada vez que cambia.
 */
export function createJamSession(d: JamSessionDeps) {
  const newId = d.newId ?? randomUUID;
  let client: JamClient | null = null;
  let host: NodeHost | null = null;
  /** Cada sala nueva o abandonada incrementa esto: los avisos de una sesión vieja se descartan. */
  let gen = 0;
  let errorN = 0;

  const memberId = (): string => {
    let id = d.settings.get<string>('jam_member_id');
    if (!id) {
      id = newId();
      d.settings.set('jam_member_id', id);
    }
    return id;
  };
  const idle = (): JamView => ({ status: 'idle', kind: null, invite: null, selfId: memberId(), name: d.settings.get<string>('jam_name') ?? '', offsetMs: 0, state: null });
  let view: JamView = idle();

  const push = (patch: Partial<JamView>) => {
    view = { ...view, ...patch };
    d.emit(view);
  };
  const stopHost = async () => {
    const h = host;
    host = null;
    await h?.stop();
  };

  /** Resuelve con la primera vista que ya trae el estado de la sala; rechaza si termina antes de conectar. */
  function start(o: { url: string; kind: 'local' | 'internet'; invite: string | null; name: string; create: boolean }): Promise<JamView> {
    const mine = ++gen;
    view = { status: 'connecting', kind: o.kind, invite: o.invite, selfId: memberId(), name: o.name, offsetMs: 0, state: null };
    d.emit(view);
    return new Promise<JamView>((resolve, reject) => {
      let settled = false;
      client = new JamClient(
        { url: o.url, memberId: view.selfId, name: o.name, create: o.create },
        {
          onState: (state) => {
            if (mine !== gen) return;
            push({ state });
            if (!settled) {
              settled = true;
              resolve(view);
            }
          },
          onOffset: (offsetMs) => mine === gen && push({ offsetMs }),
          onError: (code) => mine === gen && push({ error: { code, n: ++errorN } }),
          onStatus: (status, reason) => {
            if (mine !== gen) return;
            push({ status, reason: status === 'ended' ? reason : undefined });
            if (status !== 'ended') return;
            client = null;
            void stopHost();
            if (!settled) {
              settled = true;
              reject(new StartError(jamErrorMessage(reason), reason));
            }
          },
        },
      );
    });
  }

  async function createInternet(name: string, relayUrl: string): Promise<JamView> {
    for (let attempt = 0; ; attempt++) {
      const code = newRoomCode();
      try {
        const relay = relayUrl.replace(/\/+$/, '');
        const invite = formatInvite('internet', code, d.hostRelayUrl ? relay : undefined);
        return await start({ url: `${relay}/${code}`, kind: 'internet', invite, name, create: true });
      } catch (e) {
        if (!(e instanceof StartError && e.reason === 'code_taken') || attempt >= 2) throw e;
      }
    }
  }

  async function create(o: { kind: 'local' | 'internet'; name: string }): Promise<JamView> {
    const name = sanitizeName(o.name);
    if (!name) throw new Error(NEED_NAME);
    const relay = d.hostRelayUrl ? d.hostRelayUrl() : d.relayUrl;
    if (o.kind === 'internet' && !relay) throw new Error('Configurá tu relé de Cloudflare para crear una sala por internet.');
    await leave();
    d.settings.set('jam_name', name);
    let v: JamView;
    if (o.kind === 'local') {
      const code = newRoomCode();
      const h = await startLocalHost(code);
      host = h;
      const invite = formatInvite('local', code, `${d.localAddress?.() ?? lanAddresses()[0] ?? '127.0.0.1'}:${h.port}`);
      v = await start({ url: `ws://127.0.0.1:${h.port}/${code}`, kind: 'local', invite, name, create: true });
    } else {
      v = await createInternet(name, relay!);
    }
    // El modo que el admin usó la última vez se recuerda como punto de partida.
    const last = d.settings.get<JamMode>('jam_last_mode');
    if (last === 'everyone') client?.send({ t: 'mode.set', mode: last });
    return v;
  }

  async function join(o: { invite: string; name: string }): Promise<JamView> {
    const parsed = parseInvite(o.invite, d.relayUrl);
    if (!parsed) throw new Error('La invitación no es válida. Revisá el código o la dirección.');
    const name = sanitizeName(o.name);
    if (!name) throw new Error(NEED_NAME);
    await leave();
    d.settings.set('jam_name', name);
    const address = parsed.url.slice(0, -parsed.code.length - 1);
    const invite = parsed.kind === 'local' ? parsed.url.replace(/^ws:\/\//, '') :
      formatInvite('internet', parsed.code, address === d.relayUrl.replace(/\/+$/, '') ? undefined : address);
    return start({ url: parsed.url, kind: parsed.kind, invite, name, create: false });
  }

  /** `quit`: se cierra la app. Para la sala eso es una caída y no una salida: el miembro queda desconectado y puede volver con sus likes. */
  async function leave(o?: { quit?: boolean }): Promise<void> {
    const c = client;
    // El admin de una sala local cierra la sala y espera a que los miembros reciban "La sala terminó" antes de apagar el servidor.
    if (c && host && view.status === 'connected' && view.state?.adminId === view.selfId) {
      c.send({ t: 'close' });
      const until = Date.now() + 1500;
      while (client === c && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    }
    client = null;
    gen++;
    if (o?.quit) c?.close();
    else c?.leave();
    await stopHost();
    view = idle();
    d.emit(view);
  }

  /** Lo que manda el renderer se vuelve a validar aquí: `hello` y `ping` son cosa del cliente, no de la interfaz. */
  function send(msg: unknown): void {
    const parsed = parseClientMsg(JSON.stringify(msg) ?? '');
    if (!parsed || parsed.t === 'hello' || parsed.t === 'ping' || !client) return;
    if (parsed.t === 'mode.set' && view.state?.adminId === view.selfId) d.settings.set('jam_last_mode', parsed.mode);
    client.send(parsed);
  }

  return { create, join, leave, send, view: () => view };
}
