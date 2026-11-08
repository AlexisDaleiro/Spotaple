import { describe, expect, it } from 'vitest';
import { formatBytes } from '../src/renderer/src/lib/format';

describe('formatBytes', () => {
  it('cero se muestra en MB', () => {
    expect(formatBytes(0)).toBe('0 MB');
  });

  it('menos de 1 MB va en KB, con un mínimo de 1 KB', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(10)).toBe('1 KB');
  });

  it('de 1 MB a 1 GB va en MB con un decimal y coma', () => {
    expect(formatBytes(1024 * 1024)).toBe('1,0 MB');
    expect(formatBytes(5_300_000)).toBe('5,1 MB');
  });

  it('desde 1 GB va en GB con dos decimales y coma', () => {
    expect(formatBytes(3 * 1024 ** 3)).toBe('3,00 GB');
  });
});
