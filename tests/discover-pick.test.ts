import { describe, expect, it } from 'vitest';
import { mixPick, mixSubtitle, periodKeys, pickSimilarArtists, radarPick, seededShuffle, weeklyPick } from '../src/main/music/discover-pick';
import type { AlbumSummary, ArtistSummary, Track } from '../src/shared/types';

const t = (id: string, title: string, artist: string, artistId?: string): Track => ({ id, title, artists: [{ name: artist, ...(artistId ? { id: artistId } : {}) }] });
const ids = (list: Track[]) => list.map((x) => x.id);

describe('periodKeys', () => {
  it('un miércoles: semanal es el lunes, diario es hoy y radar es el viernes anterior', () => {
    expect(periodKeys(new Date(2026, 10, 11, 12))).toEqual({ weekly: '2026-11-09', daily: '2026-11-11', radar: '2026-11-06' });
  });

  it('un lunes es su propio inicio de semana y el radar sigue siendo el viernes anterior', () => {
    expect(periodKeys(new Date(2026, 10, 9, 12))).toEqual({ weekly: '2026-11-09', daily: '2026-11-09', radar: '2026-11-06' });
  });

  it('un viernes es su propio radar y un sábado usa el viernes anterior', () => {
    expect(periodKeys(new Date(2026, 10, 6, 12)).radar).toBe('2026-11-06');
    expect(periodKeys(new Date(2026, 10, 7, 12))).toMatchObject({ weekly: '2026-11-02', radar: '2026-11-06' });
  });

  it('el domingo sigue en la semana que empezó el lunes anterior', () => {
    expect(periodKeys(new Date(2026, 10, 15, 12))).toEqual({ weekly: '2026-11-09', daily: '2026-11-15', radar: '2026-11-13' });
  });

  it('medianoche local ya es el día nuevo y el minuto anterior es el día viejo', () => {
    expect(periodKeys(new Date(2026, 10, 9, 0, 0)).weekly).toBe('2026-11-09');
    expect(periodKeys(new Date(2026, 10, 8, 23, 59))).toMatchObject({ weekly: '2026-11-02', daily: '2026-11-08' });
  });

  it('el cambio de horario de verano no corre el día', () => {
    expect(periodKeys(new Date(2026, 2, 8, 12))).toEqual({ weekly: '2026-03-02', daily: '2026-03-08', radar: '2026-03-06' });
    expect(periodKeys(new Date(2026, 9, 25, 12))).toEqual({ weekly: '2026-10-19', daily: '2026-10-25', radar: '2026-10-23' });
  });
});

describe('seededShuffle', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  it('la misma semilla da el mismo orden y otra semilla da otro', () => {
    expect(seededShuffle(items, '2026-11-09')).toEqual(seededShuffle(items, '2026-11-09'));
    expect(seededShuffle(items, '2026-11-09')).not.toEqual(seededShuffle(items, '2026-11-10'));
  });

  it('conserva los elementos y no muta la entrada', () => {
    const copy = [...items];
    const out = seededShuffle(items, 'x');
    expect([...out].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual(copy);
  });
});

