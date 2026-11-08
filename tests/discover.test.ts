import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../src/main/db/store';
import { createDiscover, type DiscoverSource } from '../src/main/music/discover';
import type { AlbumDetail, AlbumSummary, ArtistDetail, ArtistRef, ArtistSummary, Track } from '../src/shared/types';

const WED = new Date(2026, 10, 11, 12); // miércoles 2026-11-11: semana del lunes 2026-11-09, radar del viernes 2026-11-06
const THU = new Date(2026, 10, 12, 12);
const FRI = new Date(2026, 10, 13, 12); // nuevo viernes → período de radar nuevo
const MON = new Date(2026, 10, 16, 12); // semana nueva
const FRI2 = new Date(2026, 10, 20, 12);

const art = (n: number): ArtistRef => ({ id: `UCart${n}`, name: `Artista ${n}` });
const song = (a: ArtistRef, k: number): Track => ({ id: `s${a.name.replace(/\W/g, '')}x${k}`, title: `Canción ${a.name} ${k}`, artists: [a] });

let store: Store;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(WED);
  store = createStore(':memory:');
});
afterEach(() => {
  store.close();
  vi.useRealTimers();
});

/** Reproducciones no automáticas: `counts[i]` canciones distintas del artista i+1. */
function seed(counts: number[], favorites = 0, artists: ArtistRef[] = counts.map((_, i) => art(i + 1))) {
  counts.forEach((n, i) => {
    for (let k = 0; k < n; k++) store.recordPlay(song(artists[i]!, k));
  });
  for (let k = 0; k < favorites; k++) store.toggleFavorite(song(artists[0]!, 100 + k));
}

function makeSource(over: Partial<DiscoverSource> = {}) {
  const releases = new Map<string, AlbumSummary[]>();
  const defaults = (id: string): AlbumSummary[] => [
    { id: `MPREb_${id}_26`, title: `Disco 26 de ${id}`, artists: [], year: '2026' },
    { id: `MPREb_${id}_13`, title: `Disco 13 de ${id}`, artists: [], year: '2013' },
  ];
  const source: DiscoverSource = {
    getRadio: vi.fn(async (id: string): Promise<Track[]> =>
      Array.from({ length: 40 }, (_, i) => ({ id: `rad-${id}-${i}`, title: `Radio ${id} ${i}`, artists: [{ id: `UCrad${id}${i}`, name: `Radio ${id} ${i}` }] })),
    ),
    getArtist: vi.fn(
      async (id: string): Promise<ArtistDetail> =>
        ({
          id,
          name: `Artista ${id}`,
          topSongs: [],
          albums: releases.get(id) ?? defaults(id),
          singles: [],
          similar: [{ id: 'UCsim1', name: 'Parecido 1' }, { id: 'UCsim2', name: 'Parecido 2' }, { id: 'UCart2', name: 'Artista 2' }] as ArtistSummary[],
        }) as ArtistDetail,
    ),
    getAlbum: vi.fn(
      async (id: string): Promise<AlbumDetail> =>
        ({ id, title: id, artists: [], tracks: [0, 1, 2].map((i) => ({ id: `${id}-t${i}`, title: `${id} pista ${i}`, artists: [{ name: 'Alguien' }] })) }) as AlbumDetail,
    ),
    ...over,
  };
  return { source, releases };
}

const make = (over: Partial<DiscoverSource> = {}, enabled = () => true) => {
  const s = makeSource(over);
  return { ...s, discover: createDiscover({ source: s.source, store, enabled }) };
};
const calls = (s: DiscoverSource) => (s.getRadio as ReturnType<typeof vi.fn>).mock.calls.length + (s.getArtist as ReturnType<typeof vi.fn>).mock.calls.length + (s.getAlbum as ReturnType<typeof vi.fn>).mock.calls.length;
const kindsOf = (lists: { kind: string }[]) => lists.map((l) => l.kind);

