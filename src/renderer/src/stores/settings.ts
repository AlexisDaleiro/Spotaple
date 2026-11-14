import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings';
import { api } from '../api';
import { applySettings } from '../lib/apply-settings';
import { toast } from './ui';

export interface SettingsApi {
  get(): Promise<AppSettings>;
  set(patch: Partial<AppSettings>): Promise<AppSettings>;
}

export interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load(): Promise<void>;
  /** Aplica al instante y guarda con retraso: los cambios seguidos (selector de color) viajan juntos. */
  update(patch: Partial<AppSettings>): void;
  /** Guarda ya lo pendiente (p. ej. al cerrar la ventana). */
  flush(): Promise<void>;
  /** Vuelve a aplicar los ajustes actuales (cambió el esquema del sistema). */
  reapply(): void;
}

export function createSettingsStore(deps: { api: SettingsApi; apply: (s: AppSettings) => void; onError: (message: string) => void; debounceMs?: number }) {
  const wait = deps.debounceMs ?? 250;
  let pending: Partial<AppSettings> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = Promise.resolve();
  let revision = 0;
  const fail = (e: unknown) => deps.onError(e instanceof Error ? e.message : 'No se pudieron guardar los ajustes.');

  return createStore<SettingsState>((set, get) => {
    function flush() {
      clearTimeout(timer);
      timer = undefined;
      if (Object.keys(pending).length === 0) return writing;
      const patch = pending;
      pending = {};
      const mine = revision;
      writing = writing.then(async () => {
        try {
          const saved = await deps.api.set(patch);
          if (mine === revision && JSON.stringify(saved) !== JSON.stringify(get().settings)) {
            set({ settings: saved });
            deps.apply(saved);
          }
        } catch (e) {
          fail(e);
        }
      });
      return writing;
    }

    return {
      settings: DEFAULT_SETTINGS,
      loaded: false,
      async load() {
        try {
          set({ settings: { ...DEFAULT_SETTINGS, ...(await deps.api.get()) } });
        } catch (e) {
          fail(e);
        }
        set({ loaded: true });
        deps.apply(get().settings);
      },
      update(patch) {
        revision++;
        const settings = { ...get().settings, ...patch };
        set({ settings });
        deps.apply(settings);
        pending = { ...pending, ...patch };
        clearTimeout(timer);
        timer = setTimeout(() => void flush(), wait);
      },
      flush,
      reapply() {
        deps.apply(get().settings);
      },
    };
  });
}

const systemLight = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;

export const settingsStore = createSettingsStore({
  // Perezoso: `api` no existe fuera de la ventana (pruebas) y no debe romper al importar el módulo.
  api: { get: () => api.settings.get(), set: (patch) => api.settings.set(patch) },
  apply: (s) => applySettings(document.documentElement, s, systemLight()),
  onError: (message) => toast(message, 'error'),
});

export const useSettings = <T>(selector: (s: SettingsState) => T): T => useStore(settingsStore, selector);
