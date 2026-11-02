/**
 * Dropping an image on a live page (spec 18, Images, On the canvas). While one image with a file
 * is dragged, the pages that are live are asked, once per animation frame, for the picture under
 * the pointer; the answer is outlined. A drop on a picture puts the image back where the drag
 * began and swaps the picture in one step, with no burst. Nothing here runs on the canvas thread
 * beyond posting a message and drawing one outline.
 */
import { parseAssetMarker, type ArtifactShapeProps } from "@unframed/contracts";
import { isArtifactKind } from "@unframed/domain";
import { useEditor, useValue, type Editor, type TLAssetId, type TLShape, type TLShapeId } from "tldraw";
import { messageOf } from "../agent/store.ts";
import type { EngineConnection } from "../rpc/engine.ts";
import { showError, showNotice } from "../toasts.tsx";
import type { EditMessage } from "./ArtifactFrame.tsx";
import { artifactsOf, isLive, type DropHit } from "./state.ts";

/** The project file an image shape shows: its asset's source names it. */
const imageFileOf = (editor: Editor, shape: TLShape | null | undefined): string | undefined => {
  if (!shape || shape.type !== "image") return undefined;
  const assetId = (shape.props as { assetId?: unknown }).assetId;
  const src = typeof assetId === "string" ? (editor.getAsset(assetId as TLAssetId)?.props as { src?: unknown } | undefined)?.src : undefined;
  const marker = typeof src === "string" ? parseAssetMarker(src) : undefined;
  return marker?.kind === "project-file" ? marker.file : undefined;
};

/** The live pages a drag may drop on: artifacts with a file that run a frame now. */
const livePages = (editor: Editor): TLShapeId[] =>
  editor
    .getCurrentPageShapes()
    .filter((shape) => isArtifactKind(shape.type) && (shape.props as ArtifactShapeProps).file !== "" && isLive(editor, shape.id))
    .map((shape) => shape.id);

/** Posts one `unframed:edit:*` message to a live canvas frame, if it runs. */
const postTo = (editor: Editor, id: string, message: unknown): void => {
  artifactsOf(editor).editPosts.get(id)?.(message);
};

/**
 * A message from a canvas frame's edit bridge. Its ready answer sets the bridge's mode and locks
 * (interact, so it draws and picks nothing, and knows what is locked); a hit answer sets the drop hit.
 */
export const onFrameEdit = (editor: Editor, shapeId: string, message: EditMessage): void => {
  const state = artifactsOf(editor);
  if (message.type === "unframed:edit:ready") {
    const locked = (editor.getShape(shapeId as TLShapeId)?.props as ArtifactShapeProps | undefined)?.lockedElements ?? [];
    postTo(editor, shapeId, { type: "unframed:edit:mode", mode: "interact", locked });
    return;
  }
  if (message.type !== "unframed:edit:hit") return;
  const elementId = typeof message.elementId === "string" ? message.elementId : null;
  const target = message.target === "src" || message.target === "background" ? message.target : null;
  const box = message.box as DropHit["box"] | null | undefined;
  if (elementId === null || target === null || !box) {
    if (state.dropHit.get()?.shapeId === shapeId) state.dropHit.set(undefined);
    return;
  }
  state.dropHit.set({ shapeId, elementId, target, box });
};

/** The outline over the picture an image drag would replace: one 2 px primary line over the frame. */
export const DropOutline = ({ shapeId }: { readonly shapeId: string }) => {
  const editor = useEditor();
  const hit = useValue("image drop hit", () => {
    const current = artifactsOf(editor).dropHit.get();
    return current?.shapeId === shapeId ? current : undefined;
  }, [editor, shapeId]);
  if (hit === undefined) return null;
  return (
    <div
      aria-hidden
      data-drop-outline=""
      className="pointer-events-none absolute"
      style={{ left: hit.box.x, top: hit.box.y, width: hit.box.w, height: hit.box.h, border: "2px solid var(--primary)" }}
    />
  );
};

/**
 * Installs the drop for one canvas. A press on an image deselects the page it was dragged onto, so
 * the page that was selected alone when the press began is held live until the drag ends.
 */