describe('con pocos datos', () => {
  it('con 14 reproducciones y 4 favoritas no está lista, no muestra nada y no pide nada a YouTube', async () => {
    seed([8, 6], 4);
    const { discover, source } = make();
    expect(discover.get()).toEqual({ enabled: true, ready: false, updating: false, lists: [], artists: [] });
    expect(await discover.refresh()).toEqual({ enabled: true, ready: false, updating: false, lists: [], artists: [] });
    expect(calls(source)).toBe(0);
  });

  it('con el ajuste apagado no pide nada y lo dice', async () => {
    seed([8, 6, 4, 2]);
    const { discover, source } = make({}, () => false);
    const state = await discover.refresh();
    expect(state).toEqual({ enabled: false, ready: false, updating: false, lists: [], artists: [] });
    expect(calls(source)).toBe(0);
  });
});

describe('generación', () => {
  beforeEach(() => seed([8, 6, 4, 2], 1));

  it('genera semanal, mixes, radar y artistas, y los devuelve vigentes', async () => {
    const { discover } = make();
    const state = await discover.refresh();
    expect(state.ready).toBe(true);
    expect(kindsOf(state.lists)).toEqual(['weekly', 'mix', 'mix', 'mix', 'mix', 'radar']);
    expect(state.lists.every((l) => !l.stale && l.tracks.length > 0)).toBe(true);
    expect(state.lists.filter((l) => l.kind === 'mix').map((l) => l.title)).toEqual(['Mix 1', 'Mix 2', 'Mix 3', 'Mix 4']);
    expect(state.lists[0]!.title).toBe('Descubrimiento semanal');
    expect(state.lists.at(-1)!.title).toBe('Release Radar');
    expect(state.artists.map((a) => a.id)).toEqual(['UCsim1', 'UCsim2']); // «Artista 2» ya está en el historial
  });

  it('el semanal no trae canciones ya reproducidas ni favoritas y tiene un máximo de 2 por artista', async () => {
    const played = new Set(store.playedTrackIds());
    const { discover } = make({
      getRadio: vi.fn(async (id: string): Promise<Track[]> => [
        ...Array.from({ length: 5 }, (_, i) => ({ id: `solo-${id}-${i}`, title: `Del mismo ${id} ${i}`, artists: [{ id: 'UCmismo', name: 'Mismo Artista' }] })),
        { id: [...played][0]!, title: 'Ya sonó', artists: [{ id: 'UCotro', name: 'Otro' }] },
        ...Array.from({ length: 30 }, (_, i) => ({ id: `n-${id}-${i}`, title: `Nueva ${id} ${i}`, artists: [{ id: `UCn${id}${i}`, name: `Nuevo ${id} ${i}` }] })),
      ]),
    });
    const weekly = (await discover.refresh()).lists.find((l) => l.kind === 'weekly')!;
    expect(weekly.tracks.length).toBeGreaterThan(20);
    expect(weekly.tracks.length).toBeLessThanOrEqual(30);
    expect(weekly.tracks.some((t) => played.has(t.id))).toBe(false);
    expect(weekly.tracks.filter((t) => t.artists[0]!.id === 'UCmismo').length).toBeLessThanOrEqual(2);
  });

  it('una segunda corrida del mismo día y la misma semana no vuelve a pedir nada', async () => {
    const { discover, source } = make();
    await discover.refresh();
    const before = calls(source);
    await discover.refresh();
    expect(calls(source)).toBe(before);
  });

  it('al cambiar de día se renuevan los mixes pero no el semanal, y antes de refrescar se ven los anteriores como viejos', async () => {
    const { discover } = make();
    const first = await discover.refresh();
    vi.setSystemTime(THU);
    const before = discover.get();
    expect(before.lists.filter((l) => l.kind === 'mix').every((l) => l.stale)).toBe(true);
    expect(before.lists.find((l) => l.kind === 'weekly')!.stale).toBe(false);
    const after = await discover.refresh();
    const mixes = after.lists.filter((l) => l.kind === 'mix');
    expect(mixes).toHaveLength(4);
    expect(mixes.every((l) => !l.stale && l.period === '2026-11-12')).toBe(true);
    expect(after.lists.find((l) => l.kind === 'weekly')!.period).toBe(first.lists[0]!.period);
  });

  it('al cambiar de semana se renuevan el semanal y los artistas', async () => {
    const { discover } = make();
    await discover.refresh();
    vi.setSystemTime(MON);
    expect(discover.get().lists.find((l) => l.kind === 'weekly')!.stale).toBe(true);
    const after = await discover.refresh();
    expect(after.lists.find((l) => l.kind === 'weekly')!.period).toBe('2026-11-16');
    expect(store.generatedLists().find((l) => l.kind === 'artists')!.period).toBe('2026-11-16');
  });

  it('un mix que ya no tiene ancla no queda mezclado con los nuevos', async () => {
    const { discover } = make();
    await discover.refresh();
    expect(discover.get().lists.filter((l) => l.kind === 'mix')).toHaveLength(4);
    store.saveGenerated({ kind: 'mix', slot: '6', period: '2026-11-10', title: 'Mix 6', subtitle: 'viejo', items: [], createdAt: 1 });
    expect(discover.get().lists.filter((l) => l.kind === 'mix').map((l) => l.slot)).toEqual(['1', '2', '3', '4']);
  });

  it('un artista top sin id no entra en getArtist, pero su semilla sigue sirviendo', async () => {
    store.close();
    store = createStore(':memory:');
    const sinId: ArtistRef = { name: 'Charly García' };
    seed([9, 6, 4, 3], 0, [sinId, art(2), art(3), art(4)]);
    const { discover, source } = make();
    await discover.refresh();
    const asked = (source.getArtist as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(asked.sort()).toEqual(['UCart2', 'UCart3', 'UCart4']);
    const seeds = (source.getRadio as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(seeds).toContain(store.tasteInputs(500).plays.find((p) => p.artists[0]!.name === 'Charly García')!.trackId);
  });

  it('con menos de 3 anclas no arma mixes, pero sí el semanal', async () => {
    store.close();
    store = createStore(':memory:');
    seed([10, 8]);
    const { discover } = make();
    const state = await discover.refresh();
    expect(kindsOf(state.lists)).toEqual(['weekly', 'radar']);
  });
});

describe('cuando algo falla', () => {
  beforeEach(() => seed([8, 6, 4, 2], 1));
  const networkError = () => Object.assign(new Error('sin red'), { code: 'network' });

  it('sin internet al regenerar conserva las listas anteriores, no lanza y no entra en bucle', async () => {
    const { discover, source } = make();
    await discover.refresh();
    vi.setSystemTime(THU);
    (source.getRadio as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw networkError();
    });
    const radioCalls = (source.getRadio as ReturnType<typeof vi.fn>).mock.calls.length;
    const state = await discover.refresh();
    const mixes = state.lists.filter((l) => l.kind === 'mix');
    expect(mixes).toHaveLength(4);
    expect(mixes.every((l) => l.stale)).toBe(true);
    // Una sola vez por semilla (los 4 anclas), no reintentos dentro de la misma corrida.
    expect((source.getRadio as ReturnType<typeof vi.fn>).mock.calls.length - radioCalls).toBeLessThanOrEqual(4);
  });

  it('la siguiente corrida reintenta y se recupera', async () => {
    const { discover, source } = make();
    await discover.refresh();
    vi.setSystemTime(THU);
    const impl = (source.getRadio as ReturnType<typeof vi.fn>).getMockImplementation()!;
    (source.getRadio as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw networkError();
    });
    await discover.refresh();
    (source.getRadio as ReturnType<typeof vi.fn>).mockImplementation(impl);
    const state = await discover.refresh();
    expect(state.lists.filter((l) => l.kind === 'mix').every((l) => !l.stale)).toBe(true);
  });

  it('si falla todo no guarda nada nuevo y tampoco lanza', async () => {
    const boom = async () => {
      throw networkError();
    };
    const { discover } = make({ getRadio: vi.fn(boom), getArtist: vi.fn(boom), getAlbum: vi.fn(boom) });
    const state = await discover.refresh();
    expect(state.lists).toEqual([]);
    expect(state.artists).toEqual([]);
    expect(store.generatedLists()).toEqual([]);
  });
});

