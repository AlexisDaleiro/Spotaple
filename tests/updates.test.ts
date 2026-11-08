import { EventEmitter } from 'node:events';
import type { AppUpdater } from 'electron-updater';
import { describe, expect, it, vi } from 'vitest';
import { createUpdates } from '../src/main/updates';

const available = { isUpdateAvailable: true, updateInfo: { version: '0.1.1' } };

function fixture() {
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn().mockResolvedValue(available),
    downloadUpdate: vi.fn().mockResolvedValue(['installer.exe']),
    quitAndInstall: vi.fn(),
  });
  const beforeInstall = vi.fn(async () => {});
  const updates = createUpdates(updater as unknown as AppUpdater, vi.fn(), beforeInstall);
  return { updater, updates, beforeInstall };
}

describe('actualizaciones de Spotaple', () => {
  it('no permite actualizar una copia que no tiene instalador', async () => {
    const emit = vi.fn();
    const beforeInstall = vi.fn(async () => {});
    const updates = createUpdates(null, emit, beforeInstall);
    await updates.check();
    await updates.install();
    expect(updates.state()).toEqual({ status: 'unsupported' });
    expect(emit).not.toHaveBeenCalled();
    expect(beforeInstall).not.toHaveBeenCalled();
  });

  it('descarga una vez y espera la confirmación para instalar', async () => {
    const { updater, updates, beforeInstall } = fixture();
    let finishDownload!: (files: string[]) => void;
    updater.downloadUpdate.mockReturnValueOnce(new Promise<string[]>((resolve) => { finishDownload = resolve; }));

    const check = updates.check();
    await updates.check();
    await updates.install();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    updater.emit('download-progress', { percent: 42.1 });
    expect(updates.state()).toEqual({ status: 'downloading', version: '0.1.1', percent: 42 });

    finishDownload(['installer.exe']);
    await check;
    expect(updates.state()).toEqual({ status: 'ready', version: '0.1.1' });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    await Promise.all([updates.install(), updates.install()]);
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
    expect(updates.state()).toEqual({ status: 'installing', version: '0.1.1' });
  });

  it('permite reintentar y distingue un fallo de tener la última versión', async () => {
    const { updater, updates } = fixture();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce({ isUpdateAvailable: false });
    updater.downloadUpdate.mockRejectedValueOnce(new Error('descarga incompleta'));

    await updates.check();
    expect(updates.state()).toEqual({ status: 'error' });
    await updates.check();
    expect(updates.state()).toEqual({ status: 'current' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    await updates.check();
    expect(updates.state()).toEqual({ status: 'error' });

    await updates.check();
    updater.quitAndInstall.mockImplementationOnce(() => updater.emit('error', new Error('instalador bloqueado')));
    await updates.install();
    expect(updates.state()).toEqual({ status: 'ready', version: '0.1.1', installFailed: true });
  });
});
