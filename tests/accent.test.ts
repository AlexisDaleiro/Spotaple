import { describe, expect, it } from 'vitest';
import { ACCENT_VARS, contrastRatio, deriveAccent, relativeLuminance } from '../src/renderer/src/lib/accent';

describe('deriveAccent según el fondo', () => {
  const LIGHT = '#e8eaee';
  const DARK = '#24262c';

  it('no cambia un acento que ya se lee sobre el fondo', () => {
    expect(deriveAccent('#ff5d73', DARK)!['--accent']).toBe('#ff5d73');
  });

  it('sobre un fondo claro oscurece el acento hasta 4.5:1 y el texto sobre él cumple AA', () => {
    for (const hex of ['#ffd60a', '#38bdf8', '#ff5d73']) {
      const v = deriveAccent(hex, LIGHT)!;
      expect(contrastRatio(v['--accent'], LIGHT)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v['--accent-ink'], v['--accent'])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('sobre un fondo oscuro aclara un acento oscuro hasta 4.5:1 y el texto sobre él cumple AA', () => {
    for (const hex of ['#1d4ed8', '#000000']) {
      const v = deriveAccent(hex, DARK)!;
      expect(contrastRatio(v['--accent'], DARK)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v['--accent-ink'], v['--accent'])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('un fondo inválido se ignora: no hay ajuste', () => {
    expect(deriveAccent('#1d4ed8', 'red')!['--accent']).toBe('#1d4ed8');
  });
});

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
