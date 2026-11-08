import { describe, expect, it, vi } from 'vitest';
import { createLoudnessFill } from '../src/main/loudness';
import type { ResolvedAudio } from '../src/main/music/provider';

const audio = (loudnessLkfs?: number): ResolvedAudio => ({ url: 'https://x.example/a', mimeType: 'audio/webm', expiresAt: Date.now() + 1e6, loudnessLkfs });

function setup(o: { normalize?: boolean; resolve?: () => Promise<ResolvedAudio>; timeoutMs?: number } = {}) {
  const resolveAudio = vi.fn(o.resolve ?? (async () => audio(-9.5)));
  const setLoudness = vi.fn();
  const fill = createLoudnessFill({ provider: { resolveAudio }, store: { setLoudness }, enabled: () => o.normalize ?? true, timeoutMs: o.timeoutMs ?? 50 });
  return { fill, resolveAudio, setLoudness };
}

describe('completar el loudness de una descargada', () => {
  it('sin dato y con «Normalizar» activo: lo pide, lo guarda y lo devuelve', async () => {
    const { fill, resolveAudio, setLoudness } = setup();
    expect(await fill('abcDEF12345')).toBe(-9.5);
    expect(resolveAudio).toHaveBeenCalledWith('abcDEF12345');
    expect(setLoudness).toHaveBeenCalledWith('abcDEF12345', -9.5);
  });

  it('con «Normalizar» apagado no toca la red y no gasta el intento', async () => {
    let on = false;
    const resolveAudio = vi.fn(async () => audio(-9.5));
    const fill = createLoudnessFill({ provider: { resolveAudio }, store: { setLoudness: vi.fn() }, enabled: () => on, timeoutMs: 50 });
    expect(await fill('abcDEF12345')).toBeUndefined();
    expect(resolveAudio).not.toHaveBeenCalled();
    on = true; // se activa después: ahora sí se completa
    expect(await fill('abcDEF12345')).toBe(-9.5);
  });

  it('un error de red da undefined, no lanza, y no se reintenta en la sesión', async () => {
    const { fill, resolveAudio, setLoudness } = setup({ resolve: async () => Promise.reject(new Error('sin red')) });
    expect(await fill('abcDEF12345')).toBeUndefined();
    expect(await fill('abcDEF12345')).toBeUndefined();
    expect(resolveAudio).toHaveBeenCalledTimes(1);
    expect(setLoudness).not.toHaveBeenCalled();
  });

  it('si YouTube no informa loudness no guarda nada', async () => {
    const { fill, setLoudness } = setup({ resolve: async () => audio(undefined) });
    expect(await fill('abcDEF12345')).toBeUndefined();
    expect(setLoudness).not.toHaveBeenCalled();
  });

  it('si tarda más que el tiempo máximo no hace esperar, pero guarda el dato cuando llega', async () => {
    let finish!: (a: ResolvedAudio) => void;
    const slow = new Promise<ResolvedAudio>((r) => (finish = r));
    const { fill, setLoudness } = setup({ resolve: () => slow, timeoutMs: 10 });
    expect(await fill('abcDEF12345')).toBeUndefined();
    expect(setLoudness).not.toHaveBeenCalled();
    finish(audio(-11));
    await new Promise((r) => setTimeout(r, 0));
    expect(setLoudness).toHaveBeenCalledWith('abcDEF12345', -11);
  });
});
