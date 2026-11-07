import { describe, expect, it, vi } from 'vitest';
import type { PersistedPlayerState, PreparedAudio, Track } from '../src/shared/types';
import { createPlayer, type AudioLike, type PlayerApi, type PlayerDeps, type RadioHook } from '../src/renderer/src/player/player';

/** Audio simulado: reproduce eventos como lo haría un HTMLAudioElement. */
class FakeAudio extends EventTarget implements AudioLike {
  src = '';
  currentTime = 0;
  duration = NaN;
  volume = 1;
  muted = false;
  paused = true;
  error: { code: number } | null = null;
  play() {
    this.paused = false;
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  /** Simula que la fuente se cargó: duración conocida. */
  loaded(duration = 200) {
    this.duration = duration;
    this.dispatchEvent(new Event('loadedmetadata'));
  }
  ended() {
    this.dispatchEvent(new Event('ended'));
  }
  fail(code = 4) {
    this.error = { code };
    this.dispatchEvent(new Event('error'));
  }
}

const track = (n: number): Track => ({ id: `track${String(n).padStart(6, '0')}`, title: `Canción ${n}`, artists: [{ name: 'Artista' }], durationSec: 180 });
const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i));
const flush = () => new Promise((r) => setTimeout(r, 0));
const ok = (id: string): PreparedAudio => ({ trackId: id, mimeType: 'audio/webm' });

