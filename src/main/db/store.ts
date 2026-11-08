import { DatabaseSync } from 'node:sqlite';
import { parseFormat, type AudioFormat } from '../../shared/offline';
import { DEFAULT_SETTINGS, parseSettings, type AppSettings } from '../../shared/settings';
import type { AffinityInputs } from '../music/radio';
import type { TasteInputs } from '../music/taste';
import type {
  ArtistSummary,
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
  // Marca las reproducciones que empezaron solas desde la radio: no cuentan como gusto del usuario.
  `
  ALTER TABLE plays ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
  `,
  // Canciones guardadas en el disco para escucharlas sin internet (el archivo vive en userData/offline).
  `
  CREATE TABLE downloads (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id),
    format TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // Listas de «Hecho para vos» por período. Para kind = 'artists' la columna `tracks` guarda artistas, no canciones.
  `
  CREATE TABLE generated_lists (
    kind TEXT NOT NULL,
    slot TEXT NOT NULL,
    period TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    tracks TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (kind, slot, period)
  );
  `,
  // Loudness (LUFS absolutos) de cada canción: una descargada suena del disco sin pasar por YouTube y necesita el dato.
  `
  ALTER TABLE tracks ADD COLUMN loudness REAL;
  `,
];

/** Una lista generada tal como se guarda: canciones, o artistas si `kind` es `'artists'`. */
export interface StoredList {
  kind: string;
  slot: string;
  period: string;
  title: string;
  subtitle: string;
  items: Track[] | ArtistSummary[];
  createdAt: number;
}

const TASTE_RESET_KEY = 'taste_reset_at';
const RADAR_SEEN_KEY = 'radar_seen';
const RADAR_SEEN_MAX = 2000;
/** Períodos que se conservan por lista (el vigente y el anterior, que se muestra mientras se regenera). */
const KEEP_PERIODS = 2;

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
  /** `auto`: la puso la radio y avanzó sola (no la eligió el usuario). */
  function recordPlay(track: Track, auto = false) {
    tx(() => {
      upsertTrack(track);
      db.prepare('INSERT INTO plays(track_id, played_at, auto) VALUES(?,?,?)').run(track.id, Date.now(), auto ? 1 : 0);
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
  /** Ids distintos de las últimas reproducciones (automáticas o no), la más reciente primero. */
  function recentPlayIds(limit: number): string[] {
    return (db.prepare('SELECT track_id FROM plays GROUP BY track_id ORDER BY MAX(id) DESC LIMIT ?').all(limit) as Row[]).map((r) => String(r.track_id));
  }
  /** Marca de «Reiniciar mis gustos» (0 si nunca se reinició). */
  function tasteResetAt(): number {
    const v = getSetting<unknown>(TASTE_RESET_KEY);
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  /** Ignora lo anterior a `now` (reproducciones y favoritas agregadas). No borra nada. */
  function resetTaste(now: number) {
    setSetting(TASTE_RESET_KEY, now);
  }
  /**
   * Lo que alimenta el perfil de gustos: reproducciones NO automáticas (las últimas `limit`) y favoritas, posteriores a
   * la marca de «Reiniciar mis gustos».
   */
  function tasteInputs(limit: number): TasteInputs {
    const since = tasteResetAt();
    const artists = (r: Row) => JSON.parse(String(r.artists)) as Track['artists'];
    const plays = db
      .prepare(
        `SELECT p.track_id AS track_id, t.artists AS artists, p.played_at AS played_at FROM plays p JOIN tracks t ON t.id = p.track_id
         WHERE p.auto = 0 AND p.played_at > ? ORDER BY p.id DESC LIMIT ?`,
      )
      .all(since, limit) as Row[];
    const favorites = db
      .prepare('SELECT f.track_id AS track_id, t.artists AS artists, f.added_at AS added_at FROM favorites f JOIN tracks t ON t.id = f.track_id WHERE f.added_at > ?')
      .all(since) as Row[];
    return {
      plays: plays.map((r) => ({ trackId: String(r.track_id), artists: artists(r), playedAt: Number(r.played_at) })),
      favorites: favorites.map((r) => ({ trackId: String(r.track_id), artists: artists(r), addedAt: Number(r.added_at) })),
    };
  }
  /** Lo que usa la radio para medir afinidad por artista: lo mismo que el perfil de gustos, sin ids de canción. */
  function affinityInputs(limit: number): AffinityInputs {
    const input = tasteInputs(limit);
    return {
      plays: input.plays.map((p) => ({ artists: p.artists, playedAt: p.playedAt })),
      favorites: input.favorites.map((f) => ({ artists: f.artists })),
    };
  }
  /** Ids distintos de todo lo que alguna vez sonó (automáticas incluidas): lo que el semanal no vuelve a ofrecer. */
  function playedTrackIds(): string[] {
    return (db.prepare('SELECT DISTINCT track_id FROM plays').all() as Row[]).map((r) => String(r.track_id));
  }
  /** Canciones distintas que escuchaste (no automáticas) o marcaste favoritas, posteriores al reinicio, las más recientes primero. */
  function knownTracks(limit: number): Track[] {
    const since = tasteResetAt();
    return (
      db
        .prepare(
          `SELECT t.*, MAX(x.at) AS at FROM (
             SELECT track_id, played_at AS at FROM plays WHERE auto = 0 AND played_at > ?
             UNION ALL
             SELECT track_id, added_at AS at FROM favorites WHERE added_at > ?
           ) x JOIN tracks t ON t.id = x.track_id GROUP BY t.id ORDER BY at DESC LIMIT ?`,
        )
        .all(since, since, limit) as Row[]
    ).map(rowToTrack);
  }

  // ---- listas generadas de «Hecho para vos»
  /** La fila del período más nuevo de cada lista (kind + slot). */
  function generatedLists(): StoredList[] {
    const rows = db
      .prepare(
        `SELECT * FROM generated_lists g
         WHERE g.period = (SELECT MAX(period) FROM generated_lists WHERE kind = g.kind AND slot = g.slot)
         ORDER BY g.kind, g.slot`,
      )
      .all() as Row[];
    return rows.flatMap((r) => {
      try {
        const items = JSON.parse(String(r.tracks)) as StoredList['items'];
        if (!Array.isArray(items)) return [];
        return [{ kind: String(r.kind), slot: String(r.slot), period: String(r.period), title: String(r.title), subtitle: String(r.subtitle), items, createdAt: Number(r.created_at) }];
      } catch {
        return [];
      }
    });
  }
  /** Reemplaza la fila del mismo kind + slot + period y conserva solo los 2 períodos más nuevos de esa lista. */
  function saveGenerated(list: StoredList) {
    tx(() => {
      db.prepare(
        `INSERT INTO generated_lists(kind, slot, period, title, subtitle, tracks, created_at) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(kind, slot, period) DO UPDATE SET title=excluded.title, subtitle=excluded.subtitle, tracks=excluded.tracks, created_at=excluded.created_at`,
      ).run(list.kind, list.slot, list.period, list.title, list.subtitle, JSON.stringify(list.items), list.createdAt);
      db.prepare(
        `DELETE FROM generated_lists WHERE kind = ? AND slot = ?
         AND period NOT IN (SELECT period FROM generated_lists WHERE kind = ? AND slot = ? ORDER BY period DESC LIMIT ?)`,
      ).run(list.kind, list.slot, list.kind, list.slot, KEEP_PERIODS);
    });
  }
  function clearGenerated() {
    db.exec('DELETE FROM generated_lists');
  }

  // ---- lanzamientos que el Release Radar ya mostró
  function radarSeen(): string[] {
    const v = getSetting<unknown>(RADAR_SEEN_KEY);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
  /** Sin repetidos (un id repetido cuenta como el más reciente) y con tope: conserva los últimos. */
  function saveRadarSeen(ids: string[]) {
    const latest = new Map<string, true>();
    for (const id of ids) {
      latest.delete(id);
      latest.set(id, true);
    }
    setSetting(RADAR_SEEN_KEY, [...latest.keys()].slice(-RADAR_SEEN_MAX));
  }
  function selectionCount(): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM selections').get() as Row).n);
  }
  function playCount(): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM plays').get() as Row).n);
  }

  // ---- descargas offline (índice de lo que hay en userData/offline)
  function downloads(): { trackId: string; format: AudioFormat; bytes: number }[] {
    const rows = db.prepare('SELECT track_id, format, bytes FROM downloads').all() as Row[];
    return rows.flatMap((r) => {
      const format = parseFormat(r.format);
      return format ? [{ trackId: String(r.track_id), format, bytes: Number(r.bytes) }] : [];
    });
  }
  /** Reemplaza la fila si la canción ya tenía una. La canción debe existir en `tracks`. */
  function addDownload(trackId: string, format: AudioFormat, bytes: number) {
    db.prepare(
      `INSERT INTO downloads(track_id, format, bytes, created_at) VALUES(?,?,?,?)
       ON CONFLICT(track_id) DO UPDATE SET format=excluded.format, bytes=excluded.bytes, created_at=excluded.created_at`,
    ).run(trackId, format, bytes, Date.now());
  }
  function removeDownload(trackId: string) {
    db.prepare('DELETE FROM downloads WHERE track_id = ?').run(trackId);
  }
  function clearDownloads() {
    db.exec('DELETE FROM downloads');
  }
  /** Guarda el loudness (LUFS) de una canción que ya existe en `tracks`; si no existe, no hace nada. */
  function setLoudness(trackId: string, lkfs: number) {
    db.prepare('UPDATE tracks SET loudness = ? WHERE id = ?').run(lkfs, trackId);
  }
  function trackLoudness(trackId: string): number | undefined {
    const r = db.prepare('SELECT loudness FROM tracks WHERE id = ?').get(trackId) as Row | undefined;
    return (r?.loudness as number | null | undefined) ?? undefined;
  }
  function trackDuration(trackId: string): number | undefined {
    const r = db.prepare('SELECT duration_sec FROM tracks WHERE id = ?').get(trackId) as Row | undefined;
    return (r?.duration_sec as number | null | undefined) ?? undefined;
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
  /** Ajustes de la app. `jamName` vive en la clave `jam_name` (la sala ya la usa); el resto, en un solo JSON. */
  const APP_SETTINGS_KEY = 'app_settings';
  function getAppSettings(): AppSettings {
    return {
      ...DEFAULT_SETTINGS,
      ...parseSettings(getSetting(APP_SETTINGS_KEY)),
      jamName: parseSettings({ jamName: getSetting('jam_name') }).jamName ?? DEFAULT_SETTINGS.jamName,
    };
  }
  function setAppSettings(patch: Partial<AppSettings>): AppSettings {
    const { jamName, ...rest } = parseSettings(patch);
    tx(() => {
      if (jamName !== undefined) setSetting('jam_name', jamName);
      if (Object.keys(rest).length) {
        const blob = parseSettings(getSetting(APP_SETTINGS_KEY));
        delete blob.jamName;
        setSetting(APP_SETTINGS_KEY, { ...blob, ...rest });
      }
    });
    return getAppSettings();
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
    recentPlayIds,
    affinityInputs,
    getAppSettings,
    setAppSettings,
    downloads,
    addDownload,
    removeDownload,
    clearDownloads,
    trackDuration,
    setLoudness,
    trackLoudness,
    tasteInputs,
    resetTaste,
    playedTrackIds,
    knownTracks,
    generatedLists,
    saveGenerated,
    clearGenerated,
    radarSeen,
    saveRadarSeen,
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof createStore>;
