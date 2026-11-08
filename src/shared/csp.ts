import { AUDIO_SCHEME } from './api';

/**
 * Política de contenido de la interfaz. Solo se permite: scripts propios, portadas de los
 * dominios de imágenes de YouTube Music y audio por nuestro protocolo. Nada de red directa.
 * En desarrollo se relajan los scripts en línea y el websocket de Vite (HMR).
 */
export function buildCsp(dev: boolean, localAudio = false): string {
  const images = 'https://*.googleusercontent.com https://*.ggpht.com https://*.ytimg.com';
  return [
    "default-src 'none'",
    `script-src ${dev ? "'self' 'unsafe-inline'" : "'self'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${images}`,
    `media-src ${localAudio ? "'self'" : `${AUDIO_SCHEME}:`}`,
    `connect-src ${dev ? "'self' ws://localhost:*" : "'self'"}`,
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
