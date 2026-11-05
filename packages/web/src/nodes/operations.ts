import { NODE_DEFAULT_SIZE, type NodeMedium, type NodeShapeProps, type WireRole } from "@unframed/contracts";
import { defaultRole, nodeRequest, sourceOf, wireRefusal, WIRE_TARGET_REFUSAL, nodeCatalogueOf, frameImagesOf } from "@unframed/domain";
import { createShapeId, getIndexBetween, type Editor, type IndexKey, type TLShapeId } from "tldraw";
import { knownCatalogue } from "../generate/catalogue.ts";
import { showError } from "../toasts.tsx";
import {isNodeShape, isWireShape, nodeCanvas, nodeCatalogues, type NodeShape, type WireShape } from "./facts.ts";

/** The model a node runs: its own, else the medium's default from the session's catalogue. */
export const nodeModel = (props: Pick<NodeShapeProps, "medium" | "model">): string => props.model !== "" ? props.model : (knownCatalogue(nodeCatalogueOf(props.medium))?.default ?? "");

export const nodeEntry = (props: Pick<NodeShapeProps, "medium" | "model">) => knownCatalogue(nodeCatalogueOf(props.medium))?.models.find((entry) => entry.id === nodeModel(props));

let framesEditor: Editor | undefined;
export const bindNodeCatalogues = (editor: Editor) => {
  framesEditor = editor;
};

export const nodeFrames = (props: Pick<NodeShapeProps, "medium" | "model">): string[] => {
  if (props.medium !== "video") return [];
  const listed = framesEditor === undefined ? undefined : nodeCatalogues(framesEditor).get().video;
  const model = nodeModel(props);
  const entry = listed?.find((each) => each.id === model) ?? nodeEntry(props);
  return frameImagesOf(entry);
};

/** The roles each wire into a node shows, from the one function that also builds its run. */

/** Draws a wire from `from` into `to`, or says why it cannot be drawn. */
export const connectWire = (editor: Editor, from: TLShapeId, to: TLShapeId | undefined): boolean => {
  const canvas = nodeCanvas(editor);
  const target = to === undefined ? undefined : canvas.nodes.get(to);
  if (to === undefined || !target) {
    showError(WIRE_TARGET_REFUSAL);
    return false;
  }
  const source = sourceOf(canvas, from);
  const role: WireRole = (source === undefined ? undefined : defaultRole(target.medium, nodeFrames(target), source)) ?? "prompt";
  const refusal = wireRefusal({ canvas, from, to, role });
  if (refusal !== null) {
    showError(refusal);
    return false;
  }
  if (canvas.wires.some((wire) => wire.from === from && wire.to === to)) return true;
  const page = editor.getCurrentPageId();
  const top = editor.getSortedChildIdsForParent(page).map((id) => editor.getShape(id)!.index).at(-1);
  editor.markHistoryStoppingPoint("draw wire");
  editor.createShape<WireShape>({
    id: createShapeId(),
    type: "wire",
    parentId: page,
    x: 0,
    y: 0,
    index: getIndexBetween(top ?? null, null),
    props: { from, to, role },
    meta: source === "page" || source === "node-page" ? {} : { unframed: { chosen: true } },
  });
  return true;
};

/** Changes a wire's role, or says why it cannot take it. */
export const setWireRole = (editor: Editor, wireId: TLShapeId, role: WireRole, files?: "entry" | "linked"): void => {
  const wire = editor.getShape(wireId);
  if (!isWireShape(wire)) return;
  const refusal = wireRefusal({ canvas: nodeCanvas(editor), from: wire.props.from, to: wire.props.to, role, wireId });
  if (refusal !== null) return void showError(refusal);
  editor.markHistoryStoppingPoint("wire role");
  editor.updateShape<WireShape>({
    id: wireId,
    type: "wire",
    props: { ...wire.props, role, ...(files === undefined ? {} : { files }) },
    meta: { ...wire.meta, unframed: { ...((wire.meta.unframed as object | undefined) ?? {}), chosen: true } },
  });
};

export const setWireFiles = (editor: Editor, wireId: TLShapeId, files: "entry" | "linked"): void => {
  const wire = editor.getShape(wireId);
  if (!isWireShape(wire)) return;
  editor.markHistoryStoppingPoint("wire files");
  editor.updateShape<WireShape>({ id: wireId, type: "wire", props: { ...wire.props, files } });
};

/** Moves a wire in its node's input list: before the wire at `before`, or to the end. */
export const moveWire = (editor: Editor, wireId: TLShapeId, before: TLShapeId | undefined): void => {
  const wire = editor.getShape(wireId);
  if (!isWireShape(wire)) return;
  const siblings = editor
    .getCurrentPageShapesSorted()
    .filter((shape): shape is WireShape => isWireShape(shape) && shape.id !== wireId);
  const at = before === undefined ? siblings.length : siblings.findIndex((shape) => shape.id === before);
  const below = at <= 0 ? undefined : siblings[at - 1];
  const above = at < 0 || at >= siblings.length ? undefined : siblings[at];
  const index = getIndexBetween((below?.index ?? null) as IndexKey | null, (above?.index ?? null) as IndexKey | null);
  editor.markHistoryStoppingPoint("reorder wire");
  editor.updateShape<WireShape>({ id: wireId, type: "wire", index });
};

/** Edits a node's own settings as one undo step. */
type NodePatch = Partial<Pick<NodeShapeProps, "medium" | "model" | "params" | "instruction" | "currentVersionId">> & { readonly runs?: number | undefined };

export const updateNode = (editor: Editor, id: TLShapeId, patch: NodePatch, mark = true): void => {
  const shape = editor.getShape(id);
  if (!isNodeShape(shape)) return;
  if (mark) editor.markHistoryStoppingPoint("node settings");
  const props = { ...shape.props, ...patch } as NodeShapeProps;
  if (patch.runs === undefined && "runs" in patch) delete props.runs;
  editor.updateShape<NodeShape>({ id, type: "node", props });
};

export const newNodeProps = (medium: NodeMedium, values: { model?: string; params?: Record<string, string | number | boolean>; runs?: number }): NodeShapeProps => ({
  ...NODE_DEFAULT_SIZE,
  medium,
  model: values.model ?? "",
  params: values.params ?? {},
  ...(medium === "image" && values.runs !== undefined && values.runs > 1 ? { runs: values.runs } : {}),
  instruction: "",
  versions: [],
  currentVersionId: null,
});
