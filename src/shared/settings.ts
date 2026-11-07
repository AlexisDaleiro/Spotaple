// Ajustes de la app compartidos entre main, preload y renderer. Solo datos serializables.
import { sanitizeName } from './jam/protocol';

export type ThemeId = 'system' | 'grafito' | 'claro' | 'medianoche' | 'oceano';
export type ResolvedTheme = Exclude<ThemeId, 'system'>;
export type Density = 'comfortable' | 'compact';
export type StreamQuality = 'high' | 'saver';

export interface AppSettings {
  theme: ThemeId;
  /** `#rrggbb` o null (el acento propio del tema). */
  accent: string | null;
  textScale: number;
  density: Density;
  reduceMotion: boolean;
  streamQuality: StreamQuality;
  /** Al abrir la app, retoma la canción que había en pausa. */
  resumeOnOpen: boolean;
  /** Nombre por defecto en las salas. Vive en la clave `jam_name` de la tabla `settings`. */
  jamName: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'grafito',
  accent: null,
  textScale: 1,
  density: 'comfortable',
  reduceMotion: false,
  streamQuality: 'high',
  resumeOnOpen: false,
  jamName: '',
};

export const TEXT_SCALES = [0.9, 1, 1.1, 1.25] as const;

export interface ThemeInfo {
  id: ResolvedTheme;
  label: string;
  scheme: 'dark' | 'light';
  /** Color de la barra de título: el mismo valor que `--bg-0` del tema en tokens.css. */
  bg: string;
  /** Color de los botones nativos de la ventana. */
  symbol: string;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'grafito', label: 'Grafito', scheme: 'dark', bg: '#0c0d0f', symbol: '#b4b8c0' },
  { id: 'claro', label: 'Claro', scheme: 'light', bg: '#e8eaee', symbol: '#42464f' },
  { id: 'medianoche', label: 'Medianoche', scheme: 'dark', bg: '#000000', symbol: '#b4b8c0' },
  { id: 'oceano', label: 'Océano', scheme: 'dark', bg: '#08121c', symbol: '#aebfd1' },
];

const DENSITIES: readonly Density[] = ['comfortable', 'compact'];
const QUALITIES: readonly StreamQuality[] = ['high', 'saver'];
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Devuelve solo los campos conocidos y válidos de `raw`; todo lo demás se descarta.
 * Nunca copia el objeto de entrada (lee claves propias conocidas), así que `__proto__` y claves extra no pasan.
 */
export function parseSettings(raw: unknown): Partial<AppSettings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const get = (k: keyof AppSettings): unknown => (Object.hasOwn(raw, k) ? (raw as Record<string, unknown>)[k] : undefined);
  const out: Partial<AppSettings> = {};

  const theme = get('theme');
  if (theme === 'system' || THEMES.some((t) => t.id === theme)) out.theme = theme as ThemeId;

  const accent = get('accent');
  if (accent === null) out.accent = null;
  else if (typeof accent === 'string' && HEX.test(accent)) out.accent = accent.toLowerCase();

  const scale = get('textScale');
  if ((TEXT_SCALES as readonly unknown[]).includes(scale)) out.textScale = scale as number;

  const density = get('density');
  if (DENSITIES.includes(density as Density)) out.density = density as Density;

  const reduceMotion = get('reduceMotion');
  if (typeof reduceMotion === 'boolean') out.reduceMotion = reduceMotion;

  const quality = get('streamQuality');
  if (QUALITIES.includes(quality as StreamQuality)) out.streamQuality = quality as StreamQuality;

  const resume = get('resumeOnOpen');
  if (typeof resume === 'boolean') out.resumeOnOpen = resume;

  const jamName = get('jamName');
  if (jamName === '') out.jamName = '';
  else {
    const name = sanitizeName(jamName);
    if (name !== null) out.jamName = name;
  }

  return out;
}

/** El tema concreto: «Sistema» se resuelve según el esquema del sistema operativo. */
export function resolveTheme(theme: ThemeId, systemLight: boolean): ResolvedTheme {
  return theme === 'system' ? (systemLight ? 'claro' : 'grafito') : theme;
}
