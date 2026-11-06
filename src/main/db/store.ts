import { DatabaseSync } from 'node:sqlite';
import type {
  PersistedPlayerState,
  PlaylistDetail,
  PlaylistSummary,
  Track,
} from '../../shared/types';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artists TEXT NOT NULL,
    album_id TEXT,
    album_title TEXT,
    duration_sec INTEGER,
    thumbnail TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE favorites (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id),
    added_at INTEGER NOT NULL
  );
  CREATE TABLE playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id),
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX idx_playlist_items ON playlist_items(playlist_id, position);
  -- Canciones que realmente empezaron a sonar.
  CREATE TABLE plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(id),
    played_at INTEGER NOT NULL
  );
  CREATE INDEX idx_plays_at ON plays(played_at DESC);
  -- Canciones que el usuario solo eligió (pueden no haber sonado nunca).
  CREATE TABLE selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(id),
    selected_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

type Row = Record<string, unknown>;

const PLAYER_STATE_KEY = 'player_state';
export const MAX_PLAYLIST_NAME = 80;

export function cleanName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAYLIST_NAME);
  if (!n) throw new Error('El nombre no puede estar vacío.');
  return n;
}

function rowToTrack(r: Row): Track {
  return {
    id: String(r.id),
    title: String(r.title),
    artists: JSON.parse(String(r.artists)) as Track['artists'],
    album: r.album_title ? { id: (r.album_id as string | null) ?? undefined, title: String(r.album_title) } : undefined,
    durationSec: (r.duration_sec as number | null) ?? undefined,
    thumbnail: (r.thumbnail as string | null) ?? undefined,
  };
}

