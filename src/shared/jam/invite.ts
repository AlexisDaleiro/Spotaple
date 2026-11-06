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

/** Internet: solo el código. Red local: `ip:puerto/CODIGO`. */
export function formatInvite(kind: 'local' | 'internet', code: string, hostPort?: string): string {
  return kind === 'local' && hostPort ? `${hostPort}/${code}` : code;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOSTNAME = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

function validHost(host: string): boolean {
  if (IPV4.test(host)) return host.split('.').every((o) => Number(o) <= 255);
  return HOSTNAME.test(host);
}

/** Interpreta lo que alguien pega en "Unirse": tolera espacios, minúsculas y los prefijos ws://, wss://, http:// y https://. */
export function parseInvite(text: string, relayUrl: string): ParsedInvite | null {
  const t = text.trim().replace(/^(?:wss?|https?):\/\//i, '');
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
