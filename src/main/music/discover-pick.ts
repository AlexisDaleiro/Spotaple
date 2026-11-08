import { artistKey, songKey } from '../../shared/track';
import type { AlbumSummary, ArtistSummary, Track } from '../../shared/types';

/** Máximo de canciones de un mismo artista en el Descubrimiento semanal. */
const MAX_PER_ARTIST = 2;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Suma días por fecha local (no por milisegundos): el cambio de horario de verano no corre el día. */
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * Períodos de renovación en hora local, como `YYYY-MM-DD`: la semana ISO (su lunes), el día, y el radar (el viernes
 * anterior o el de hoy si es viernes).
 */
export function periodKeys(now: Date): { weekly: string; daily: string; radar: string } {
  const day = now.getDay(); // 0 domingo … 6 sábado
  return { weekly: ymd(addDays(now, -((day + 6) % 7))), daily: ymd(now), radar: ymd(addDays(now, -((day + 2) % 7))) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Generador pseudoaleatorio determinista (mulberry32). */
function seededRandom(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mezcla determinista: la misma semilla da siempre el mismo orden. No muta la entrada. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rnd = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const primaryKey = (t: Track): string => (t.artists[0] ? artistKey(t.artists[0]) : '');

/** Se queda con la primera canción de cada título + artista. */
function uniqueSongs(list: readonly Track[]): Track[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = songKey(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Descubrimiento semanal: une los candidatos de varias semillas, intercalándolos. Fuera lo excluido y los duplicados por
 * título + artista; dentro de cada semilla pasan primero los artistas que nunca escuchaste; máximo 2 por artista.
 */
export function weeklyPick(
  seeds: { artistKey: string; tracks: Track[] }[],
  ctx: { excludeIds: ReadonlySet<string>; knownArtists: ReadonlySet<string>; limit: number },
): Track[] {
  const lists = seeds.map((s) => {
    const fresh = s.tracks.filter((x) => !ctx.excludeIds.has(x.id));
    return [...fresh.filter((x) => !ctx.knownArtists.has(primaryKey(x))), ...fresh.filter((x) => ctx.knownArtists.has(primaryKey(x)))];
  });
  const out: Track[] = [];
  const songs = new Set<string>();
  const perArtist = new Map<string, number>();
  const at = lists.map(() => 0);
  let progressed = true;
  while (out.length < ctx.limit && progressed) {
    progressed = false;
    for (let i = 0; i < lists.length && out.length < ctx.limit; i++) {
      while (at[i]! < lists[i]!.length) {
        const c = lists[i]![at[i]!++]!;
        const song = songKey(c);
        const artist = primaryKey(c);
        if (songs.has(song) || (perArtist.get(artist) ?? 0) >= MAX_PER_ARTIST) continue;
        songs.add(song);
        perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
        out.push(c);
        progressed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Mix diario: mitad canciones que ya conocés (de la base local) del ancla y de los artistas afines (los que aparecen
 * en la radio del ancla) y mitad radio, alternadas. Con pocas de una mitad, la otra completa hasta `limit`.
 * La mezcla de las conocidas sale de `seed` (fecha + ancla), así es estable durante el día.
 */
export function mixPick(o: { anchor: { key: string; name: string }; radio: Track[]; known: Track[]; seed: string; limit: number }): Track[] {
  const radioArtists = new Set(o.radio.flatMap((x) => x.artists.map(artistKey)));
  const mine = o.known.filter((x) => x.artists.some((a) => artistKey(a) === o.anchor.key || radioArtists.has(artistKey(a))));
  const knownList = uniqueSongs(seededShuffle(mine, `${o.seed}:${o.anchor.key}`));
  const radioList = uniqueSongs(o.radio);

  const half = Math.floor(o.limit / 2);
  let knownPick = knownList.slice(0, half);
  const without = (list: Track[], taken: Track[]) => {
    const keys = new Set(taken.map(songKey));
    return list.filter((x) => !keys.has(songKey(x)));
  };
  let radioPick = without(radioList, knownPick).slice(0, o.limit - knownPick.length);
  if (knownPick.length + radioPick.length < o.limit) {
    knownPick = knownList.slice(0, o.limit - radioPick.length);
    radioPick = without(radioPick, knownPick);
  }

  const out: Track[] = [];
  for (let i = 0; i < Math.max(knownPick.length, radioPick.length); i++) {
    if (knownPick[i]) out.push(knownPick[i]!);
    if (radioPick[i]) out.push(radioPick[i]!);
  }
  return out;
}

/** «Artista A, Artista B y más». */
export function mixSubtitle(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names[0]}, ${names[1]} y más`;
}

/**
 * Release Radar. YouTube Music solo informa el año de un lanzamiento, así que «nuevo» es «no visto antes por la app».
 * Sin vistos (primera vez) cuentan los lanzamientos del año en curso. `observed` son todos los ids que aparecieron:
 * se marcan como vistos aunque no se muestren. `fresh` sale del año más nuevo al más viejo (los sin año, al final).
 */
export function radarPick(
  artists: { albums: AlbumSummary[]; singles: AlbumSummary[] }[],
  seen: ReadonlySet<string>,
  ctx: { year: number },
): { fresh: AlbumSummary[]; observed: string[] } {
  const byId = new Map<string, AlbumSummary>();
  for (const a of artists) for (const r of [...a.albums, ...a.singles]) if (!byId.has(r.id)) byId.set(r.id, r);
  const all = [...byId.values()];
  const firstRun = seen.size === 0;
  const yearOf = (r: AlbumSummary): number => (r.year && Number.isFinite(Number(r.year)) ? Number(r.year) : -Infinity);
  const fresh = all.filter((r) => (firstRun ? r.year === String(ctx.year) : !seen.has(r.id))).sort((x, y) => (yearOf(y) === yearOf(x) ? 0 : yearOf(y) > yearOf(x) ? 1 : -1));
  return { fresh, observed: all.map((r) => r.id) };
}

/**
 * Artistas sugeridos: une las listas de «Fans might also like», sin repetir, sin los que ya están en el historial
 * (`knownKeys`: id o nombre en minúsculas); primero los que aparecen en más listas, y después por primera aparición.
 */
export function pickSimilarArtists(lists: ArtistSummary[][], knownKeys: ReadonlySet<string>, limit: number): ArtistSummary[] {
  const stats = new Map<string, { artist: ArtistSummary; count: number; first: number }>();
  let order = 0;
  for (const list of lists) {
    const inThis = new Set<string>();
    for (const a of list) {
      if (inThis.has(a.id)) continue;
      inThis.add(a.id);
      const s = stats.get(a.id);
      if (s) s.count++;
      else stats.set(a.id, { artist: a, count: 1, first: order++ });
    }
  }
  return [...stats.values()]
    .filter(({ artist }) => !knownKeys.has(artist.id) && !knownKeys.has(artist.name.trim().toLowerCase()))
    .sort((x, y) => y.count - x.count || x.first - y.first)
    .slice(0, limit)
    .map((s) => s.artist);
}
