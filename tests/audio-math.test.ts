import { describe, expect, it } from 'vitest';
import { crossfadeCurve, EQ_BANDS, EQ_PRESETS, EQ_RANGE_DB, normalizationGainDb, presetFor } from '../src/shared/audio';

describe('normalizationGainDb', () => {
  it('baja las canciones más fuertes que −14 LUFS hacia −14', () => {
    expect(normalizationGainDb(-8.85)).toBeCloseTo(-5.15, 5);
  });

  it('nunca sube: las que ya están en −14 o más bajo quedan en 0 dB', () => {
    expect(normalizationGainDb(-14)).toBe(0);
    expect(normalizationGainDb(-14.5)).toBe(0);
    expect(normalizationGainDb(-30)).toBe(0);
  });

  it('el recorte máximo es −12 dB', () => {
    expect(normalizationGainDb(-1)).toBe(-12);
  });

  it('sin loudness o con un valor no finito no hay ajuste (0 dB, nunca NaN)', () => {
    for (const v of [undefined, NaN, Infinity, -Infinity]) expect(normalizationGainDb(v)).toBe(0);
  });
});

describe('crossfadeCurve', () => {
  const out = crossfadeCurve(32, 'out');
  const inn = crossfadeCurve(32, 'in');

  it('sale de 1 a 0 y entra de 0 a 1', () => {
    expect(out).toHaveLength(32);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[31]).toBeCloseTo(0, 5);
    expect(inn[0]).toBeCloseTo(0, 5);
    expect(inn[31]).toBeCloseTo(1, 5);
  });

  it('es de potencia constante: in² + out² vale 1 en cada punto', () => {
    for (let i = 0; i < 32; i++) expect(inn[i]! ** 2 + out[i]! ** 2).toBeCloseTo(1, 5);
  });
});

describe('ecualizador', () => {
  it('tiene 10 bandas en orden creciente', () => {
    expect(EQ_BANDS).toHaveLength(10);
    for (let i = 1; i < EQ_BANDS.length; i++) expect(EQ_BANDS[i]!).toBeGreaterThan(EQ_BANDS[i - 1]!);
  });

  it('el primer preset es «plano» (todo en 0) y los ids no se repiten', () => {
    expect(EQ_PRESETS[0]!.id).toBe('plano');
    expect(EQ_PRESETS[0]!.gains.every((g) => g === 0) && EQ_PRESETS[0]!.preamp === 0).toBe(true);
    expect(new Set(EQ_PRESETS.map((p) => p.id)).size).toBe(EQ_PRESETS.length);
  });

  it('cada preset trae 10 ganancias y un preamplificador dentro de ±12 dB', () => {
    for (const p of EQ_PRESETS) {
      expect(p.gains).toHaveLength(10);
      for (const g of [...p.gains, p.preamp]) expect(Math.abs(g)).toBeLessThanOrEqual(EQ_RANGE_DB);
    }
  });

  it('presetFor devuelve el preset exacto o null («Personalizado»)', () => {
    for (const p of EQ_PRESETS) expect(presetFor(p.gains, p.preamp)).toBe(p);
    const bass = EQ_PRESETS.find((p) => p.id !== 'plano')!;
    expect(presetFor(bass.gains, bass.preamp + 0.5)).toBeNull();
    expect(presetFor(bass.gains.slice(1), bass.preamp)).toBeNull();
  });
});
