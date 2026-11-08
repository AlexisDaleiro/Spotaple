import type { ArtistRef } from '../../shared/types';
import { artistKey, computeAffinity } from './radio';

/** Cuántos datos hacen falta para armar «Hecho para vos» y a cuántos artistas se mira. */
export const TASTE = {
  MIN_PLAYS: 15,
  MIN_FAVORITES: 5,
  TOP_ARTISTS: 8,
} as const;

export interface TasteInputs {
  /** Reproducciones **no automáticas**. */
  plays: { trackId: string; artists: ArtistRef[]; playedAt: number }[];
  favorites: { trackId: string; artists: ArtistRef[]; addedAt: number }[];
}

export interface TasteArtist {
  /** `channel_id` si lo hay y si no el nombre en minúsculas (igual que la afinidad de la radio). */
  key: string;
  /** Solo si la clave es un `channel_id`: sin id no se puede pedir la página del artista. */
  id?: string;
  name: string;
  score: number;
  /** Su canción más escuchada (o su última favorita): sirve de semilla para la radio. */
  seedTrackId?: string;
}

export interface Taste {
  /** Del que más te gusta al que menos. */
  artists: TasteArtist[];
  playCount: number;
  favoriteCount: number;
  /** Hay datos suficientes para armar las listas. */
  ready: boolean;
}

/**
 * Perfil de gustos: ranking de artistas con **la misma afinidad que usa la radio** (reproducciones con vida media y
 * favoritas), la semilla de cada uno y si hay datos suficientes. Una canción con varios artistas acreditados cuenta
 * para todos.
 */
export function buildTaste(input: TasteInputs, now: number): Taste {
  const affinity = computeAffinity(
    { plays: input.plays.map((p) => ({ artists: p.artists, playedAt: p.playedAt })), favorites: input.favorites.map((f) => ({ artists: f.artists })) },
    now,
  );

  const who = new Map<string, { id?: string; name: string }>();
  const played = new Map<string, Map<string, { n: number; last: number }>>();
  const faved = new Map<string, { trackId: string; addedAt: number }>();
  for (const p of input.plays) {
    for (const a of p.artists) {
      const key = artistKey(a);
      if (!who.has(key)) who.set(key, { id: a.id, name: a.name });
      const byTrack = played.get(key) ?? new Map<string, { n: number; last: number }>();
      const cur = byTrack.get(p.trackId) ?? { n: 0, last: 0 };
      byTrack.set(p.trackId, { n: cur.n + 1, last: Math.max(cur.last, p.playedAt) });
      played.set(key, byTrack);
    }
  }
  for (const f of input.favorites) {
    for (const a of f.artists) {
      const key = artistKey(a);
      if (!who.has(key)) who.set(key, { id: a.id, name: a.name });
      const cur = faved.get(key);
      if (!cur || f.addedAt > cur.addedAt) faved.set(key, { trackId: f.trackId, addedAt: f.addedAt });
    }
  }

  const seedOf = (key: string): string | undefined => {
    const byTrack = played.get(key);
    if (byTrack?.size) {
      return [...byTrack.entries()].sort((x, y) => y[1].n - x[1].n || y[1].last - x[1].last)[0]![0];
    }
    return faved.get(key)?.trackId;
  };

  const artists = [...affinity.entries()]
    .map(([key, score]) => ({ key, id: who.get(key)?.id, name: who.get(key)?.name ?? key, score, seedTrackId: seedOf(key) }))
    .sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));

  const playCount = input.plays.length;
  const favoriteCount = input.favorites.length;
  return { artists, playCount, favoriteCount, ready: playCount >= TASTE.MIN_PLAYS || favoriteCount >= TASTE.MIN_FAVORITES };
}
