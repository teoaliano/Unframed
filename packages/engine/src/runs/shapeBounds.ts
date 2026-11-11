import { storedPageBoxes, storedShapeBoxes, type Box } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";

export const shapeBoxes = (records: ReadonlyArray<TLRecord>): Map<string, { local: Box; page: Box }> => storedShapeBoxes(records);

export const shapePageBoxes = (records: ReadonlyArray<TLRecord>): Array<{ readonly id: string; readonly type: string; readonly box: Box }> => storedPageBoxes(records);
