import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { formatFromMime, type AudioFormat } from '../shared/offline';
import type { AudioVariant, MusicProvider } from './music/provider';
import { MESSAGES, MusicError, classify } from './music/youtube/errors';
import { openUpstream } from './upstream';

export class DownloadLimitError extends MusicError {
  constructor() {
    super('unavailable', 'La descarga supera el espacio disponible.');
  }
}

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
  maxBytes?: number;
}): Promise<{ dest: string; bytes: number; format: AudioFormat; loudnessLkfs?: number }> {
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
    const limit = o.maxBytes ?? Infinity;
    if (audio.contentLength && audio.contentLength > limit) {
      await discard();
      throw new DownloadLimitError();
    }

    const dest = o.destFor(format);
    part = `${dest}.part`;
    const source = Readable.fromWeb(res.body as unknown as WebReadableStream);
    const target = createWriteStream(part);
    if (Number.isFinite(limit)) {
      let bytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > limit) callback(new DownloadLimitError());
          else callback(null, chunk);
        },
      });
      await pipeline(source, meter, target, { signal: o.signal });
    } else {
      await pipeline(source, target, { signal: o.signal });
    }
    const { size } = await stat(part);
    if (audio.contentLength && size !== audio.contentLength) throw new MusicError('network', MESSAGES.network);
    await rename(part, dest);
    return { dest, bytes: size, format, loudnessLkfs: audio.loudnessLkfs };
  } catch (e) {
    if (part) await rm(part, { force: true }).catch(() => undefined);
    throw classify(e);
  }
}
