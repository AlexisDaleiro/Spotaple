import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportTrack } from '../src/main/export';
import type { MusicProvider, ResolvedAudio } from '../src/main/music/provider';
import { exportFileName, type AudioFormat } from '../src/shared/offline';
import type { Track } from '../src/shared/types';

const track: Track = { id: 'abcDEF12345', title: 'One More Time', artists: [{ name: 'Daft Punk' }] };

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'spotaple-export-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(opts: { local?: { file: string; mimeType: string } | null; status?: number; mimeFor?: (v: string | undefined) => string } = {}) {
  const provider: MusicProvider = {
    search: vi.fn(),
    getAlbum: vi.fn(),
    getArtist: vi.fn(),
    getPlaylist: vi.fn(),
    getRadio: vi.fn(),
    resolveAudio: vi.fn(async (_id: string, o?: { variant?: string }): Promise<ResolvedAudio> => ({
      url: 'https://rr1.googlevideo.example/v',
      mimeType: (opts.mimeFor ?? ((v) => (v === 'aac' ? 'audio/mp4' : 'audio/webm')))(o?.variant),
      contentLength: 11,
      expiresAt: Date.now() + 1e6,
    })),
    invalidate: vi.fn(),
  };
  const fetchImpl = vi.fn(async () => new Response(new Blob(['audio-bytes']).stream(), { status: opts.status ?? 206 })) as unknown as typeof fetch;
  const dest = join(dir, 'elegido.bin');
  const pickSavePath = vi.fn(async (_name: string, _format: AudioFormat): Promise<string | null> => dest);
  const offline = { local: vi.fn(() => opts.local ?? null) };
  const run = (format: AudioFormat) => exportTrack({ offline, provider, fetchImpl, pickSavePath }, track, format);
  return { run, provider, pickSavePath, dest };
}

describe('exportTrack', () => {
  it('si se cancela el diálogo no hace nada y no es un error', async () => {
    const { run, provider, pickSavePath } = setup();
    pickSavePath.mockResolvedValueOnce(null);
    expect(await run('opus')).toEqual({ saved: false });
    expect(provider.resolveAudio).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('propone «Artista - Título.ext» con la extensión del formato', async () => {
    const { run, pickSavePath } = setup();
    await run('aac');
    expect(pickSavePath).toHaveBeenCalledWith(exportFileName(track, 'aac'), 'aac');
    expect(exportFileName(track, 'aac')).toBe('Daft Punk - One More Time.m4a');
  });

  it('con el archivo descargado en el mismo formato lo copia sin tocar la red', async () => {
    const local = join(dir, 'local.webm');
    writeFileSync(local, 'copia-local');
    const { run, provider, dest } = setup({ local: { file: local, mimeType: 'audio/webm' } });
    expect(await run('opus')).toEqual({ saved: true, name: 'elegido.bin' });
    expect(readFileSync(dest, 'utf8')).toBe('copia-local');
    expect(provider.resolveAudio).not.toHaveBeenCalled();
  });

  it('con la descarga en otro formato baja el pedido', async () => {
    const local = join(dir, 'local.webm');
    writeFileSync(local, 'copia-local');
    const { run, provider, dest } = setup({ local: { file: local, mimeType: 'audio/webm' } });
    expect(await run('aac')).toEqual({ saved: true, name: 'elegido.bin' });
    expect(readFileSync(dest, 'utf8')).toBe('audio-bytes');
    expect(provider.resolveAudio).toHaveBeenCalledTimes(1);
  });

  it('Opus pide la variante high y AAC la variante aac', async () => {
    const opus = setup();
    await opus.run('opus');
    expect(opus.provider.resolveAudio).toHaveBeenCalledWith(track.id, { variant: 'high' });
    const aac = setup();
    await aac.run('aac');
    expect(aac.provider.resolveAudio).toHaveBeenCalledWith(track.id, { variant: 'aac' });
  });

  it('si la descarga falla el error se propaga y no queda nada en el destino', async () => {
    const { run, dest } = setup({ status: 502 });
    await expect(run('opus')).rejects.toMatchObject({ code: 'unavailable' });
    expect(existsSync(dest)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('si YouTube solo tiene otro formato falla sin dejar archivos', async () => {
    const { run, dest } = setup({ mimeFor: () => 'audio/mp4' });
    await expect(run('opus')).rejects.toMatchObject({ code: 'unavailable' });
    expect(existsSync(dest)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});
