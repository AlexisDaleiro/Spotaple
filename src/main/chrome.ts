import { nativeTheme, type BrowserWindow } from 'electron';
import { THEMES, chromeFor, type AppSettings } from '../shared/settings';

/** Alto de la zona de botones nativos: igual que `--title-h` de la interfaz. */
export const TITLE_BAR_HEIGHT = 48;

/**
 * Fija el esquema nativo (barras de scroll, menús, controles) según el tema y devuelve los colores de la ventana.
 * «Sistema» deja que Chromium siga al sistema operativo; un tema concreto fuerza su esquema claro u oscuro.
 */
export function prepareChrome(settings: AppSettings): { bg: string; symbol: string } {
  nativeTheme.themeSource = settings.theme === 'system' ? 'system' : THEMES.find((t) => t.id === settings.theme)!.scheme;
  return chromeFor(settings, !nativeTheme.shouldUseDarkColors);
}

/** Recolorea una ventana ya creada (fondo y barra de título nativa) para los ajustes dados. */
export function applyChrome(win: BrowserWindow, settings: AppSettings): void {
  const { bg, symbol } = prepareChrome(settings);
  win.setBackgroundColor(bg);
  // Electron permite recolorear la superposición en Windows y Linux.
  if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: bg, symbolColor: symbol, height: TITLE_BAR_HEIGHT });
}
