import { nameRefusal } from "@unframed/domain";
import { useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { Input } from "~/components/ui/input";
import { renameShape, stopRename } from "../rename.ts";

/** Keeps a press inside the label's controls from reaching the canvas. */
export const fieldEvents = (editor: Editor) => ({
  onPointerDown: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onPointerUp: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onPointerMove: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onDoubleClick: (event: SyntheticEvent) => editor.markEventAsHandled(event),
});

/** The field's width in characters: room for what is typed, then it scrolls. */
const MIN_CHARS = 4;
const MAX_CHARS = 40;
const charsFor = (value: string) => Math.min(MAX_CHARS, Math.max(MIN_CHARS, value.length + 2));

/**
 * The name field in a label's place: a fixed `@`, then the current `@id`, fully selected.
 * Enter and blur commit; Escape abandons the draft; every other key stays in the field. A
 * name the rules refuse keeps the field open on Enter with the reason beside it; blur
 * abandons it. Below 100 % zoom the field is scaled back up, so it is never smaller on
 * screen than at 100 %.
 */
export const RenameField = ({ shapeId, current, kind }: { readonly shapeId: TLShapeId; readonly current: string; readonly kind: string }) => {
  const editor = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [problem, setProblem] = useState<string>();
  const zoom = useValue("rename zoom", () => editor.getZoomLevel(), [editor]);

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const finish = (commit: boolean) => {
      if (finished.current) return;
      finished.current = true;
      if (commit && nameRefusal(field.value, current) === undefined) renameShape(editor, shapeId, field.value);
      stopRename(editor);
    };
    // Native listeners, so tldraw's own key and pointer handlers never see what belongs to the field.
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        const refusal = nameRefusal(field.value, current);
        if (refusal !== undefined) setProblem(refusal);
        else finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };
    const onInput = () => {
      field.size = charsFor(field.value);
      setProblem(undefined);
    };
    const onBlur = () => finish(true);
    // tldraw keeps focus where it is on a canvas press, so a press anywhere else ends the rename here.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== field) finish(true);
    };
    field.addEventListener("keydown", onKeyDown);
    field.addEventListener("input", onInput);
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
      field.removeEventListener("input", onInput);
      field.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [editor, shapeId, current]);

  return (
    // The name is typed as it is, not in the label's case; the kit Input sits unstyled inside this frame.
    <span className="pointer-events-auto flex origin-bottom-left items-center gap-px" style={zoom < 1 ? { transform: `scale(${1 / zoom})` } : undefined}>
      <span data-testid="rename-prefix">@</span>
      <span className="inline-flex h-5 items-center overflow-hidden rounded-md border border-highlight bg-background text-foreground">
        <Input
          ref={input}
          unstyled
          aria-label={`${kind} name`}
          aria-invalid={problem !== undefined ? true : undefined}
          defaultValue={current}
          size={charsFor(current)}
          spellCheck={false}
          autoComplete="off"
          {...fieldEvents(editor)}
        />
      </span>
      {problem !== undefined && (
        <span role="alert" className="ml-1.5 whitespace-nowrap text-destructive-foreground">
          {problem}
        </span>
      )}
    </span>
  );
};
