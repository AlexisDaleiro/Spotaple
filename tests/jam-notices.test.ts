import { describe, expect, it } from 'vitest';
import { createRoom } from '../src/shared/jam/engine';
import type { JamView } from '../src/shared/jam/types';
import { jamNotice } from '../src/renderer/src/stores/jam';

const view = (patch: Partial<JamView> = {}): JamView => ({
  status: 'connected',
  kind: 'local',
  invite: null,
  selfId: 'admin-1',
  name: 'Ana',
  offsetMs: 0,
  state: createRoom({ code: 'K7M2P', adminId: 'admin-1', adminName: 'Ana', transferAdmin: false }, 0),
  ...patch,
});

describe('jamNotice', () => {
  it('avisa cada error nuevo una sola vez por contador', () => {
    const before = view();
    const withError = view({ error: { code: 'duplicate', n: 1 } });
    expect(jamNotice(before, withError)).toEqual({ message: 'Ya está en la cola.', kind: 'error' });
    expect(jamNotice(withError, withError)).toBeNull();
    expect(jamNotice(withError, view({ error: { code: 'duplicate', n: 2 } }))).toEqual({ message: 'Ya está en la cola.', kind: 'error' });
  });

  it('avisa cuando una sala viva termina, con el motivo', () => {
    expect(jamNotice(view(), view({ status: 'ended', reason: 'closed' }))).toEqual({ message: 'La sala terminó.', kind: 'info' });
    expect(jamNotice(view({ status: 'reconnecting' }), view({ status: 'ended' }))).toEqual({ message: 'Se perdió la conexión con la sala.', kind: 'error' });
  });

  it('no avisa si todavía no había sala (eso lo informa la propia llamada a crear o unirse) ni repite el aviso', () => {
    expect(jamNotice(view({ status: 'connecting', state: null }), view({ status: 'ended', reason: 'no_room', state: null }))).toBeNull();
    expect(jamNotice(null, view({ status: 'ended', reason: 'closed' }))).toBeNull();
    expect(jamNotice(view({ status: 'ended', reason: 'closed' }), view({ status: 'ended', reason: 'closed' }))).toBeNull();
  });
});
