import { useLayoutEffect, useRef, type SyntheticEvent } from "react";
import { useEditor, type Editor, type TLShapeId } from "tldraw";
import { Input } from "~/components/ui/input";
import { renameShape, stopRename } from "../rename.ts";

/** Keeps a press inside the label's controls from reaching the canvas. */
export const fieldEvents = (editor: Editor) => ({
  onPointerDown: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onPointerUp: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onPointerMove: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onDoubleClick: (event: SyntheticEvent) => editor.markEventAsHandled(event),
});

/**
 * The name field in a label's place: a fixed `@`, then the current `@id`, fully selected.
 * Enter and blur commit; Escape abandons the draft; every other key stays in the field.
 */
export const RenameField = ({ shapeId, current, kind }: { readonly shapeId: TLShapeId; readonly current: string; readonly kind: string }) => {
  const editor = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const finish = (commit: boolean) => {
      if (finished.current) return;
      finished.current = true;
      if (commit) renameShape(editor, shapeId, field.value);
      stopRename(editor);
    };
    // Native listeners, so tldraw's own key and pointer handlers never see what belongs to the field.
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    // tldraw keeps focus where it is on a canvas press, so a press anywhere else ends the rename here.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== field) finish(true);
    };
    field.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    // A double-click opens the field during its second press, and a menu item while the menu
    // closes; both move focus after that. Take the keyboard once they have.
    const frame = requestAnimationFrame(() => {
      field.focus();
      field.select();
      field.addEventListener("blur", onBlur);
    });
    return () => {
      cancelAnimationFrame(frame);
      field.removeEventListener("keydown", onKeyDown);
      field.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [editor, shapeId]);

  return (
    // The name is typed as it is, not in the label's case; the kit Input sits unstyled inside this frame.
    <span className="pointer-events-auto flex items-center gap-px">
      <span data-testid="rename-prefix">@</span>
      <span className="inline-flex h-5 items-center overflow-hidden rounded-md border border-highlight bg-background text-foreground">
        <Input
          ref={input}
          unstyled
          aria-label={`${kind} name`}
          defaultValue={current}
          size={Math.max(4, current.length + 2)}
          spellCheck={false}
          autoComplete="off"
          {...fieldEvents(editor)}
        />
      </span>
    </span>
  );
};
