import { RotateCw } from "lucide-react";
import { useEditor, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Tip } from "../chrome/ui.tsx";
import { reloadFrame } from "./state.ts";

export const ReloadButton = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  return (
    <Tip label="Reload">
      <Button variant="outline" size="icon-sm" aria-label="Reload" data-testid="artifact-reload" onClick={() => reloadFrame(editor, shapeId)}>
        <RotateCw aria-hidden />
      </Button>
    </Tip>
  );
};
