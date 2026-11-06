import { create } from 'zustand';
import type { JamView } from '@shared/jam/types';
import { api } from '../api';

interface JamStore {
  /** Lo último que informó main; null hasta la primera carga. */
  view: JamView | null;
  set(view: JamView): void;
}

export const useJam = create<JamStore>((set) => ({ view: null, set: (view) => set({ view }) }));

/** En una sala viva: con estado y conectada (o reconectando, sin haber perdido la sala). */
export const inRoom = (v: JamView | null): boolean => v !== null && v.state !== null && (v.status === 'connected' || v.status === 'reconnecting');

export const isAdmin = (v: JamView | null): boolean => v !== null && v.state !== null && v.state.adminId === v.selfId;

/** Carga la vista actual y se suscribe a los cambios que empuja main. */
export async function startJamBridge(): Promise<void> {
  try {
    useJam.getState().set(await api.jam.view());
    await api.jam.subscribe((view) => useJam.getState().set(view));
  } catch {
    /* sin sala o sin puente: el jam simplemente no aparece */
  }
}
