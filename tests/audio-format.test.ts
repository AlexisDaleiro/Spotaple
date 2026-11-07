import { describe, expect, it, vi } from 'vitest';
import { chooseAudioFormat } from '../src/main/music/youtube/format';

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

  it('si ningún intento sirve, propaga el error del último', () => {
    const info = fakeInfo(() => {
      throw new Error('nada');
    });
    expect(() => chooseAudioFormat(info, 'high')).toThrow('nada');
    expect(info.chooseFormat).toHaveBeenCalledTimes(2);
  });
});
