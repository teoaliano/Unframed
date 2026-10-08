import type { ReactNode } from "react";
import { ToastProvider, toastManager } from "~/components/ui/toast";

const ERROR_TIMEOUT_MS = 6000;

/**
 * Shows a failure on the app's one toast queue, from inside React or not. A toast with an
 * `id` replaces the previous toast with that id instead of stacking. Error toasts hide by
 * themselves; `sticky` ones stay until closed.
 */
export const showError = (message: string, options: { id?: string; sticky?: boolean } = {}): string =>
  toastManager.add({
    ...(options.id === undefined ? {} : { id: options.id }),
    title: message,
    type: "error",
    priority: "high",
    timeout: options.sticky ? 0 : ERROR_TIMEOUT_MS,
  });

/** A notice that is not a failure: a warning when something went partly wrong, or information, with an optional second line. */
export const showNotice = (message: string, type: "warning" | "info", description?: string): string =>
  toastManager.add({ title: message, ...(description === undefined ? {} : { description }), type, priority: type === "warning" ? "high" : "low", timeout: ERROR_TIMEOUT_MS });

/** A notice about something the person just did, with Undo; the toast closes when Undo is pressed. */
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

/** The kit's toasts at the bottom start corner, above the canvas and its chrome. */
export const Toasts = ({ children }: { readonly children: ReactNode }) => <ToastProvider position="bottom-left">{children}</ToastProvider>;
