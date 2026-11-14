import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../src/main/db/store';
import type { MusicProvider, ResolvedAudio } from '../src/main/music/provider';
import { createOffline } from '../src/main/offline';
import type { OfflineState } from '../src/shared/offline';
import type { Track } from '../src/shared/types';

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, readdir: vi.fn(fs.readdir) };
});

const t = (n: number): Track => ({ id: `track${String(n).padStart(6, '0')}`, title: `Canción ${n}`, artists: [{ name: 'Artista' }], durationSec: 100 + n });

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spotaple-offline-'));
  store = createStore(':memory:');
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Proveedor y red simulados: `gated` retiene la respuesta de esas canciones hasta `release()`, `broken` responde 502. */
function setup(opts: { enabled?: boolean; maxBytes?: () => number } = {}) {
  const gated = new Set<string>();
  const broken = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let inFlight = 0;
  let maxInFlight = 0;
  const provider: MusicProvider = {
    search: vi.fn(),
    getAlbum: vi.fn(),
    getArtist: vi.fn(),
    getPlaylist: vi.fn(),
    getRadio: vi.fn(),
    resolveAudio: vi.fn(async (id: string): Promise<ResolvedAudio> => ({ url: `https://rr1.googlevideo.example/v?id=${id}`, mimeType: 'audio/webm', contentLength: 11, expiresAt: Date.now() + 1e6 })),
    invalidate: vi.fn(),
  };
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const id = new URL(String(url)).searchParams.get('id')!;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    if (gated.has(id)) await gate;
    inFlight--;
    if (broken.has(id)) return new Response(null, { status: 502 });
    return new Response(new Blob(['audio-bytes']).stream(), { status: 206 });
  }) as unknown as typeof fetch;
  const states: OfflineState[] = [];
  const offline = createOffline({ dir, store, provider, fetchImpl, enabled: () => opts.enabled ?? true, maxBytes: opts.maxBytes, emit: (s) => states.push(s) });
  return { offline, provider, fetchImpl, gated, broken, release, states, inFlight: () => inFlight, maxInFlight: () => maxInFlight };
}

/** La canción pasa a ser favorita en la base (lo que hace `toggleFavorite` antes de avisar al servicio). */
const favorite = (n: number) => store.toggleFavorite(t(n));

