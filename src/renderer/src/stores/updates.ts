import { create } from 'zustand';
import type { UpdateState } from '@shared/updates';
import { api } from '../api';

export const useUpdates = create<{ state?: UpdateState }>(() => ({}));

export async function startUpdatesBridge(): Promise<void> {
  const set = (state: UpdateState) => useUpdates.setState({ state });
  try {
    await api.updates.subscribe(set);
    const initial = await api.updates.state();
    if (!useUpdates.getState().state) set(initial);
  } catch {
    set({ status: 'unsupported' });
  }
}
