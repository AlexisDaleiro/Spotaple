import type { JamView } from '@shared/jam/types';
import { canAdvance, inRoom, isAdmin } from '../stores/jam';
import type { PlayerActions, PlayerStatus } from './player';

export type PlaybackCommand = 'play' | 'pause' | 'prev' | 'next' | 'seek';

export const playbackActive = (status: PlayerStatus): boolean =>
  status === 'playing' || status === 'buffering' || status === 'loading';

export function applyPlaybackCommand(
  p: Pick<PlayerActions, PlaybackCommand>,
  room: JamView | null,
  advanceRoom: () => void,
  command: PlaybackCommand,
  position?: number,
): void {
  if (inRoom(room)) {
    if (command === 'next') {
      if (canAdvance(room)) advanceRoom();
      return;
    }
    if (command === 'prev' || !isAdmin(room)) return;
    // Los cambios del audio del admin se sincronizan con la sala desde jam-sync.
  }

  if (command === 'seek') {
    if (position !== undefined && Number.isFinite(position)) p.seek(position);
  } else {
    p[command]();
  }
}
