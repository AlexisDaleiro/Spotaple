import { describe, expect, it, vi } from 'vitest';
import { createResponder } from '../src/main/audio-protocol';
import type { MusicProvider, ResolvedAudio } from '../src/main/music/provider';

const data = Uint8Array.from([1, 2, 3, 4, 5, 6]);
const source: ResolvedAudio = {
  url: 'https://audio.example.test/test', mimeType: 'audio/webm',
  contentLength: data.length, formatId: 251, expiresAt: Date.now() + 100_000,
};
const request = () => new Request('http://127.0.0.1/streamTrack', { headers: { Range: 'bytes=0-' } });

function partial(start: number, body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>) {
  return new Response(body, { status: 206, headers: {
    'Content-Range': `bytes ${start}-5/6`,
    'Content-Length': String(data.length - start),
  } });
}

function setup(initial: Response, reopen = () => partial(3, data.slice(3))) {
  const provider: MusicProvider = {
    resolveAudio: vi.fn(async () => source), invalidate: vi.fn(),
    search: vi.fn(), getAlbum: vi.fn(), getArtist: vi.fn(), getPlaylist: vi.fn(), getRadio: vi.fn(),
  };
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(initial).mockImplementation(async () => reopen());
  return { provider, fetchImpl, handle: createResponder(provider, fetchImpl, undefined, true) };
}

describe('recuperación del streaming móvil', () => {
  it('pide el byte siguiente y entrega el archivo exacto cuando se corta el cuerpo', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(data.slice(0, 3));
      controller.close();
    } });
    const { handle, fetchImpl } = setup(partial(0, body));
    const res = await handle(request());
    expect(res.headers.get('content-length')).toBe('6');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toEqual({ Range: 'bytes=3-5' });
  });

  it('recupera un flujo que queda abierto sin datos y cancela la respuesta estancada', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ start: (stream) => stream.enqueue(data.slice(0, 3)), cancel });
      const { handle } = setup(partial(0, body));
      const received = (await handle(request())).arrayBuffer();
      await vi.advanceTimersByTimeAsync(5000);
      expect(new Uint8Array(await received)).toEqual(data);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rechaza un tramo incorrecto y limita los reintentos', async () => {
    const { handle, fetchImpl } = setup(partial(0, data.slice(0, 3)), () => partial(2, data.slice(2)));
    const res = await handle(request());
    await expect(res.arrayBuffer()).rejects.toThrow('No se pudo recuperar el audio.');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('una resolución de fuente estancada se agota y permite pedir otro tramo', async () => {
    vi.useFakeTimers();
    try {
      const { provider, handle } = setup(partial(0, data.slice(0, 3)));
      vi.mocked(provider.resolveAudio).mockResolvedValueOnce(source).mockImplementationOnce(() => new Promise(() => {}));
      const received = (await handle(request())).arrayBuffer();
      await vi.advanceTimersByTimeAsync(5000);
      expect(new Uint8Array(await received)).toEqual(data);
      expect(provider.resolveAudio).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('si el navegador deja la canción, cancela sin pedir otro tramo', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start: (stream) => stream.enqueue(data.slice(0, 3)), cancel });
    const { handle, fetchImpl } = setup(partial(0, body));
    const reader = (await handle(request())).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
