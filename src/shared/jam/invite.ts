/** 31 símbolos: dígitos 2-9 y letras sin I, L ni O (no se confunden al dictarlos). */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LEN = 5;

export function newRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

export const isRoomCode = (s: string): boolean => /^[2-9A-HJKMNP-Z]{5}$/.test(s);

export interface ParsedInvite {
  kind: 'local' | 'internet';
  code: string;
  /** URL WebSocket a la que conectarse (`/<CODIGO>` al final). */
  url: string;
}

/** El relé oficial admite códigos cortos. Una invitación a un relé propio incluye su dirección. */
export function formatInvite(kind: 'local' | 'internet', code: string, address?: string): string {
  if (!address) return code;
  return `${kind === 'internet' ? address.replace(/^wss:/, 'https:') : address}/${code}`;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOSTNAME = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
const WORKERS_HOST = '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){2}workers\\.dev';
const WORKER_URL = new RegExp(`^(?:https|wss)://(${WORKERS_HOST})/?$`, 'i');
const WORKER_INVITE = new RegExp(`^(?:https|wss)://(${WORKERS_HOST})/([a-z0-9]+)$`, 'i');

/** Los relés propios generados por Cloudflare tienen una dirección TLS bajo workers.dev. */
export function parseRelayUrl(value: unknown): string | null {
  const m = typeof value === 'string' ? WORKER_URL.exec(value.trim()) : null;
  return m ? `wss://${m[1]!.toLowerCase()}` : null;
}

function validHost(host: string): boolean {
  if (IPV4.test(host)) return host.split('.').every((o) => Number(o) <= 255);
  return HOSTNAME.test(host);
}

/** Interpreta lo que alguien pega en "Unirse": tolera espacios, minúsculas y los prefijos ws://, wss://, http:// y https://. */
export function parseInvite(text: string, relayUrl: string): ParsedInvite | null {
  const trimmed = text.trim();
  const worker = WORKER_INVITE.exec(trimmed);
  if (worker) {
    const code = worker[2]!.toUpperCase();
    return isRoomCode(code) ? { kind: 'internet', code, url: `wss://${worker[1]!.toLowerCase()}/${code}` } : null;
  }
  const t = trimmed.replace(/^(?:wss?|https?):\/\//i, '');
  if (!t.includes('/') && !t.includes(':')) {
    const code = t.toUpperCase();
    return isRoomCode(code) ? { kind: 'internet', code, url: `${relayUrl.replace(/\/+$/, '')}/${code}` } : null;
  }
  const m = /^([^/:\s]+):(\d{1,5})\/([A-Za-z0-9]+)$/.exec(t);
  if (!m) return null;
  const [, host, portText, rawCode] = m;
  const port = Number(portText);
  const code = rawCode!.toUpperCase();
  if (!validHost(host!) || port < 1 || port > 65535 || !isRoomCode(code)) return null;
  return { kind: 'local', code, url: `ws://${host}:${port}/${code}` };
}
