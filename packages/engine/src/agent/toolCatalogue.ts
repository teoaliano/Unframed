import type { McpTool } from "./mcp.ts";
import { ArtifactTools } from "../artifacts/artifactTools.ts";
import { ComponentTools } from "../artifacts/componentTools.ts";
import { PreviewTools } from "../artifacts/previewTools.ts";
import { CanvasTools } from "./canvasTools.ts";
import { CommentTools } from "./commentTools.ts";
import { KitTools } from "../kits/kitTools.ts";
import { outsideSelectionTools } from "./selectionTools.ts";
import { generateTool } from "./generateTool.ts";
import { outsideAgentTools } from "./outsideTools.ts";

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
    ...new CommentTools(inert).tools(),
    ...new ArtifactTools(inert, () => 0).tools(),
    ...new ComponentTools(inert, () => 0).tools(),
    ...new PreviewTools(inert).tools(),
    ...new KitTools(inert).tools(),
    generateTool(inert),
    ...outsideSelectionTools({ hub: inert, read: inert.read }),
    ...outsideAgentTools(inert),
  ];
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
};
