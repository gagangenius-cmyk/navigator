import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

interface UiState {
  toasts: ToastMessage[];
  /** Device has no connectivity (from NetInfo). */
  offline: boolean;
  /** Biometric lock is showing. */
  locked: boolean;
  show: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
  setOffline: (offline: boolean) => void;
  setLocked: (locked: boolean) => void;
}

let nextId = 1;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  offline: false,
  locked: false,
  show: (kind, text) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 5000 : 3000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setOffline: (offline) => set({ offline }),
  setLocked: (locked) => set({ locked }),
}));

/** Imperative helper for use outside components (mutation callbacks). */
export const toast = {
  success: (text: string) => useUiStore.getState().show('success', text),
  error: (text: string) => useUiStore.getState().show('error', text),
  info: (text: string) => useUiStore.getState().show('info', text),
};
