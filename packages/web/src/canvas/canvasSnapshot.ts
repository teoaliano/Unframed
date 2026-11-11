import type { SelectionApply, SelectionSnapshotResult } from "@unframed/contracts";
import { Box, type Editor, type TLShapeId } from "tldraw";

type SnapshotRequest = Extract<SelectionApply, { kind: "snapshot" }>;

const base64Of = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
};

/** Draws an area of the canvas for an outside agent's canvas_snapshot: every shape in it, as the person sees it. */
export const renderSnapshot = async (editor: Editor, request: SnapshotRequest): Promise<SelectionSnapshotResult> => {
  try {
    const box = new Box(request.bounds.x, request.bounds.y, request.bounds.w, request.bounds.h);
    const ids = [...editor.getCurrentPageShapeIds()].filter((id) => {
      const bounds = editor.getShapePageBounds(id as TLShapeId);
      return bounds !== undefined && bounds.collides(box);
    });
    if (ids.length === 0) return { requestId: request.requestId, error: "Nothing is drawn in that area of the canvas." };
    const { blob, width, height } = await editor.toImage(ids, {
      format: "png",
      bounds: box,
      scale: request.scale,
      pixelRatio: 1,
      background: true,
      padding: 0,
      darkMode: editor.user.getIsDarkMode(),
    });
    return { requestId: request.requestId, png: await base64Of(blob), width: Math.round(width), height: Math.round(height) };
  } catch (failure) {
    return { requestId: request.requestId, error: `The Unframed window could not draw the snapshot: ${failure instanceof Error ? failure.message : String(failure)}` };
  }
};
