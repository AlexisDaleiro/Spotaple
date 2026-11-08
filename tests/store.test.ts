import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore, type Store } from '../src/main/db/store';
import { sanitizePlayerState, sanitizeRadioRequest, sanitizeTrack } from '../src/main/validate';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Track } from '../src/shared/types';

const t = (n: number, extra: Partial<Track> = {}): Track => ({
  id: `track${String(n).padStart(6, '0')}`,
  title: `Canción ${n}`,
  artists: [{ id: 'UCartist1', name: 'Artista' }],
  album: { id: 'MPREb_x', title: 'Disco' },
  durationSec: 100 + n,
  thumbnail: `https://lh3.googleusercontent.com/cover${n}=w120-h120`,
  ...extra,
});

let store: Store;
beforeEach(() => void (store = createStore(':memory:')));
afterEach(() => store.close());

describe('favoritos', () => {
  it('alterna y devuelve el estado final; la lista sale del más nuevo al más viejo', () => {
    expect(store.toggleFavorite(t(1))).toBe(true);
    expect(store.toggleFavorite(t(2))).toBe(true);
    expect(store.favoriteIds().sort()).toEqual([t(1).id, t(2).id]);
    expect(store.favorites().map((x) => x.id)).toEqual([t(2).id, t(1).id]);
    expect(store.toggleFavorite(t(1))).toBe(false);
    expect(store.favorites().map((x) => x.id)).toEqual([t(2).id]);
  });
  it('guarda los metadatos para reconstruir la biblioteca sin red', () => {
    store.toggleFavorite(t(3));
    expect(store.favorites()[0]).toEqual(t(3));
  });
});

describe('playlists', () => {
  it('crea, renombra y elimina; el nombre se normaliza y no puede quedar vacío', () => {
    const p = store.createPlaylist('  Mi   lista  ');
    expect(p.name).toBe('Mi lista');
    store.renamePlaylist(p.id, 'Otra');
    expect(store.playlists()[0]!.name).toBe('Otra');
    expect(() => store.createPlaylist('   ')).toThrow(/vacío/);
    expect(() => store.renamePlaylist(p.id, '')).toThrow();
    store.deletePlaylist(p.id);
    expect(store.playlists()).toHaveLength(0);
  });

  it('agrega canciones en orden, omite repetidas y informa cuántas entraron', () => {
    const p = store.createPlaylist('X');
    expect(store.addToPlaylist(p.id, [t(1), t(2), t(1)])).toBe(2);
    expect(store.addToPlaylist(p.id, [t(2), t(3)])).toBe(1);
    expect(store.playlist(p.id).items.map((i) => i.track.id)).toEqual([t(1).id, t(2).id, t(3).id]);
  });

  it('resumen: cantidad, duración total y hasta 4 portadas', () => {
    const p = store.createPlaylist('X');
    store.addToPlaylist(p.id, [t(1), t(2), t(3), t(4), t(5)]);
    const s = store.playlists()[0]!;
    expect(s.trackCount).toBe(5);
    expect(s.durationSec).toBe(101 + 102 + 103 + 104 + 105);
    expect(s.covers).toHaveLength(4);
  });

  it('quita canciones por item', () => {
    const p = store.createPlaylist('X');
    store.addToPlaylist(p.id, [t(1), t(2)]);
    const [first] = store.playlist(p.id).items;
    store.removeFromPlaylist(p.id, first!.itemId);
    expect(store.playlist(p.id).items.map((i) => i.track.id)).toEqual([t(2).id]);
  });

  it('reordena y persiste el orden; rechaza un orden que no coincide', () => {
    const p = store.createPlaylist('X');
    store.addToPlaylist(p.id, [t(1), t(2), t(3)]);
    const ids = store.playlist(p.id).items.map((i) => i.itemId);
    store.reorderPlaylist(p.id, [ids[2]!, ids[0]!, ids[1]!]);
    expect(store.playlist(p.id).items.map((i) => i.track.id)).toEqual([t(3).id, t(1).id, t(2).id]);
    expect(() => store.reorderPlaylist(p.id, [ids[0]!])).toThrow();
    expect(() => store.reorderPlaylist(p.id, [ids[0]!, ids[0]!, ids[1]!])).toThrow();
    expect(store.playlist(p.id).items.map((i) => i.track.id)).toEqual([t(3).id, t(1).id, t(2).id]);
  });

  it('eliminar una playlist no borra las canciones ni los favoritos', () => {
    const p = store.createPlaylist('X');
    store.addToPlaylist(p.id, [t(1)]);
    store.toggleFavorite(t(1));
    store.deletePlaylist(p.id);
    expect(store.favorites()).toHaveLength(1);
    expect(() => store.playlist(p.id)).toThrow(/no existe/);
  });
});

