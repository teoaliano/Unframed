import { SlidersHorizontal } from "lucide-react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { artifactsOf, toggleTuning } from "./state.ts";

/** Parameters in the selection toolbar of one filled page or motion: opens and closes its panel on the canvas. */
export const ParametersButton = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const open = useValue("parameters open", () => artifactsOf(editor).tuning.get() === shapeId, [editor, shapeId]);
  return (
    <Button variant="outline" size="sm" aria-pressed={open} data-pressed={open ? "" : undefined} onClick={() => toggleTuning(editor, shapeId)}>
      <SlidersHorizontal aria-hidden />
      Parameters
    </Button>
  );
};