function setup(prepare?: PlayerApi['prepare'], extra: Partial<PlayerDeps> = {}) {
  const audio = new FakeAudio();
  const api = {
    prepare: vi.fn(prepare ?? (async (id: string) => ok(id))),
    invalidate: vi.fn(async () => undefined),
    recordSelection: vi.fn(async () => undefined),
    recordPlay: vi.fn(async () => undefined),
  };
  const notify = vi.fn();
  const store = createPlayer({ audio, api, notify, urlFor: (id) => `test://${id}`, ...extra });
  return { audio, api, notify, store, s: () => store.getState() };
}

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe('radio automática', () => {
  const batch = (n: number, from = 100) => Array.from({ length: n }, (_, i) => track(from + i));
  const radioOf = (result: () => Promise<Track[]>, on = true) => ({ enabled: () => on, fetch: vi.fn(async (_seed: Track, _ids: string[]) => result()) }) satisfies RadioHook;
  const saved = (queue: Track[]): PersistedPlayerState => ({ queue, index: 0, positionSec: 0, volume: 0.8, muted: false, repeat: 'off', shuffle: false });

  it('con la radio activa, al empezar una canción suelta se piden sugerencias y se agregan marcadas', async () => {
    const radio = radioOf(async () => batch(5));
    const { s } = setup(undefined, { radio });
    s().playTracks([track(0)], 0);
    await flush();
    expect(radio.fetch).toHaveBeenCalledTimes(1);
    expect(radio.fetch).toHaveBeenCalledWith(track(0), [track(0).id]);
    expect(s().items).toHaveLength(6);
    expect(s().items[0]!.auto).toBeUndefined();
    expect(s().items.slice(1).every((i) => i.auto === true)).toBe(true);
  });

  it('no pide si quedan 3 o más por sonar, y sí cuando quedan menos', async () => {
    const lots = radioOf(async () => batch(2));
    const a = setup(undefined, { radio: lots });
    a.s().playTracks(tracks(5), 0);
    await flush();
    expect(lots.fetch).not.toHaveBeenCalled();

    const few = radioOf(async () => batch(2));
    const b = setup(undefined, { radio: few });
    b.s().playTracks(tracks(3), 1);
    await flush();
    expect(few.fetch).toHaveBeenCalledTimes(1);
  });

  it('no pide con la radio apagada, con repetir toda la cola o una, ni dentro de una sala', async () => {
    const off = radioOf(async () => batch(2), false);
    setup(undefined, { radio: off }).s().playTracks([track(0)], 0);
    await flush();
    expect(off.fetch).not.toHaveBeenCalled();

    const looping = radioOf(async () => batch(2));
    const r = setup(undefined, { radio: looping });
    r.s().cycleRepeat(); // todo
    r.s().playTracks([track(0)], 0);
    await flush();
    r.s().cycleRepeat(); // una
    r.s().playTracks([track(1)], 0);
    await flush();
    expect(looping.fetch).not.toHaveBeenCalled();

    const inRoom = radioOf(async () => batch(2));
    const j = setup(undefined, { radio: inRoom, jam: { active: () => true, request: vi.fn() } });
    j.s().hydrate(saved([track(0)]));
    j.s().togglePlay();
    await flush();
    expect(inRoom.fetch).not.toHaveBeenCalled();
  });

  it('una sola petición a la vez y no reintenta tras un fallo hasta que cambia la canción', async () => {
    const radio = radioOf(async () => {
      throw new Error('boom');
    });
    const { s, notify } = setup(undefined, { radio });
    s().playTracks([track(0)], 0);
    await flush();
    expect(radio.fetch).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);

    s().playIndex(0); // la misma canción otra vez: sigue bloqueada
    await flush();
    expect(radio.fetch).toHaveBeenCalledTimes(1);

    s().addToQueue([track(1)]);
    s().next(); // otra canción: se vuelve a intentar
    await flush();
    expect(radio.fetch).toHaveBeenCalledTimes(2);
  });

  it('un error de red y una respuesta vacía son silenciosos', async () => {
    const net = radioOf(async () => {
      throw Object.assign(new Error('sin red'), { code: 'network' });
    });
    const a = setup(undefined, { radio: net });
    a.s().playTracks([track(0)], 0);
    await flush();
    expect(net.fetch).toHaveBeenCalledTimes(1);
    expect(a.notify).not.toHaveBeenCalled();

    const empty = radioOf(async () => []);
    const b = setup(undefined, { radio: empty });
    b.s().playTracks([track(0)], 0);
    await flush();
    expect(b.notify).not.toHaveBeenCalled();
    expect(b.s().items).toHaveLength(1);
  });

  it('descarta lo que ya está en la cola cuando la respuesta llega tarde', async () => {
    const late = deferred<Track[]>();
    const radio = radioOf(() => late.promise);
    const { s } = setup(undefined, { radio });
    s().playTracks([track(0)], 0);
    await flush();
    s().addToQueue([track(100)]); // se agrega mientras la radio todavía piensa
    late.resolve([track(100), track(101)]);
    await flush();
    expect(s().items.map((i) => i.track.id)).toEqual([track(0).id, track(100).id, track(101).id]);
  });

  it('«Limpiar» la cola no dispara un relleno inmediato', async () => {
    const radio = radioOf(async () => batch(4));
    const { s } = setup(undefined, { radio });
    s().playTracks([track(0)], 0);
    await flush();
    expect(radio.fetch).toHaveBeenCalledTimes(1);
    s().clearUpcoming();
    await flush();
    expect(radio.fetch).toHaveBeenCalledTimes(1);
    expect(s().items).toHaveLength(1);
  });

  it('recordPlay recibe auto solo si el ítem vino de la radio y avanzó solo', async () => {
    const radio = radioOf(async () => batch(3));
    const { s, audio, api } = setup(undefined, { radio });
    s().playTracks([track(0)], 0);
    await flush();
    expect(api.recordPlay).toHaveBeenLastCalledWith(track(0), false); // la eligió el usuario

    audio.ended(); // avanza sola a la primera de la radio
    await flush();
    expect(api.recordPlay).toHaveBeenLastCalledWith(track(100), true);

    s().next(); // «siguiente» es una acción del usuario
    await flush();
    expect(api.recordPlay).toHaveBeenLastCalledWith(track(101), false);

    s().playIndex(3); // elegida a mano
    await flush();
    expect(api.recordPlay).toHaveBeenLastCalledWith(track(102), false);
  });
});

