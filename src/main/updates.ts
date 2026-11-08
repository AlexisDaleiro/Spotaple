import type { AppUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/updates';

export function createUpdates(autoUpdater: AppUpdater | null, emit: (state: UpdateState) => void, beforeInstall: () => Promise<void>) {
  let state: UpdateState = { status: autoUpdater ? 'idle' : 'unsupported' };
  const set = (next: UpdateState) => {
    state = next;
    emit(next);
  };

  if (autoUpdater) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.on('download-progress', ({ percent }) => {
      if (state.status === 'downloading') set({ ...state, percent: Math.round(percent) });
    });
    autoUpdater.on('error', () => {
      // Los fallos de búsqueda y descarga también rechazan sus promesas. Instalar usa este evento.
      if (state.status === 'installing') set({ status: 'ready', version: state.version, installFailed: true });
    });
  }

  return {
    state: () => state,
    async check() {
      if (!autoUpdater || (state.status !== 'idle' && state.status !== 'current' && state.status !== 'error')) return;
      set({ status: 'checking' });
      try {
        const result = await autoUpdater.checkForUpdates();
        if (!result) throw new Error('No se pudo consultar el canal de actualizaciones.');
        if (!result.isUpdateAvailable) {
          set({ status: 'current' });
          return;
        }
        const { version } = result.updateInfo;
        set({ status: 'downloading', version });
        await autoUpdater.downloadUpdate();
        set({ status: 'ready', version });
      } catch {
        set({ status: 'error' });
      }
    },
    async install() {
      if (!autoUpdater || state.status !== 'ready') return;
      const { version } = state;
      set({ status: 'installing', version });
      try {
        await beforeInstall();
        autoUpdater.quitAndInstall(false, true);
      } catch {
        set({ status: 'ready', version, installFailed: true });
      }
    },
  };
}

export type Updates = ReturnType<typeof createUpdates>;
