import type { ReactNode } from "react";
import { ToastProvider, toastManager } from "~/components/ui/toast";

const ERROR_TIMEOUT_MS = 6000;

export const showError = (message: string, options: { id?: string; sticky?: boolean } = {}): string =>
  toastManager.add({
    ...(options.id === undefined ? {} : { id: options.id }),
    title: message,
    type: "error",
    priority: "high",
    timeout: options.sticky ? 0 : ERROR_TIMEOUT_MS,
  });

export const showNotice = (message: string, type: "warning" | "info", description?: string): string =>
  toastManager.add({ title: message, ...(description === undefined ? {} : { description }), type, priority: type === "warning" ? "high" : "low", timeout: ERROR_TIMEOUT_MS });

export const showReveal = (message: string, onReveal: () => void): string => {
  const id: string = toastManager.add({
    title: message,
    type: "info",
    priority: "low",
    timeout: ERROR_TIMEOUT_MS,
    actionProps: {
      children: "Reveal",
      onClick: () => {
        toastManager.close(id);
        onReveal();
      },
    },
  });
  return id;
};

export const showUndo = (message: string, onUndo: () => void): string => {
  const id: string = toastManager.add({
    title: message,
    type: "info",
    priority: "low",
    timeout: ERROR_TIMEOUT_MS,
    actionProps: {
      children: "Undo",
      onClick: () => {
        toastManager.close(id);
        onUndo();
      },
    },
  });
  return id;
};

export const closeToast =(id: string): void => toastManager.close(id);

export const Toasts = ({ children }: { readonly children: ReactNode }) => <ToastProvider position="bottom-left">{children}</ToastProvider>;
