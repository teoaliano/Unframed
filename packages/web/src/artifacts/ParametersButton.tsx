import { SlidersHorizontal } from "lucide-react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { Toggle } from "~/components/ui/toggle";
import { artifactsOf, toggleTuning } from "./state.ts";

/** Parameters in the selection toolbar of one filled page or motion: opens and closes its panel on the canvas. */
export const ParametersButton = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const open = useValue("parameters open", () => artifactsOf(editor).tuning.get() === shapeId, [editor, shapeId]);
  return (
    <Toggle variant="outline" size="sm" pressed={open} onPressedChange={() => toggleTuning(editor, shapeId)}>
      <SlidersHorizontal aria-hidden />
      Parameters
    </Toggle>
  );
};