describe('weeklyPick', () => {
  const ctx = (over: Partial<Parameters<typeof weeklyPick>[1]> = {}) => ({ excludeIds: new Set<string>(), knownArtists: new Set<string>(), limit: 30, ...over });

  it('descarta lo excluido y los duplicados por título y artista, también entre semillas', () => {
    const seeds = [
      { artistKey: 'k1', tracks: [t('a1', 'Tema', 'Uno'), t('a2', 'Otro', 'Dos')] },
      { artistKey: 'k2', tracks: [t('a3', ' tema ', 'uno'), t('b1', 'Más', 'Tres')] },
    ];
    expect(ids(weeklyPick(seeds, ctx({ excludeIds: new Set(['a2']) })))).toEqual(['a1', 'b1']);
  });

  it('nunca más de 2 por artista en toda la lista', () => {
    const tracks = Array.from({ length: 6 }, (_, i) => t(`x${i}`, `T${i}`, 'X', 'UCx'));
    expect(weeklyPick([{ artistKey: 'k', tracks }], ctx())).toHaveLength(2);
  });

  it('intercala entre semillas', () => {
    const seeds = [
      { artistKey: 'k1', tracks: [t('a1', 'A1', 'Uno'), t('a2', 'A2', 'Dos')] },
      { artistKey: 'k2', tracks: [t('b1', 'B1', 'Tres'), t('b2', 'B2', 'Cuatro')] },
    ];
    expect(ids(weeklyPick(seeds, ctx()))).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('dentro de cada semilla pasan primero los artistas que nunca escuchaste', () => {
    const seeds = [{ artistKey: 'k1', tracks: [t('known1', 'K1', 'Conocido', 'UCk'), t('new1', 'N1', 'Nuevo', 'UCn')] }];
    expect(ids(weeklyPick(seeds, ctx({ knownArtists: new Set(['UCk']) })))).toEqual(['new1', 'known1']);
  });

  it('respeta el límite', () => {
    const tracks = Array.from({ length: 40 }, (_, i) => t(`t${i}`, `T${i}`, `Artista ${i}`));
    expect(weeklyPick([{ artistKey: 'k', tracks }], ctx())).toHaveLength(30);
    expect(weeklyPick([{ artistKey: 'k', tracks }], ctx({ limit: 5 }))).toHaveLength(5);
  });

  it('con muchos candidatos repetidos entre semillas igual sale una lista sin duplicados', () => {
    const shared = Array.from({ length: 10 }, (_, i) => t(`s${i}`, `Compartida ${i}`, `Artista ${i}`));
    const seeds = [
      { artistKey: 'k1', tracks: shared },
      { artistKey: 'k2', tracks: [...shared].reverse() },
      { artistKey: 'k3', tracks: shared.map((x) => ({ ...x, id: `copia-${x.id}` })) },
    ];
    const out = weeklyPick(seeds, ctx());
    expect(out).toHaveLength(10);
    expect(new Set(out.map((x) => x.title)).size).toBe(10);
  });
});

describe('mixPick', () => {
  const radio = (n: number, from = 0) => Array.from({ length: n }, (_, i) => t(`r${from + i}`, `Radio ${from + i}`, `Afín ${from + i}`, `UCr${from + i}`));
  const known = (n: number, artist = 'Ancla', artistId = 'UCancla') => Array.from({ length: n }, (_, i) => t(`k${i}`, `Conocida ${i}`, artist, artistId));
  const anchor = { key: 'UCancla', name: 'Ancla' };
  const run = (o: Partial<Parameters<typeof mixPick>[0]> = {}) => mixPick({ anchor, radio: radio(40), known: known(40), seed: '2026-11-11', limit: 30, ...o });

  it('alterna conocidas y radio, mitad y mitad', () => {
    const out = run();
    expect(out).toHaveLength(30);
    expect(out.filter((x) => x.id.startsWith('k'))).toHaveLength(15);
    expect(out.map((x) => x.id[0]).slice(0, 4)).toEqual(['k', 'r', 'k', 'r']);
  });

  it('sin duplicados por título y artista entre las dos mitades', () => {
    const dupOfKnown = { ...t('rdup', 'Conocida 0', 'Ancla', 'UCancla') };
    const out = run({ radio: [dupOfKnown, ...radio(40)], known: known(3) });
    const keys = out.map((x) => `${x.title.toLowerCase()}|${x.artists[0]!.name.toLowerCase()}`);
    expect(new Set(keys).size).toBe(out.length);
  });

  it('con pocas conocidas completa con radio hasta el límite', () => {
    const out = run({ known: known(3) });
    expect(out).toHaveLength(30);
    expect(out.filter((x) => x.id.startsWith('k'))).toHaveLength(3);
  });

  it('con poca radio completa con conocidas', () => {
    const out = run({ radio: radio(4) });
    expect(out).toHaveLength(30);
    expect(out.filter((x) => x.id.startsWith('r'))).toHaveLength(4);
  });

  it('las conocidas son del ancla o de artistas que aparecen en la radio (los afines)', () => {
    const afin = t('kafin', 'De un afín', 'Afín 3', 'UCr3');
    const ajena = t('kajena', 'De otro', 'Otro', 'UCotro');
    const out = run({ known: [afin, ajena, ...known(2)] });
    expect(ids(out)).toContain('kafin');
    expect(ids(out)).not.toContain('kajena');
  });

  it('la misma semilla da la misma lista y otra semilla cambia el orden de las conocidas', () => {
    expect(ids(run())).toEqual(ids(run()));
    expect(ids(run({ seed: '2026-11-12' }))).not.toEqual(ids(run()));
  });

  it('las conocidas del propio ancla van antes que las de los afines', () => {
    const afines = Array.from({ length: 20 }, (_, i) => t(`afin${i}`, `De un afín ${i}`, 'Afín 3', 'UCr3'));
    const out = run({ known: [...afines, ...known(20)] });
    expect(out.filter((x) => x.id.startsWith('afin'))).toHaveLength(0); // las 15 conocidas son del ancla
    expect(out.filter((x) => x.id.startsWith('k'))).toHaveLength(15);
  });

  it('no repite lo que ya usó otro mix (avoid), ni de las conocidas ni de la radio', () => {
    const first = run();
    const avoid = new Set(first.map((x) => `${x.title.trim().toLowerCase()}|${x.artists[0]!.id ?? x.artists[0]!.name.toLowerCase()}`));
    const second = run({ avoid });
    expect(second.length).toBeGreaterThan(0);
    expect(ids(second).filter((id) => ids(first).includes(id))).toEqual([]);
  });
});

describe('mixSubtitle', () => {
  it('uno, dos, tres o más nombres', () => {
    expect(mixSubtitle([])).toBe('');
    expect(mixSubtitle(['A'])).toBe('A');
    expect(mixSubtitle(['A', 'B'])).toBe('A y B');
    expect(mixSubtitle(['A', 'B', 'C'])).toBe('A, B y más');
    expect(mixSubtitle(['A', 'B', 'C', 'D'])).toBe('A, B y más');
  });
});

describe('radarPick', () => {
  const rel = (id: string, year?: string): AlbumSummary => ({ id, title: id, artists: [], year });
  const artists = [
    { albums: [rel('MPREb_new26', '2026'), rel('MPREb_old', '2013')], singles: [rel('MPREb_single26', '2026'), rel('MPREb_dup', '2026')] },
    { albums: [rel('MPREb_dup', '2026'), rel('MPREb_x24', '2024'), rel('MPREb_x25', '2025')], singles: [] },
  ];

  it('la primera vez (sin vistos) muestra solo lo del año en curso y observa todo, también lo viejo', () => {
    const { fresh, observed } = radarPick(artists, new Set(), { year: 2026 });
    expect(fresh.map((x) => x.id).sort()).toEqual(['MPREb_dup', 'MPREb_new26', 'MPREb_single26']);
    expect([...observed].sort()).toEqual(['MPREb_dup', 'MPREb_new26', 'MPREb_old', 'MPREb_single26', 'MPREb_x24', 'MPREb_x25']);
  });

  it('con vistos solo cuentan los ids nuevos del año en curso o del anterior', () => {
    const seen = new Set(['MPREb_new26', 'MPREb_old', 'MPREb_single26', 'MPREb_dup']);
    expect(radarPick(artists, seen, { year: 2026 }).fresh.map((x) => x.id)).toEqual(['MPREb_x25']); // el de 2024 no es una novedad
  });

  it('ordena lo nuevo del año más reciente al más viejo y no repite un id', () => {
    const seen = new Set(['MPREb_old']);
    const { fresh } = radarPick(artists, seen, { year: 2026 });
    expect(fresh.map((x) => x.year)).toEqual(['2026', '2026', '2026', '2025']);
    expect(new Set(fresh.map((x) => x.id)).size).toBe(fresh.length);
  });

  it('los lanzamientos sin año no cuentan como nuevos después de la primera vez', () => {
    const seen = new Set(['MPREb_old']);
    const out = radarPick([{ albums: [rel('MPREb_noyear'), rel('MPREb_y25', '2025')], singles: [] }], seen, { year: 2026 });
    expect(out.fresh.map((x) => x.id)).toEqual(['MPREb_y25']);
  });

  it('un artista que entra al top después no inunda el radar con su catálogo viejo, pero igual queda observado', () => {
    const seen = new Set(['MPREb_algo']);
    const out = radarPick([{ albums: [rel('MPREb_80', '1980'), rel('MPREb_77', '1977'), rel('MPREb_25', '2025')], singles: [] }], seen, { year: 2026 });
    expect(out.fresh.map((x) => x.id)).toEqual(['MPREb_25']);
    expect(out.observed).toEqual(['MPREb_80', 'MPREb_77', 'MPREb_25']);
  });
});

describe('pickSimilarArtists', () => {
  const a = (id: string, name: string): ArtistSummary => ({ id, name });

  it('une las listas sin repetir y ordena por cuántas listas lo traen, y después por primera aparición', () => {
    const lists = [
      [a('U1', 'Uno'), a('U2', 'Dos'), a('U3', 'Tres')],
      [a('U3', 'Tres'), a('U4', 'Cuatro')],
      [a('U3', 'Tres'), a('U2', 'Dos')],
    ];
    expect(pickSimilarArtists(lists, new Set(), 10).map((x) => x.id)).toEqual(['U3', 'U2', 'U1', 'U4']);
  });

  it('quita los que ya están en el historial, por id o por nombre en minúsculas', () => {
    const lists = [[a('U1', 'Uno'), a('U2', 'Dos'), a('U3', 'Tres')]];
    expect(pickSimilarArtists(lists, new Set(['U1', 'dos']), 10).map((x) => x.id)).toEqual(['U3']);
  });

  it('respeta el límite', () => {
    const lists = [Array.from({ length: 20 }, (_, i) => a(`U${i}`, `Artista ${i}`))];
    expect(pickSimilarArtists(lists, new Set(), 12)).toHaveLength(12);
  });
});
