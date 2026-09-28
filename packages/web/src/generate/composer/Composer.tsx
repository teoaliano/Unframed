import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
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

const isSendKey = (event: KeyboardEvent) => event.key === "Enter" && (platform() === "darwin" ? event.metaKey : event.ctrlKey);

/**
 * The composer shell, shared by the Generate tray and the Agent tray (spec 08). It owns
 * Esc, the send key and the selection binding; a tray owns its bands and what send does.
 */
export const Composer = ({ mode, project, recipe, onCollapse }: ComposerProps) => {
  const editor = useEditor();
  const { agentTray: AgentTray } = useSlots();
  const menus = useRef(new Set<string>());
  const tray = useRef<TrayHandle>(null);

  const onMenuOpen = useCallback((key: string, open: boolean) => {
    if (open) menus.current.add(key);
    else menus.current.delete(key);
  }, []);

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
      className="unframed-composer"
      role="group"
      aria-label="Composer"
      data-testid="composer"
      data-tray={mode}
      onKeyDownCapture={(event) => {
        // A menu or the model dialog inside the composer takes its keys first.
        if (menus.current.size > 0) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCollapse();
        } else if (isSendKey(event)) {
          event.preventDefault();
          event.stopPropagation();
          tray.current?.send();
        }
      }}
      onKeyDown={(event) => {
        // Keys typed in the composer are the composer's: tldraw's shortcuts never see them.
        event.stopPropagation();
      }}
    >
      {mode === "generate" ? (
        <GenerateTray project={project} recipe={recipe} onSent={onCollapse} onMenuOpen={onMenuOpen} handle={tray} />
      ) : AgentTray ? (
        <AgentTray project={project} close={onCollapse} />
      ) : null}
    </div>
  );
};
