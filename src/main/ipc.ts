import { ipcMain } from 'electron';
import { createHandlers } from './handlers';

export function registerIpc({ rendererOrigin, ...deps }: Parameters<typeof createHandlers>[0] & { rendererOrigin?: string }) {
  for (const [channel, handler] of createHandlers(deps)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const url = event.senderFrame?.url ?? '';
      const trusted = rendererOrigin ? url.startsWith(rendererOrigin) : url.startsWith('file://');
      if (!trusted) return { ok: false, error: { code: 'unknown', message: 'Origen no autorizado.' } };
      return handler(...args);
    });
  }
}
