import type { DiscoverState, GeneratedList, GeneratedKind } from '../../shared/discover';
import { artistKey, songKey } from '../../shared/track';
import type { AlbumDetail, ArtistDetail, ArtistSummary, Track } from '../../shared/types';
import type { Store } from '../db/store';
import { mixPick, mixSubtitle, periodKeys, pickSimilarArtists, radarPick, weeklyPick } from './discover-pick';
import { buildTaste, TASTE } from './taste';

/** Todas las constantes de «Hecho para vos» en un solo lugar: se calibran acá. */
export const DISCOVER = {
  WEEKLY_SIZE: 30,
  MIX_SIZE: 30,
  MAX_MIXES: 6,
  /** Con menos anclas los mixes saldrían casi iguales entre sí: no se arman. */
  MIN_MIXES: 3,
  RADAR_ARTISTS: 15,
  RADAR_ALBUMS: 12,
  RADAR_TRACKS: 30,
  SIMILAR_ANCHORS: 4,
  SIMILAR_MAX: 12,
  /** Pedidos simultáneos a YouTube. */
  CONCURRENCY: 4,
  /** Reproducciones que se leen para el perfil de gustos. */
  TASTE_PLAYS: 500,
  /** Canciones conocidas que se leen para los mixes y para no sugerir artistas que ya escuchás. */
  KNOWN_TRACKS: 2000,
} as const;

/** Lo que el servicio necesita del proveedor musical. */
export interface DiscoverSource {
  getRadio(videoId: string): Promise<Track[]>;
  getArtist(id: string): Promise<ArtistDetail>;
  getAlbum(id: string): Promise<AlbumDetail>;
}

/** Lo que el servicio necesita de la base. */
export type DiscoverStore = Pick<
  Store,
  'tasteInputs' | 'playedTrackIds' | 'knownTracks' | 'favoriteIds' | 'generatedLists' | 'saveGenerated' | 'clearGenerated' | 'radarSeen' | 'saveRadarSeen' | 'resetTaste'
>;

const KIND_ORDER: Record<string, number> = { weekly: 0, mix: 1, radar: 2 };

/** Limita cuántos pedidos corren a la vez. */
function limiter(max: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= max) await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiters.shift()?.();
    }
  };
}

const fulfilled = <T>(results: PromiseSettledResult<T>[]): T[] => results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

/**
 * «Hecho para vos»: arma Descubrimiento semanal, Mixes diarios, Release Radar y artistas sugeridos desde el historial y
 * las favoritas, los guarda por período y devuelve siempre lo último que haya. `refresh` genera de forma perezosa lo que
 * falta del período vigente, una corrida a la vez; cada lista falla por separado y conserva la anterior.
 */
