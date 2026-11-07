import { Innertube, Log, Platform, UniversalCache } from 'youtubei.js';
import type { AlbumDetail, ArtistDetail, ArtistRef, SearchResults } from '../../../shared/types';
import type { StreamQuality } from '../../../shared/settings';
import type { MusicProvider, ResolvedAudio } from '../provider';
import { createAudioCache, createQualityLock } from './audio-cache';
import { evaluatePlayerScript } from './eval';
import { chooseAudioFormat } from './format';
import { classify, MESSAGES, MusicError, playabilityError, withTimeout } from './errors';
import { bestThumb, isTrackItem, mapAlbum, mapArtist, mapTrack, searchItems, txt } from './mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

const REQUEST_TIMEOUT_MS = 15_000;
/** Margen antes del vencimiento declarado por la URL. */
const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TTL_MS = 30 * 60_000;

/**
 * Clientes de InnerTube usados para obtener el audio, en orden de preferencia. Se verificó cuáles
 * entregan el archivo completo (ver `assertFullRange`): hoy solo VISIONOS. Los demás quedan como
 * alternativa por si YouTube cambia las reglas; cada candidato se valida antes de usarse.
 */
const STREAM_CLIENTS = ['VISIONOS', 'ANDROID_VR', 'IOS'] as const;
/** Por debajo de este tamaño no hace falta comprobar tramos lejanos. */
const SHORT_FILE_BYTES = 1_100_000;

export interface YouTubeProviderOptions {
  /** Carpeta para cachear el reproductor de YouTube entre sesiones (acelera el arranque). */
  cacheDir?: string;
  now?: () => number;
  fetch?: typeof fetch;
  /** Calidad de streaming vigente; se lee en cada resolución, así que cambiar el ajuste vale desde la siguiente canción. */
  getQuality?: () => StreamQuality;
}

