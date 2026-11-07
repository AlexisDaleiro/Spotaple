import { describe, expect, it } from 'vitest';
import type { ResolvedAudio } from '../src/main/music/provider';
import { createAudioCache } from '../src/main/music/youtube/audio-cache';

const audio = (expiresAt: number): ResolvedAudio => ({ url: 'https://example.invalid/a', mimeType: 'audio/webm', expiresAt });

describe('caché de audio resuelto', () => {
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

  it('invalidate borra la canción en ambas calidades', () => {
    const cache = createAudioCache(() => 0);
    cache.set('high', 'abc123', audio(9999));
    cache.set('saver', 'abc123', audio(9999));
    cache.set('high', 'otra99', audio(9999));
    cache.invalidate('abc123');
    expect(cache.get('high', 'abc123')).toBeUndefined();
    expect(cache.get('saver', 'abc123')).toBeUndefined();
    expect(cache.get('high', 'otra99')).toBeDefined();
  });
});
