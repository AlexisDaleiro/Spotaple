import { describe, expect, it, vi } from 'vitest';
import { createResponder } from '../src/main/audio-protocol';
import type { MusicProvider, ResolvedAudio } from '../src/main/music/provider';

const SECRET_URL = 'https://rr1.googlevideo.example/videoplayback?sig=SECRETO&expire=9999999999';

function setup(opts: { statuses?: number[]; length?: number | undefined } = {}) {
  let resolves = 0;
  const provider: MusicProvider = {
    search: vi.fn(),
    getAlbum: vi.fn(),
    getArtist: vi.fn(),
    resolveAudio: vi.fn(async (): Promise<ResolvedAudio> => {
      resolves++;
      return {
        url: `${SECRET_URL}&n=${resolves}`,
        mimeType: 'audio/webm',
        contentLength: 'length' in opts ? opts.length : 1000,
        expiresAt: Date.now() + 1e6,
      };
    }),
    invalidate: vi.fn(),
  };
  const statuses = opts.statuses ?? [206];
  const calls: { url: string; range: string }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), range: (init?.headers as Record<string, string>).Range! });
    // El último estado de la lista se repite en los pedidos siguientes.
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    const body = status === 200 || status === 206 ? new Blob(['audio-bytes']).stream() : null;
    return new Response(body, {
      status,
      headers: status === 206 ? { 'content-range': 'bytes 100-999/1000', 'content-length': '900' } : {},
    });
  }) as unknown as typeof fetch;
  const handle = createResponder(provider, fetchImpl);
  const req = (path: string, range?: string) => new Request(`spotaple-audio://track/${path}`, { headers: range ? { range } : {} });
  return { provider, calls, handle, req };
}

describe('protocolo de audio', () => {
  it('reenvía el Range tal cual y devuelve 206 con Content-Range de googlevideo', async () => {
    const { handle, req, calls } = setup();
    const res = await handle(req('abcDEF12345', 'bytes=100-'));
    expect(res.status).toBe(206);
    expect(calls[0]!.range).toBe('bytes=100-');
    expect(res.headers.get('content-range')).toBe('bytes 100-999/1000');
    expect(res.headers.get('content-type')).toBe('audio/webm');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(await res.text()).toBe('audio-bytes');
  });

  it('sin Range pide desde el principio', async () => {
    const { handle, req, calls } = setup();
    await handle(req('abcDEF12345'));
    expect(calls[0]!.range).toBe('bytes=0-');
  });

  it('la URL real y sus credenciales nunca salen en la respuesta', async () => {
    const { handle, req } = setup();
    const res = await handle(req('abcDEF12345', 'bytes=0-'));
    const dump = JSON.stringify([...res.headers]) + (await res.text());
    expect(dump).not.toContain('googlevideo');
    expect(dump).not.toContain('SECRETO');
  });

  it('fuente caducada (403): invalida, resuelve de nuevo y reintenta una sola vez', async () => {
    const { handle, req, provider, calls } = setup({ statuses: [403, 206] });
    const res = await handle(req('abcDEF12345', 'bytes=0-'));
    expect(res.status).toBe(206);
    expect(provider.invalidate).toHaveBeenCalledWith('abcDEF12345');
    expect(provider.resolveAudio).toHaveBeenCalledTimes(2);
    expect(calls[0]!.url).not.toBe(calls[1]!.url);
  });

  it('si el reintento también falla responde error, sin bucle', async () => {
    const { handle, req, provider } = setup({ statuses: [403, 403] });
    const res = await handle(req('abcDEF12345', 'bytes=0-'));
    expect(res.status).toBe(502);
    expect(provider.resolveAudio).toHaveBeenCalledTimes(2);
  });

  it('un servidor que ignora el Range (200) no sirve para saltar de posición', async () => {
    const { handle, req } = setup({ statuses: [200] });
    expect((await handle(req('abcDEF12345', 'bytes=500-'))).status).toBe(502);
    expect((await handle(req('abcDEF12345', 'bytes=0-'))).status).toBe(200);
  });

  it('pedir más allá del final da 416', async () => {
    const { handle, req } = setup({ length: 1000 });
    const res = await handle(req('abcDEF12345', 'bytes=1000-'));
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
  });

  it('ids inválidos se rechazan antes de tocar la red', async () => {
    const { handle, req, provider } = setup();
    for (const bad of ['..%2F..%2Fx', 'a', 'id con espacios']) {
      expect((await handle(req(bad))).status).toBe(400);
    }
    expect(provider.resolveAudio).not.toHaveBeenCalled();
  });

  it('error de red al resolver: 504 con mensaje, no excepción', async () => {
    const { handle, req, provider } = setup();
    vi.mocked(provider.resolveAudio).mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    const res = await handle(req('abcDEF12345', 'bytes=0-'));
    expect(res.status).toBe(504);
    expect(await res.text()).toMatch(/conexión/i);
  });
});
