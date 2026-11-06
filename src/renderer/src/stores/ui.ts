import type { ReactNode } from 'react';
import { create } from 'zustand';

export type ToastKind = 'info' | 'error' | 'success';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: { label: string; run: () => void };
}

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
  /** Un nivel de submenú: reemplaza el contenido del menú con un botón para volver. */
  submenu?: MenuItem[];
}

export type DialogSpec =
  | { kind: 'prompt'; title: string; label: string; initial?: string; confirmLabel: string; onSubmit: (value: string) => void | Promise<void> }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void> };

interface UiState {
  toasts: Toast[];
  dialog: DialogSpec | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  queueOpen: boolean;
  /** Se incrementa para pedir que la barra superior enfoque la búsqueda. */
  focusSearchTick: number;
  toggleQueue(): void;
  focusSearch(): void;
  openDialog(d: DialogSpec): void;
  closeDialog(): void;
  openMenu(x: number, y: number, items: MenuItem[]): void;
  closeMenu(): void;
  dismissToast(id: number): void;
}

const readQueueOpen = (): boolean => {
  try {
    return localStorage.getItem('queueOpen') === '1';
  } catch {
    return false;
  }
};

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  dialog: null,
  menu: null,
  queueOpen: readQueueOpen(),
  focusSearchTick: 0,
  toggleQueue() {
    const queueOpen = !get().queueOpen;
    set({ queueOpen });
    try {
      localStorage.setItem('queueOpen', queueOpen ? '1' : '0');
    } catch {
      /* preferencia opcional */
    }
  },
  focusSearch: () => set({ focusSearchTick: get().focusSearchTick + 1 }),
  openDialog: (dialog) => set({ dialog, menu: null }),
  closeDialog: () => set({ dialog: null }),
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

let toastId = 0;
/** Mensaje breve. Los de error duran más; con `action` (p. ej. Deshacer) se quedan un poco más. */
export function toast(message: string, kind: ToastKind = 'info', action?: Toast['action']) {
  const id = ++toastId;
  const { toasts } = useUi.getState();
  useUi.setState({ toasts: [...toasts.filter((t) => t.message !== message).slice(-2), { id, message, kind, action }] });
  const ms = kind === 'error' ? 6500 : action ? 6000 : 3200;
  setTimeout(() => useUi.getState().dismissToast(id), ms);
}
