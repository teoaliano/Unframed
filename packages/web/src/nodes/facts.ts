import type { ModelEntry, NodeMedium, NodeShapeProps } from "@unframed/contracts";
import { nodeCanvasOf, type NodeCanvas } from "@unframed/domain";
import { atom, computed, type Atom, type Computed, type Editor, type TLShape, type TLShapeId } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";
import { canvasShapes } from "../generate/facts.ts";

export type NodeShape = TLShape<"node">;
export type WireShape = TLShape<"wire">;

const renderAtoms = new WeakMap<Editor, Atom<ReadonlyMap<string, string>>>();

export const motionRenders = (editor: Editor): Atom<ReadonlyMap<string, string>> => {
  let found = renderAtoms.get(editor);
  if (!found) {
    found = atom<ReadonlyMap<string, string>>("motion renders", new Map());
    renderAtoms.set(editor, found);
  }
  return found;
};

const canvases = new WeakMap<Editor, Computed<NodeCanvas>>();

/** The node and wire facts of the live canvas, the way the engine reads them. */
export const nodeCanvas = (editor: Editor): NodeCanvas => {
  let made = canvases.get(editor);
  if (!made) {
    made = computed("node canvas", () => nodeCanvasOf(editor.getCurrentPageShapes(), canvasShapes(editor), motionRenders(editor).get()));
    canvases.set(editor, made);
  }
  return made.get();
};

/** Keeps the newest render of every motion on the canvas known, for the nodes that take one. */
export const watchMotionRenders = (editor: Editor, engine: EngineConnection, project: string): (() => void) => {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    const files = editor
      .getCurrentPageShapes()
      .filter((shape) => shape.type === "motion" && typeof (shape.props as { file?: unknown }).file === "string" && (shape.props as { file: string }).file !== "")
      .map((shape) => (shape.props as { file: string }).file);
    const wired = editor.getCurrentPageShapes().some((shape) => shape.type === "wire");
    const key = `${files.sort().join("\n")}|${editor.getCurrentPageShapes().filter((shape) => shape.type === "video").length}`;
    if (!wired || key === last) return;
    last = key;
    void engine.call("node.renders", { project, files }).then(
      ({ renders }) => motionRenders(editor).set(new Map(Object.entries(renders))),
      () => undefined,
    );
  };
  const stop = editor.store.listen(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  }, { scope: "document" });
  refresh();
  return () => {
    stop();
    if (timer !== undefined) clearTimeout(timer);
  };
};

export const isNodeShape = (shape: TLShape | undefined): shape is NodeShape => shape?.type === "node";
export const isWireShape = (shape: TLShape | undefined): shape is WireShape => shape?.type === "wire";

export const nodeProps = (editor: Editor, id: TLShapeId): NodeShapeProps | undefined => {
  const shape = editor.getShape(id);
  return isNodeShape(shape) ? shape.props : undefined;
};

/** The catalogue a node medium reads: a page node runs a text model. */
export const catalogueOf = (medium: NodeMedium): "image" | "video" | "text" | "audio" => (medium === "page" ? "text" : medium);

export const framesOf = (entry: ModelEntry | undefined): string[] => {
  const frames = (entry?.params as { frame_images?: unknown } | null | undefined)?.frame_images;
  return Array.isArray(frames) ? frames.filter((each): each is string => typeof each === "string") : [];
};
