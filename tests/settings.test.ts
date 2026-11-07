import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/shared/jam/types';
import { DEFAULT_SETTINGS, TEXT_SCALES, THEMES, chromeFor, parseSettings, resolveTheme } from '../src/shared/settings';

describe('parseSettings', () => {
  it('conserva lo válido y normaliza el acento a minúsculas', () => {
    const input = { theme: 'claro', accent: '#AABBCC', textScale: 1.25, density: 'compact', reduceMotion: true, streamQuality: 'saver', resumeOnOpen: true, jamName: 'Ale' };
    expect(parseSettings(input)).toEqual({ ...input, accent: '#aabbcc' });
  });

  it('descarta todo lo inválido o desconocido', () => {
    const junk = { theme: 'neon', accent: 'red', textScale: 99, density: 'x', reduceMotion: 'yes', streamQuality: 'ultra', resumeOnOpen: 1, jamName: 42, extra: true };
    expect(parseSettings(junk)).toEqual({});
  });

  it('acepta accent null y descarta colores que no son #rrggbb', () => {
    expect(parseSettings({ accent: null })).toEqual({ accent: null });
    for (const bad of ['#12', '#GGGGGG', 'url(x)', '']) expect(parseSettings({ accent: bad })).toEqual({});
  });

  it('jamName: vacío borra, se recorta, y rechaza control o exceso de largo', () => {
    expect(parseSettings({ jamName: '' })).toEqual({ jamName: '' });
    expect(parseSettings({ jamName: '  Ale  ' })).toEqual({ jamName: 'Ale' });
    expect(parseSettings({ jamName: 'a\u0007b' })).toEqual({});
    expect(parseSettings({ jamName: 'x'.repeat(LIMITS.name + 1) })).toEqual({});
  });

  it('entradas que no son objeto dan {} y __proto__ no contamina', () => {
    expect(parseSettings(null)).toEqual({});
    expect(parseSettings('x')).toEqual({});
    expect(parseSettings([])).toEqual({});
    expect(parseSettings(JSON.parse('{"__proto__":{"theme":"claro"}}'))).toEqual({});
    expect(({} as { theme?: string }).theme).toBeUndefined();
  });

  it('textScale solo acepta los valores de TEXT_SCALES', () => {
    for (const s of TEXT_SCALES) expect(parseSettings({ textScale: s })).toEqual({ textScale: s });
    expect(parseSettings({ textScale: 1.05 })).toEqual({});
  });
});

describe('resolveTheme', () => {
  it('sistema → claro u oscuro según el sistema; los demás se mantienen', () => {
    expect(resolveTheme('system', true)).toBe('claro');
    expect(resolveTheme('system', false)).toBe('grafito');
    expect(resolveTheme('oceano', true)).toBe('oceano');
  });
});

describe('chromeFor', () => {
  const colors = (id: string) => {
    const t = THEMES.find((x) => x.id === id)!;
    return { bg: t.bg, symbol: t.symbol };
  };

  it('devuelve los colores de la ventana del tema resuelto', () => {
    expect(chromeFor({ ...DEFAULT_SETTINGS, theme: 'system' }, true)).toEqual(colors('claro'));
    expect(chromeFor({ ...DEFAULT_SETTINGS, theme: 'system' }, false)).toEqual(colors('grafito'));
    expect(chromeFor({ ...DEFAULT_SETTINGS, theme: 'oceano' }, true)).toEqual(colors('oceano'));
  });
});

describe('THEMES y valores por defecto', () => {
  it('cuatro temas concretos; solo claro es de esquema claro; colores #rrggbb', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['grafito', 'claro', 'medianoche', 'oceano']);
    expect(THEMES.filter((t) => t.scheme === 'light').map((t) => t.id)).toEqual(['claro']);
    for (const t of THEMES) {
      expect(t.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.symbol).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.accentBg).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('el tema por defecto conserva el aspecto actual (grafito)', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('grafito');
  });
});
