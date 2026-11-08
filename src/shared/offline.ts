// Contratos de descargas y offline compartidos entre main, preload y renderer. Solo datos y funciones puras.
import type { Track } from './types';

export type AudioFormat = 'opus' | 'aac';

export const AUDIO_FORMATS: Record<AudioFormat, { ext: 'webm' | 'm4a'; mime: 'audio/webm' | 'audio/mp4'; label: string }> = {
  opus: { ext: 'webm', mime: 'audio/webm', label: 'Opus (.webm)' },
  aac: { ext: 'm4a', mime: 'audio/mp4', label: 'AAC (.m4a)' },
};

const FORMATS = Object.keys(AUDIO_FORMATS) as AudioFormat[];

export const parseFormat = (v: unknown): AudioFormat | null => FORMATS.find((f) => f === v) ?? null;
export const formatFromMime = (mime: string): AudioFormat | null => FORMATS.find((f) => AUDIO_FORMATS[f].mime === mime) ?? null;
export const formatFromExt = (ext: string): AudioFormat | null => FORMATS.find((f) => AUDIO_FORMATS[f].ext === ext) ?? null;

/** Lo que main informa a la interfaz: `ids` descargadas, `pending` en cola o bajando, `failed` fallidas desde el último `reconcile`. */
export interface OfflineState {
  ids: string[];
  pending: number;
  failed: number;
  bytes: number;
}

export type ExportResult = { saved: false } | { saved: true; name: string };

const MAX_NAME = 150;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** «Artista - Título.ext» válido en Windows: sin caracteres prohibidos, sin nombres reservados, sin punto final. */
export function exportFileName(track: Track, format: AudioFormat): string {
  const artists = track.artists.map((a) => a.name).join(', ');
  const raw = artists ? `${artists} - ${track.title}` : track.title;
  // eslint-disable-next-line no-control-regex
  let base = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, MAX_NAME).replace(/[ .]+$/, '').trim();
  if (!base) base = 'Sin título';
  else if (RESERVED.test(base.split('.')[0]!.trim())) base = `_${base}`;
  return `${base}.${AUDIO_FORMATS[format].ext}`;
}
