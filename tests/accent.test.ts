import { describe, expect, it } from 'vitest';
import { ACCENT_VARS, contrastRatio, deriveAccent, relativeLuminance } from '../src/renderer/src/lib/accent';

describe('deriveAccent', () => {
  it('conserva el acento, deriva hover y press, y arma el tono suave', () => {
    const v = deriveAccent('#ff5d73')!;
    expect(v['--accent']).toBe('#ff5d73');
    expect(v['--accent-soft']).toBe('rgba(255, 93, 115, 0.14)');
    expect(relativeLuminance(v['--accent-hover'])).toBeGreaterThan(relativeLuminance(v['--accent']));
    expect(relativeLuminance(v['--accent'])).toBeGreaterThan(relativeLuminance(v['--accent-press']));
  });

  it('el texto sobre el acento cumple contraste AA (oscuro en el amarillo, claro en el azul)', () => {
    for (const hex of ['#ff5d73', '#ffd60a', '#1d4ed8']) {
      const v = deriveAccent(hex)!;
      expect(contrastRatio(v['--accent-ink'], v['--accent'])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('devuelve null para lo que no es #rrggbb', () => {
    for (const bad of ['red', '#12345', '#GGGGGG', '', 'url(x)']) expect(deriveAccent(bad)).toBeNull();
  });

  it('ACCENT_VARS lista las cinco variables que se fijan', () => {
    expect([...ACCENT_VARS].sort()).toEqual(['--accent', '--accent-hover', '--accent-ink', '--accent-press', '--accent-soft']);
  });
});
