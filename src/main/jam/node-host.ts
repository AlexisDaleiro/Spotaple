import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { isRoomCode } from '../../shared/jam/invite';
import { RoomHost } from '../../shared/jam/room-host';
import { LIMITS } from '../../shared/jam/types';

export interface NodeHostOpts {
  /** 0 = un puerto libre cualquiera. */
  port: number;
  bindHost?: string;
  /** single: una sola sala (`singleCode`), la del admin en red local · multi: salas por código (relé). */
  rooms: 'single' | 'multi';
  singleCode?: string;
  transferAdmin: boolean;
}

export interface NodeHost {
  port: number;
  stop(): Promise<void>;
  /** Corta los sockets desde el servidor sin cerrar el servidor (para probar la reconexión). */
  dropConnections(): void;
}

const SWEEP_MS = 5000;

/** Servidor WebSocket sobre `RoomHost`. La ruta es `/<CODIGO>`; cualquier otra recibe 404. */
export function startNodeHost(o: NodeHostOpts): Promise<NodeHost> {
  const rooms = new Map<string, RoomHost>();
  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxMsgBytes });
  const server = createServer((_req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('Upgrade Required');
  });

  server.on('upgrade', (req, socket, head) => {
    const code = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
    if (!isRoomCode(code) || (o.rooms === 'single' && code !== o.singleCode)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      let room = rooms.get(code);
      if (!room) {
        room = new RoomHost({ code, transferAdmin: o.transferAdmin });
        rooms.set(code, room);
      }
      const session = room.connect({ send: (data) => ws.send(data), close: () => ws.close() });
      ws.on('message', (data, isBinary) => {
        if (!isBinary) session.receive(String(data));
      });
      ws.on('close', () => {
        sockets.delete(ws);
        session.closed();
      });
      ws.on('error', () => ws.terminate());
    });
  });

  const sweeper = setInterval(() => {
    for (const [code, room] of rooms) {
      room.sweep();
      if (room.expired) rooms.delete(code);
    }
  }, SWEEP_MS);
  sweeper.unref();

  return new Promise<NodeHost>((resolve, reject) => {
    server.once('error', (e) => {
      clearInterval(sweeper);
      reject(e);
    });
    server.listen(o.port, o.bindHost ?? '0.0.0.0', () => {
      server.removeAllListeners('error');
      resolve({
        port: (server.address() as AddressInfo).port,
        dropConnections: () => sockets.forEach((ws) => ws.terminate()),
        stop: () =>
          new Promise<void>((done) => {
            clearInterval(sweeper);
            sockets.forEach((ws) => ws.terminate());
            wss.close();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

/** Host de la sala local del admin: una sala, el rol no se traspasa (si el admin se va, la sala termina). */
export async function startLocalHost(code: string, preferredPort = 47800): Promise<NodeHost> {
  const opts: NodeHostOpts = { port: preferredPort, rooms: 'single', singleCode: code, transferAdmin: false };
  try {
    return await startNodeHost(opts);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    return startNodeHost({ ...opts, port: 0 });
  }
}

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** IPv4 de esta PC que no son de loopback, las de redes privadas primero. */
export function lanAddresses(): string[] {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  return [...ips.filter(isPrivate), ...ips.filter((ip) => !isPrivate(ip))];
}
