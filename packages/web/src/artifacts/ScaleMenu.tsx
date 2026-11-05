import type { ArtifactShapeProps } from "@unframed/contracts";
import { ARTIFACT_SCALES, artifactScale, rescaledArtifact } from "@unframed/domain";
import { ChevronDown, Scaling } from "lucide-react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tip } from "../chrome/ui.tsx";

const percent = (scale: number): string => `${Math.round(scale * 100)}%`;

export const setArtifactScale = (editor: Editor, shapeId: TLShapeId, next: number): void => {
  const shape = editor.getShape(shapeId);
  if (!shape) return;
  const props = shape.props as ArtifactShapeProps;
  if (artifactScale(props) === next) return;
  const sized = rescaledArtifact(props, next);
  const { scale: _scale, ...rest } = props;
  editor.markHistoryStoppingPoint("artifact scale");
  editor.store.put([{ ...shape, props: { ...rest, w: sized.w, h: sized.h, ...(sized.scale === undefined ? {} : { scale: sized.scale }) } } as TLShape]);
};

export const ScaleMenu = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const scale = useValue("artifact scale", () => artifactScale((editor.getShape(shapeId)?.props ?? {}) as { scale?: unknown }), [editor, shapeId]);
  return (
    <Menu>
      <Tip label="Scale on the canvas">
        <MenuTrigger render={<Button variant="outline" size="sm" aria-label={`Scale on the canvas, ${percent(scale)}`} data-testid="artifact-scale" />}>
          <Scaling aria-hidden />
          <span className="tabular-nums">{percent(scale)}</span>
          <ChevronDown aria-hidden className="opacity-72" />
        </MenuTrigger>
      </Tip>
      <MenuPopup align="start" className="min-w-36">
        <MenuRadioGroup value={String(scale)} onValueChange={(value) => setArtifactScale(editor, shapeId, Number(value))}>
          {ARTIFACT_SCALES.map((choice) => (
            <MenuRadioItem key={choice} value={String(choice)} closeOnClick>
              <span className="flex items-center justify-between gap-3 tabular-nums">
                {percent(choice)}
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem disabled={scale === 1} onClick={() => setArtifactScale(editor, shapeId, 1)}>
          Reset to 100%
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
};
