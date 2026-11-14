import { describe, expect, it } from 'vitest';
import type { ResolvedAudio } from '../src/main/music/provider';
import { createAudioCache, createQualityLock } from '../src/main/music/youtube/audio-cache';

const audio = (expiresAt: number): ResolvedAudio => ({ url: 'https://example.invalid/a', mimeType: 'audio/webm', expiresAt });

describe('calidad fijada por canción', () => {
  it('recuerda la calidad con la que se empezó la canción', () => {
    const lock = createQualityLock();
    expect(lock.get('abc123')).toBeUndefined();
    lock.lock('abc123', 'saver');
    expect(lock.get('abc123')).toBe('saver');
    lock.lock('abc123', 'high');
    expect(lock.get('abc123')).toBe('high');
  });

  it('al pasarse del tope olvida la más vieja', () => {
    const lock = createQualityLock(2);
    lock.lock('uno111', 'high');
    lock.lock('dos222', 'high');
    lock.lock('tres33', 'saver');
    expect(lock.get('uno111')).toBeUndefined();
    expect(lock.get('dos222')).toBe('high');
    expect(lock.get('tres33')).toBe('saver');
  });
});

describe('caché de audio resuelto', () => {
  it('al llegar al tope descarta la entrada menos reciente y recupera lugares vencidos', () => {
    let now = 0;
    const cache = createAudioCache(() => now, 2);
    cache.set('high', 'a', audio(200));
    cache.set('high', 'b', audio(200));
    expect(cache.get('high', 'a')).toBeDefined();
    cache.set('high', 'c', audio(100));
    expect(cache.get('high', 'b')).toBeUndefined();
    now = 101;
    cache.set('high', 'd', audio(200));
    expect(cache.get('high', 'c')).toBeUndefined();
    expect(cache.get('high', 'a')).toBeDefined();
    expect(cache.get('high', 'd')).toBeDefined();
  });

  it('la clave incluye la calidad: lo resuelto en Alta no sirve en Ahorro', () => {
    const cache = createAudioCache(() => 1000);
    const high = audio(5000);
    cache.set('high', 'abc123', high);
    expect(cache.get('high', 'abc123')).toBe(high);
    expect(cache.get('saver', 'abc123')).toBeUndefined();
  });

  it('una entrada vencida no se devuelve', () => {
    let t = 1000;
    const cache = createAudioCache(() => t);
    cache.set('high', 'abc123', audio(2000));
    expect(cache.get('high', 'abc123')).toBeDefined();
    t = 2000;
    expect(cache.get('high', 'abc123')).toBeUndefined();
  });

  it('distingue las tres variantes de la misma canción', () => {
    const cache = createAudioCache(() => 0);
    const aac = audio(9999);
    cache.set('aac', 'abc123', aac);
    expect(cache.get('aac', 'abc123')).toBe(aac);
    expect(cache.get('high', 'abc123')).toBeUndefined();
    expect(cache.get('saver', 'abc123')).toBeUndefined();
  });

  it('invalidate borra la canción en las tres variantes', () => {
    const cache = createAudioCache(() => 0);
    cache.set('high', 'abc123', audio(9999));
    cache.set('saver', 'abc123', audio(9999));
    cache.set('aac', 'abc123', audio(9999));
    cache.set('high', 'otra99', audio(9999));
    cache.invalidate('abc123');
    expect(cache.get('high', 'abc123')).toBeUndefined();
    expect(cache.get('saver', 'abc123')).toBeUndefined();
    expect(cache.get('aac', 'abc123')).toBeUndefined();
    expect(cache.get('high', 'otra99')).toBeDefined();
  });
});
