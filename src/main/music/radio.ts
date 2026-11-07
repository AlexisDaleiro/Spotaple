import type { ArtistRef, Track } from '../../shared/types';

/** Todas las constantes de la radio en un solo lugar: se calibran acá. */
export const RADIO = {
  /** Canciones que entrega cada pedido. */
  BATCH: 20,
  /** Cuántas reproducciones recientes (automáticas o no) no se repiten. */
  RECENT_PLAYS: 50,
  /** Una reproducción pierde la mitad de su peso cada tantos días. */
  HALF_LIFE_DAYS: 45,
  /** Una favorita pesa como tantas reproducciones de hoy. */
  FAVORITE_WEIGHT: 3,
  /** Cuánto puede subir la afinidad a una canción (la posición que da YouTube vale 1). */
  AFFINITY_WEIGHT: 0.35,
  /** Afinidad a la que el empujón llega a la mitad de su máximo. */
  AFFINITY_K: 3,
  MAX_SAME_ARTIST_RUN: 2,
  /** Cuántas reproducciones no automáticas se leen para calcular la afinidad. */
  AFFINITY_PLAYS: 500,
} as const;

const DAY_MS = 86_400_000;

export interface AffinityInputs {
  /** Reproducciones **no automáticas** (la radio no se alimenta de sí misma). */
  plays: { artists: ArtistRef[]; playedAt: number }[];
  favorites: { artists: ArtistRef[] }[];
}

/** Lo que la radio necesita saber del historial; lo cumple el `Store`. */
export interface RadioHistory {
  /** Ids distintos de las últimas reproducciones, la más reciente primero. */
  recentPlayIds(limit: number): string[];
  affinityInputs(limit: number): AffinityInputs;
}

/** De dónde salen los candidatos; lo cumple el proveedor musical. */
export interface RadioSource {
  getRadio(videoId: string): Promise<Track[]>;
  getArtist(id: string): Promise<{ topSongs: Track[] }>;
}

/** Clave estable de un artista: su `channel_id` si lo tiene, si no el nombre en minúsculas. */
export const artistKey = (a: ArtistRef): string => a.id ?? a.name.trim().toLowerCase();

const primary = (t: Track): string => (t.artists[0] ? artistKey(t.artists[0]) : '');
const titleKey = (t: Track): string => `${t.title.trim().toLowerCase()}|${primary(t)}`;

/** Afinidad por artista: reproducciones con vida media + favoritas, a **cada** artista acreditado. */
export function computeAffinity(input: AffinityInputs, now: number): Map<string, number> {
  const out = new Map<string, number>();
  const add = (artists: ArtistRef[], weight: number) => {
    for (const a of artists) out.set(artistKey(a), (out.get(artistKey(a)) ?? 0) + weight);
  };
  for (const p of input.plays) add(p.artists, 0.5 ** (Math.max(0, now - p.playedAt) / DAY_MS / RADIO.HALF_LIFE_DAYS));
  for (const f of input.favorites) add(f.artists, RADIO.FAVORITE_WEIGHT);
  return out;
}

/**
 * Filtra y reordena los candidatos (en el orden de YouTube): fuera lo excluido y los duplicados por título + artista;
 * la posición de YouTube pesa más y la afinidad suma un empujón moderado; nunca más de `MAX_SAME_ARTIST_RUN` seguidas
 * del mismo artista (la racha arranca contando al artista de la semilla). Si no hay forma de cumplirlo, no se cuelga.
 */
export function rankRadio(
  candidates: Track[],
  ctx: { exclude: ReadonlySet<string>; affinity: ReadonlyMap<string, number>; seedArtist?: ArtistRef; limit?: number },
): Track[] {
  const seen = new Set<string>();
  const kept = candidates.filter((c) => {
    if (ctx.exclude.has(c.id)) return false;
    const key = titleKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const pool = kept
    .map((track, i) => {
      const a = Math.max(0, ...track.artists.map((x) => ctx.affinity.get(artistKey(x)) ?? 0));
      return { track, i, score: 1 - i / kept.length + RADIO.AFFINITY_WEIGHT * (a / (a + RADIO.AFFINITY_K)) };
    })
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map((s) => s.track);

  const out: Track[] = [];
  const limit = ctx.limit ?? RADIO.BATCH;
  let lastKey: string | null = ctx.seedArtist ? artistKey(ctx.seedArtist) : null;
  let run = lastKey === null ? 0 : 1;
  while (pool.length && out.length < limit) {
    let at = pool.findIndex((c) => !(primary(c) === lastKey && run >= RADIO.MAX_SAME_ARTIST_RUN));
    if (at < 0) at = 0;
    const [pick] = pool.splice(at, 1);
    const key = primary(pick!);
    run = key === lastKey ? run + 1 : 1;
    lastKey = key;
    out.push(pick!);
  }
  return out;
}

/**
 * Arma el siguiente lote de radio para una semilla. Pide la radio de YouTube Music y, si no hay sugerencias o falla
 * (salvo sin red: probar otra cosa no ayuda), cae a las canciones populares del artista de la semilla.
 */
export function createRadio(deps: { source: RadioSource; history: RadioHistory; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const finish = (candidates: Track[], seed: Track, excludeIds: string[]): Track[] =>
    rankRadio(candidates, {
      exclude: new Set([seed.id, ...excludeIds, ...deps.history.recentPlayIds(RADIO.RECENT_PLAYS)]),
      affinity: computeAffinity(deps.history.affinityInputs(RADIO.AFFINITY_PLAYS), now()),
      seedArtist: seed.artists[0],
    });

  return {
    async next(seed: Track, excludeIds: string[]): Promise<Track[]> {
      let failure: { error: unknown } | null = null;
      try {
        const out = finish(await deps.source.getRadio(seed.id), seed, excludeIds);
        if (out.length) return out;
      } catch (e) {
        if ((e as { code?: string } | null)?.code === 'network') throw e;
        failure = { error: e };
      }
      const artistId = seed.artists[0]?.id;
      if (!artistId) {
        if (failure) throw failure.error;
        return [];
      }
      try {
        return finish((await deps.source.getArtist(artistId)).topSongs, seed, excludeIds);
      } catch (e) {
        throw failure ? failure.error : e;
      }
    },
  };
}
