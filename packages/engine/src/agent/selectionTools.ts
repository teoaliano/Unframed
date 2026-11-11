import type { TLRecord } from "@tldraw/tlschema";
import { agentShapeId, roomShapeId } from "@unframed/domain";
import type { LiveSelection } from "../selection/liveSelection.ts";
import { shapePageBoxes } from "../runs/shapeBounds.ts";
import type { McpTool, ToolAnswer } from "./mcp.ts";

/** The description of `canvas_select`, for an outside agent (spec 14). */
export const CANVAS_SELECT_DESCRIPTION =
  "Set the shapes the person has selected in the Unframed window they last used on this project. An empty list clears the selection. The selection is where the person's pointer is, not part of the canvas: Revert does not undo it. The person sees the change at once.";

export const CANVAS_SNAPSHOT_DESCRIPTION =
  "Look at part of the canvas as the person sees it: a PNG of every shape in the area, drawn in the open Unframed window, with the person's drawings, notes and arrows on top of the images. Use it to read feedback the person drew or wrote on the board, which canvas_read only lists as boxes. Pass shapeIds (the area around them, plus padding) or area ({x, y, w, h} in canvas coordinates, as canvas_read reports them); with neither, the whole canvas. The answer names the shapes in the picture and the scale it was drawn at. Take one snapshot per screen you need to read: a large area is scaled down and loses detail. Unframed must be open on this project.";

const MAX_SIDE = 1600;
const MAX_SCALE = 2;
const DEFAULT_PADDING = 48;

type Box = { x: number; y: number; w: number; h: number };

const unionOf = (boxes: ReadonlyArray<Box>): Box | undefined => {
  if (boxes.length === 0) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const areaOf = (value: unknown): Box | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { x, y, w, h } = value as Record<string, unknown>;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  if ((w as number) <= 0 || (h as number) <= 0) return undefined;
  return { x: x as number, y: y as number, w: w as number, h: h as number };
};

const refuse = (message: string): ToolAnswer => ({ value: { error: message }, isError: true });

export interface SelectionToolDeps {
  readonly hub: LiveSelection;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
}

/**
 * The outside-only selection tool (spec 14). It is never on the in-app list: in-app agents never
 * change what is selected (spec 07).
 */
export const outsideSelectionTools = (deps: SelectionToolDeps): McpTool[] => [
  {
    name: "canvas_select",
    description: CANVAS_SELECT_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        shapeIds: { type: "array", items: { type: "string" }, description: "The ids canvas_read reports, in the order to select them." },
      },
      required: ["shapeIds"],
      additionalProperties: false,
    },
    call: async (binding, args): Promise<ToolAnswer> => {
      const requested = args.shapeIds;
      if (!Array.isArray(requested) || requested.some((id) => typeof id !== "string")) {
        return { value: { error: "shapeIds must be a list of shape ids" }, isError: true };
      }
      const records = await deps.read(binding.project);
      const existing = new Set(records.filter((record) => record.typeName === "shape").map((record) => record.id as string));
      const ids = (requested as string[]).map((id) => roomShapeId(id));
      const missing = requested.filter((_, index) => !existing.has(ids[index]!)).map((id) => agentShapeId(String(id)));
      const applied = await deps.hub.apply(binding.project, ids.filter((id) => existing.has(id)));
      return {
        value: {
          selection: applied.shapeIds.map((id) => agentShapeId(id)),
          missing,
          ...(applied.note === undefined ? {} : { selectionNote: applied.note }),
        },
      };
    },
  },
  {
    name: "canvas_snapshot",
    description: CANVAS_SNAPSHOT_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        shapeIds: { type: "array", items: { type: "string" }, description: "The ids canvas_read reports. The snapshot covers them all, plus padding." },
        area: {
          type: "object",
          description: "An area of the canvas instead of shapes, in canvas coordinates.",
          properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
          required: ["x", "y", "w", "h"],
        },
        padding: { type: "number", description: `Canvas units added around the shapes, so notes and arrows beside them show too. Default ${DEFAULT_PADDING}.` },
      },
      additionalProperties: false,
    },
    call: async (binding, args): Promise<ToolAnswer> => {
      const boxes = shapePageBoxes(await deps.read(binding.project));
      const byId = new Map(boxes.map((entry) => [entry.id, entry.box]));
      let area: Box | undefined;
      if (args.area !== undefined) {
        area = areaOf(args.area);
        if (area === undefined) return refuse("area must be {x, y, w, h} with numbers, and w and h above zero");
      } else {
        const requested = args.shapeIds;
        if (requested !== undefined && (!Array.isArray(requested) || requested.some((id) => typeof id !== "string"))) return refuse("shapeIds must be a list of shape ids");
        const ids = requested === undefined ? boxes.map((entry) => entry.id) : (requested as string[]).map((id) => roomShapeId(id));
        const missing = (requested as string[] | undefined)?.filter((_, index) => !byId.has(ids[index]!)) ?? [];
        if (missing.length > 0) return refuse(`no shape with the id ${missing.map((id) => agentShapeId(id)).join(", ")}; call canvas_read for the ids`);
        const union = unionOf(ids.map((id) => byId.get(id)!).filter((box) => box !== undefined));
        if (union === undefined) return refuse("The canvas is empty, so there is nothing to look at.");
        const raw = args.padding;
        const padding = typeof raw === "number" && Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 2000) : DEFAULT_PADDING;
        area = { x: union.x - padding, y: union.y - padding, w: union.w + 2 * padding, h: union.h + 2 * padding };
      }
      const scale = Math.min(MAX_SCALE, MAX_SIDE / Math.max(area.w, area.h));
      const drawn = await deps.hub.snapshot(binding.project, area, scale);
      if ("error" in drawn) return refuse(drawn.error);
      const inside = boxes.filter((entry) => overlaps(entry.box, area!)).map((entry) => agentShapeId(entry.id));
      const round = (n: number) => Math.round(n * 100) / 100;
      return {
        value: {
          area: { x: round(area.x), y: round(area.y), w: round(area.w), h: round(area.h) },
          scale: round(scale),
          width: drawn.width,
          height: drawn.height,
          shapes: inside,
          ...(scale < 0.5 ? { note: "This area is large, so the picture is scaled down. Snapshot fewer shapes to read the details." } : {}),
        },
        images: [{ data: drawn.png, mimeType: "image/png" }],
      };
    },
  },
];
