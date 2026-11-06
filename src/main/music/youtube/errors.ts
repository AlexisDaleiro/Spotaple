import type { ErrorCode } from '../../../shared/types';

export class MusicError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MusicError';
  }
}

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
]);

export const MESSAGES = {
  network: 'Sin conexión con el servicio de música. Revisá tu internet y probá de nuevo.',
  unavailable: 'Esta canción no está disponible para reproducir.',
  blocked: 'YouTube no entregó el audio completo de esta canción. Suele ser un cambio reciente en su servicio; probá de nuevo más tarde.',
  region: 'Esta canción no está disponible en tu región.',
  parse: 'YouTube respondió algo inesperado. Probá de nuevo; si sigue, la integración puede necesitar una actualización.',
  unknown: 'Algo salió mal. Probá de nuevo.',
} as const;

/** Convierte cualquier error en un `MusicError` con mensaje accionable en español. */
export function classify(e: unknown): MusicError {
  if (e instanceof MusicError) return e;
  const err = e as { message?: string; code?: string; cause?: { code?: string; message?: string }; name?: string } | null;
  const text = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`.toLowerCase();
  const code = err?.code ?? err?.cause?.code;
  if (
    (code && NETWORK_CODES.has(code)) ||
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    err?.name === 'TimeoutError'
  ) {
    return new MusicError('network', MESSAGES.network);
  }
  // YouTube.js lanza "This video is unavailable" para videos borrados, privados o inexistentes.
  if (/country|region/.test(text)) return new MusicError('region', MESSAGES.region);
  if (/unavailable|not available|private video|has been removed|terminated|no longer/.test(text)) {
    return new MusicError('unavailable', MESSAGES.unavailable);
  }
  if (/parse|unexpected|nsig|decipher|player/i.test(text)) return new MusicError('parse', MESSAGES.parse);
  return new MusicError('unknown', MESSAGES.unknown);
}

/** Interpreta `playability_status` de YouTube. Devuelve null si se puede reproducir. */
export function playabilityError(status: string | undefined, reason: string | undefined): MusicError | null {
  if (!status || status === 'OK') return null;
  if (reason && /country|region|location|your area|not available in/i.test(reason)) {
    return new MusicError('region', MESSAGES.region);
  }
  return new MusicError('unavailable', MESSAGES.unavailable);
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
