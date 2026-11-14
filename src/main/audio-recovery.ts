import type { ResolvedAudio } from './music/provider';

const INACTIVITY_MS = 5_000;
const MAX_REOPENS = 3;

function readWithDeadline(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Tiempo de espera del audio agotado.')), INACTIVITY_MS);
  });
  return Promise.race([reader.read(), deadline]).finally(() => clearTimeout(timer));
}

function parseContentRange(response: Response) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  if (!match) return;
  const [start, end, total] = match.slice(1).map(Number) as [number, number, number];
  if ([start, end, total].every(Number.isSafeInteger) && start <= end && end < total) return { start, end, total };
}

/** Reanuda el mismo tramo de audio antes de que el cliente tenga que reiniciar el reproductor. */
export function recoverAudioBody(
  response: Response,
  source: ResolvedAudio,
  start: number,
  signal: AbortSignal,
  reopen: (range: string, signal: AbortSignal) => Promise<{ res: Response; audio: ResolvedAudio }>,
): ReadableStream<Uint8Array> | null {
  if (!response.body) return null;
  const length = Number(response.headers.get('content-length'));
  const range = response.status === 206 ? parseContentRange(response) :
    start === 0 && Number.isSafeInteger(length) && length > 0 ? { start, end: length - 1, total: length } : undefined;
  if (!range || range.start !== start || (source.contentLength && range.total !== source.contentLength)) return response.body;

  const closed = new AbortController();
  const active = AbortSignal.any([signal, closed.signal]);
  let offset = start;
  let reader = response.body.getReader();
  let segment = new AbortController();
  let remaining = MAX_REOPENS;
  const stopSegment = () => {
    segment.abort();
    void reader.cancel().catch(() => undefined);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (offset <= range.end) {
          active.throwIfAborted();
          try {
            const { done, value } = await readWithDeadline(reader);
            active.throwIfAborted();
            if (done || value.byteLength > range.end + 1 - offset) throw new Error('Tramo de audio incompleto.');
            offset += value.byteLength;
            controller.enqueue(value);
            if (offset > range.end) {
              stopSegment();
              controller.close();
            }
            return;
          } catch {
            stopSegment();
          }

          let reopened = false;
          while (remaining > 0) {
            active.throwIfAborted();
            remaining--;
            segment = new AbortController();
            const attempt = AbortSignal.any([active, segment.signal]);
            const opening = reopen(`bytes=${offset}-${range.end}`, attempt).then((next) => {
              if (attempt.aborted) {
                void next.res.body?.cancel().catch(() => undefined);
                attempt.throwIfAborted();
              }
              return next;
            });
            const timeout = setTimeout(() => segment.abort(new Error('Tiempo de espera del audio agotado.')), INACTIVITY_MS);
            let rejectAbort!: () => void;
            const aborted = new Promise<never>((_, reject) => {
              rejectAbort = () => reject(attempt.reason);
              if (attempt.aborted) rejectAbort();
              else attempt.addEventListener('abort', rejectAbort, { once: true });
            });
            try {
              const next = await Promise.race([opening, aborted]);
              const nextRange = parseContentRange(next.res);
              if (next.res.status === 206 && next.res.body && next.audio.mimeType === source.mimeType &&
                next.audio.formatId === source.formatId &&
                nextRange?.start === offset && nextRange.end === range.end && nextRange.total === range.total) {
                reader = next.res.body.getReader();
                reopened = true;
                break;
              }
              void next.res.body?.cancel().catch(() => undefined);
              if (next.res.status === 429) {
                remaining = 0;
                break;
              }
            } catch {
              // Se vuelve a pedir el mismo byte hasta agotar los intentos.
            } finally {
              clearTimeout(timeout);
              attempt.removeEventListener('abort', rejectAbort);
            }
          }
          if (!reopened) throw new Error('No se pudo recuperar el audio.');
        }
      } catch (error) {
        stopSegment();
        controller.error(error);
      }
    },
    cancel() {
      closed.abort();
      stopSegment();
    },
  });
}
