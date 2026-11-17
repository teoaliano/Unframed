import { dialsWith, type ArtifactKind } from "@unframed/domain";
import type { CanvasDoc } from "../../canvas/doc.ts";

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

export const applyLateSaves = (doc: CanvasDoc, project: string): void => {
  for (let index = waiting.length - 1; index >= 0; index--) {
    const save = waiting[index]!;
    if (save.project !== project) continue;
    waiting.splice(index, 1);
    const shape = doc.shape(save.shapeId);
    if (!shape || (shape.props as { file?: string }).file !== save.from) continue;
    const saved = (shape.props as { dials?: Record<string, unknown> }).dials;
    doc.update(shape.id, save.held === undefined ? { file: save.to } : { file: save.to, dials: dialsWith(saved, save.held) }, "element edit");
  }
};
