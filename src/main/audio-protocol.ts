import type { MusicProvider } from './music/provider';
import { classify } from './music/youtube/errors';
import { openUpstream } from './upstream';

const ID_RE = /^[\w-]{6,24}$/;

/**
 * `spotaple-audio://track/<videoId>` → audio con soporte de Range. La URL real nunca sale del proceso
 * principal: el renderer solo conoce el videoId, y si la URL caduca se vuelve a resolver aquí.
 *
 * Se reenvía el Range tal cual (googlevideo acepta tramos abiertos y completos con el cliente elegido
 * por el proveedor). Responder solo un trozo con `Content-Length` parcial hacía que Chromium tomara
 * ese trozo como el archivo entero: el salto de posición caía al final y la canción "terminaba".
 */
export function createAudioHandler(provider: MusicProvider, fetchImpl: typeof fetch = fetch) {
  const respond = createResponder(provider, fetchImpl);
  if (process.env['SPOTAPLE_DEBUG'] !== '1') return respond;
  // Diagnóstico opcional (SPOTAPLE_DEBUG=1): una línea por pedido de audio, sin URLs ni credenciales.
  return async (request: Request) => {
    const res = await respond(request);
    console.log(`[audio] ${new URL(request.url).pathname} ${request.headers.get('range')} -> ${res.status} ${res.headers.get('content-range') ?? ''}`);
    return res;
  };
}

export function createResponder(provider: MusicProvider, fetchImpl: typeof fetch) {
  return async function handle(request: Request): Promise<Response> {
    let id: string;
    try {
      id = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (!ID_RE.test(id)) return new Response('bad request', { status: 400 });

    const m = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
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
