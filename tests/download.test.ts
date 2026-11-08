import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadTo } from '../src/main/download';
import type { MusicProvider, ResolvedAudio } from '../src/main/music/provider';
import { AUDIO_FORMATS, type AudioFormat } from '../src/shared/offline';

const ID = 'abcDEF12345';
let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'spotaple-dl-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(opts: { mime?: string; length?: number | undefined; statuses?: number[]; fetchError?: Error } = {}) {
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
        url: `https://rr1.googlevideo.example/videoplayback?n=${resolves}`,
        mimeType: opts.mime ?? 'audio/webm',
        contentLength: 'length' in opts ? opts.length : 11,
        expiresAt: Date.now() + 1e6,
      };
    }),
    invalidate: vi.fn(),
  };
  const statuses = opts.statuses ?? [206];
  let calls = 0;
  const fetchImpl = vi.fn(async () => {
    if (opts.fetchError) throw opts.fetchError;
    const status = statuses[Math.min(calls++, statuses.length - 1)]!;
    const ok = status === 200 || status === 206;
    return new Response(ok ? new Blob(['audio-bytes']).stream() : null, { status });
  }) as unknown as typeof fetch;
  const destFor = vi.fn((f: AudioFormat) => join(dir, `${ID}.${AUDIO_FORMATS[f].ext}`));
  const run = (extra: { variant?: 'high' | 'aac' | 'saver'; expect?: AudioFormat } = {}) =>
    downloadTo({ provider, fetchImpl, id: ID, variant: extra.variant ?? 'high', destFor, expect: extra.expect });
  return { provider, fetchImpl, destFor, run };
}

describe('downloadTo', () => {
  it('escribe el archivo completo y no deja el .part', async () => {
    const { run } = setup();
    const out = await run();
    expect(out).toEqual({ dest: join(dir, `${ID}.webm`), bytes: 11, format: 'opus' });
    expect(readFileSync(out.dest, 'utf8')).toBe('audio-bytes');
    expect(readdirSync(dir)).toEqual([`${ID}.webm`]);
  });

  it('deduce AAC de audio/mp4 y usa la extensión m4a', async () => {
    const { run } = setup({ mime: 'audio/mp4' });
    const out = await run({ variant: 'aac' });
    expect(out.format).toBe('aac');
    expect(out.dest).toBe(join(dir, `${ID}.m4a`));
  });

  it('pide a pedido la variante al proveedor', async () => {
    const { run, provider } = setup({ mime: 'audio/mp4' });
    await run({ variant: 'aac' });
    expect(provider.resolveAudio).toHaveBeenCalledWith(ID, { variant: 'aac' });
  });

  it('si el formato no es el esperado rechaza antes de escribir nada', async () => {
    const { run, destFor } = setup({ mime: 'audio/mp4' });
    await expect(run({ expect: 'opus' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(destFor).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('un formato que no es Opus ni AAC no sirve', async () => {
    const { run } = setup({ mime: 'audio/ogg' });
    await expect(run()).rejects.toMatchObject({ code: 'unavailable' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('URL caducada (403): invalida, resuelve de nuevo y termina bien', async () => {
    const { run, provider } = setup({ statuses: [403, 206] });
    const out = await run();
    expect(out.bytes).toBe(11);
    expect(provider.invalidate).toHaveBeenCalledWith(ID);
    expect(provider.resolveAudio).toHaveBeenCalledTimes(2);
  });

  it('tamaño distinto al declarado (descarga cortada): error de red y ningún archivo', async () => {
    const { run } = setup({ length: 1000 });
    await expect(run()).rejects.toMatchObject({ code: 'network' });
    expect(existsSync(join(dir, `${ID}.webm`))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('sin tamaño declarado acepta lo que llegó', async () => {
    const { run } = setup({ length: undefined });
    expect((await run()).bytes).toBe(11);
  });

  it('un estado de error del servidor da «no disponible» y ningún archivo', async () => {
    const { run } = setup({ statuses: [502] });
    await expect(run()).rejects.toMatchObject({ code: 'unavailable' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('un fallo de red al pedir sale clasificado como red', async () => {
    const { run } = setup({ fetchError: new TypeError('fetch failed') });
    await expect(run()).rejects.toMatchObject({ code: 'network' });
    expect(readdirSync(dir)).toEqual([]);
  });
});
