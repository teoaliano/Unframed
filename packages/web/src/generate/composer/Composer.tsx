import { useCallback, useEffect, useRef } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import { platform } from "../../canvas/platform.ts";
import { useSlots } from "../../chrome/slots.ts";
import type { RecipeMode } from "../state.ts";
import { GenerateTray, type TrayHandle } from "./GenerateTray.tsx";

export interface ComposerProps {
  readonly mode: "generate" | "agent";
  readonly project: string;
  readonly recipe: RecipeMode | undefined;
  /** Esc, or an acknowledged send: back to the bar. */
  readonly onCollapse: () => void;
}

const isSendKey = (event: { readonly key: string; readonly metaKey: boolean; readonly ctrlKey: boolean }) =>
  event.key === "Enter" && (platform() === "darwin" ? event.metaKey : event.ctrlKey);

const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && target.closest("input, textarea, [contenteditable='true']") !== null;

/**
 * The composer shell, shared by the Generate tray and the Agent tray (spec 08). It owns
 * Esc, the send key and the selection binding; a tray owns its bands and what send does.
 */
export const Composer = ({ mode, project, recipe, onCollapse }: ComposerProps) => {
  const editor = useEditor();
  const { agentTray: AgentTray } = useSlots();
  // Each open menu, with how to close it when its owner lets the shell do that.
  const menus = useRef(new Map<string, (() => void) | undefined>());
  const tray = useRef<TrayHandle>(null);
  const root = useRef<HTMLDivElement>(null);

  const onMenuOpen = useCallback((key: string, open: boolean, close?: () => void) => {
    if (open) menus.current.set(key, close);
    else menus.current.delete(key);
  }, []);

  // Esc closes a menu that gave the shell its close, whatever has focus. Focus can be outside
  // the menu: on its chip before the menu takes focus, or on "+ add prop" when a value menu
  // opens from it. Base UI's own Esc listeners need focus inside, or arrive a render later.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const closers = [...menus.current.values()].filter((close) => close !== undefined);
      if (closers.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      for (const close of closers) close();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  // The send key works while the composer is open wherever focus is, unless another text field has it.
  // The Agent tray reads its own keys (Enter sends there, Cmd+Enter flips queue and steer).
  useEffect(() => {
    if (mode === "agent") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSendKey(event) || menus.current.size > 0) return;
      if (!root.current?.contains(event.target as Node) && isEditable(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      tray.current?.send();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [mode]);

  // While the composer is open, clicking a shape adds it to the selection instead of replacing it.
  useEffect(
    () =>
      editor.sideEffects.registerBeforeChangeHandler("instance_page_state", (previous, next) => {
        const before = previous.selectedShapeIds;
        const after = next.selectedShapeIds;
        if (before === after || before.length === 0 || after.length !== 1 || editor.inputs.getShiftKey()) return next;
        const [clicked] = after as [TLShapeId];
        return { ...next, selectedShapeIds: before.includes(clicked) ? before : [...before, clicked] };
      }),
    [editor],
  );

  return (
    <div
      ref={root}
      className="box-border w-[420px] p-3 data-[tray=agent]:w-[416px] data-[tray=agent]:p-0"
      role="group"
      aria-label="Composer"
      data-testid="composer"
      data-tray={mode}
      onKeyDownCapture={(event) => {
        // tldraw reads keys on its container, which holds the composer, before React's bubble
        // handlers run. Unmarked, an Esc on a chip whose menu is still taking focus clears the
        // selection, and that closes the composer.
        editor.markEventAsHandled(event);
        // A menu or the model dialog inside the composer takes its keys first.
        if (menus.current.size > 0) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCollapse();
        }
      }}
      onKeyDown={(event) => {
        // Keys typed in the composer are the composer's: tldraw's shortcuts, on the body, never see them.
        event.stopPropagation();
      }}
    >
      {mode === "generate" ? (
        <GenerateTray project={project} recipe={recipe} onSent={onCollapse} onMenuOpen={onMenuOpen} handle={tray} />
      ) : AgentTray ? (
        <AgentTray project={project} close={onCollapse} onMenuOpen={onMenuOpen} />
      ) : null}
    </div>
  );
};
