import type { McpTool } from "./mcp.ts";
import { ArtifactTools } from "../artifacts/artifactTools.ts";
import { PreviewTools } from "../artifacts/previewTools.ts";
import { CanvasTools } from "./canvasTools.ts";
import { outsideSelectionTools } from "./selectionTools.ts";
import { generateTool } from "./generateTool.ts";

/**
 * The Unframed tool list, as the tool definitions give it: name, description and input schema.
 * The engine registers these same definitions, and the stdio shim answers `tools/list` from this
 * function while Unframed is closed, so the two cannot drift. The handlers are never called here;
 * the dependencies throw if one is.
 */
const inert: any = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("the tool catalogue calls no dependency");
    },
  },
);

export const unframedToolCatalogue = (): Array<Pick<McpTool, "name" | "description" | "inputSchema">> => {
  const tools: McpTool[] = [
    ...new CanvasTools(inert).tools(),
    ...new ArtifactTools(inert, () => 0).tools(),
    ...new PreviewTools(inert).tools(),
    generateTool(inert),
    ...outsideSelectionTools({ hub: inert, read: inert.read }),
  ];
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
};
