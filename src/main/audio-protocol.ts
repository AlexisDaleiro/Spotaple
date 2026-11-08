import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { MusicProvider } from './music/provider';
import { classify } from './music/youtube/errors';
import { openUpstream } from './upstream';

const ID_RE = /^[\w-]{6,24}$/;

/** Archivo descargado de una canción (o null si no está descargada). */
export type LocalAudio = (id: string) => { file: string; mimeType: string } | null;

/**
 * Interpreta un `Range` sobre un archivo de `size` bytes. `null`: no hay Range que valga, se sirve el archivo entero;
 * `'unsatisfiable'`: el inicio cae fuera del archivo (416). El fin se recorta al último byte.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header ?? '');
  if (!m) return null;
  const start = Number(m[1]);
  if (start >= size) return 'unsatisfiable';
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return end < start ? null : { start, end };
}

/** Sirve un archivo descargado con soporte de Range. Devuelve null si no se puede leer (entonces se va a la red). */
async function serveLocal(request: Request, hit: { file: string; mimeType: string }): Promise<Response | null> {
  let size: number;
  try {
    size = (await stat(hit.file)).size;
  } catch {
    return null;
  }
  if (size === 0) return null;
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const headers = new Headers({ 'Content-Type': hit.mimeType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': String(end - start + 1) });
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  const stream = createReadStream(hit.file, { start, end });
  request.signal.addEventListener('abort', () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status: range ? 206 : 200, headers });
}

/**
 * `spotaple-audio://track/<videoId>` → audio con soporte de Range. La URL real nunca sale del proceso
 * principal: el renderer solo conoce el videoId, y si la URL caduca se vuelve a resolver aquí.
 *
 * Se reenvía el Range tal cual (googlevideo acepta tramos abiertos y completos con el cliente elegido
 * por el proveedor). Responder solo un trozo con `Content-Length` parcial hacía que Chromium tomara
 * ese trozo como el archivo entero: el salto de posición caía al final y la canción "terminaba".
 */
export function createAudioHandler(provider: MusicProvider, fetchImpl: typeof fetch = fetch, local?: LocalAudio) {
  const inner = createResponder(provider, fetchImpl, local);
  // El <audio> va con crossOrigin="anonymous" (Web Audio exige un medio con CORS): toda respuesta lo permite.
  const respond = async (request: Request) => {
    const res = await inner(request);
    res.headers.set('Access-Control-Allow-Origin', '*');
    return res;
  };
  if (process.env['SPOTAPLE_DEBUG'] !== '1') return respond;
  // Diagnóstico opcional (SPOTAPLE_DEBUG=1): una línea por pedido de audio, sin URLs ni credenciales.
  return async (request: Request) => {
    const res = await respond(request);
    console.log(`[audio] ${new URL(request.url).pathname} ${request.headers.get('range')} -> ${res.status} ${res.headers.get('content-range') ?? ''}`);
    return res;
  };
}

export function createResponder(provider: MusicProvider, fetchImpl: typeof fetch, local?: LocalAudio) {
  return async function handle(request: Request): Promise<Response> {
    let id: string;
    try {
      id = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (!ID_RE.test(id)) return new Response('bad request', { status: 400 });

    // Descargada: suena del disco, sin red. Si el archivo no se puede leer, sigue por la red.
    const hit = local?.(id);
    if (hit) {
      const res = await serveLocal(request, hit);
      if (res) return res;
    }

    const m =/^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
    const start = m ? Number(m[1]) : 0;
    const range = `bytes=${start}-${m?.[2] ?? ''}`;

    try {
      // Si la URL caducó, `openUpstream` la resuelve de nuevo y reintenta una sola vez.
      const { res, audio } = await openUpstream({ provider, fetchImpl, id, range, signal: request.signal });
      if (audio.contentLength && start >= audio.contentLength) {
        await res.body?.cancel().catch(() => undefined);
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${audio.contentLength}` } });
      }
      if (res.status !== 200 && res.status !== 206) {
        await res.body?.cancel().catch(() => undefined);
        return new Response('upstream error', { status: 502 });
      }
      // Si el servidor ignoró el Range y devolvió el archivo entero, no sirve para un salto de posición.
      if (res.status === 200 && start > 0) {
        await res.body?.cancel().catch(() => undefined);
        return new Response('range not supported', { status: 502 });
      }

      const headers = new Headers({ 'Content-Type': audio.mimeType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      for (const h of ['content-length', 'content-range']) {
        const v = res.headers.get(h);
        if (v) headers.set(h, v);
      }
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      const err = classify(e);
      return new Response(err.message, { status: err.code === 'network' ? 504 : 502 });
    }
  };
}
