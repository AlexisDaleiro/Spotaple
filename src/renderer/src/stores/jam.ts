import { create } from 'zustand';
import { jamErrorMessage } from '@shared/jam/errors';
import type { JamView } from '@shared/jam/types';
import type { JamRelayStatus } from '@shared/jam/config';
import { api } from '../api';
import { toast } from './ui';

interface JamStore {
  /** Lo último que informó main; null hasta la primera carga. */
  view: JamView | null;
  relay: JamRelayStatus | null;
  set(view: JamView): void;
}

export const useJam = create<JamStore>((set) => ({ view: null, relay: null, set: (view) => set({ view }) }));

/** En una sala viva: con estado y conectada (o reconectando, sin haber perdido la sala). */
export const inRoom = (v: JamView | null): boolean => v !== null && v.state !== null && (v.status === 'connected' || v.status === 'reconnecting');

export const isAdmin = (v: JamView | null): boolean => v !== null && v.state !== null && v.state.adminId === v.selfId;

/** El admin puede pasar a la siguiente si algo suena, o si la sala se detuvo (canciones no disponibles) con la cola llena. */
export const canAdvance = (v: JamView | null): boolean =>
  isAdmin(v) && !!v?.state && (v.state.now !== null || (v.state.halted && v.state.queue.length > 0));

/** Qué avisarle a la persona al pasar de la vista `prev` a `next` (o null si no hay nada que decir). */
export function jamNotice(prev: JamView | null, next: JamView): { message: string; kind: 'info' | 'error' } | null {
  if (next.error && next.error.n !== prev?.error?.n) return { message: jamErrorMessage(next.error.code), kind: 'error' };
  // Fallar al crear o unirse lo informa la propia llamada: aquí solo cuenta una sala que ya estaba viva.
  if (inRoom(prev) && next.status === 'ended') {
    if (next.reason === 'closed') return { message: jamErrorMessage('closed'), kind: 'info' };
    return { message: next.reason ? jamErrorMessage(next.reason) : 'Se perdió la conexión con la sala.', kind: 'error' };
  }
  return null;
}

/** Carga la vista actual y se suscribe a los cambios que empuja main (con sus avisos). */
export async function startJamBridge(): Promise<void> {
  void startRelayBridge();
  try {
    useJam.getState().set(await api.jam.view());
    await api.jam.subscribe((view) => {
      const notice = jamNotice(useJam.getState().view, view);
      useJam.getState().set(view);
      if (notice) toast(notice.message, notice.kind);
    });
  } catch {
    /* sin sala o sin puente: el jam simplemente no aparece */
  }
}

async function startRelayBridge(): Promise<void> {
  try {
    await api.jam.subscribeRelay((relay) => useJam.setState({ relay }));
    const relay = await api.jam.relayStatus();
    if (!useJam.getState().relay) useJam.setState({ relay });
  } catch (e) {
    toast(e instanceof Error ? e.message : 'No se pudo leer el estado del relé.', 'error');
  }
}
