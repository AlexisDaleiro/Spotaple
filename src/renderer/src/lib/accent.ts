/** Variables CSS que dependen del color de acento. Se fijan en `<html>` y pisan las del tema. */
export type AccentVars = Record<'--accent' | '--accent-hover' | '--accent-press' | '--accent-ink' | '--accent-soft', string>;
export const ACCENT_VARS: readonly (keyof AccentVars)[] = ['--accent', '--accent-hover', '--accent-press', '--accent-ink', '--accent-soft'];

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Texto sobre el acento: oscuro o blanco, el que dé más contraste. */
const INK_DARK = '#101114';
const INK_LIGHT = '#ffffff';
/** Contraste mínimo del acento contra el fondo del tema cuando se usa como texto o icono (WCAG AA). */
const MIN_ACCENT_CONTRAST = 4.5;
/** Cuánto se aclara el acento al pasar el mouse y cuánto se oscurece al presionar (puntos de claridad HSL). */
const HOVER_LIGHTNESS = 6;
const PRESS_LIGHTNESS = -8;

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const [S, L] = [s / 100, l / 100];
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Luminancia relativa WCAG de un `#rrggbb` (0 = negro, 1 = blanco). */
export function relativeLuminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex).map(lin) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG entre dos `#rrggbb` (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Mueve la claridad del color (sin tocar tono ni saturación) hasta que se lea sobre `against` con contraste AA:
 * oscurece sobre un fondo claro y aclara sobre uno oscuro. Si ya se lee, lo devuelve igual.
 */
function withContrast(hex: string, against: string): string {
  if (contrastRatio(hex, against) >= MIN_ACCENT_CONTRAST) return hex;
  const direction = relativeLuminance(against) > 0.5 ? -1 : 1;
  const [h, s, l] = rgbToHsl(toRgb(hex));
  let out = hex;
  for (let step = 1; step <= 100; step++) {
    out = toHex(hslToRgb(h, s, clamp(l + direction * step, 0, 100)));
    if (contrastRatio(out, against) >= MIN_ACCENT_CONTRAST) break;
  }
  return out;
}

/**
 * Deriva las variantes del acento desde un `#rrggbb`. Devuelve `null` si no lo es: nunca llega CSS arbitrario.
 * Con `against` (el fondo del tema, `#rrggbb`), el acento se ajusta para leerse sobre él: se usa como color de texto e iconos.
 */
export function deriveAccent(hex: string, against?: string): AccentVars | null {
  if (!HEX.test(hex)) return null;
  const base = hex.toLowerCase();
  const accent = against && HEX.test(against) ? withContrast(base, against) : base;
  const rgb = toRgb(accent);
  const [h, s, l] = rgbToHsl(rgb);
  return {
    '--accent': accent,
    '--accent-hover': toHex(hslToRgb(h, s, clamp(l + HOVER_LIGHTNESS, 0, 100))),
    '--accent-press': toHex(hslToRgb(h, s, clamp(l + PRESS_LIGHTNESS, 0, 100))),
    '--accent-ink': contrastRatio(INK_DARK, accent) >= contrastRatio(INK_LIGHT, accent) ? INK_DARK : INK_LIGHT,
    '--accent-soft': `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.14)`,
  };
}