describe('una sola corrida a la vez', () => {
  beforeEach(() => seed([8, 6, 4, 2], 1));

  it('dos refresh simultáneos comparten la corrida y piden una sola vez cada semilla', async () => {
    const { discover, source } = make();
    const p = discover.refresh();
    expect(discover.get().updating).toBe(true);
    const [a, b] = await Promise.all([p, discover.refresh()]);
    expect(a).toEqual(b);
    expect((source.getRadio as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect((source.getArtist as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect(discover.get().updating).toBe(false);
  });

  it('nunca hay más de 4 pedidos a YouTube a la vez', async () => {
    let inFlight = 0;
    let max = 0;
    const slow = async <T>(value: T): Promise<T> => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return value;
    };
    const base = makeSource().source;
    const { discover } = make({
      getRadio: vi.fn(async (id: string) => slow(await base.getRadio(id))),
      getArtist: vi.fn(async (id: string) => slow(await base.getArtist(id))),
      getAlbum: vi.fn(async (id: string) => slow(await base.getAlbum(id))),
    });
    await discover.refresh();
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
  });
});

describe('Release Radar', () => {
  beforeEach(() => seed([8, 6, 4, 2], 1));

  it('la primera vez muestra lo del año en curso y marca visto todo lo observado', async () => {
    const { discover } = make();
    const radar = (await discover.refresh()).lists.find((l) => l.kind === 'radar')!;
    expect(radar.tracks.length).toBeGreaterThan(0);
    expect(radar.tracks.every((t) => t.id.includes('_26-t'))).toBe(true); // solo discos de 2026
    const seen = store.radarSeen();
    expect(seen).toContain('MPREb_UCart1_26');
    expect(seen).toContain('MPREb_UCart1_13');
  });

  it('después solo cuentan los ids nuevos', async () => {
    const { discover, releases } = make();
    await discover.refresh();
    releases.set('UCart1', [
      { id: 'MPREb_nuevo', title: 'Disco nuevo', artists: [], year: '2026' },
      { id: 'MPREb_UCart1_26', title: 'Disco 26 de UCart1', artists: [], year: '2026' },
      { id: 'MPREb_UCart1_13', title: 'Disco 13 de UCart1', artists: [], year: '2013' },
    ]);
    vi.setSystemTime(FRI);
    const radar = (await discover.refresh()).lists.find((l) => l.kind === 'radar')!;
    expect(radar.period).toBe('2026-11-13');
    expect(radar.tracks.map((t) => t.id.split('-t')[0])).toEqual(['MPREb_nuevo', 'MPREb_nuevo', 'MPREb_nuevo']);
  });

  it('sin novedades conserva el radar anterior bajo el período nuevo y no vuelve a consultar esa semana', async () => {
    const { discover, source } = make();
    const first = (await discover.refresh()).lists.find((l) => l.kind === 'radar')!;
    vi.setSystemTime(FRI2);
    const kept = (await discover.refresh()).lists.find((l) => l.kind === 'radar')!;
    expect(kept.period).toBe('2026-11-20');
    expect(kept.tracks).toEqual(first.tracks);
    expect(kept.subtitle).toBe(first.subtitle);
    const before = calls(source);
    await discover.refresh();
    expect(calls(source)).toBe(before);
  });

  it('los ids vistos nunca pasan de 2000', async () => {
    store.saveRadarSeen(Array.from({ length: 1999 }, (_, i) => `MPREb_viejo${i}`));
    const { discover } = make();
    await discover.refresh();
    expect(store.radarSeen().length).toBeLessThanOrEqual(2000);
  });
});

describe('«Reiniciar mis gustos»', () => {
  beforeEach(() => seed([8, 6, 4, 2], 1));

  it('vacía las listas, ignora lo anterior, no toca el historial ni los lanzamientos vistos y la radio también lo ignora', async () => {
    const { discover } = make();
    await discover.refresh();
    const seenBefore = store.radarSeen();
    const playsBefore = store.playedTrackIds().length;
    vi.setSystemTime(new Date(2026, 10, 11, 13));
    const state = discover.reset();
    expect(state).toEqual({ enabled: true, ready: false, updating: false, lists: [], artists: [] });
    expect(store.generatedLists()).toEqual([]);
    expect(store.radarSeen()).toEqual(seenBefore);
    expect(store.playedTrackIds()).toHaveLength(playsBefore);
    expect(store.affinityInputs(500).plays).toEqual([]);
    expect(store.affinityInputs(500).favorites).toEqual([]);
  });

  it('una corrida que estaba en curso al reiniciar no guarda nada', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = makeSource().source;
    const { discover } = make({ getRadio: vi.fn(async (id: string) => (await gate, base.getRadio(id))) });
    const running = discover.refresh();
    await Promise.resolve();
    discover.reset();
    release();
    await running;
    expect(store.generatedLists()).toEqual([]);
  });
});
