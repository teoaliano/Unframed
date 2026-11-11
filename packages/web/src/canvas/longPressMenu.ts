import type { Editor } from "tldraw";

const HOLD_MS = 500;
const SLOP_PX = 10;

/**
 * A long press opens the canvas's right-click menu (spec 22), so every item on it is
 * reachable by touch. Touch only: the Pencil draws, and a pen resting still before a
 * stroke must not open a menu. The synthetic `contextmenu` is what the menu's own
 * trigger already listens for, so the menu opens where the finger is.
 */
export const installLongPressMenu = (editor: Editor): (() => void) => {
  const container = editor.getContainer();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let from: { readonly x: number; readonly y: number } | undefined;

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    from = undefined;
  };

  const down = (event: PointerEvent): void => {
    cancel();
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const { clientX, clientY } = event;
    from = { x: clientX, y: clientY };
    timer = setTimeout(() => {
      cancel();
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY, button: 2 }));
    }, HOLD_MS);
  };

  const move = (event: PointerEvent): void => {
    if (from === undefined) return;
    if (Math.abs(event.clientX - from.x) > SLOP_PX || Math.abs(event.clientY - from.y) > SLOP_PX) cancel();
  };

  const options = { capture: true } as const;
  container.addEventListener("pointerdown", down, options);
  container.addEventListener("pointermove", move, options);
  container.addEventListener("pointerup", cancel, options);
  container.addEventListener("pointercancel", cancel, options);
  return () => {
    cancel();
    container.removeEventListener("pointerdown", down, options);
    container.removeEventListener("pointermove", move, options);
    container.removeEventListener("pointerup", cancel, options);
    container.removeEventListener("pointercancel", cancel, options);
  };
};