export function createStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const q = {
    upsertTrack: db.prepare(
      `INSERT INTO tracks(id,title,artists,album_id,album_title,duration_sec,thumbnail,updated_at)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, artists=excluded.artists, album_id=excluded.album_id,
         album_title=excluded.album_title, duration_sec=COALESCE(excluded.duration_sec, tracks.duration_sec),
         thumbnail=COALESCE(excluded.thumbnail, tracks.thumbnail), updated_at=excluded.updated_at`,
    ),
  };

  function upsertTrack(t: Track) {
    q.upsertTrack.run(
      t.id,
      t.title,
      JSON.stringify(t.artists),
      t.album?.id ?? null,
      t.album?.title ?? null,
      t.durationSec ?? null,
      t.thumbnail ?? null,
      Date.now(),
    );
  }

  // ---- favoritos
  function favorites(): Track[] {
    return (
      db
        .prepare('SELECT t.* FROM favorites f JOIN tracks t ON t.id = f.track_id ORDER BY f.added_at DESC, f.rowid DESC')
        .all() as Row[]
    ).map(rowToTrack);
  }
  function favoriteIds(): string[] {
    return (db.prepare('SELECT track_id FROM favorites').all() as Row[]).map((r) => String(r.track_id));
  }
  /** Devuelve el estado final: true = ahora es favorita. */
  function toggleFavorite(track: Track): boolean {
    return tx(() => {
      const has = db.prepare('SELECT 1 FROM favorites WHERE track_id = ?').get(track.id);
      if (has) {
        db.prepare('DELETE FROM favorites WHERE track_id = ?').run(track.id);
        return false;
      }
      upsertTrack(track);
      db.prepare('INSERT INTO favorites(track_id, added_at) VALUES(?,?)').run(track.id, Date.now());
      return true;
    });
  }

  // ---- playlists
  function summary(r: Row): PlaylistSummary {
    const id = Number(r.id);
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(t.duration_sec),0) AS dur
         FROM playlist_items i JOIN tracks t ON t.id = i.track_id WHERE i.playlist_id = ?`,
      )
      .get(id) as Row;
    const covers = (
      db
        .prepare(
          `SELECT t.thumbnail FROM playlist_items i JOIN tracks t ON t.id = i.track_id
           WHERE i.playlist_id = ? AND t.thumbnail IS NOT NULL ORDER BY i.position LIMIT 4`,
        )
        .all(id) as Row[]
    ).map((c) => String(c.thumbnail));
    return {
      id,
      name: String(r.name),
      trackCount: Number(agg.n),
      durationSec: Number(agg.dur),
      covers,
      updatedAt: Number(r.updated_at),
    };
  }
  function playlists(): PlaylistSummary[] {
    return (db.prepare('SELECT * FROM playlists ORDER BY updated_at DESC, id DESC').all() as Row[]).map(summary);
  }
  function playlist(id: number): PlaylistDetail {
    const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('La playlist no existe.');
    const items = (
      db
        .prepare(
          `SELECT i.id AS item_id, t.* FROM playlist_items i JOIN tracks t ON t.id = i.track_id
           WHERE i.playlist_id = ? ORDER BY i.position`,
        )
        .all(id) as Row[]
    ).map((r) => ({ itemId: Number(r.item_id), track: rowToTrack(r) }));
    return { ...summary(row), items };
  }
  function createPlaylist(name: string): PlaylistSummary {
    const now = Date.now();
    const res = db.prepare('INSERT INTO playlists(name,created_at,updated_at) VALUES(?,?,?)').run(cleanName(name), now, now);
    return summary(db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(res.lastInsertRowid)) as Row);
  }
  const touch = (id: number) => db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  function renamePlaylist(id: number, name: string) {
    db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(cleanName(name), Date.now(), id);
  }
  function deletePlaylist(id: number) {
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  }
  /** Omite las canciones que ya están. Devuelve cuántas se agregaron. */
  function addToPlaylist(id: number, tracks: Track[]): number {
    return tx(() => {
      if (!db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id)) throw new Error('La playlist no existe.');
      const present = new Set(
        (db.prepare('SELECT track_id FROM playlist_items WHERE playlist_id = ?').all(id) as Row[]).map((r) => String(r.track_id)),
      );
      let pos = Number((db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM playlist_items WHERE playlist_id = ?').get(id) as Row).m);
      let added = 0;
      for (const t of tracks) {
        if (present.has(t.id)) continue;
        present.add(t.id);
        upsertTrack(t);
        db.prepare('INSERT INTO playlist_items(playlist_id,track_id,position,added_at) VALUES(?,?,?,?)').run(id, t.id, ++pos, Date.now());
        added++;
      }
      if (added) touch(id);
      return added;
    });
  }
  function removeFromPlaylist(id: number, itemId: number) {
    tx(() => {
      db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(itemId, id);
      touch(id);
    });
  }
  /** `orderedItemIds` debe contener exactamente los items actuales. */
  function reorderPlaylist(id: number, orderedItemIds: number[]) {
    tx(() => {
      const current = (db.prepare('SELECT id FROM playlist_items WHERE playlist_id = ?').all(id) as Row[]).map((r) => Number(r.id));
      const same =
        current.length === orderedItemIds.length &&
        new Set(orderedItemIds).size === orderedItemIds.length &&
        orderedItemIds.every((x) => current.includes(x));
      if (!same) throw new Error('El orden recibido no coincide con la playlist.');
      const upd = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?');
      orderedItemIds.forEach((itemId, i) => upd.run(i, itemId));
      touch(id);
    });
  }

  // ---- historial: lo que sonó vs. lo que solo se eligió
  function recordPlay(track: Track) {
    tx(() => {
      upsertTrack(track);
      db.prepare('INSERT INTO plays(track_id, played_at) VALUES(?,?)').run(track.id, Date.now());
    });
  }
  function recordSelection(track: Track) {
    tx(() => {
      upsertTrack(track);
      db.prepare('INSERT INTO selections(track_id, selected_at) VALUES(?,?)').run(track.id, Date.now());
    });
  }
  /** Canciones distintas, la más reciente primero. */
  function recentPlays(limit: number): Track[] {
    return (
      db
        .prepare(
          `SELECT t.* FROM (SELECT track_id, MAX(id) AS last FROM plays GROUP BY track_id ORDER BY last DESC LIMIT ?) p
           JOIN tracks t ON t.id = p.track_id ORDER BY p.last DESC`,
        )
        .all(limit) as Row[]
    ).map(rowToTrack);
  }
  function selectionCount(): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM selections').get() as Row).n);
  }
  function playCount(): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM plays').get() as Row).n);
  }

  // ---- ajustes / estado del reproductor
  function getSetting<T>(key: string): T | null {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    if (!r) return null;
    try {
      return JSON.parse(String(r.value)) as T;
    } catch {
      return null;
    }
  }
  function setSetting(key: string, value: unknown) {
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
      key,
      JSON.stringify(value),
    );
  }
  function loadPlayerState(): PersistedPlayerState | null {
    return getSetting<PersistedPlayerState>(PLAYER_STATE_KEY);
  }
  function savePlayerState(state: PersistedPlayerState) {
    tx(() => {
      for (const t of state.queue) upsertTrack(t);
      setSetting(PLAYER_STATE_KEY, state);
    });
  }

  return {
    upsertTrack,
    favorites,
    favoriteIds,
    toggleFavorite,
    playlists,
    playlist,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    reorderPlaylist,
    recordPlay,
    recordSelection,
    recentPlays,
    selectionCount,
    playCount,
    getSetting,
    setSetting,
    loadPlayerState,
    savePlayerState,
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof createStore>;
