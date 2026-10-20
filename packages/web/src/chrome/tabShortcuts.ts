import { useEffect } from "react";
import type { ProjectActivation } from "../project/activation.ts";
import { platform } from "../canvas/platform.ts";
import { OPEN_PROJECT_LIST } from "./tabEvents.ts";

/** The text fields where a shortcut belongs to the field: the prompt editor, the chat composer, form inputs. */
const typing = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("[contenteditable='true'], input, textarea, select") !== null;
};

/** A dialog or menu that is open owns the keyboard (spec 17): tab shortcuts wait. */
const dialogOpen = (): boolean => document.querySelector("[role=dialog], [role=alertdialog]") !== null;

/**
 * The project tab shortcuts (spec 17, following Figma's desktop app). `Cmd` is Ctrl off macOS.
 * Cmd+T opens the project list, Cmd+W closes the active tab, Cmd+Shift+T reopens the last closed,
 * Cmd+1 to Cmd+8 jump to a tab and Cmd+9 to the last, and Ctrl+Tab cycles on every platform.
 * Alt+ArrowLeft and Alt+ArrowRight move the focused tab. None fire while a field or dialog has focus.
 */
export const useTabShortcuts = (activation: ProjectActivation): void => {
  useEffect(() => {
    const mac = platform() === "darwin";
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || dialogOpen()) return;
      const cmd = mac ? event.metaKey : event.ctrlKey;
      const key = event.key;
      const { order, active } = activation.tabState();

      if (event.ctrlKey && key === "Tab" && order.length > 0) {
        const at = Math.max(0, order.indexOf(active ?? ""));
        const step = event.shiftKey ? -1 : 1;
        const next = order[(at + step + order.length) % order.length];
        event.preventDefault();
        if (next !== undefined) void activation.activate(next);
        return;
      }

      if (event.altKey && !cmd && (key === "ArrowLeft" || key === "ArrowRight")) {
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.project : undefined;
        if (focused === undefined) return;
        event.preventDefault();
        const at = order.indexOf(focused);
        activation.moveTab(focused, at + (key === "ArrowLeft" ? -1 : 1));
        return;
      }

      if (!cmd) return;
      const lower = key.toLowerCase();
      if (!event.shiftKey && lower === "t") {
        event.preventDefault();
        window.dispatchEvent(new Event(OPEN_PROJECT_LIST));
      } else if (!event.shiftKey && lower === "w") {
        if (active === undefined) return;
        event.preventDefault();
        void activation.closeTab(active);
      } else if (event.shiftKey && lower === "t") {
        event.preventDefault();
        void activation.reopenClosed();
      } else if (!event.shiftKey && /^[1-9]$/.test(key) && order.length > 0) {
        const target = key === "9" ? order[order.length - 1] : order[Number(key) - 1];
        if (target === undefined) return;
        event.preventDefault();
        void activation.activate(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activation]);
};
