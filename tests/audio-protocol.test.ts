import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioHandler, createResponder, parseRange } from '../src/main/audio-protocol';
import type { MusicProvider, ResolvedAudio } from '../src/main/music/provider';

const SECRET_URL = 'https://rr1.googlevideo.example/videoplayback?sig=SECRETO&expire=9999999999';

function setup(opts: { statuses?: number[]; length?: number | undefined } = {}) {
  let resolves = 0;
  const provider: MusicProvider = {
    search: vi.fn(),
    getAlbum: vi.fn(),
    getArtist: vi.fn(),
    getPlaylist: vi.fn(),
    getRadio: vi.fn(),
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
  return { provider, calls, handle, req, fetchImpl };
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

describe('parseRange', () => {
  it('entiende tramos con fin, abiertos y con fin pasado del tamaño', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('un inicio al final o más allá no se puede satisfacer', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=5000-6000', 1000)).toBe('unsatisfiable');
  });

  it('sin Range válido (o con un fin menor que el inicio) pide el archivo entero', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('basura', 1000)).toBeNull();
    expect(parseRange('bytes=-100', 1000)).toBeNull();
    expect(parseRange('bytes=500-100', 1000)).toBeNull();
  });
});

describe('archivo local (descargas offline)', () => {
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spotaple-proto-'));
    file = join(dir, 'abcDEF12345.webm');
    writeFileSync(file, bytes);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = (local: (id: string) => { file: string; mimeType: string } | null) => {
    const s = setup();
    return { ...s, handle: createResponder(s.provider, s.fetchImpl, local) };
  };
  const body = async (res: Response) => Buffer.from(await res.arrayBuffer());

  it('sin Range: 200 con el archivo entero y sin tocar la red', async () => {
    const { handle, req, provider, calls } = make(() => ({ file, mimeType: 'audio/webm' }));
    const res = await handle(req('abcDEF12345'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('1000');
    expect(res.headers.get('content-type')).toBe('audio/webm');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect((await body(res)).equals(bytes)).toBe(true);
    expect(provider.resolveAudio).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('un tramo da 206 con su Content-Range y exactamente esos bytes', async () => {
    const { handle, req } = make(() => ({ file, mimeType: 'audio/webm' }));
    const res = await handle(req('abcDEF12345', 'bytes=100-199'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(res.headers.get('content-length')).toBe('100');
    expect((await body(res)).equals(bytes.subarray(100, 200))).toBe(true);
  });

  it('un tramo abierto llega hasta el final y uno que se pasa se recorta', async () => {
    const { handle, req } = make(() => ({ file, mimeType: 'audio/webm' }));
    const open = await handle(req('abcDEF12345', 'bytes=900-'));
    expect(open.headers.get('content-range')).toBe('bytes 900-999/1000');
    expect((await body(open)).equals(bytes.subarray(900))).toBe(true);
    const past = await handle(req('abcDEF12345', 'bytes=0-5000'));
    expect(past.headers.get('content-range')).toBe('bytes 0-999/1000');
    expect((await body(past)).equals(bytes)).toBe(true);
  });

  it('pedir más allá del final da 416', async () => {
    const { handle, req } = make(() => ({ file, mimeType: 'audio/webm' }));
    const res = await handle(req('abcDEF12345', 'bytes=1000-'));
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
  });

  it('si el archivo ya no está en el disco cae a la red', async () => {
    const { handle, req, calls } = make(() => ({ file: join(dir, 'no-existe.webm'), mimeType: 'audio/webm' }));
    const res = await handle(req('abcDEF12345', 'bytes=0-'));
    expect(res.status).toBe(206);
    expect(calls).toHaveLength(1);
  });

  it('una canción que no está descargada va a la red como siempre', async () => {
    const { handle, req, calls } = make(() => null);
    expect((await handle(req('abcDEF12345', 'bytes=0-'))).status).toBe(206);
    expect(calls).toHaveLength(1);
  });

  it('un id inválido se rechaza antes de buscar el archivo', async () => {
    const local = vi.fn(() => ({ file, mimeType: 'audio/webm' }));
    const { handle, req } = make(local);
    expect((await handle(req('id con espacios'))).status).toBe(400);
    expect(local).not.toHaveBeenCalled();
  });
});

describe('CORS del protocolo (Web Audio exige un medio con CORS)', () => {
  it('toda respuesta lleva Access-Control-Allow-Origin: * (200, 206 y error)', async () => {
    for (const [statuses, range, want] of [[[200], undefined, 200], [[206], 'bytes=100-', 206]] as const) {
      const { provider, fetchImpl, req } = setup({ statuses: [...statuses] });
      const res = await createAudioHandler(provider, fetchImpl)(req('abcDEF12345', range));
      expect(res.status).toBe(want);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    }
    const { provider, fetchImpl, req } = setup();
    const bad = await createAudioHandler(provider, fetchImpl)(req('no'));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('access-control-allow-origin')).toBe('*');
  });
});
