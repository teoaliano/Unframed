import type { TLRecord } from "@tldraw/tlschema";
import { agentShapeId, roomShapeId } from "@unframed/domain";
import type { LiveSelection } from "../selection/liveSelection.ts";
import type { McpTool, ToolAnswer } from "./mcp.ts";

/** The description of `canvas_select`, for an outside agent. */
export const CANVAS_SELECT_DESCRIPTION =
  "Set the shapes the person has selected in the Unframed window they last used on this project. An empty list clears the selection. The selection is where the person's pointer is, not part of the canvas: Revert does not undo it. The person sees the change at once.";

export interface SelectionToolDeps {
  readonly hub: LiveSelection;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
}

/**
 * The outside-only selection tool. It is never on the in-app list: in-app agents never
 * change what is selected.
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
];
