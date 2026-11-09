import { describe, expect, it, vi } from 'vitest';
import { CODE_ALPHABET, formatInvite, isRoomCode, newRoomCode, parseInvite } from '../src/shared/jam/invite';

const R = 'wss://relay.example.workers.dev';

describe('newRoomCode', () => {
  it('usa 5 caracteres de un alfabeto de 31 símbolos', () => {
    expect(CODE_ALPHABET).toHaveLength(31);
    expect(newRoomCode(() => 0)).toBe('22222');
    expect(newRoomCode(() => 0.999999)).toBe('ZZZZZ');
    expect(isRoomCode(newRoomCode())).toBe(true);
  });

  it('no usa Math.random: el código es lo único que protege la sala', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random no es aleatorio de verdad');
    });
    try {
      expect(isRoomCode(newRoomCode())).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('parseInvite', () => {
  it('acepta un código de internet en minúsculas y con espacios', () => {
    expect(parseInvite('  k7m2p ', R)).toEqual({ kind: 'internet', code: 'K7M2P', url: `${R}/K7M2P` });
  });

  it('acepta ip:puerto/código y los prefijos ws:// y http://', () => {
    const want = { kind: 'local', code: 'K7M2P', url: 'ws://192.168.1.20:47800/K7M2P' };
    expect(parseInvite('192.168.1.20:47800/K7M2P', R)).toEqual(want);
    expect(parseInvite('ws://192.168.1.20:47800/K7M2P', R)).toEqual(want);
    expect(parseInvite('http://192.168.1.20:47800/k7m2p', R)).toEqual(want);
  });

  it('acepta el nombre de un equipo en vez de una IP', () => {
    expect(parseInvite('PC-ADMIN:47800/k7m2p', R)?.url).toBe('ws://PC-ADMIN:47800/K7M2P');
  });

  it('rechaza lo que no es una invitación válida', () => {
    for (const bad of ['', 'K7M2', 'K7M2PX', 'K7M0P', '999.1.1.1:47800/K7M2P', '192.168.1.20/K7M2P', '192.168.1.20:47800/K7M2', '192.168.1.20:70000/K7M2P']) {
      expect(parseInvite(bad, R), bad).toBeNull();
    }
  });

  it('formatInvite y parseInvite son inversas', () => {
    expect(parseInvite(formatInvite('local', 'K7M2P', '10.0.0.5:47800'), R)?.url).toBe('ws://10.0.0.5:47800/K7M2P');
    expect(formatInvite('internet', 'K7M2P')).toBe('K7M2P');
  });

  it('envía la invitación de un relé propio a su Worker aunque haya otro relé por defecto', () => {
    const host = 'wss://spotaple-jam.anfitrion.workers.dev';
    const invite = formatInvite('internet', 'K7M2P', host);
    expect(invite).toBe('https://spotaple-jam.anfitrion.workers.dev/K7M2P');
    expect(parseInvite(invite, R)).toEqual({ kind: 'internet', code: 'K7M2P', url: `${host}/K7M2P` });
    expect(parseInvite('https://spotaple-jam.anfitrion.workers.dev.ejemplo.org/K7M2P', R)).toBeNull();
  });
});
