// Contratos de «Hecho para vos» compartidos entre main, preload y renderer. Solo datos serializables.
import type { ArtistSummary, Track } from './types';

/** Descubrimiento semanal, Mixes diarios (uno por `slot`) o Release Radar. */
export type GeneratedKind = 'weekly' | 'mix' | 'radar';

export interface GeneratedList {
  kind: GeneratedKind;
  /** Distingue las listas del mismo tipo (los mixes son `'1'`…`'6'`). */
  slot: string;
  title: string;
  subtitle: string;
  tracks: Track[];
  /** Período en que se generó (`YYYY-MM-DD`). */
  period: string;
  createdAt: number;
  /** Es de un período anterior al vigente: se muestra mientras se regenera. */
  stale: boolean;
}

export interface DiscoverState {
  /** Ajuste «Hecho para vos» activado. */
  enabled: boolean;
  /** Hay datos suficientes en el historial para armar las listas. */
  ready: boolean;
  /** Se está generando algo ahora. */
  updating: boolean;
  /** Ordenadas: semanal, mixes por `slot`, radar. Vacías si no está `enabled` o no está `ready`. */
  lists: GeneratedList[];
  /** «Artistas que podrías escuchar». */
  artists: ArtistSummary[];
}
