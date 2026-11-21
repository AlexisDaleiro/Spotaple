/**
 * Relé compartido de Spotaple. También recibe las invitaciones que solo tienen el código.
 */
export const JAM_RELAY_URL = 'wss://spotaple-jam.alexisdaleiro.workers.dev';

export const JAM_RELAY_HEALTH_PATH = '/_spotaple-jam';
export const JAM_RELAY_SERVICE = 'spotaple-jam';
export type JamRelayStatus = 'unconfigured' | 'preparing' | 'claim' | 'ready';