describe('descargas de favoritas', () => {
  it('dos descargas simultáneas respetan el límite y se recuperan al subirlo', async () => {
    let budget = 11;
    const { offline } = setup({ maxBytes: () => budget });
    favorite(1);
    favorite(2);
    await offline.reconcile();
    await offline.idle();
    expect(offline.state()).toMatchObject({ bytes: 11, pending: 0, failed: 0, limited: true });
    expect(readdirSync(dir)).toHaveLength(1);
    budget = 22;
    await offline.reconcile();
    await offline.idle();
    expect(offline.state()).toEqual({ bytes: 22, ids: expect.arrayContaining([t(1).id, t(2).id]), pending: 0, failed: 0 });
  });

  it('apagar la descarga automática pausa un trabajo en curso y conserva las favoritas', async () => {
    const options = { enabled: true };
    const { offline, gated, release, inFlight } = setup(options);
    favorite(1);
    gated.add(t(1).id);
    await offline.onFavorite(t(1).id, true);
    await vi.waitFor(() => expect(inFlight()).toBe(1));
    options.enabled = false;
    await offline.reconcile();
    release();
    await offline.idle();
    expect(offline.state()).toEqual({ bytes: 0, ids: [], pending: 0, failed: 0 });
    expect(store.isFavorite(t(1).id)).toBe(true);
    options.enabled = true;
    await offline.reconcile();
    await offline.idle();
    expect(offline.state().ids).toEqual([t(1).id]);
  });

  it('espera a que la pista esté preparada antes de iniciar otra descarga', async () => {
    const { offline, fetchImpl } = setup();
    let release!: () => void;
    const preparation = new Promise<void>((resolve) => { release = resolve; });
    const preparing = offline.prioritize(() => preparation);
    favorite(1);
    await offline.onFavorite(t(1).id, true);
    expect(offline.state().pending).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    release();
    await preparing;
    await offline.idle();
    expect(offline.state().ids).toEqual([t(1).id]);
  });

  it('baja la favorita nueva y queda disponible sin red', async () => {
    const { offline, states } = setup();
    favorite(1);
    await offline.onFavorite(t(1).id, true);
    await offline.idle();
    expect(offline.local(t(1).id)).toEqual({ file: join(dir, `${t(1).id}.webm`), mimeType: 'audio/webm', durationSec: 101 });
    expect(store.downloads()).toEqual([{ trackId: t(1).id, format: 'opus', bytes: 11 }]);
    expect(readFileSync(join(dir, `${t(1).id}.webm`), 'utf8')).toBe('audio-bytes');
    expect(states.at(-1)).toEqual({ ids: [t(1).id], pending: 0, failed: 0, bytes: 11 });
  });

  it('con la descarga automática apagada no baja nada', async () => {
    const { offline, fetchImpl } = setup({ enabled: false });
    favorite(1);
    await offline.onFavorite(t(1).id, true);
    await offline.idle();
    expect(offline.local(t(1).id)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('nunca baja más de 2 a la vez y termina todas', async () => {
    const { offline, gated, release, maxInFlight, inFlight } = setup();
    for (const n of [1, 2, 3, 4, 5]) {
      favorite(n);
      gated.add(t(n).id);
      await offline.onFavorite(t(n).id, true);
    }
    await vi.waitFor(() => expect(inFlight()).toBe(2));
    expect(offline.state().pending).toBe(5);
    release();
    await offline.idle();
    expect(maxInFlight()).toBe(2);
    expect(offline.state().ids.sort()).toEqual([1, 2, 3, 4, 5].map((n) => t(n).id));
    expect(offline.state().pending).toBe(0);
  });

  it('quitar de favoritas borra el archivo y la fila', async () => {
    const { offline } = setup();
    favorite(1);
    await offline.onFavorite(t(1).id, true);
    await offline.idle();
    favorite(1); // la quita
    await offline.onFavorite(t(1).id, false);
    expect(offline.local(t(1).id)).toBeNull();
    expect(store.downloads()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('quitar de favoritas mientras baja no deja archivo ni fila', async () => {
    const { offline, gated, release, inFlight } = setup();
    favorite(1);
    gated.add(t(1).id);
    await offline.onFavorite(t(1).id, true);
    await vi.waitFor(() => expect(inFlight()).toBe(1));
    favorite(1); // la quita mientras baja
    await offline.onFavorite(t(1).id, false);
    release();
    await offline.idle();
    expect(readdirSync(dir)).toEqual([]);
    expect(store.downloads()).toEqual([]);
    expect(offline.local(t(1).id)).toBeNull();
  });

  it('una descarga fallida cuenta como fallida, no deja archivo y el siguiente reconcile la reintenta', async () => {
    const { offline, broken } = setup();
    favorite(1);
    broken.add(t(1).id);
    await offline.onFavorite(t(1).id, true);
    await offline.idle();
    expect(offline.state()).toMatchObject({ ids: [], failed: 1, pending: 0 });
    expect(readdirSync(dir)).toEqual([]);
    broken.clear();
    await offline.reconcile();
    await offline.idle();
    expect(offline.state()).toMatchObject({ ids: [t(1).id], failed: 0 });
  });
});

describe('borrar todas las descargas', () => {
  it('una sincronización anterior no vuelve a bajar las descargas borradas', async () => {
    favorite(1);
    store.addDownload(t(1).id, 'opus', 11);
    const name = `${t(1).id}.webm`;
    writeFileSync(join(dir, name), 'audio-bytes');
    const { offline, fetchImpl } = setup();
    let started!: () => void;
    let release!: (names: string[]) => void;
    const scanning = new Promise<void>((resolve) => { started = resolve; });
    const entries = new Promise<string[]>((resolve) => { release = resolve; });
    vi.mocked(readdir).mockImplementationOnce(async () => {
      started();
      return entries as never;
    });
    const syncing = offline.reconcile();
    await scanning;
    await offline.clear();
    release([name]);
    await syncing;
    await offline.idle();
    expect(offline.state().ids).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('borra archivos y filas, y descarta lo que estaba bajando', async () => {
    const { offline, gated, release, inFlight } = setup();
    favorite(1);
    await offline.onFavorite(t(1).id, true);
    await offline.idle();
    favorite(2);
    gated.add(t(2).id);
    await offline.onFavorite(t(2).id, true);
    await vi.waitFor(() => expect(inFlight()).toBe(1));
    await offline.clear();
    expect(store.downloads()).toEqual([]);
    expect(offline.local(t(1).id)).toBeNull();
    release();
    await offline.idle();
    expect(readdirSync(dir)).toEqual([]);
    expect(store.downloads()).toEqual([]);
    expect(offline.state()).toEqual({ ids: [], pending: 0, failed: 0, bytes: 0 });
  });
});

describe('reconcile', () => {
  it('limpia lo que sobra, quita filas sin archivo o sin favorita, y baja las favoritas que faltan', async () => {
    // A: favorita con fila pero sin archivo. B: con archivo y fila, pero ya no es favorita. C: favorita sin nada.
    for (const n of [1, 2, 3]) favorite(n);
    store.addDownload(t(1).id, 'opus', 5);
    store.addDownload(t(2).id, 'opus', 5);
    writeFileSync(join(dir, `${t(2).id}.webm`), 'viejo');
    favorite(2); // B deja de ser favorita con la app cerrada
    writeFileSync(join(dir, 'resto.webm.part'), 'a medias');
    writeFileSync(join(dir, 'huerfano123.webm'), 'sin fila');
    const { offline } = setup();
    await offline.reconcile();
    await offline.idle();
    expect(readdirSync(dir).sort()).toEqual([`${t(1).id}.webm`, `${t(3).id}.webm`]);
    expect(store.downloads().map((d) => d.trackId).sort()).toEqual([t(1).id, t(3).id]);
    expect(offline.local(t(2).id)).toBeNull();
  });

  it('con la descarga automática apagada no encola nada', async () => {
    favorite(1);
    const { offline, fetchImpl } = setup({ enabled: false });
    await offline.reconcile();
    await offline.idle();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(offline.state().pending).toBe(0);
  });

  it('no toca el .part de una descarga que está en curso', async () => {
    const { offline, gated, release, inFlight } = setup();
    favorite(1);
    gated.add(t(1).id);
    await offline.onFavorite(t(1).id, true);
    await vi.waitFor(() => expect(inFlight()).toBe(1));
    const part = join(dir, `${t(1).id}.webm.part`);
    writeFileSync(part, 'en curso');
    await offline.reconcile();
    expect(existsSync(part)).toBe(true);
    release();
    await offline.idle();
    expect(readdirSync(dir)).toEqual([`${t(1).id}.webm`]);
  });
});
