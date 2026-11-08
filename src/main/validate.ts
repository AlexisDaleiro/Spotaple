import { parseFormat, type AudioFormat } from '../shared/offline';
import { sanitizeTrack } from '../shared/track';
import type { PersistedPlayerState, Track } from '../shared/types';
import { MusicError } from './music/youtube/errors';

export { sanitizeTrack };

/**
 * Todo lo que llega del renderer se valida antes de tocar la base de datos: el renderer puede
 * tener errores y los títulos/URLs vienen de una fuente remota, así que se tratan como datos.
 */
const bad = () => new MusicError('unknown', 'Solicitud inválida.');

export const str = (v: unknown, max = 200): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw bad();
  return v;
};
export const id = (v: unknown): string => {
  const s = str(v, 64);
  if (!/^[\w-]+$/.test(s)) throw bad();
  return s;
};
export const int = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw bad();
  return v;
};

/** Pedido de radio: la canción semilla y los ids que ya están en la cola (hasta 2000, con el patrón de ids). */
export function sanitizeRadioRequest(v: unknown): { seed: Track; excludeIds: string[] } {
  const r = v as { seed?: unknown; excludeIds?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.excludeIds) || r.excludeIds.length > 2000) throw bad();
  return { seed: sanitizeTrack(r.seed), excludeIds: r.excludeIds.map((x) => id(x)) };
}

/** Pedido de «Descargar canción»: la canción y el formato (opus o aac). La ruta de destino nunca viene del renderer. */
export function sanitizeExportRequest(v: unknown): { track: Track; format: AudioFormat } {
  const r = v as { track?: unknown; format?: unknown } | null;
  const format = parseFormat(r?.format);
  if (!r || typeof r !== 'object' || !format) throw bad();
  return { track: sanitizeTrack(r.track), format };
}

export function sanitizePlayerState(v: unknown): PersistedPlayerState {
  const s = v as Partial<PersistedPlayerState> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.queue) || s.queue.length > 2000) throw bad();
  const queue = s.queue.map(sanitizeTrack);
  const num = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  return {
    queue,
    index: Math.round(num(s.index, 0, 0, Math.max(0, queue.length - 1))),
    positionSec: num(s.positionSec, 0, 0, 86_400),
    volume: num(s.volume, 0.8, 0, 1),
    muted: s.muted === true,
    repeat: s.repeat === 'all' || s.repeat === 'one' ? s.repeat : 'off',
    shuffle: s.shuffle === true,
  };
}