describe('estados de reproducción', () => {
  it('idle → loading → playing, y registra selección y reproducción real una sola vez', async () => {
    const { s, audio, api } = setup();
    expect(s().status).toBe('idle');
    s().playTracks(tracks(3), 0);
    expect(s().status).toBe('loading');
    await flush();
    expect(audio.src).toBe('test://track000000');
    expect(s().status).toBe('playing');
    expect(api.recordSelection).toHaveBeenCalledTimes(1);
    expect(api.recordPlay).toHaveBeenCalledTimes(1);
  });

  it('pausa y continúa con togglePlay', async () => {
    const { s, audio } = setup();
    s().playTracks(tracks(2), 0);
    await flush();
    s().togglePlay();
    expect(s().status).toBe('paused');
    expect(audio.paused).toBe(true);
    s().togglePlay();
    await flush();
    expect(s().status).toBe('playing');
  });

  it('"esperando datos": waiting → buffering → playing', async () => {
    const { s, audio } = setup();
    s().playTracks(tracks(1), 0);
    await flush();
    audio.dispatchEvent(new Event('waiting'));
    expect(s().status).toBe('buffering');
    audio.dispatchEvent(new Event('playing'));
    expect(s().status).toBe('playing');
  });

  it('completa la duración que YouTube no informó en la lista, y la guarda con la reproducción', async () => {
    const { s, api } = setup(async (id) => ({ ...ok(id), durationSec: 241 }));
    s().playTracks([{ ...track(0), durationSec: undefined }], 0);
    await flush();
    expect(s().items[0]!.track.durationSec).toBe(241);
    expect(s().duration).toBe(241);
    expect(api.recordPlay).toHaveBeenCalledWith(expect.objectContaining({ id: track(0).id, durationSec: 241 }), false);
  });

  it('seleccionar sin que suene no cuenta como reproducción', async () => {
    const d = deferred<PreparedAudio>();
    const { s, api } = setup(() => d.promise);
    s().playTracks(tracks(1), 0);
    await flush();
    expect(api.recordSelection).toHaveBeenCalledTimes(1);
    expect(api.recordPlay).not.toHaveBeenCalled();
  });
});

