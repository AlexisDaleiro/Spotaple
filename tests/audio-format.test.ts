import { describe, expect, it, vi } from 'vitest';
import { chooseAudioFormat, loudnessOf } from '../src/main/music/youtube/format';

const fakeInfo = (impl: (o: { codec?: string }) => unknown) => ({ chooseFormat: vi.fn(impl) });

describe('chooseAudioFormat', () => {
  it('alta: pide Opus con la mejor calidad', () => {
    const info = fakeInfo(() => 'opus-best');
    expect(chooseAudioFormat(info, 'high')).toBe('opus-best');
    expect(info.chooseFormat).toHaveBeenCalledTimes(1);
    expect(info.chooseFormat).toHaveBeenCalledWith({ type: 'audio', quality: 'best', format: 'any', codec: 'opus' });
  });

  it('alta: si no hay Opus, cae al mejor formato disponible', () => {
    const info = fakeInfo((o) => {
      if (o.codec) throw new Error('sin opus');
      return 'aac-best';
    });
    expect(chooseAudioFormat(info, 'high')).toBe('aac-best');
    expect(info.chooseFormat).toHaveBeenLastCalledWith({ type: 'audio', quality: 'best' });
  });

  it('ahorro: pide el formato más eficiente, Opus primero y luego cualquiera', () => {
    const first = fakeInfo(() => 'opus-small');
    expect(chooseAudioFormat(first, 'saver')).toBe('opus-small');
    expect(first.chooseFormat).toHaveBeenCalledWith({ type: 'audio', quality: 'bestefficiency', format: 'any', codec: 'opus' });

    const fallback = fakeInfo((o) => {
      if (o.codec) throw new Error('sin opus');
      return 'aac-small';
    });
    expect(chooseAudioFormat(fallback, 'saver')).toBe('aac-small');
    expect(fallback.chooseFormat).toHaveBeenLastCalledWith({ type: 'audio', quality: 'bestefficiency', format: 'any' });
  });

  it('aac: pide el mejor mp4 una sola vez (el spike confirmó que eso elige el itag 140)', () => {
    const info = fakeInfo(() => 'aac-140');
    expect(chooseAudioFormat(info, 'aac')).toBe('aac-140');
    expect(info.chooseFormat).toHaveBeenCalledTimes(1);
    expect(info.chooseFormat).toHaveBeenCalledWith({ type: 'audio', quality: 'best', format: 'mp4' });
  });

  it('aac: si no hay mp4 propaga el error, sin caer a otro formato', () => {
    const info = fakeInfo(() => {
      throw new Error('sin mp4');
    });
    expect(() => chooseAudioFormat(info, 'aac')).toThrow('sin mp4');
    expect(info.chooseFormat).toHaveBeenCalledTimes(1);
  });

  it('si ningún intento sirve, propaga el error del último', () => {
    const info = fakeInfo(() => {
      throw new Error('nada');
    });
    expect(() => chooseAudioFormat(info, 'high')).toThrow('nada');
    expect(info.chooseFormat).toHaveBeenCalledTimes(2);
  });
});

describe('loudnessOf', () => {
  const info = (perceptual?: number) => ({ player_config: { audio_config: { perceptual_loudness_db: perceptual } } });

  it('prefiere el LUFS absoluto del formato', () => {
    expect(loudnessOf(info(-12), { track_absolute_loudness_lkfs: -8.85 })).toBe(-8.85);
  });

  it('si el formato no lo trae, usa perceptual_loudness_db de la info', () => {
    expect(loudnessOf(info(-13.87), {})).toBe(-13.87);
  });

  it('valores basura o fuera de −60…0 dan undefined (y el de respaldo se usa si el del formato es basura)', () => {
    for (const v of [NaN, Infinity, 0.5, -100]) expect(loudnessOf({}, { track_absolute_loudness_lkfs: v })).toBeUndefined();
    expect(loudnessOf(info(-10), { track_absolute_loudness_lkfs: NaN })).toBe(-10);
    expect(loudnessOf({}, {})).toBeUndefined();
  });
});
