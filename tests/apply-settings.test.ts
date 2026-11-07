import { describe, expect, it, vi } from 'vitest';
import { ACCENT_VARS } from '../src/renderer/src/lib/accent';
import { applySettings, type RootLike } from '../src/renderer/src/lib/apply-settings';
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings';

function apply(over: Partial<AppSettings>, systemLight = false) {
  const root = { dataset: {} as Record<string, string | undefined>, style: { setProperty: vi.fn(), removeProperty: vi.fn() } } satisfies RootLike;
  applySettings(root, { ...DEFAULT_SETTINGS, ...over }, systemLight);
  return root;
}

describe('applySettings', () => {
  it('tema «Sistema» se resuelve según el esquema del sistema', () => {
    expect(apply({ theme: 'system' }, true).dataset.theme).toBe('claro');
    expect(apply({ theme: 'system' }, false).dataset.theme).toBe('grafito');
    expect(apply({ theme: 'oceano' }, true).dataset.theme).toBe('oceano');
  });

  it('un acento válido fija las cinco variables', () => {
    const root = apply({ accent: '#1d4ed8' });
    const set = root.style.setProperty.mock.calls.map((c) => c[0]);
    for (const name of ACCENT_VARS) expect(set).toContain(name);
    expect(root.style.setProperty).toHaveBeenCalledWith('--accent', '#1d4ed8');
    expect(root.style.removeProperty).not.toHaveBeenCalled();
  });

  it('sin acento, o con uno inválido, quita las cinco variables y no fija ninguna', () => {
    for (const accent of [null, 'red']) {
      const root = apply({ accent });
      expect(root.style.removeProperty.mock.calls.map((c) => c[0]).sort()).toEqual([...ACCENT_VARS].sort());
      expect(root.style.setProperty).not.toHaveBeenCalledWith('--accent', expect.anything());
    }
  });

  it('escala de texto, densidad y animaciones', () => {
    const root = apply({ textScale: 1.25, density: 'compact', reduceMotion: true });
    expect(root.style.setProperty).toHaveBeenCalledWith('--text-scale', '1.25');
    expect(root.dataset.density).toBe('compact');
    expect(root.dataset.reduceMotion).toBe('true');
    expect(apply({}).dataset.reduceMotion).toBe('false');
  });
});