export function createDiscover(d: { source: DiscoverSource; store: DiscoverStore; enabled: () => boolean; now?: () => number }) {
  const now = () => (d.now ?? Date.now)();
  let running: Promise<DiscoverState> | null = null;
  /** Sube con «Reiniciar mis gustos»: una corrida que empezó antes ya no guarda nada. */
  let resetEpoch = 0;

  const taste = () => buildTaste(d.store.tasteInputs(DISCOVER.TASTE_PLAYS), now());

  function get(): DiscoverState {
    const enabled = d.enabled();
    const updating = running !== null;
    if (!enabled) return { enabled: false, ready: false, updating, lists: [], artists: [] };
    if (!taste().ready) return { enabled, ready: false, updating, lists: [], artists: [] };

    const periods = periodKeys(new Date(now()));
    const current: Record<string, string> = { weekly: periods.weekly, mix: periods.daily, radar: periods.radar };
    const stored = d.store.generatedLists();
    let lists: GeneratedList[] = stored
      .filter((l) => l.kind in KIND_ORDER)
      .map((l) => ({
        kind: l.kind as GeneratedKind,
        slot: l.slot,
        title: l.title,
        subtitle: l.subtitle,
        tracks: l.items as Track[],
        period: l.period,
        createdAt: l.createdAt,
        stale: l.period !== current[l.kind],
      }));
    // Si de un tipo hay listas del período vigente, las viejas sobran (por ejemplo un mix cuyo ancla ya no está).
    for (const kind of Object.keys(KIND_ORDER)) {
      if (lists.some((l) => l.kind === kind && !l.stale)) lists = lists.filter((l) => l.kind !== kind || !l.stale);
    }
    lists.sort((a, b) => KIND_ORDER[a.kind]! - KIND_ORDER[b.kind]! || Number(a.slot) - Number(b.slot));
    const artistsRow = stored.find((l) => l.kind === 'artists');
    return { enabled, ready: true, updating, lists, artists: (artistsRow?.items ?? []) as ArtistSummary[] };
  }

  async function generateAll(): Promise<void> {
    const epoch = resetEpoch;
    const profile = taste();
    const periods = periodKeys(new Date(now()));
    const stored = d.store.generatedLists();
    const have = (kind: string, slot: string, period: string) => stored.some((l) => l.kind === kind && l.slot === slot && l.period === period);
    const save = (list: Parameters<DiscoverStore['saveGenerated']>[0]) => {
      if (epoch === resetEpoch) d.store.saveGenerated(list);
    };

    // Cada getArtist, getRadio y getAlbum se pide una sola vez por corrida, y como mucho 4 a la vez.
    const limit = limiter(DISCOVER.CONCURRENCY);
    const memo = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
      let p = cache.get(key);
      if (!p) {
        p = limit(load);
        cache.set(key, p);
      }
      return p;
    };
    const artists = new Map<string, Promise<ArtistDetail>>();
    const radios = new Map<string, Promise<Track[]>>();
    const albums = new Map<string, Promise<AlbumDetail>>();
    const artistOf = (id: string) => memo(artists, id, () => d.source.getArtist(id));
    const radioOf = (id: string) => memo(radios, id, () => d.source.getRadio(id));
    const albumOf = (id: string) => memo(albums, id, () => d.source.getAlbum(id));

    const withSeed = profile.artists.filter((a) => a.seedTrackId);
    const withId = profile.artists.filter((a) => a.id);
    const knownTracks = d.store.knownTracks(DISCOVER.KNOWN_TRACKS);
    const knownKeys = new Set(knownTracks.flatMap((t) => t.artists.flatMap((a) => [artistKey(a), a.name.trim().toLowerCase()])));

    async function weekly() {
      if (have('weekly', '1', periods.weekly)) return;
      const seeds = withSeed.slice(0, TASTE.TOP_ARTISTS);
      const panels = await Promise.allSettled(seeds.map((s) => radioOf(s.seedTrackId!)));
      const lists = seeds.flatMap((s, i) => {
        const r = panels[i]!;
        return r.status === 'fulfilled' ? [{ artistKey: s.key, tracks: r.value }] : [];
      });
      if (!lists.length) return;
      const picked = weeklyPick(lists, {
        excludeIds: new Set([...d.store.playedTrackIds(), ...d.store.favoriteIds()]),
        knownArtists: new Set(profile.artists.map((a) => a.key)),
        limit: DISCOVER.WEEKLY_SIZE,
      });
      if (!picked.length) return;
      save({ kind: 'weekly', slot: '1', period: periods.weekly, title: 'Descubrimiento semanal', subtitle: 'Canciones que todavía no escuchaste, elegidas con tus gustos', items: picked, createdAt: now() });
    }

    async function mixes() {
      const anchors = withSeed.slice(0, DISCOVER.MAX_MIXES);
      if (anchors.length < DISCOVER.MIN_MIXES) return;
      await Promise.all(
        anchors.map(async (anchor, i) => {
          const slot = String(i + 1);
          if (have('mix', slot, periods.daily)) return;
          try {
            const panel = await radioOf(anchor.seedTrackId!);
            const picked = mixPick({ anchor: { key: anchor.key, name: anchor.name }, radio: panel, known: knownTracks, seed: periods.daily, limit: DISCOVER.MIX_SIZE });
            if (!picked.length) return;
            const counts = new Map<string, number>();
            for (const t of picked) {
              const name = t.artists[0]?.name;
              if (name && name !== anchor.name) counts.set(name, (counts.get(name) ?? 0) + 1);
            }
            const others = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([name]) => name);
            save({ kind: 'mix', slot, period: periods.daily, title: `Mix ${slot}`, subtitle: mixSubtitle([anchor.name, ...others]), items: picked, createdAt: now() });
          } catch {
            /* este mix conserva el anterior */
          }
        }),
      );
    }

    async function radar() {
      if (have('radar', '1', periods.radar)) return;
      const targets = withId.slice(0, DISCOVER.RADAR_ARTISTS);
      const details = fulfilled(await Promise.allSettled(targets.map((a) => artistOf(a.id!))));
      if (!details.length) return;
      const seen = new Set(d.store.radarSeen());
      const { fresh, observed } = radarPick(
        details.map((a) => ({ albums: a.albums, singles: a.singles })),
        seen,
        { year: new Date(now()).getFullYear() },
      );
      const previous = stored.find((l) => l.kind === 'radar' && l.slot === '1');
      if (epoch !== resetEpoch) return;
      if (!fresh.length) {
        d.store.saveRadarSeen([...d.store.radarSeen(), ...observed]);
        // Sin novedades se mantiene el radar anterior (con su fecha) para no volver a consultar en cada apertura.
        if (previous) save({ ...previous, period: periods.radar });
        return;
      }
      const shown = fresh.slice(0, DISCOVER.RADAR_ALBUMS);
      const expanded = fulfilled(await Promise.allSettled(shown.map((a) => albumOf(a.id))));
      const songs = new Set<string>();
      const items: Track[] = [];
      for (const album of expanded) {
        for (const t of album.tracks) {
          const key = songKey(t);
          if (songs.has(key) || items.length >= DISCOVER.RADAR_TRACKS) continue;
          songs.add(key);
          items.push(t);
        }
      }
      if (!items.length || epoch !== resetEpoch) return; // no se marca visto: se reintenta
      const friday = periods.radar.split('-').map(Number) as [number, number, number];
      const date = new Date(friday[0], friday[1] - 1, friday[2]).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
      save({ kind: 'radar', slot: '1', period: periods.radar, title: 'Release Radar', subtitle: `Novedades de tus artistas · ${date}`, items, createdAt: now() });
      // Lo que quedó fuera por el tope se ofrece la próxima vez: no se marca visto.
      const shownIds = new Set(shown.map((a) => a.id));
      const leftover = new Set(fresh.filter((a) => !shownIds.has(a.id)).map((a) => a.id));
      d.store.saveRadarSeen([...d.store.radarSeen(), ...observed.filter((id) => !leftover.has(id))]);
    }

    async function artistsRow() {
      if (have('artists', '1', periods.weekly)) return;
      const anchors = withId.slice(0, DISCOVER.SIMILAR_ANCHORS);
      const details = fulfilled(await Promise.allSettled(anchors.map((a) => artistOf(a.id!))));
      if (!details.length) return;
      const picked = pickSimilarArtists(details.map((a) => a.similar ?? []), knownKeys, DISCOVER.SIMILAR_MAX);
      if (!picked.length) return;
      save({ kind: 'artists', slot: '1', period: periods.weekly, title: 'Artistas que podrías escuchar', subtitle: '', items: picked, createdAt: now() });
    }

    // Cada lista falla por separado: lo que no se pueda armar conserva la anterior y se reintenta en la próxima corrida.
    await Promise.allSettled([weekly(), mixes(), radar(), artistsRow()]);
  }

  function refresh(): Promise<DiscoverState> {
    if (running) return running;
    if (!d.enabled() || !taste().ready) return Promise.resolve(get());
    running = (async () => {
      try {
        await generateAll();
      } catch {
        /* cada lista ya maneja sus fallos */
      } finally {
        running = null;
      }
      return get();
    })();
    return running;
  }

  /** «Reiniciar mis gustos»: ignora lo anterior, vacía las listas y descarta lo que se esté generando. No toca los lanzamientos vistos. */
  function reset(): DiscoverState {
    resetEpoch++;
    d.store.resetTaste(now());
    d.store.clearGenerated();
    return get();
  }

  return { get, refresh, reset };
}

export type Discover = ReturnType<typeof createDiscover>;
