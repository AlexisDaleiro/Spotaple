import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { formatFromMime, type AudioFormat } from '../shared/offline';
import type { AudioVariant, MusicProvider } from './music/provider';
import { MESSAGES, MusicError, classify } from './music/youtube/errors';
import { openUpstream } from './upstream';

/**
 * Baja una canción completa a un archivo. Escribe `<dest>.part` y lo renombra al terminar, así nunca queda un archivo
 * a medias con el nombre final. El formato sale del tipo que entrega YouTube (solo Opus y AAC); `expect` exige uno.
 * Si el tamaño no coincide con el declarado (descarga cortada), falla y no deja nada.
 */
export async function downloadTo(o: {
  provider: MusicProvider;
  fetchImpl: typeof fetch;
  id: string;
  variant: AudioVariant;
  destFor: (format: AudioFormat) => string;
  expect?: AudioFormat;
  signal?: AbortSignal;
}): Promise<{ dest: string; bytes: number; format: AudioFormat }> {
  let part: string | undefined;
  try {
    const { res, audio } = await openUpstream({ provider: o.provider, fetchImpl: o.fetchImpl, id: o.id, range: 'bytes=0-', signal: o.signal, variant: o.variant });
    const discard = () => res.body?.cancel().catch(() => undefined);
    if (res.status !== 200 && res.status !== 206) {
      await discard();
      throw new MusicError('unavailable', MESSAGES.blocked);
    }
    const format = formatFromMime(audio.mimeType);
    if (!format || (o.expect && format !== o.expect)) {
      await discard();
      throw new MusicError('unavailable', 'Esta canción no está disponible en ese formato.');
    }
    if (!res.body) throw new MusicError('network', MESSAGES.network);

    const dest = o.destFor(format);
    part = `${dest}.part`;
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(part), { signal: o.signal });
    const { size } = await stat(part);
    if (audio.contentLength && size !== audio.contentLength) throw new MusicError('network', MESSAGES.network);
    await rename(part, dest);
    return { dest, bytes: size, format };
  } catch (e) {
    if (part) await rm(part, { force: true }).catch(() => undefined);
    throw classify(e);
  }
}
