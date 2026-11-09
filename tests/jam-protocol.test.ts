import { describe, expect, it } from 'vitest';
import { encode, parseClientMsg, sanitizeName } from '../src/shared/jam/protocol';
import { sanitizeTrack } from '../src/shared/track';
import type { Track } from '../src/shared/types';

const track: Track = {
  id: 'dQw4w9WgXcQ',
  title: 'One More Time',
  artists: [{ name: 'Daft Punk' }],
  durationSec: 320,
  thumbnail: 'https://i.ytimg.com/vi/x/mq.jpg',
};
const hello = { t: 'hello', protocol: 1, memberId: 'user-1234-abcd', name: 'Mara' };
const parse = (m: unknown) => parseClientMsg(JSON.stringify(m));

describe('parseClientMsg: hello', () => {
  it('parsea un hello válido', () => {
    expect(parse(hello)).toEqual(hello);
    expect(parse({ ...hello, create: true })).toEqual({ ...hello, create: true });
  });
  it('acepta una clave de miembro y rechaza una mal formada', () => {
    const key = 'clave-mara-0123456789';
    expect(parse({ ...hello, key })).toEqual({ ...hello, key });
    expect(parse({ ...hello, key: 'corta' })).toBeNull();
    expect(parse({ ...hello, key: 'x'.repeat(65) })).toBeNull();
    expect(parse({ ...hello, key: 'con espacios y símbolos!' })).toBeNull();
  });
  it('rechaza protocol no entero, memberId corto y nombre inválido', () => {
    expect(parse({ ...hello, protocol: 1.5 })).toBeNull();
    expect(parse({ ...hello, memberId: 'abc' })).toBeNull();
    expect(parse({ ...hello, name: '' })).toBeNull();
  });
});

describe('parseClientMsg: canciones (Review Focus 4)', () => {
  it('parsea queue.add con una canción válida, con y sin "at"', () => {
    expect(parse({ t: 'queue.add', track })).toEqual({ t: 'queue.add', track });
    expect(parse({ t: 'queue.add', track, at: 'next' })).toEqual({ t: 'queue.add', track, at: 'next' });
    expect(parse({ t: 'queue.add', track, at: 'jamás' })).toBeNull();
  });
  it('descarta una miniatura que no es https sin rechazar el mensaje', () => {
    const m = parse({ t: 'queue.add', track: { ...track, thumbnail: 'http://x/y.jpg' } });
    expect(m && m.t === 'queue.add' && m.track.thumbnail).toBeUndefined();
  });
  it('rechaza campos enormes, faltantes o con forma inválida', () => {
    expect(parse({ t: 'queue.add', track: { ...track, title: 'x'.repeat(301) } })).toBeNull();
    expect(parse({ t: 'queue.add', track: { ...track, title: undefined } })).toBeNull();
    expect(parse({ t: 'queue.add', track: { ...track, artists: Array.from({ length: 13 }, () => ({ name: 'a' })) } })).toBeNull();
    expect(parse({ t: 'queue.add', track: { ...track, id: 'abc' } })).toBeNull();
    expect(parse({ t: 'queue.add', track: 'no soy un objeto' })).toBeNull();
  });
});

describe('parseClientMsg: transport y resto', () => {
  it('seek exige una posición válida', () => {
    expect(parse({ t: 'transport', action: 'seek' })).toBeNull();
    expect(parse({ t: 'transport', action: 'seek', positionSec: NaN })).toBeNull();
    expect(parse({ t: 'transport', action: 'seek', positionSec: -1 })).toBeNull();
    expect(parse({ t: 'transport', action: 'seek', positionSec: 86_401 })).toBeNull();
    expect(parse({ t: 'transport', action: 'seek', positionSec: 12.5 })).toEqual({ t: 'transport', action: 'seek', positionSec: 12.5 });
    expect(parse({ t: 'transport', action: 'next' })).toEqual({ t: 'transport', action: 'next' });
    expect(parse({ t: 'transport', action: 'bailar' })).toBeNull();
  });
  it('los demás mensajes vuelven idénticos', () => {
    const ok = [
      { t: 'queue.remove', itemId: '3' },
      { t: 'queue.move', itemId: '3', toIndex: 0 },
      { t: 'queue.playNext', itemId: '3' },
      { t: 'queue.playNow', itemId: '3' },
      { t: 'vote.skip' },
      { t: 'like.toggle' },
      { t: 'mode.set', mode: 'everyone' },
      { t: 'playing', itemId: '3', positionSec: 2 },
      { t: 'ended', itemId: '3' },
      { t: 'unavailable', itemId: '3' },
      { t: 'ping', id: 7 },
      { t: 'leave' },
      { t: 'close' },
    ];
    for (const m of ok) expect(parse(m), m.t).toEqual(m);
  });
  it('rechaza valores fuera de rango', () => {
    expect(parse({ t: 'mode.set', mode: 'todos' })).toBeNull();
    expect(parse({ t: 'ping', id: 'x' })).toBeNull();
    expect(parse({ t: 'queue.move', itemId: '3', toIndex: -1 })).toBeNull();
    expect(parse({ t: 'ended', itemId: '' })).toBeNull();
  });
  it('rechaza basura: no JSON, tipo desconocido y mensajes de más de 8192 bytes', () => {
    expect(parseClientMsg('esto no es json')).toBeNull();
    expect(parse({ t: 'nope' })).toBeNull();
    expect(parse({ t: 'queue.add', track, relleno: 'x'.repeat(9000) })).toBeNull();
  });
});

describe('sanitizeName / sanitizeTrack / encode', () => {
  it('sanitizeName recorta y valida largo y caracteres de control', () => {
    expect(sanitizeName('  Mara  ')).toBe('Mara');
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('x'.repeat(25))).toBeNull();
    expect(sanitizeName('a\u0000b')).toBeNull();
    expect(sanitizeName(42)).toBeNull();
  });
  it('sanitizeTrack lanza "Solicitud inválida." con datos malos', () => {
    expect(() => sanitizeTrack({})).toThrow('Solicitud inválida.');
    expect(sanitizeTrack(track).id).toBe(track.id);
  });
  it('encode serializa a JSON', () => {
    expect(encode({ t: 'pong', id: 1, serverTime: 2 })).toBe('{"t":"pong","id":1,"serverTime":2}');
  });
});
