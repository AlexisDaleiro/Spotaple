import { createBridge } from '../src/shared/bridge';
import { IPC } from '../src/shared/api';
import type { ExportResult } from '../src/shared/offline';
import type { IpcResult } from '../src/shared/types';
import './touch.css';

const events = new EventSource('./events');
events.addEventListener('android:install', () => window.SpotapleAndroid?.install());
const listeners = new Map<string, EventListener>();
const pendingSaves = new Map<number, (status: number) => void>();
let nextSave = 0;
Object.assign(window, {
  spotapleSaveResult(id: number, status: number) {
    pendingSaves.get(id)?.(status);
    pendingSaves.delete(id);
  },
});

declare global {
  interface Window {
    SpotapleAndroid?: {
      save(id: number, token: string, name: string): void;
      media(state: string): void;
      open(url: string): void;
      install(): void;
    };
  }
}

async function saveTransfer(result: Extract<ExportResult, { saved: true }>): Promise<ExportResult> {
  const android = window.SpotapleAndroid;
  if (!android || !result.transfer) throw new Error('No se pudo abrir el selector de archivos.');
  const status = await new Promise<number>((resolve) => {
    const id = ++nextSave;
    pendingSaves.set(id, resolve);
    android.save(id, result.transfer!, result.name);
  });
  if (status < 0) throw new Error('No se pudo guardar el archivo.');
  return status > 0 ? { saved: true, name: result.name } : { saved: false };
}

async function request<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const response = await fetch('./rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args }),
  });
  if (!response.ok) throw new Error('No se pudo comunicar con Spotaple.');
  return response.json();
}

window.spotapleBridge = createBridge(
  async <T>(channel: string, ...args: unknown[]) => {
    const result = await request<T>(channel, ...args);
    if (channel === IPC.export && result.ok) {
      const out = result.data as ExportResult;
      if (out.saved) return { ok: true, data: await saveTransfer(out) as T };
    }
    return result;
  },
  (channel, callback) => {
    const previous = listeners.get(channel);
    if (previous) events.removeEventListener(channel, previous);
    const listener: EventListener = (event) => callback(JSON.parse((event as MessageEvent<string>).data));
    listeners.set(channel, listener);
    events.addEventListener(channel, listener);
    return Promise.resolve({ ok: true, data: undefined });
  },
  'android',
);
document.documentElement.dataset.platform = 'android';
void import('./renderer-platform');