export function createYouTubeProvider(opts: YouTubeProviderOptions = {}): MusicProvider {
  const now = opts.now ?? Date.now;
  const getQuality = opts.getQuality ?? ((): StreamQuality => 'high');
  const fetchImpl = opts.fetch ?? fetch;
  // YouTube.js escribe en consola cada nodo desconocido de la API interna; no es información útil aquí.
  Log.setLevel(Log.Level.NONE);
  // Requisito documentado por YouTube.js: hay que aportar el evaluador de JS (ver eval.ts).
  Platform.shim.eval = evaluatePlayerScript;

  let clientPromise: Promise<Innertube> | null = null;
  const getClient = (): Promise<Innertube> => {
    clientPromise ??= withTimeout(
      Innertube.create({
        retrieve_player: true,
        // Red de Chromium en la app (proxy y certificados del sistema); sin esto, el fetch de Node.
        fetch: opts.fetch,
        cache: opts.cacheDir ? new UniversalCache(true, opts.cacheDir) : undefined,
      }),
      REQUEST_TIMEOUT_MS * 2,
    ).catch((e) => {
      clientPromise = null;
      throw e;
    });
    return clientPromise;
  };
  const resetClient = () => {
    clientPromise = null;
  };

  const cache = createAudioCache(now);
  const qualityLock = createQualityLock();
  const inflight = new Map<string, Promise<ResolvedAudio>>();

  /**
   * Comprobación real de que la URL entrega el archivo completo y no solo el primer tramo.
   * Verificado con youtubei.js 18.3.0: con varios clientes (YTMUSIC, IOS, ANDROID_VR, TV_SIMPLY…)
   * googlevideo responde 403 a partir de ~1 MiB —el límite que YouTube aplica a las URLs sin
   * "PO token" (Proof of Origin)—, lo que cortaría la canción a los ~65 s. Pedimos 1 byte a mitad
   * de archivo; si no responde 206, ese cliente no sirve y se prueba el siguiente.
   */
  async function assertFullRange(url: string, length: number | undefined) {
    if (length !== undefined && length < SHORT_FILE_BYTES) return;
    const at = length ? Math.floor(length / 2) : SHORT_FILE_BYTES;
    const res = await withTimeout(fetchImpl(url, { headers: { Range: `bytes=${at}-${at}` } }), REQUEST_TIMEOUT_MS);
    await res.body?.cancel().catch(() => undefined);
    if (res.status !== 206) throw new MusicError('unavailable', MESSAGES.blocked);
  }

  async function resolveWith(yt: Innertube, trackId: string, client: (typeof STREAM_CLIENTS)[number], quality: StreamQuality): Promise<ResolvedAudio> {
    const info = await withTimeout(yt.getBasicInfo(trackId, { client }), REQUEST_TIMEOUT_MS);
    const bad = playabilityError(info.playability_status?.status, info.playability_status?.reason);
    if (bad) throw bad;

    // Opus (WebM) primero y, si no hay, otro formato; Alta pide el mejor y Ahorro el más liviano (ver format.ts).
    let format;
    try {
      format = chooseAudioFormat(info, quality);
    } catch {
      throw new MusicError('unavailable', MESSAGES.unavailable);
    }
    const url = await format.decipher(yt.session.player);
    if (!url) throw new MusicError('parse', MESSAGES.parse);

    const length = Number(format.content_length) || undefined;
    await assertFullRange(url, length);

    const expire = Number(new URL(url).searchParams.get('expire'));
    return {
      url,
      mimeType: (format.mime_type ?? 'audio/mp4').split(';')[0]!.trim(),
      contentLength: length,
      expiresAt: expire > 0 ? expire * 1000 - EXPIRY_MARGIN_MS : now() + DEFAULT_TTL_MS,
      durationSec: info.basic_info.duration || undefined,
    };
  }

  async function resolveOnce(trackId: string, quality: StreamQuality): Promise<ResolvedAudio> {
    const yt = await getClient();
    let first: MusicError | undefined;
    for (const client of STREAM_CLIENTS) {
      try {
        return await resolveWith(yt, trackId, client, quality);
      } catch (e) {
        const err = classify(e);
        first ??= err;
        if (err.code === 'network') throw err; // sin conexión: probar otro cliente no ayuda
      }
    }
    throw first ?? new MusicError('unavailable', MESSAGES.unavailable);
  }

  /**
   * `newPlay`: la canción empieza a sonar ahora, así que toma la calidad vigente y la fija. Los demás pedidos de la
   * misma reproducción (saltos de posición, reintentos del protocolo de audio) usan la calidad fijada.
   */
  async function resolveAudio(trackId: string, opts?: { newPlay?: boolean }): Promise<ResolvedAudio> {
    const quality = opts?.newPlay ? getQuality() : (qualityLock.get(trackId) ?? getQuality());
    if (opts?.newPlay) qualityLock.lock(trackId, quality);
    const hit = cache.get(quality, trackId);
    if (hit) return hit;
    // La clave incluye la calidad: una resolución en curso en Alta no sirve a un pedido en Ahorro.
    const flightKey = `${quality}:${trackId}`;
    const running = inflight.get(flightKey);
    if (running) return running;

    const job = (async () => {
      try {
        try {
          return await resolveOnce(trackId, quality);
        } catch (e) {
          const err = classify(e);
          // Cambios de API / reproductor caducado: se recrea la sesión y se reintenta una vez.
          if (err.code === 'parse' || err.code === 'unknown') {
            resetClient();
            return await resolveOnce(trackId, quality);
          }
          throw err;
        }
      } catch (e) {
        throw classify(e);
      }
    })();
    inflight.set(flightKey, job);
    try {
      const out = await job;
      cache.set(quality, trackId, out);
      return out;
    } finally {
      inflight.delete(flightKey);
    }
  }

  async function search(query: string): Promise<SearchResults> {
    const yt = await getClient().catch((e) => {
      throw classify(e);
    });
    const run = (type: 'song' | 'album' | 'artist') => withTimeout(yt.music.search(query, { type }), REQUEST_TIMEOUT_MS);
    const [songsR, albumsR, artistsR] = await Promise.allSettled([run('song'), run('album'), run('artist')]);
    if (songsR.status === 'rejected' && albumsR.status === 'rejected' && artistsR.status === 'rejected') {
      throw classify(songsR.reason);
    }
    const items = (r: PromiseSettledResult<Node>) => (r.status === 'fulfilled' ? searchItems(r.value) : []);
    return {
      query,
      songs: items(songsR)
        .filter(isTrackItem)
        .map((i) => mapTrack(i))
        .filter((t) => t !== null),
      albums: items(albumsR)
        .filter((i) => i.item_type === 'album')
        .map((i) => mapAlbum(i))
        .filter((a) => a !== null),
      artists: items(artistsR)
        .filter((i) => i.item_type === 'artist')
        .map((i) => mapArtist(i))
        .filter((a) => a !== null),
      partial: [songsR, albumsR, artistsR].some((r) => r.status === 'rejected'),
    };
  }

  async function getAlbum(id: string): Promise<AlbumDetail> {
    try {
      const yt = await getClient();
      const a: Node = await withTimeout(yt.music.getAlbum(id), REQUEST_TIMEOUT_MS);
      const h = a.header;
      const strap = h?.strapline_text_one;
      const artistRef: ArtistRef | undefined = txt(strap)
        ? { id: strap?.runs?.[0]?.endpoint?.payload?.browseId, name: txt(strap) }
        : undefined;
      const sub = txt(h?.subtitle).split('•').map((s) => s.trim());
      const title = txt(h?.title);
      if (!title) throw new MusicError('parse', MESSAGES.parse);
      const cover = bestThumb(h?.thumbnail?.contents);
      const albumRef = { id, title };
      const list: Node[] = Array.isArray(a.contents) ? a.contents : [];
      const tracks = list
        .filter(isTrackItem)
        .map((i) => mapTrack(i, { artists: artistRef ? [artistRef] : undefined, album: albumRef, thumbnail: cover }))
        .filter((t) => t !== null);
      return {
        id,
        title,
        artists: artistRef ? [artistRef] : [],
        year: sub.find((s) => /^\d{4}$/.test(s)),
        kind: sub.find((s) => ['Album', 'Single', 'EP'].includes(s)),
        thumbnail: cover,
        tracks,
      };
    } catch (e) {
      throw classify(e);
    }
  }

  async function getArtist(id: string): Promise<ArtistDetail> {
    try {
      const yt = await getClient();
      const a: Node = await withTimeout(yt.music.getArtist(id), REQUEST_TIMEOUT_MS);
      const h = a.header;
      const name = txt(h?.title);
      if (!name) throw new MusicError('parse', MESSAGES.parse);
      const ref: ArtistRef = { id, name };
      const sections: Node[] = Array.isArray(a.sections) ? a.sections : [];
      const titleOf = (s: Node) => txt(s?.header?.title ?? s?.title).toLowerCase();
      const items = (pred: (t: string) => boolean): Node[] =>
        sections.filter((s) => pred(titleOf(s))).flatMap((s) => (Array.isArray(s.contents) ? s.contents : []));
      return {
        id,
        name,
        thumbnail: bestThumb(h?.thumbnail?.contents),
        description: txt(h?.description) || undefined,
        topSongs: items((t) => t === 'top songs' || t === 'songs')
          .filter(isTrackItem)
          .map((i) => mapTrack(i))
          .filter((t) => t !== null),
        albums: items((t) => t === 'albums')
          .map((i) => mapAlbum(i, ref))
          .filter((x) => x !== null),
        singles: items((t) => t.startsWith('singles'))
          .map((i) => mapAlbum(i, ref))
          .filter((x) => x !== null),
      };
    } catch (e) {
      throw classify(e);
    }
  }

  return { search, getAlbum, getArtist, resolveAudio, invalidate: (id) => cache.invalidate(id) };
}
