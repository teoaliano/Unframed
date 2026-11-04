import { SunMoon } from "lucide-react";
import { useEditor, useValue, type Editor, type TLShapeId, type TLShape, type TLShapePartial } from "tldraw";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tip } from "../chrome/ui.tsx";
import { kitOf } from "./kit.ts";

const setShapeMode = (editor: Editor, shapeId: TLShapeId, mode: string): void => {
  const shape = editor.getShape(shapeId);
  const kit = kitOf(editor);
  if (!shape || !kit || !kit.modes.includes(mode)) return;
  if (mode === kit.modes[0]) {
    const props: Record<string, unknown> = { ...shape.props };
    delete props.mode;
    editor.store.put([{ ...shape, props } as TLShape]);
    return;
  }
  editor.updateShape({ id: shapeId, type: shape.type, props: { mode } } as TLShapePartial);
};

export const KitModePicker = ({ shapeId, variant }: { readonly shapeId: TLShapeId; readonly variant: "header" | "toolbar" }) => {
  const editor = useEditor();
  const kit = useValue("project kit", () => kitOf(editor), [editor]);
  const stored = useValue("artifact mode", () => (editor.getShape(shapeId)?.props as { mode?: string } | undefined)?.mode, [editor, shapeId]);
  if (!kit || kit.modes.length < 2) return null;
  const current = stored !== undefined && kit.modes.includes(stored) ? stored : kit.modes[0]!;
  const trigger = (
    <SelectTrigger aria-label="Kit mode" size="sm" data-testid="kit-mode" className={variant === "header" ? "w-auto shrink-0 @max-[760px]/editor-header:min-w-0" : "w-auto shrink-0"}>
      <SunMoon aria-hidden />
      <span className={variant === "header" ? "@max-[760px]/editor-header:sr-only" : undefined}>
        <SelectValue>{current}</SelectValue>
      </span>
    </SelectTrigger>
  );
  return (
    <Select value={current} onValueChange={(value) => value && setShapeMode(editor, shapeId, value)}>
      {variant === "toolbar" ? <Tip label="Kit mode">{trigger}</Tip> : trigger}
      <SelectPopup alignItemWithTrigger={false}>
        {kit.modes.map((mode, index) => (
          <SelectItem key={mode} value={mode}>
            {index === 0 ? `${mode} (default)` : mode}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
};
