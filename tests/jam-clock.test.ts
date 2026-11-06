import { describe, expect, it } from 'vitest';
import { driftAction, estimateOffset, positionAt } from '../src/shared/jam/clock';
import type { JamItem, JamNow } from '../src/shared/jam/types';

const item: JamItem = { itemId: '1', track: { id: 'dQw4w9WgXcQ', title: 'Tema', artists: [{ name: 'Alguien' }] }, addedBy: 'mara', addedAt: 0 };
const nowOf = (p: Partial<JamNow>): JamNow => ({ item, status: 'playing', anchorMs: null, pausedAtSec: 0, skipVotes: [], likes: [], ...p });

describe('estimateOffset', () => {
  it('elige la muestra de menor RTT', () => {
    const samples = [
      { sentAt: 1000, serverTime: 5100, receivedAt: 1400 },
      { sentAt: 1000, serverTime: 5050, receivedAt: 1100 },
      { sentAt: 1000, serverTime: 5300, receivedAt: 1900 },
    ];
    expect(estimateOffset(samples)).toBe(4000);
  });
  it('sin muestras no corrige nada', () => {
    expect(estimateOffset([])).toBe(0);
  });
  it('corrige un reloj local atrasado por días', () => {
    expect(estimateOffset([{ sentAt: 0, serverTime: 300_000_050, receivedAt: 100 }])).toBe(300_000_000);
  });
});

describe('positionAt', () => {
  it('en pausa devuelve la posición congelada', () => {
    expect(positionAt(nowOf({ status: 'paused', pausedAtSec: 42, anchorMs: 1000 }), 99_999)).toBe(42);
  });
  it('mientras carga o sin ancla es 0', () => {
    expect(positionAt(nowOf({ status: 'loading' }), 99_999)).toBe(0);
    expect(positionAt(nowOf({ status: 'playing', anchorMs: null }), 99_999)).toBe(0);
  });
  it('sonando es el tiempo transcurrido desde el ancla, nunca negativo', () => {
    expect(positionAt(nowOf({ anchorMs: 10_000 }), 25_500)).toBe(15.5);
    expect(positionAt(nowOf({ anchorMs: 10_000 }), 9_000)).toBe(0);
  });
});

describe('driftAction', () => {
  it('tolera hasta 0,5 s y corrige más allá, en los dos sentidos', () => {
    expect(driftAction(10, 10.5)).toBe('ok');
    expect(driftAction(10, 10.6)).toBe('seek');
    expect(driftAction(10, 9.4)).toBe('seek');
  });
});
