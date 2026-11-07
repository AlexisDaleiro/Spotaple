import type { RepeatMode, Track } from '@shared/types';

/** Un ítem de la cola. `uid` distingue la misma canción puesta dos veces. */
export interface QueueItem {
  uid: string;
  track: Track;
  /** La agregó la radio automática (no el usuario). */
  auto?: boolean;
}

export interface QueueState {
  items: QueueItem[];
  /** -1 cuando no hay canción actual. */
  index: number;
  /** Orden original mientras el aleatorio está activo (para poder volver). */
  original: QueueItem[] | null;
}

let counter = 0;
export const newItem = (track: Track, auto = false): QueueItem => ({ uid: `q${++counter}`, track, ...(auto ? { auto: true } : {}) });
export const makeItems = (tracks: Track[], auto = false): QueueItem[] => tracks.map((t) => newItem(t, auto));

export function shuffled<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Siguiente posición, o null si la cola terminó.
 * `auto` = terminó solo la canción (repetir-una vuelve a la misma); manual = el usuario pidió "siguiente".
 */
export function nextIndex(len: number, index: number, repeat: RepeatMode, auto: boolean): number | null {
  if (len === 0) return null;
  if (auto && repeat === 'one') return index;
  if (index + 1 < len) return index + 1;
  return repeat === 'off' ? null : 0;
}

/** Posición anterior; null = no hay anterior (el llamador reinicia la canción actual). */
export function prevIndex(len: number, index: number, repeat: RepeatMode): number | null {
  if (len === 0) return null;
  if (index > 0) return index - 1;
  return repeat === 'all' ? len - 1 : null;
}

/** Activa aleatorio: la canción actual queda primera y el resto se mezcla. */
export function enableShuffle(s: QueueState, rand?: () => number): QueueState {
  if (s.original || s.items.length === 0) return s;
  const current = s.items[s.index];
  if (!current) return { ...s, original: s.items, items: shuffled(s.items, rand), index: -1 };
  const rest = s.items.filter((_, i) => i !== s.index);
  return { items: [current, ...shuffled(rest, rand)], index: 0, original: s.items };
}

/** Desactiva aleatorio: vuelve al orden original, conservando lo agregado y quitando lo eliminado. */
export function disableShuffle(s: QueueState): QueueState {
  if (!s.original) return s;
  const currentUid = s.items[s.index]?.uid;
  const alive = new Set(s.items.map((i) => i.uid));
  const known = new Set(s.original.map((i) => i.uid));
  const items = [...s.original.filter((i) => alive.has(i.uid)), ...s.items.filter((i) => !known.has(i.uid))];
  const index = currentUid ? items.findIndex((i) => i.uid === currentUid) : -1;
  return { items, index, original: null };
}

/** "Reproducir a continuación": justo después de la canción actual. */
export function insertNext(s: QueueState, add: QueueItem[]): QueueState {
  const at = s.index + 1;
  const items = [...s.items.slice(0, at), ...add, ...s.items.slice(at)];
  let original = s.original;
  if (original) {
    const currentUid = s.items[s.index]?.uid;
    const pos = currentUid ? original.findIndex((i) => i.uid === currentUid) + 1 : 0;
    original = [...original.slice(0, pos), ...add, ...original.slice(pos)];
  }
  return { items, index: s.index, original };
}

/** "Agregar a la cola": al final. */
export function append(s: QueueState, add: QueueItem[]): QueueState {
  return { items: [...s.items, ...add], index: s.index, original: s.original ? [...s.original, ...add] : null };
}

/**
 * «Agregar a la cola» del usuario: antes de las canciones que puso la radio, que siguen siendo «lo último».
 * Solo cuentan las de la radio que vienen después de la canción actual (las que ya sonaron no importan).
 */
export function insertBeforeAuto(s: QueueState, add: QueueItem[]): QueueState {
  const firstAuto = (list: QueueItem[], from: number) => {
    const i = list.findIndex((it, k) => k >= from && it.auto);
    return i < 0 ? list.length : i;
  };
  const at = firstAuto(s.items, s.index + 1);
  let original = s.original;
  if (original) {
    const currentUid = s.items[s.index]?.uid;
    const o = firstAuto(original, currentUid ? original.findIndex((i) => i.uid === currentUid) + 1 : 0);
    original = [...original.slice(0, o), ...add, ...original.slice(o)];
  }
  return { items: [...s.items.slice(0, at), ...add, ...s.items.slice(at)], index: s.index, original };
}

/** Quita un ítem. `wasCurrent` avisa si era la canción en curso (el índice pasa a apuntar a la siguiente). */
export function removeItem(s: QueueState, uid: string): { state: QueueState; wasCurrent: boolean } {
  const at = s.items.findIndex((i) => i.uid === uid);
  if (at < 0) return { state: s, wasCurrent: false };
  const items = s.items.filter((i) => i.uid !== uid);
  const index = at < s.index ? s.index - 1 : s.index;
  return {
    state: { items, index: Math.min(index, items.length - 1), original: s.original ? s.original.filter((i) => i.uid !== uid) : null },
    wasCurrent: at === s.index,
  };
}

export function moveItem(s: QueueState, from: number, to: number): QueueState {
  if (from === to || from < 0 || to < 0 || from >= s.items.length || to >= s.items.length) return s;
  const items = [...s.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved!);
  let index = s.index;
  if (from === s.index) index = to;
  else if (from < s.index && to >= s.index) index--;
  else if (from > s.index && to <= s.index) index++;
  return { ...s, items, index };
}

/** Vacía lo que viene después de la canción actual. */
export function clearUpcoming(s: QueueState): QueueState {
  const items = s.items.slice(0, s.index + 1);
  const alive = new Set(items.map((i) => i.uid));
  return { items, index: s.index, original: s.original ? s.original.filter((i) => alive.has(i.uid)) : null };
}
