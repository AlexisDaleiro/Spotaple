import { describe, expect, it } from 'vitest';
import type { Track } from '../src/shared/types';
import {
  append,
  clearUpcoming,
  disableShuffle,
  enableShuffle,
  insertBeforeAuto,
  insertNext,
  makeItems,
  moveItem,
  nextIndex,
  prevIndex,
  removeItem,
  shuffled,
  type QueueState,
} from '../src/renderer/src/player/queue';

const track = (n: number): Track => ({ id: `track${String(n).padStart(6, '0')}`, title: `Canción ${n}`, artists: [{ name: 'Artista' }] });
const state = (n: number, index = 0): QueueState => ({ items: makeItems(Array.from({ length: n }, (_, i) => track(i))), index, original: null });
const titles = (s: QueueState) => s.items.map((i) => i.track.title);
/** Generador pseudoaleatorio determinista para pruebas. */
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('makeItems', () => {
  it('marca como auto las canciones que puso la radio y no agrega la propiedad al resto', () => {
    const auto = makeItems([track(1), track(2)], true);
    expect(auto.every((i) => i.auto === true)).toBe(true);
    const normal = makeItems([track(1)]);
    expect('auto' in normal[0]!).toBe(false);
  });
});

describe('insertBeforeAuto', () => {
  it('pone lo que agrega el usuario antes de las canciones de la radio', () => {
    const withRadio = append(state(2), makeItems([track(10), track(11)], true));
    expect(titles(insertBeforeAuto(withRadio, makeItems([track(20)])))).toEqual(['Canción 0', 'Canción 1', 'Canción 20', 'Canción 10', 'Canción 11']);
  });

  it('sin radio en la cola va al final, como append', () => {
    expect(titles(insertBeforeAuto(state(2), makeItems([track(20)])))).toEqual(['Canción 0', 'Canción 1', 'Canción 20']);
  });

  it('ignora las canciones de la radio que ya sonaron (antes de la actual)', () => {
    const items = [...makeItems([track(10)], true), ...makeItems([track(0), track(1)]), ...makeItems([track(11)], true)];
    const s: QueueState = { items, index: 1, original: null };
    expect(titles(insertBeforeAuto(s, makeItems([track(20)])))).toEqual(['Canción 10', 'Canción 0', 'Canción 1', 'Canción 20', 'Canción 11']);
  });

  it('con aleatorio activo también queda antes de la radio en el orden original', () => {
    const withRadio = append(state(2), makeItems([track(10)], true));
    const shuffledState = enableShuffle(withRadio, seeded(7));
    const r = insertBeforeAuto(shuffledState, makeItems([track(20)]));
    const original = r.original!.map((i) => i.track.title);
    expect(original.indexOf('Canción 20')).toBeLessThan(original.indexOf('Canción 10'));
  });
});

describe('nextIndex / prevIndex', () => {
  it('avanza y se detiene al final cuando no hay repetición', () => {
    expect(nextIndex(3, 0, 'off', true)).toBe(1);
    expect(nextIndex(3, 2, 'off', true)).toBeNull();
    expect(nextIndex(3, 2, 'off', false)).toBeNull();
  });
  it('repetir todo vuelve al principio', () => {
    expect(nextIndex(3, 2, 'all', true)).toBe(0);
    expect(nextIndex(3, 2, 'all', false)).toBe(0);
  });
  it('repetir una repite sola al terminar, pero "siguiente" manual sí avanza', () => {
    expect(nextIndex(3, 1, 'one', true)).toBe(1);
    expect(nextIndex(3, 1, 'one', false)).toBe(2);
  });
  it('cola vacía no tiene siguiente', () => {
    expect(nextIndex(0, -1, 'all', true)).toBeNull();
  });
  it('anterior: retrocede, envuelve solo con repetir todo, y si no hay devuelve null (reiniciar)', () => {
    expect(prevIndex(3, 2, 'off')).toBe(1);
    expect(prevIndex(3, 0, 'off')).toBeNull();
    expect(prevIndex(3, 0, 'all')).toBe(2);
  });
});

