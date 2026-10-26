import type { ToolAnswer, McpBinding, McpTool } from "./mcp.ts";

/** The description of `generate`, for an outside agent. */
export const GENERATE_DESCRIPTION =
  "Start one paid generation from the shapes you name: an image (one batch of up to 10 outputs), a video (one clip) or a text answer. The person pays OpenRouter for it. Call it with dryRun true first to see the final prompt and the estimate, then again to run. A selection that needs a sketch or a marked picture, or a reference video on this computer, cannot be sent from here: the answer says so, and the person makes that one in the app. The answer gives the run and its placeholders at once; the result lands later, and canvas_read shows its cost when it has one.";

/** The `generate` tool, registered for an outside connection. Its handler is the runtime's. */
export const generateTool = (run: (binding: McpBinding, args: Record<string, unknown>) => Promise<ToolAnswer>): McpTool => ({
  name: "generate",
  description: GENERATE_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      medium: { type: "string", enum: ["image", "video", "text"], description: "What to make." },
      sources: { type: "array", items: { type: "string" }, description: "The shape ids to make it from, as canvas_read names them." },
      instruction: { type: "string", description: "What to make from them, as the composer's box takes it." },
      params: {
        type: "object",
        additionalProperties: { type: ["string", "number", "boolean"] },
        description: "The model's settings, as the composer's tray takes them, e.g. resolution, aspect_ratio, quality, duration, inputMode, generate_audio. Leave out for the defaults.",
      },
      runs: { type: "integer", minimum: 1, maximum: 10, description: "Outputs of one image batch. Text and video run once." },
      dryRun: { type: "boolean", description: "Only show the final prompt, the references and the estimate. Nothing is sent or spent." },
      model: { type: "string", description: "The model to use. The default when omitted." },
    },
    required: ["medium", "sources"],
    additionalProperties: false,
  },
  call: (binding, args) => run(binding, args),
});

export type GenerateArguments =
  | { ok: true; medium: "image" | "video" | "text"; sources: string[]; instruction: string; params: Record<string, string | number | boolean>; runs: number; dryRun: boolean; model: string | undefined }
  | { ok: false; message: string };

const PARAM_VALUE = (value: unknown): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** The arguments `generate` reads, checked: a bad one is refused with a sentence the agent can act on. */
export const generateArguments = (args: Record<string, unknown>): GenerateArguments => {
  if (args.medium !== "image" && args.medium !== "video" && args.medium !== "text") return { ok: false, message: 'medium has to be "image", "video" or "text".' };
  if (!Array.isArray(args.sources) || args.sources.length === 0 || args.sources.some((id) => typeof id !== "string")) {
    return { ok: false, message: "sources has to be a list of at least one shape id." };
  }
  const runs = args.runs ?? 1;
  if (!Number.isInteger(runs) || (runs as number) < 1 || (runs as number) > 10) return { ok: false, message: "runs has to be a whole number from 1 to 10." };
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") return { ok: false, message: "dryRun has to be true or false." };
  if (args.model !== undefined && typeof args.model !== "string") return { ok: false, message: "model has to be the name of a model." };
  const params = args.params ?? {};
  if (typeof params !== "object" || params === null || Array.isArray(params) || !Object.values(params).every(PARAM_VALUE)) {
    return { ok: false, message: "params has to be an object whose values are text, numbers or true/false." };
  }
  return {
    ok: true,
    medium: args.medium,
    sources: args.sources as string[],
    instruction: typeof args.instruction === "string" ? args.instruction : "",
    params: params as Record<string, string | number | boolean>,
    runs: runs as number,
    dryRun: args.dryRun === true,
    model: args.model as string | undefined,
  };
};