export const installImageDrop = (editor: Editor, engine: EngineConnection, project: string): (() => void) => {
  const state = artifactsOf(editor);
  // The selection as the previous event left it: a press is judged against what was selected before it.
  let lastSelection: TLShapeId[] = [];
  let press: { readonly image: TLShapeId; readonly mark: string; dragging: boolean } | undefined;
  let frame: number | undefined;

  const probe = () => {
    frame = undefined;
    if (!press?.dragging) return;
    const point = editor.inputs.getCurrentPagePoint();
    for (const id of livePages(editor)) {
      const bounds = editor.getShapePageBounds(id);
      if (!bounds) continue;
      const inside = point.x >= bounds.x && point.x <= bounds.maxX && point.y >= bounds.y && point.y <= bounds.maxY;
      if (!inside) {
        if (state.dropHit.get()?.shapeId === id) state.dropHit.set(undefined);
        continue;
      }
      postTo(editor, id, { type: "unframed:edit:hitTest", x: point.x - bounds.x, y: point.y - bounds.y });
    }
  };

  const schedule = () => {
    if (frame === undefined) frame = requestAnimationFrame(probe);
  };

  const swap = (hit: DropHit, file: string) => {
    const shape = editor.getShape(hit.shapeId as TLShapeId);
    if (!shape) return;
    const base = (shape.props as ArtifactShapeProps).file;
    engine
      .call("artifact.edit", { project, shapeId: hit.shapeId, baseFile: base, edits: [{ type: "image", elementId: hit.elementId, target: hit.target, file }] })
      .then((answer) => {
        const current = editor.getShape(hit.shapeId as TLShapeId);
        if (!current || (current.props as ArtifactShapeProps).file !== base) {
          showNotice("This page changed somewhere else. Your last change wasn't saved.", "warning");
          return;
        }
        // The swap is one step of its own, so Cmd-Z takes back the picture and nothing else.
        editor.markHistoryStoppingPoint("image swap");
        editor.updateShape({ id: hit.shapeId as TLShapeId, type: shape.type, props: { file: answer.file } } as never);
      })
      .catch((error: unknown) => {
        const code = (error as { code?: unknown }).code;
        if (code === "conflict") showNotice("This page changed somewhere else. Your last change wasn't saved.", "warning");
        else showError(messageOf(error));
      });
  };

  const onEvent = (info: { type: string; name?: string }) => {
    if (info.type !== "pointer") return;
    const before = lastSelection;
    lastSelection = editor.getSelectedShapeIds().slice();
    if (info.name === "pointer_down") {
      const only = editor.getOnlySelectedShape();
      const file = imageFileOf(editor, only);
      const pages = before.filter((id) => isArtifactKind(editor.getShape(id)?.type ?? "") && (editor.getShape(id)?.props as ArtifactShapeProps | undefined)?.file !== "");
      if (only && file !== undefined && pages.length === 1) {
        state.dropHolds.set(new Set(pages.map(String)));
        press = { image: only.id, mark: editor.markHistoryStoppingPoint("image drop"), dragging: false };
        for (const id of livePages(editor)) postTo(editor, id, { type: "unframed:edit:hello" });
      }
    } else if (press !== undefined && info.name === "pointer_move" && editor.isIn("select.translating")) {
      press.dragging = true;
      schedule();
    } else if (press !== undefined && info.name === "pointer_up") {
      const hit = state.dropHit.get();
      const file = imageFileOf(editor, editor.getShape(press.image));
      const dropping = press.dragging && hit !== undefined && file !== undefined;
      if (dropping) {
        // The move is taken back to the start of the press, so it is not recorded; the swap is what the person keeps.
        editor.bailToMark(press.mark);
        swap(hit, file);
      }
      state.dropHit.set(undefined);
      state.dropHolds.set(new Set());
      press = undefined;
    }
  };

  editor.on("event", onEvent as never);
  return () => {
    editor.off("event", onEvent as never);
    if (frame !== undefined) cancelAnimationFrame(frame);
    state.dropHolds.set(new Set());
    state.dropHit.set(undefined);
  };
};
