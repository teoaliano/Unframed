import { dialsWith, type ArtifactKind } from "@unframed/domain";
import type { Editor, TLShapeId } from "tldraw";

interface LateSave {
  readonly project: string;
  readonly shapeId: string;
  readonly kind: ArtifactKind;
  readonly from: string;
  readonly to: string;
  readonly held: Readonly<Record<string, unknown>> | undefined;
}

const waiting: LateSave[] = [];

export const keepLateSave = (save: LateSave): void => {
  waiting.push(save);
};

export const applyLateSaves = (editor: Editor, project: string): void => {
  for (let index = waiting.length - 1; index >= 0; index--) {
    const save = waiting[index]!;
    if (save.project !== project) continue;
    waiting.splice(index, 1);
    const shape = editor.getShape(save.shapeId as TLShapeId);
    if (!shape || (shape.props as { file?: string }).file !== save.from) continue;
    const saved = (shape.props as { dials?: Record<string, unknown> }).dials;
    editor.markHistoryStoppingPoint("element edit");
    editor.updateShape({ id: shape.id, type: save.kind, props: save.held === undefined ? { file: save.to } : { file: save.to, dials: dialsWith(saved, save.held) } } as never);
  }
};