describe('aleatorio', () => {
  it('deja la canción actual primera y conserva todas las demás', () => {
    const s = enableShuffle(state(8, 3), seeded(7));
    expect(s.index).toBe(0);
    expect(s.items[0]!.track.title).toBe('Canción 3');
    expect([...titles(s)].sort()).toEqual([...titles(state(8))].sort());
    expect(s.original).not.toBeNull();
  });
  it('al desactivarlo vuelve al orden original y encuentra la canción actual', () => {
    const base = state(6, 2);
    let s = enableShuffle(base, seeded(3));
    s = { ...s, index: 4 }; // el usuario avanzó hasta otra canción
    const current = s.items[4]!.track.title;
    const back = disableShuffle(s);
    expect(titles(back)).toEqual(titles(base));
    expect(back.items[back.index]!.track.title).toBe(current);
    expect(back.original).toBeNull();
  });
  it('lo agregado y lo quitado durante el aleatorio se respeta al desactivarlo', () => {
    let s = enableShuffle(state(4, 0), seeded(5));
    const extra = makeItems([track(99)]);
    s = append(s, extra);
    s = removeItem(s, s.items[2]!.uid).state;
    const back = disableShuffle(s);
    expect(back.items).toHaveLength(4); // 4 + 1 agregada − 1 quitada
    expect(titles(back)).toContain('Canción 99');
  });
  it('shuffled no pierde ni duplica elementos', () => {
    const out = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], seeded(11));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('editar la cola', () => {
  it('"a continuación" inserta justo después de la actual', () => {
    const s = insertNext(state(4, 1), makeItems([track(50), track(51)]));
    expect(titles(s)).toEqual(['Canción 0', 'Canción 1', 'Canción 50', 'Canción 51', 'Canción 2', 'Canción 3']);
    expect(s.index).toBe(1);
  });
  it('"agregar a la cola" va al final', () => {
    expect(titles(append(state(2), makeItems([track(9)])))).toEqual(['Canción 0', 'Canción 1', 'Canción 9']);
  });
  it('quitar una anterior corre el índice; quitar la actual avisa', () => {
    const s = state(5, 3);
    const before = removeItem(s, s.items[1]!.uid);
    expect(before.state.index).toBe(2);
    expect(before.wasCurrent).toBe(false);
    const cur = removeItem(s, s.items[3]!.uid);
    expect(cur.wasCurrent).toBe(true);
    expect(cur.state.items[cur.state.index]!.track.title).toBe('Canción 4');
  });
  it('quitar la última actual deja el índice válido', () => {
    const s = state(3, 2);
    const r = removeItem(s, s.items[2]!.uid);
    expect(r.state.index).toBe(1);
  });
  it('mover mantiene apuntando a la misma canción actual', () => {
    const s = state(5, 2);
    const cur = s.items[2]!.uid;
    for (const [from, to] of [[0, 4], [4, 0], [1, 3], [3, 1], [2, 4], [2, 0]] as const) {
      const m = moveItem(s, from, to);
      expect(m.items[m.index]!.uid).toBe(cur);
      expect(m.items).toHaveLength(5);
    }
  });
  it('mover fuera de rango no hace nada', () => {
    const s = state(3);
    expect(moveItem(s, 0, 9)).toBe(s);
  });
  it('limpiar quita solo lo que viene después de la actual', () => {
    const s = clearUpcoming(state(5, 2));
    expect(titles(s)).toEqual(['Canción 0', 'Canción 1', 'Canción 2']);
  });
  it('la misma canción dos veces tiene identificadores distintos', () => {
    const items = makeItems([track(1), track(1)]);
    expect(items[0]!.uid).not.toBe(items[1]!.uid);
  });
});
