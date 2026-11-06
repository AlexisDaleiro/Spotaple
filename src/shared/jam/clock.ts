import type { JamNow } from './types';

export interface ClockSample {
  /** Reloj local al enviar el ping. */
  sentAt: number;
  /** Reloj de la sala al responder. */
  serverTime: number;
  /** Reloj local al recibir el pong. */
  receivedAt: number;
}

/**
 * Diferencia "reloj de la sala − reloj local". Se usa la muestra de menor ida y vuelta, que es la menos
 * contaminada por demoras de red, y se asume que la respuesta salió a mitad de camino.
 */
export function estimateOffset(samples: ClockSample[]): number {
  let best: ClockSample | undefined;
  for (const s of samples) if (!best || s.receivedAt - s.sentAt < best.receivedAt - best.sentAt) best = s;
  return best ? best.serverTime - (best.sentAt + best.receivedAt) / 2 : 0;
}

/** Posición (en segundos) en la que debería ir la canción actual, dado el reloj de la sala. */
export function positionAt(now: JamNow, roomNowMs: number): number {
  if (now.status === 'paused') return now.pausedAtSec;
  if (now.status === 'loading' || now.anchorMs === null) return 0;
  return Math.max(0, (roomNowMs - now.anchorMs) / 1000);
}

/** Se corrige con un salto cuando el desvío supera 0,5 s. */
export function driftAction(actualSec: number, expectedSec: number): 'ok' | 'seek' {
  return Math.abs(actualSec - expectedSec) > 0.5 ? 'seek' : 'ok';
}
