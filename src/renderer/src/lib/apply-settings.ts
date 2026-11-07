import { THEMES, resolveTheme, type AppSettings } from '@shared/settings';
import { ACCENT_VARS, deriveAccent } from './accent';

/** Lo mínimo de `document.documentElement` que usa `applySettings` (permite probarlo sin DOM). */
export interface RootLike {
  dataset: Record<string, string | undefined>;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

/**
 * Lleva los ajustes visuales al `<html>`: tema, densidad y animaciones como atributos `data-*`
 * (los lee tokens.css) y escala de texto y acento como variables CSS.
 */
export function applySettings(root: RootLike, s: AppSettings, systemLight: boolean): void {
  const theme = resolveTheme(s.theme, systemLight);
  root.dataset.theme = theme;
  root.dataset.density = s.density;
  root.dataset.reduceMotion = String(s.reduceMotion);
  root.style.setProperty('--text-scale', String(s.textScale));
  // El acento se usa también como color de texto e iconos: se ajusta para leerse sobre el fondo del tema (el elegido queda en los ajustes).
  const accent = s.accent ? deriveAccent(s.accent, THEMES.find((t) => t.id === theme)!.accentBg) : null;
  for (const name of ACCENT_VARS) {
    if (accent) root.style.setProperty(name, accent[name]);
    else root.style.removeProperty(name);
  }
}
