import { describe, expect, it } from 'vitest';
import { computeAffinity } from '../src/main/music/radio';
import { TASTE, buildTaste, type TasteInputs } from '../src/main/music/taste';
import type { ArtistRef } from '../src/shared/types';

const NOW = Date.UTC(2026, 10, 7);
const DAY = 86_400_000;
const A: ArtistRef = { id: 'UCaaa', name: 'Artista A' };
const B: ArtistRef = { name: 'Artista B' };
const C: ArtistRef = { id: 'UCccc', name: 'Artista C' };

const plays = (n: number, artists: ArtistRef[] = [A], at = NOW): TasteInputs['plays'] => Array.from({ length: n }, (_, i) => ({ trackId: `play${i}`, artists, playedAt: at }));
const input = (p: TasteInputs['plays'] = [], f: TasteInputs['favorites'] = []): TasteInputs => ({ plays: p, favorites: f });

describe('buildTaste', () => {
  it('ordena los artistas por puntaje, con el mismo valor que la afinidad de la radio', () => {
    const data = input(
      [{ trackId: 'a1', artists: [A], playedAt: NOW }, { trackId: 'b1', artists: [B], playedAt: NOW - 45 * DAY }],
      [{ trackId: 'c1', artists: [C], addedAt: NOW }],
    );
    const taste = buildTaste(data, NOW);
    expect(taste.artists.map((x) => x.name)).toEqual(['Artista C', 'Artista A', 'Artista B']);
    const affinity = computeAffinity({ plays: data.plays, favorites: data.favorites }, NOW);
    for (const x of taste.artists) expect(x.score).toBeCloseTo(affinity.get(x.key)!);
    expect(taste.artists[0]!.score).toBe(3); // una favorita pesa 3
    expect(taste.artists[2]!.score).toBeCloseTo(0.5); // una reproducción de hace 45 días pesa la mitad
  });

  it('el desempate es por clave, para que el orden sea estable', () => {
    const taste = buildTaste(input([{ trackId: 'x', artists: [{ name: 'zeta' }], playedAt: NOW }, { trackId: 'y', artists: [{ name: 'alfa' }], playedAt: NOW }]), NOW);
    expect(taste.artists.map((x) => x.key)).toEqual(['alfa', 'zeta']);
  });

  it('la clave es el channel_id si lo hay y si no el nombre en minúsculas; el id solo existe en el primer caso', () => {
    const taste = buildTaste(input([{ trackId: 'a1', artists: [A, { name: 'Charly García' }], playedAt: NOW }]), NOW);
    const byKey = new Map(taste.artists.map((x) => [x.key, x]));
    expect(byKey.get('UCaaa')).toMatchObject({ id: 'UCaaa', name: 'Artista A' });
    expect(byKey.get('charly garcía')).toMatchObject({ name: 'Charly García' });
    expect(byKey.get('charly garcía')!.id).toBeUndefined();
  });

  it('la semilla es la canción más reproducida del artista; en empate, la más reciente', () => {
    const most = buildTaste(
      input([
        { trackId: 't1', artists: [A], playedAt: NOW - 3 * DAY },
        { trackId: 't1', artists: [A], playedAt: NOW - 2 * DAY },
        { trackId: 't1', artists: [A], playedAt: NOW - DAY },
        { trackId: 't2', artists: [A], playedAt: NOW },
      ]),
      NOW,
    );
    expect(most.artists[0]!.seedTrackId).toBe('t1');
    const tie = buildTaste(
      input([
        { trackId: 't1', artists: [A], playedAt: NOW - DAY },
        { trackId: 't2', artists: [A], playedAt: NOW },
      ]),
      NOW,
    );
    expect(tie.artists[0]!.seedTrackId).toBe('t2');
  });

  it('sin reproducciones del artista usa su favorita más reciente', () => {
    const taste = buildTaste(
      input([], [
        { trackId: 'f1', artists: [A], addedAt: NOW - 2 * DAY },
        { trackId: 'f2', artists: [A], addedAt: NOW - DAY },
      ]),
      NOW,
    );
    expect(taste.artists[0]!.seedTrackId).toBe('f2');
  });

  it('una canción con dos artistas acreditados cuenta para los dos', () => {
    const taste = buildTaste(input([{ trackId: 'duo', artists: [A, C], playedAt: NOW }]), NOW);
    expect(taste.artists.map((x) => [x.name, x.seedTrackId])).toEqual([
      ['Artista A', 'duo'],
      ['Artista C', 'duo'],
    ]);
  });

  it('está lista con 15 reproducciones o con 5 favoritas, y no con 14 y 4', () => {
    expect(TASTE.MIN_PLAYS).toBe(15);
    expect(TASTE.MIN_FAVORITES).toBe(5);
    const favs = (n: number) => Array.from({ length: n }, (_, i) => ({ trackId: `f${i}`, artists: [A], addedAt: NOW }));
    expect(buildTaste(input(plays(15)), NOW).ready).toBe(true);
    expect(buildTaste(input([], favs(5)), NOW).ready).toBe(true);
    const few = buildTaste(input(plays(14), favs(4)), NOW);
    expect(few.ready).toBe(false);
    expect([few.playCount, few.favoriteCount]).toEqual([14, 4]);
  });

  it('sin datos devuelve un perfil vacío que no está listo', () => {
    expect(buildTaste(input(), NOW)).toEqual({ artists: [], playCount: 0, favoriteCount: 0, ready: false });
  });
});
