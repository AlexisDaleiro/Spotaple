/**
 * `fetch` del proceso local. En la app es `net.fetch` de Electron (red de Chromium: proxy del
 * sistema, PAC, autenticación integrada de Windows y almacén de certificados de Windows).
 * Este módulo no importa `electron` para poder probarse con un `fetch` simulado.
 */
type FetchLike = typeof fetch;

/**
 * Fuerza `credentials: 'omit'`: YouTube.js pide `include`, pero la app no tiene sesión de YouTube y
 * no debe guardar las cookies de YouTube en el almacén de cookies de Electron.
 */
export function withoutCredentials(inner: FetchLike): FetchLike {
  return (input, init) => inner(input, { ...init, credentials: 'omit' });
}
