import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createResponder } from '../src/main/audio-protocol';
import { createStore } from '../src/main/db/store';
import { exportTrack } from '../src/main/export';
import { createHandlers } from '../src/main/handlers';
import { createJamSession } from '../src/main/jam/session';
import { createRelaySetup } from '../src/main/jam/relay-setup';
import { createDiscover } from '../src/main/music/discover';
import { createYouTubeProvider } from '../src/main/music/youtube/provider';
import { withoutCredentials } from '../src/main/net-fetch';
import { createOffline } from '../src/main/offline';
import { IPC } from '../src/shared/api';
import { buildCsp } from '../src/shared/csp';
import { JAM_RELAY_HEALTH_PATH, JAM_RELAY_SERVICE, JAM_RELAY_URL, type JamRelayStatus } from '../src/shared/jam/config';
import { parseRelayUrl } from '../src/shared/jam/invite';
import { PROTOCOL } from '../src/shared/jam/types';
import { AUDIO_FORMATS } from '../src/shared/offline';
import { createAndroidUpdates } from '../src/main/android/updates';
import { deployAndroidRelay } from '../src/main/android/relay';

const MAX_BODY = 2 * 1024 * 1024;
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  png: 'image/png',
};

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Solicitud demasiado grande.');
    buffers.push(chunk);
  }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}