describe('la última elección gana', () => {
  it('una carga lenta anterior no pisa la elección más nueva', async () => {
    const slow = deferred<PreparedAudio>();
    const { s, audio, api } = setup((id) => (id === track(0).id ? slow.promise : Promise.resolve(ok(id))));
    s().playTracks(tracks(3), 0); // A: lenta
    s().playIndex(2); // B: la última elección
    await flush();
    slow.resolve(ok(track(0).id)); // A llega tarde
    await flush();
    expect(audio.src).toBe('test://track000002');
    expect(s().index).toBe(2);
    expect(api.recordPlay).toHaveBeenCalledTimes(1);
    expect(api.recordPlay).toHaveBeenCalledWith(track(2), false);
  });

  it('elegir rápido varias seguidas termina en la última', async () => {
    const { s, audio } = setup();
    const list = tracks(6);
    s().playTracks(list, 0);
    for (const i of [1, 2, 3, 4, 5]) s().playIndex(i);
    await flush();
    expect(s().index).toBe(5);
    expect(audio.src).toBe('test://track000005');
  });

  it('un fallo de una carga vieja no ensucia el estado de la nueva', async () => {
    const slow = deferred<PreparedAudio>();
    const { s, notify } = setup((id) => (id === track(0).id ? slow.promise : Promise.resolve(ok(id))));
    s().playTracks(tracks(2), 0);
    s().playIndex(1);
    await flush();
    slow.reject(Object.assign(new Error('boom'), { code: 'network' }));
    await flush();
    expect(s().status).toBe('playing');
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('fin de canción y modos', () => {
  it('avanza a la siguiente sin registrar una "selección"', async () => {
    const { s, audio, api } = setup();
    s().playTracks(tracks(3), 0);
    await flush();
    audio.ended();
    await flush();
    expect(s().index).toBe(1);
    expect(api.recordSelection).toHaveBeenCalledTimes(1);
    expect(api.recordPlay).toHaveBeenCalledTimes(2);
  });

  it('al terminar la cola sin repetir queda "finalizado"', async () => {
    const { s, audio } = setup();
    s().playTracks(tracks(2), 1);
    await flush();
    audio.ended();
    expect(s().status).toBe('ended');
    expect(s().index).toBe(1);
  });

  it('repetir todo vuelve al principio', async () => {
    const { s, audio } = setup();
    s().cycleRepeat(); // all
    s().playTracks(tracks(2), 1);
    await flush();
    audio.ended();
    await flush();
    expect(s().index).toBe(0);
    expect(s().status).toBe('playing');
  });

  it('repetir una reinicia la misma sin volver a resolver la fuente', async () => {
    const { s, audio, api } = setup();
    s().cycleRepeat();
    s().cycleRepeat(); // one
    expect(s().repeat).toBe('one');
    s().playTracks(tracks(3), 1);
    await flush();
    audio.currentTime = 150;
    audio.ended();
    await flush();
    expect(s().index).toBe(1);
    expect(audio.currentTime).toBe(0);
    expect(api.prepare).toHaveBeenCalledTimes(1);
    expect(api.recordPlay).toHaveBeenCalledTimes(2); // la repetición vuelve a contar como reproducción
  });

  it('"siguiente" manual salta aunque esté en repetir una', async () => {
    const { s } = setup();
    s().cycleRepeat();
    s().cycleRepeat();
    s().playTracks(tracks(3), 0);
    await flush();
    s().next();
    await flush();
    expect(s().index).toBe(1);
  });

  it('anterior: reinicia si pasaron más de 3 s, si no retrocede', async () => {
    const { s, audio } = setup();
    s().playTracks(tracks(3), 1);
    await flush();
    audio.dispatchEvent(new Event('timeupdate'));
    s().seek(10);
    s().prev();
    expect(s().index).toBe(1);
    expect(audio.currentTime).toBe(0);
    s().prev();
    await flush();
    expect(s().index).toBe(0);
  });

  it('aleatorio mantiene la canción actual y conserva todas', async () => {
    const { s } = setup();
    s().playTracks(tracks(6), 2);
    await flush();
    s().toggleShuffle();
    expect(s().items[s().index]!.track.id).toBe(track(2).id);
    expect(s().items).toHaveLength(6);
    s().toggleShuffle();
    expect(s().items.map((i) => i.track.id)).toEqual(tracks(6).map((t) => t.id));
    expect(s().items[s().index]!.track.id).toBe(track(2).id);
  });
});

describe('cola', () => {
  it('quitar la canción en curso pasa a la siguiente; vaciar detiene todo', async () => {
    const { s, audio } = setup();
    s().playTracks(tracks(2), 0);
    await flush();
    s().removeFromQueue(s().items[0]!.uid);
    await flush();
    expect(s().items).toHaveLength(1);
    expect(audio.src).toBe('test://track000001');
    s().removeFromQueue(s().items[0]!.uid);
    expect(s().status).toBe('idle');
    expect(s().index).toBe(-1);
    expect(audio.paused).toBe(true);
  });

  it('agregar a la cola con la cola vacía deja lista la primera sin reproducir', () => {
    const { s, audio } = setup();
    s().addToQueue(tracks(2));
    expect(s().index).toBe(0);
    expect(s().status).toBe('paused');
    expect(audio.src).toBe('');
  });

  it('"a continuación" va después de la actual', async () => {
    const { s } = setup();
    s().playTracks(tracks(3), 0);
    await flush();
    s().playNext([track(9)]);
    expect(s().items[1]!.track.id).toBe(track(9).id);
  });
});

describe('errores y recuperación', () => {
  const err = (code: string, message = 'no') => Object.assign(new Error(message), { code });

  it('contenido no disponible: avisa y pasa a la siguiente que sí suena', async () => {
    const { s, notify } = setup(async (id) => {
      if (id !== track(2).id) throw err('unavailable', 'no disponible');
      return ok(id);
    });
    s().playTracks(tracks(5), 0);
    for (let i = 0; i < 5; i++) await flush();
    expect(notify).toHaveBeenCalledTimes(2); // una vez por cada canción saltada
    expect(s().index).toBe(2);
    expect(s().status).toBe('playing');
  });

  it('con 4 canciones no disponibles seguidas se detiene en error y no se encierra en un bucle', async () => {
    const { s, api } = setup(async () => {
      throw err('unavailable', 'no disponible');
    });
    s().playTracks(tracks(10), 0);
    for (let i = 0; i < 8; i++) await flush();
    expect(s().status).toBe('error');
    expect(api.prepare.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('error de red: queda en error con mensaje y "reproducir" lo reintenta', async () => {
    let fails = 1;
    const { s } = setup(async (id) => {
      if (fails-- > 0) throw err('network', 'Sin conexión');
      return ok(id);
    });
    s().playTracks(tracks(2), 0);
    await flush();
    expect(s().status).toBe('error');
    expect(s().error?.message).toBe('Sin conexión');
    expect(s().index).toBe(0); // no saltó: la red no es culpa de la canción
    s().togglePlay();
    await flush();
    expect(s().status).toBe('playing');
  });

  it('si la fuente caduca (error del audio) la descarta, la resuelve de nuevo y retoma la posición', async () => {
    const { s, audio, api } = setup();
    s().playTracks(tracks(1), 0);
    await flush();
    audio.loaded(200);
    s().seek(42);
    audio.fail();
    await flush();
    expect(api.invalidate).toHaveBeenCalledWith(track(0).id);
    expect(api.prepare).toHaveBeenCalledTimes(2);
    audio.loaded(200); // la fuente nueva carga
    expect(audio.currentTime).toBe(42);
    expect(s().status).toBe('playing');
  });

  it('si falla otra vez tras reintentar, informa el error', async () => {
    const { s, audio } = setup();
    s().playTracks(tracks(1), 0);
    await flush();
    audio.fail();
    await flush();
    audio.fail();
    expect(s().status).toBe('error');
  });
});

describe('restauración de sesión', () => {
  const saved: PersistedPlayerState = { queue: tracks(3), index: 1, positionSec: 75, volume: 0.4, muted: true, repeat: 'all', shuffle: false };

  it('restaura cola, selección y volumen, pero NO empieza a sonar', async () => {
    const { s, audio, api } = setup();
    s().hydrate(saved);
    await flush();
    expect(s().index).toBe(1);
    expect(s().status).toBe('paused');
    expect(s().volume).toBe(0.4);
    expect(s().muted).toBe(true);
    expect(s().repeat).toBe('all');
    expect(audio.src).toBe('');
    expect(api.prepare).not.toHaveBeenCalled();
  });

  it('con una acción del usuario reanuda en la posición guardada', async () => {
    const { s, audio } = setup();
    s().hydrate(saved);
    s().togglePlay();
    await flush();
    audio.loaded(200);
    expect(audio.src).toBe('test://track000001');
    expect(audio.currentTime).toBe(75);
    expect(s().status).toBe('playing');
  });

  it('snapshot devuelve lo necesario para volver a restaurar', async () => {
    const { s } = setup();
    s().hydrate(saved);
    expect(s().snapshot()).toMatchObject({ index: 1, volume: 0.4, muted: true, repeat: 'all', positionSec: 75 });
    expect(s().snapshot().queue).toHaveLength(3);
  });

  it('sin estado guardado no cambia nada', () => {
    const { s } = setup();
    s().hydrate(null);
    expect(s().status).toBe('idle');
  });
});

describe('volumen', () => {
  it('aplica curva perceptual y silencio al audio', () => {
    const { s, audio } = setup();
    s().setVolume(0.5);
    expect(audio.volume).toBeCloseTo(0.25);
    s().toggleMute();
    expect(audio.muted).toBe(true);
    s().setVolume(0.8); // mover el volumen quita el silencio
    expect(s().muted).toBe(false);
  });
});
