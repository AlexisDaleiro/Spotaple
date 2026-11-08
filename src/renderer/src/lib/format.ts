import type { ArtistRef, Track } from '@shared/types';

/** Une clases CSS ignorando valores falsos. */
export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

export function formatTime(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec) || sec < 0) return '–:––';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** "1 h 2 min" / "45 min" para cabeceras de álbum y playlist. */
export function formatTotal(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 60) return `${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const artistsText = (artists: ArtistRef[] | undefined): string =>
  artists && artists.length ? artists.map((a) => a.name).join(', ') : 'Artista desconocido';

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Tamaño en disco: «512 KB», «5,1 MB», «3,00 GB» (coma decimal). */
export function formatBytes(n: number): string {
  if (!(n > 0)) return '0 MB';
  const MB = 1024 * 1024;
  if (n < MB) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(1).replace('.', ',')} MB`;
  return `${(n / (1024 * MB)).toFixed(2).replace('.', ',')} GB`;
}

/** Duración total, o undefined si a alguna canción le falta (YouTube no siempre la informa): mejor no mostrar un total falso. */
export const totalDuration = (tracks: Track[]): number | undefined =>
  tracks.length > 0 && tracks.every((t) => t.durationSec) ? tracks.reduce((a, t) => a + t.durationSec!, 0) : undefined;

/** Duración de una fila: en blanco si se desconoce (en el reproductor sí se muestra "–:––"). */
export const rowDuration = (sec: number | undefined): string => (sec ? formatTime(sec) : '');

const SIZABLE = /^https:\/\/[^/]*(googleusercontent\.com|ggpht\.com)\//;

/** Pide la portada al tamaño necesario (en px CSS). Las URLs de Google admiten `=w{n}-h{n}`. */
export function thumbUrl(url: string | undefined, px: number): string | undefined {
  if (!url) return undefined;
  if (!SIZABLE.test(url)) return url;
  const size = Math.min(1200, Math.max(60, Math.round(px * (window.devicePixelRatio || 1))));
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+[^/]*$/, `=w${size}-h${size}-l90-rj`);
  if (/=s\d+/.test(url)) return url.replace(/=s\d+[^/]*$/, `=s${size}`);
  return url;
}

/** Color estable derivado del texto, para portadas ausentes. */
export function hueFrom(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}