export async function startRuntime(dataDir: string, webDir: string, lanAddress?: string, version = '', applicationId?: string) {
  await mkdir(dataDir, { recursive: true });
  const prefix = `/${randomBytes(32).toString('hex')}/`;
  const streams = new Set<ServerResponse>();
  const emit = (channel: string, value: unknown) => {
    const message = `event: ${channel}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const stream of streams) {
      if (stream.writableLength > MAX_BODY) stream.destroy();
      else stream.write(message);
    }
  };
  const store = createStore(join(dataDir, 'spotaple.db'));
  const exportDir = join(dataDir, 'transfers');
  await rm(exportDir, { recursive: true, force: true });
  await mkdir(exportDir);
  const transfers = new Map<string, { file: string; mime: string }>();
  const fetchImpl = withoutCredentials(fetch);
  const provider = createYouTubeProvider({
    cacheDir: join(dataDir, 'yt-cache'),
    fetch: fetchImpl,
    getQuality: () => store.getAppSettings().streamQuality,
  });
  const offline = createOffline({
    dir: join(dataDir, 'offline'), store, provider, fetchImpl,
    enabled: () => store.getAppSettings().autoDownload,
    emit: (state) => emit(IPC.offlineState, state),
  });
  const relayUrl = () => parseRelayUrl(store.getSetting('jam_relay_url'));
  const relay = createRelaySetup({
    source: join(dirname(webDir), 'relay-worker.mjs'),
    stored: relayUrl(), fetch: fetchImpl,
    save: (url) => store.setSetting('jam_relay_url', url),
    emit: (status) => emit(IPC.jamRelayState, status),
    open: async (url) => emit('android:open', url),
    deploy: (source, signal) => deployAndroidRelay(source, signal, fetchImpl),
  });
  const relayStatus = (): JamRelayStatus => relayUrl() ? 'ready' : relay.state();
  const jam = createJamSession({
    settings: { get: store.getSetting, set: store.setSetting },
    relayUrl: JAM_RELAY_URL, hostRelayUrl: relayUrl,
    emit: (view) => emit(IPC.jamState, view),
    localAddress: lanAddress ? () => lanAddress : undefined,
  });
  const updates = createAndroidUpdates(
    dataDir, version, (state) => emit(IPC.updatesState, state), () => emit('android:install', true), fetchImpl,
    applicationId === 'com.alexis.spotaple',
  );
  const handlers = createHandlers({
    store, provider, jam, offline, fetchImpl,
    jamRelay: { ...relay, state: relayStatus },
    updates,
    discover: createDiscover({ source: provider, store, enabled: () => store.getAppSettings().forYou }),
    pickSavePath: async () => null,
    async exportAudio(track, format) {
      const token = randomBytes(20).toString('hex');
      const folder = join(exportDir, token);
      await mkdir(folder);
      try {
        const result = await exportTrack({
          offline, provider, fetchImpl,
          pickSavePath: async (name) => join(folder, name),
        }, track, format);
        if (!result.saved) {
          await rm(folder, { recursive: true, force: true });
          return result;
        }
        const forget = () => {
          transfers.delete(token);
          return rm(folder, { recursive: true, force: true }).catch(() => undefined);
        };
        transfers.set(token, { file: join(folder, result.name), mime: AUDIO_FORMATS[format].mime });
        setTimeout(() => void forget(), 15 * 60_000).unref();
        return { ...result, transfer: token };
      } catch (error) {
        await rm(folder, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    },
    onSettings: () => {},
  });
  const respondAudio = createResponder(provider, fetchImpl, offline.local, true);
  let origin: string;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', buildCsp(false, true));
    void respond(request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else response.writeHead(500).end();
    });
  });

  async function respond(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', origin);
    if (request.headers.host !== new URL(origin).host || url.origin !== origin || !url.pathname.startsWith(prefix) ||
      (request.headers.origin && request.headers.origin !== origin)) {
      response.writeHead(404).end();
      return;
    }
    const path = url.pathname.slice(prefix.length);
    if (request.method === 'POST' && path === 'rpc') {
      if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
        response.writeHead(403).end();
        return;
      }
      const input = await requestBody(request) as { channel?: unknown; args?: unknown } | null;
      if (typeof input?.channel !== 'string' || !Array.isArray(input.args)) {
        response.writeHead(400).end();
        return;
      }
      const handler = handlers.get(input.channel);
      const result = input.channel === IPC.jamRelaySetUrl ? await configureRelay(input.args[0]) : await handler?.(...input.args);
      if (!result) response.writeHead(404).end();
      else response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    if (path === 'events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      response.write(': conectado\n\n');
      streams.add(response);
      response.on('close', () => streams.delete(response));
      for (const [channel, value] of [[IPC.offlineState, offline.state()], [IPC.jamState, jam.view()], [IPC.jamRelayState, relayStatus()], [IPC.updatesState, updates.state()]]) {
        response.write(`event: ${channel}\ndata: ${JSON.stringify(value)}\n\n`);
      }
      return;
    }
    if (path.startsWith('export/')) {
      const token = path.slice('export/'.length);
      const transfer = transfers.get(token);
      if (!transfer) {
        response.writeHead(404).end();
        return;
      }
      const info = await stat(transfer.file);
      response.writeHead(200, { 'Content-Type': transfer.mime, 'Content-Length': info.size });
      await pipeline(createReadStream(transfer.file), response);
      return;
    }
    if (path.startsWith('audio/')) {
      const controller = new AbortController();
      response.once('close', () => controller.abort());
      const headers = new Headers();
      if (request.headers.range) headers.set('range', request.headers.range);
      const track = path.slice('audio/'.length);
      const audio = await respondAudio(new Request(`http://127.0.0.1/${track}`, { headers, signal: controller.signal }));
      response.writeHead(audio.status, Object.fromEntries(audio.headers));
      if (audio.body) await pipeline(Readable.fromWeb(audio.body as import('node:stream/web').ReadableStream), response);
      else response.end();
      return;
    }
    const file = path === '' || path === 'index.html' ? 'index.html' : path;
    const extension = file.split('.').at(-1) ?? '';
    if (file !== 'index.html' && (!/^assets\/[\w.-]+$/.test(file) || !Object.hasOwn(MIME, extension))) {
      response.writeHead(404).end();
      return;
    }
    const filename = join(webDir, file);
    const info = await stat(filename).catch(() => null);
    if (!info?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': MIME[extension]!, 'Content-Length': info.size });
    await pipeline(createReadStream(filename), response);
  }

  async function configureRelay(raw: unknown) {
    const candidate = parseRelayUrl(raw);
    if (candidate) {
      try {
        const health = await fetchImpl(candidate.replace(/^wss:/, 'https:') + JAM_RELAY_HEALTH_PATH, {
          redirect: 'error', signal: AbortSignal.timeout(10_000),
        });
        const info = health.ok ? await health.json() : null;
        if (info?.service === JAM_RELAY_SERVICE && info.protocol === PROTOCOL) {
          store.setSetting('jam_relay_url', candidate);
          emit(IPC.jamRelayState, relayStatus());
          return { ok: true };
        }
      } catch {
        // La configuración existente se conserva si el nuevo relé no responde.
      }
    }
    return { ok: false, error: { code: 'unknown', message: 'No se pudo comprobar la dirección del relé de Jam.' } };
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo iniciar Spotaple.');
  origin = `http://127.0.0.1:${address.port}`;
  const heartbeat = setInterval(() => {
    for (const stream of streams) stream.write(': ping\n\n');
  }, 15_000);
  heartbeat.unref();
  void offline.reconcile().catch(() => undefined);
  return {
    url: origin + prefix,
    async close() {
      clearInterval(heartbeat);
      await Promise.all([jam.leave({ quit: true }), relay.stop()]);
      for (const stream of streams) stream.end();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      store.close();
    },
  };
}

export async function runRuntime(args: string[]) {
  const [dataDir, webDir, readyFile, lanAddress, version, applicationId] = args;
  if (!dataDir || !webDir || !readyFile) throw new Error('Faltan las rutas de Android.');
  await readFile(join(webDir, 'index.html'));
  const { url } = await startRuntime(dataDir, webDir, lanAddress, version, applicationId);
  await writeFile(readyFile + '.tmp', url, { mode: 0o600 });
  await rename(readyFile + '.tmp', readyFile);
}
