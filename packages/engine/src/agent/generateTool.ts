import type { ToolAnswer, McpBinding, McpTool } from "./mcp.ts";

/** The description of `generate`, for an outside agent (spec 14). */
export const GENERATE_DESCRIPTION =
  "Start one paid generation from the shapes you name: an image (one batch of up to 10 outputs) or a text answer. The person pays OpenRouter for it. Call it with dryRun true first to see the final prompt and the estimate, then again to run. A selection that needs a sketch or a marked picture cannot be sent from here: the answer says so, and the person makes that one in the app. The answer gives the run and its placeholders at once; the result lands later, and canvas_read shows its cost when it has one.";

/** The `generate` tool, registered for an outside connection (spec 14). Its handler is the runtime's. */
export const generateTool = (run: (binding: McpBinding, args: Record<string, unknown>) => Promise<ToolAnswer>): McpTool => ({
  name: "generate",
  description: GENERATE_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      medium: { type: "string", enum: ["image", "text"], description: "What to make." },
      sources: { type: "array", items: { type: "string" }, description: "The shape ids to make it from, as canvas_read names them." },
      instruction: { type: "string", description: "What to make from them, as the composer's box takes it." },
      runs: { type: "integer", minimum: 1, maximum: 10, description: "Outputs of one image batch. Text runs once." },
      dryRun: { type: "boolean", description: "Only show the final prompt, the references and the estimate. Nothing is sent or spent." },
      model: { type: "string", description: "The model to use. The default when omitted." },
    },
    required: ["medium", "sources"],
    additionalProperties: false,
  },
  call: (binding, args) => run(binding, args),
});

/** The arguments `generate` reads, checked: a bad one is refused with a sentence the agent can act on. */
export const generateArguments = (args: Record<string, unknown>):
  | { ok: true; medium: "image" | "text"; sources: string[]; instruction: string; runs: number; dryRun: boolean; model: string | undefined }
  | { ok: false; message: string } => {
  if (args.medium !== "image" && args.medium !== "text") return { ok: false, message: 'medium has to be "image" or "text".' };
  if (!Array.isArray(args.sources) || args.sources.length === 0 || args.sources.some((id) => typeof id !== "string")) {
    return { ok: false, message: "sources has to be a list of at least one shape id." };
  }
  const runs = args.runs ?? 1;
  if (!Number.isInteger(runs) || (runs as number) < 1 || (runs as number) > 10) return { ok: false, message: "runs has to be a whole number from 1 to 10." };
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") return { ok: false, message: "dryRun has to be true or false." };
  if (args.model !== undefined && typeof args.model !== "string") return { ok: false, message: "model has to be the name of a model." };
  return {
    ok: true,
    medium: args.medium,
    sources: args.sources as string[],
    instruction: typeof args.instruction === "string" ? args.instruction : "",
    runs: runs as number,
    dryRun: args.dryRun === true,
    model: args.model as string | undefined,
  };
};
