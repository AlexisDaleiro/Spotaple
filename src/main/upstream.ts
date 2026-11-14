import type { AudioVariant, MusicProvider, ResolvedAudio } from './music/provider';

/** Estados con los que googlevideo indica que la URL caducó o dejó de valer. */
const STALE = new Set([403, 404, 410]);

/**
 * Resuelve el audio de una canción y lo pide con `range`. Si la URL caducó (403/404/410) la descarta, resuelve de
 * nuevo y pide otra vez, una sola vez. Devuelve la respuesta sea cual sea su estado: quien llama decide qué hacer.
 * Lo comparten el protocolo de audio (reproducir) y las descargas.
 */
export async function openUpstream(o: {
  provider: MusicProvider;
  fetchImpl: typeof fetch;
  id: string;
  range: string;
  signal?: AbortSignal;
  variant?: AudioVariant;
}): Promise<{ res: Response; audio: ResolvedAudio }> {
  const resolve = () => (o.variant ? o.provider.resolveAudio(o.id, { variant: o.variant }) : o.provider.resolveAudio(o.id));
  const open = (a: ResolvedAudio) => o.fetchImpl(a.url, { headers: { Range: o.range }, signal: o.signal });

  o.signal?.throwIfAborted();
  let audio = await resolve();
  o.signal?.throwIfAborted();
  let res = await open(audio);
  if (STALE.has(res.status)) {
    await res.body?.cancel().catch(() => undefined);
    o.signal?.throwIfAborted();
    o.provider.invalidate(o.id);
    audio = await resolve();
    o.signal?.throwIfAborted();
    res = await open(audio);
  }
  return { res, audio };
}