describe('historial: sonó vs. solo se eligió', () => {
  it('se guardan por separado', () => {
    store.recordSelection(t(1));
    store.recordSelection(t(2));
    store.recordPlay(t(2));
    expect(store.selectionCount()).toBe(2);
    expect(store.playCount()).toBe(1);
    expect(store.recentPlays(10).map((x) => x.id)).toEqual([t(2).id]); // la 1 nunca sonó
  });
  it('recientes: distintas, la última escuchada primero', () => {
    for (const n of [1, 2, 1, 3, 2]) store.recordPlay(t(n));
    expect(store.recentPlays(10).map((x) => x.id)).toEqual([t(2).id, t(3).id, t(1).id]);
    expect(store.recentPlays(2)).toHaveLength(2);
  });
});

describe('estado del reproductor', () => {
  it('guarda y restaura cola, índice, volumen y modos', () => {
    expect(store.loadPlayerState()).toBeNull();
    const state = { queue: [t(1), t(2)], index: 1, positionSec: 33, volume: 0.3, muted: true, repeat: 'all' as const, shuffle: true };
    store.savePlayerState(state);
    expect(store.loadPlayerState()).toEqual(state);
  });
});

describe('persistencia en disco entre sesiones', () => {
  it('lo guardado sigue ahí al reabrir el archivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spotaple-db-'));
    try {
      const file = join(dir, 'spotaple.db');
      const a = createStore(file);
      const p = a.createPlaylist('Persistente');
      a.addToPlaylist(p.id, [t(7)]);
      a.toggleFavorite(t(8));
      a.close();
      const b = createStore(file); // las migraciones no deben repetirse ni romper
      expect(b.playlists()[0]!.name).toBe('Persistente');
      expect(b.playlist(p.id).items[0]!.track.id).toBe(t(7).id);
      expect(b.favoriteIds()).toEqual([t(8).id]);
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('historial para la radio', () => {
  it('recordPlay guarda la marca auto y la afinidad solo cuenta lo que no es automático', () => {
    store.recordPlay(t(1));
    store.recordPlay(t(2), true);
    const { plays } = store.affinityInputs(10);
    expect(plays).toHaveLength(1);
    expect(plays[0]!.artists).toEqual(t(1).artists);
    expect(typeof plays[0]!.playedAt).toBe('number');
    expect(store.recentPlayIds(10)).toEqual([t(2).id, t(1).id]);
  });

  it('recentPlayIds devuelve ids distintos, respeta el límite y va de lo más reciente a lo más viejo', () => {
    store.recordPlay(t(1));
    store.recordPlay(t(2));
    store.recordPlay(t(1));
    expect(store.recentPlayIds(10)).toEqual([t(1).id, t(2).id]);
    expect(store.recentPlayIds(1)).toEqual([t(1).id]);
  });

  it('affinityInputs trae las favoritas con sus artistas y respeta el límite de reproducciones', () => {
    store.toggleFavorite(t(3));
    for (let n = 1; n <= 5; n++) store.recordPlay(t(n));
    const a = store.affinityInputs(2);
    expect(a.favorites).toEqual([{ artists: t(3).artists }]);
    expect(a.plays).toHaveLength(2);
  });

  it('una base creada con la migración 1 sube a la 2 sin perder reproducciones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spotaple-radio-'));
    const file = join(dir, 'old.db');
    try {
      const first = createStore(file);
      first.recordPlay(t(1));
      first.close();
      const raw = new DatabaseSync(file);
      raw.exec('ALTER TABLE plays DROP COLUMN auto; DROP TABLE downloads; PRAGMA user_version = 1;');
      raw.close();
      const again = createStore(file);
      expect(again.affinityInputs(10).plays).toHaveLength(1);
      again.recordPlay(t(2), true);
      expect(again.recentPlayIds(10)).toEqual([t(2).id, t(1).id]);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('descargas offline', () => {
  it('guarda y lista las descargas; otra del mismo id reemplaza a la anterior', () => {
    store.toggleFavorite(t(1));
    store.addDownload(t(1).id, 'opus', 123);
    expect(store.downloads()).toEqual([{ trackId: t(1).id, format: 'opus', bytes: 123 }]);
    store.addDownload(t(1).id, 'aac', 456);
    expect(store.downloads()).toEqual([{ trackId: t(1).id, format: 'aac', bytes: 456 }]);
  });

  it('removeDownload borra una y clearDownloads borra todas', () => {
    for (const n of [1, 2, 3]) {
      store.toggleFavorite(t(n));
      store.addDownload(t(n).id, 'opus', n);
    }
    store.removeDownload(t(2).id);
    expect(store.downloads().map((d) => d.trackId).sort()).toEqual([t(1).id, t(3).id]);
    store.clearDownloads();
    expect(store.downloads()).toEqual([]);
  });

  it('trackDuration devuelve la duración guardada y undefined si falta o la canción no existe', () => {
    store.toggleFavorite(t(4));
    store.toggleFavorite(t(5, { durationSec: undefined }));
    expect(store.trackDuration(t(4).id)).toBe(104);
    expect(store.trackDuration(t(5).id)).toBeUndefined();
    expect(store.trackDuration('noExiste123')).toBeUndefined();
  });

  it('una base en la migración 2 sube a la 3 sin perder favoritas, y las descargas sobreviven al reabrir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spotaple-dl-'));
    const file = join(dir, 'old.db');
    try {
      const first = createStore(file);
      first.toggleFavorite(t(1));
      first.close();
      const raw = new DatabaseSync(file);
      raw.exec('DROP TABLE downloads; PRAGMA user_version = 2;');
      raw.close();
      const again = createStore(file);
      expect(again.favoriteIds()).toEqual([t(1).id]);
      again.addDownload(t(1).id, 'opus', 99);
      again.close();
      const third = createStore(file);
      expect(third.downloads()).toEqual([{ trackId: t(1).id, format: 'opus', bytes: 99 }]);
      third.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ajustes de la app', () => {
  it('una base nueva devuelve los valores por defecto', () => {
    expect(store.getAppSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('guarda jamName en la clave jam_name y el resto en app_settings', () => {
    const next = store.setAppSettings({ theme: 'claro', jamName: 'Ale' });
    expect(next).toMatchObject({ theme: 'claro', jamName: 'Ale' });
    expect(store.getSetting('jam_name')).toBe('Ale');
    const blob = store.getSetting<Record<string, unknown>>('app_settings');
    expect(blob).toMatchObject({ theme: 'claro' });
    expect(blob).not.toHaveProperty('jamName');
  });

  it('lee el nombre que la sala ya guardó en jam_name', () => {
    store.setSetting('jam_name', 'Ale');
    expect(store.getAppSettings().jamName).toBe('Ale');
  });

  it('un JSON corrupto conserva lo válido y usa los valores por defecto en el resto', () => {
    store.setSetting('app_settings', { theme: 'neon', textScale: 99, density: 'compact' });
    expect(store.getAppSettings()).toEqual({ ...DEFAULT_SETTINGS, density: 'compact' });
  });

  it('un parche inválido no cambia nada', () => {
    store.setAppSettings({ theme: 'oceano' });
    const after = store.setAppSettings({ theme: 'neon' } as never);
    expect(after.theme).toBe('oceano');
    expect(store.getAppSettings().theme).toBe('oceano');
  });
});

describe('validación de lo que llega del renderer', () => {
  it('descarta miniaturas que no sean https y recorta el resto', () => {
    expect(sanitizeTrack(t(1, { thumbnail: 'javascript:alert(1)' })).thumbnail).toBeUndefined();
    expect(sanitizeTrack(t(1, { thumbnail: 'file:///C:/secreto.png' })).thumbnail).toBeUndefined();
    expect(sanitizeTrack(t(1)).thumbnail).toContain('https://');
  });
  it('rechaza ids inválidos, artistas de más y formas inesperadas', () => {
    expect(() => sanitizeTrack(t(1, { id: '../../etc' }))).toThrow();
    expect(() => sanitizeTrack(t(1, { artists: Array.from({ length: 30 }, () => ({ name: 'x' })) }))).toThrow();
    expect(() => sanitizeTrack(null)).toThrow();
    expect(() => sanitizeTrack({ ...t(1), title: '' })).toThrow();
  });
  it('la petición de radio valida la semilla y los ids a excluir', () => {
    expect(sanitizeRadioRequest({ seed: t(1), excludeIds: ['abcDEF12345'] })).toEqual({ seed: sanitizeTrack(t(1)), excludeIds: ['abcDEF12345'] });
    expect(() => sanitizeRadioRequest(null)).toThrow();
    expect(() => sanitizeRadioRequest({ seed: t(1), excludeIds: 'x' })).toThrow();
    expect(() => sanitizeRadioRequest({ seed: t(1), excludeIds: Array.from({ length: 2001 }, () => 'abcDEF12345') })).toThrow();
    expect(() => sanitizeRadioRequest({ seed: t(1), excludeIds: ['../x'] })).toThrow();
    expect(() => sanitizeRadioRequest({ seed: { id: '../x' }, excludeIds: [] })).toThrow();
  });
  it('el estado del reproductor se acota a rangos válidos', () => {
    const s = sanitizePlayerState({ queue: [t(1)], index: 99, positionSec: -5, volume: 7, muted: 'sí', repeat: 'rara', shuffle: 1 });
    expect(s).toMatchObject({ index: 0, positionSec: 0, volume: 1, muted: false, repeat: 'off', shuffle: false });
  });
});
