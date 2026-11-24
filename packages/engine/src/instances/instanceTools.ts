import type { Instance } from "@unframed/contracts";
import { agentShapeId, INSTANCE_TOOL_TEXT, logTail, roomShapeId } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { refusal, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { errorText } from "../log.ts";
import { isScreenShape, screenBeside } from "../screens/firstScreen.ts";

const LOG_LINES = 60;

export interface InstanceToolDeps {
  readonly create: (project: string, options: { readonly base?: string; readonly branch?: string }) => Promise<Instance>;
  readonly remove: (project: string, id: string, options: { readonly force?: boolean; readonly deleteBranch?: boolean }) => Promise<Instance>;
  readonly list: (project: string) => Promise<ReadonlyArray<Instance>>;
  readonly status: (project: string, id: string) => Promise<Instance>;
  readonly start: (project: string, id: string) => Promise<Instance>;
  readonly stop: (project: string, id: string) => Promise<Instance>;
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
}

class Refused extends Error {}

const summary = (instance: Instance) => ({
  id: instance.id,
  branch: instance.branch,
  baseRef: instance.baseRef,
  worktree: instance.worktree,
  state: instance.state,
  proxyPort: instance.proxyPort,
  upstreamPort: instance.upstreamPort,
  error: instance.error,
});

const detail = (instance: Instance) => ({ ...summary(instance), log: logTail(instance.log, LOG_LINES) });

const text = (name: string) => INSTANCE_TOOL_TEXT[name]!;

const idOf = (args: Record<string, unknown>): string => {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (id === "") throw new Refused("pass the Instance's id");
  return id;
};

const optionalString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

/** The agent's Instance tools (spec: Repositories, "Agent"): offered only in a Repository's chats. */
export class InstanceTools {
  private readonly deps: InstanceToolDeps;

  constructor(deps: InstanceToolDeps) {
    this.deps = deps;
  }

  private async create(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const shapeId = optionalString(args.shapeId);
    const branch = optionalString(args.branch);
    let base = optionalString(args.base);
    const records = await this.deps.read(binding.project);
    const source = shapeId === undefined ? undefined : records.find((record) => record.id === roomShapeId(shapeId));
    if (shapeId !== undefined && !isScreenShape(source)) throw new Refused(`there is no Screen ${shapeId}`);
    if (isScreenShape(source)) base = (await this.deps.status(binding.project, source.props.instance)).branch;
    const instance = await this.deps.create(binding.project, { ...(base === undefined ? {} : { base }), ...(branch === undefined ? {} : { branch }) });
    const screen = screenBeside(await this.deps.read(binding.project), instance, isScreenShape(source) ? source : undefined);
    await this.deps.apply(binding.project, { put: [screen], remove: [] }, { kind: "server", id: `chat:${binding.chatId}` });
    return { value: { instance: summary(instance), screen: agentShapeId(screen.id) } };
  }

  private async run(binding: McpBinding, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    switch (name) {
      case "instance_create":
        return this.create(binding, args);
      case "instance_remove":
        return { value: summary(await this.deps.remove(binding.project, idOf(args), { force: args.force === true, deleteBranch: args.deleteBranch === true })) };
      case "instance_status": {
        if (args.id === undefined) return { value: { instances: (await this.deps.list(binding.project)).map(summary) } };
        return { value: detail(await this.deps.status(binding.project, idOf(args))) };
      }
      case "instance_start":
        return { value: summary(await this.deps.start(binding.project, idOf(args))) };
      case "instance_stop":
        return { value: summary(await this.deps.stop(binding.project, idOf(args))) };
      default:
        return refusal(`no such Instance tool ${name}`);
    }
  }

  private async call(binding: McpBinding, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    try {
      return await this.run(binding, name, args);
    } catch (error) {
      return refusal(error instanceof Refused ? error.message : errorText(error));
    }
  }

  tools(): McpTool[] {
    const schema = (name: string, properties: Record<string, string>, required: string[] = []) => ({
      type: "object",
      properties: Object.fromEntries(Object.entries(properties).map(([key, type]) => [key, { type, description: text(name).arguments[key] ?? "" }])),
      ...(required.length === 0 ? {} : { required }),
      additionalProperties: false,
    });
    const definitions: Array<[string, Record<string, unknown>]> = [
      ["instance_create", schema("instance_create", { shapeId: "string", base: "string", branch: "string" })],
      ["instance_remove", schema("instance_remove", { id: "string", deleteBranch: "boolean", force: "boolean" }, ["id"])],
      ["instance_status", schema("instance_status", { id: "string" })],
      ["instance_start", schema("instance_start", { id: "string" }, ["id"])],
      ["instance_stop", schema("instance_stop", { id: "string" }, ["id"])],
    ];
    return definitions.map(([name, inputSchema]) => ({
      name,
      description: text(name).description,
      inputSchema,
      scope: "repository" as const,
      call: (binding, args) => this.call(binding, name, args),
    }));
  }
}
