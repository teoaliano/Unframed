import type { Instance, ScreenMock, ScreenStep } from "@unframed/contracts";
import { agentShapeId, checkMocks, checkSteps, INSTANCE_TOOL_TEXT, logTail, NO_CHROME_PREVIEW_MESSAGE, normaliseRoute, roomShapeId, SCREEN_EXPLODE_TEXT, SCREEN_STATE_TEXT } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { refusal, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { errorText } from "../log.ts";
import { isScreenShape, screenBeside } from "../screens/firstScreen.ts";
import { explodeScreen, ExplodeRefused } from "../screens/flows.ts";
import { proofFailure, proofUrl, type Proof, type StateProver } from "../screens/screenState.ts";
import { NotLive, untilLive } from "./liveInstance.ts";
import type { ScreenStatePayload } from "./stateTokens.ts";

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
  readonly stateToken: (project: string, id: string, payload: ScreenStatePayload) => Promise<string>;
  readonly prove: StateProver | undefined;
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

const text = (name: string): { readonly description: string; readonly arguments: Readonly<Record<string, string>> } =>
  name === "screen_explode" ? SCREEN_EXPLODE_TEXT : name === "screen_state" ? SCREEN_STATE_TEXT : INSTANCE_TOOL_TEXT[name]!;

export interface CheckedState {
  readonly route: string;
  readonly steps: ReadonlyArray<ScreenStep>;
  readonly mocks: ReadonlyArray<ScreenMock>;
  readonly state: string;
}

export const checkState = (args: Record<string, unknown>, fallbackRoute: string, where = ""): CheckedState => {
  const route = normaliseRoute(typeof args.route === "string" ? args.route : fallbackRoute);
  if (route === undefined) throw new Refused(`${where}the route is a path in the app, such as /settings`);
  const steps = checkSteps(args.steps);
  if ("error" in steps) throw new Refused(`${where}${steps.error}`);
  const mocks = checkMocks(args.mocks);
  if ("error" in mocks) throw new Refused(`${where}${mocks.error}`);
  const state = typeof args.state === "string" ? args.state.trim() : "";
  if (state === "") throw new Refused(`${where}describe the state in a few plain words with state, such as "the generate menu open"`);
  return { route, steps: steps.steps, mocks: mocks.mocks, state };
};

const idOf = (args: Record<string, unknown>): string => {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (id === "") throw new Refused("pass the Instance's id");
  return id;
};

const optionalString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

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

  async live(project: string, id: string): Promise<Instance & { readonly proxyPort: number }> {
    try {
      return await untilLive(() => this.deps.start(project, id), () => this.deps.status(project, id));
    } catch (error) {
      throw error instanceof NotLive ? new Refused(error.message) : error;
    }
  }

  async proveState(project: string, instance: Instance & { readonly proxyPort: number }, state: CheckedState, size: { readonly w: number; readonly h: number }): Promise<Proof> {
    if (this.deps.prove === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    const held = state.steps.length > 0 || state.mocks.length > 0;
    const token = await this.deps.stateToken(project, instance.id, { steps: state.steps, mocks: state.mocks });
    const proof = await this.deps.prove({ url: proofUrl(instance.proxyPort, state.route, token), w: size.w, h: size.h, steps: state.steps.length });
    if (proof === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    return held || proof.ok ? proof : { ok: true, png: proof.png! };
  }

  private async screenState(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const shapeId = optionalString(args.shapeId);
    if (shapeId === undefined) throw new Refused("name a Screen with shapeId");
    const records = await this.deps.read(binding.project);
    const source = records.find((record) => record.id === roomShapeId(shapeId));
    if (!isScreenShape(source)) throw new Refused(`there is no Screen ${shapeId}`);
    const state = checkState(args, source.props.route);
    const instance = await this.live(binding.project, source.props.instance);
    const size = { w: Math.round(source.props.w), h: Math.round(source.props.h) };
    const proof = await this.proveState(binding.project, instance, state, size);
    const images = proof.png === undefined ? [] : [{ data: proof.png.toString("base64"), mimeType: "image/png" }];
    if (!proof.ok) return { value: { error: proofFailure(proof, state.steps), ...(proof.step === undefined ? {} : { step: proof.step + 1 }) }, isError: true, images };
    const saved = { route: state.route, steps: [...state.steps], mocks: [...state.mocks], state: state.state };
    const now = await this.deps.read(binding.project);
    const current = now.find((record) => record.id === source.id);
    if (!isScreenShape(current)) throw new Refused(`there is no Screen ${shapeId}`);
    const record = args.newScreen === true ? screenBeside(now, instance, current) : current;
    const put = { ...record, props: { ...(record as typeof current).props, ...saved } } as TLRecord;
    await this.deps.apply(binding.project, { put: [put], remove: [] }, { kind: "server", id: `chat:${binding.chatId}` });
    return { value: { screen: agentShapeId(put.id), route: state.route, state: state.state }, images };
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
      case "screen_state":
        return this.screenState(binding, args);
      case "screen_explode": {
        const shapeId = optionalString(args.shapeId);
        if (shapeId === undefined) throw new Refused("name a Screen with shapeId");
        const routes = Array.isArray(args.routes) ? args.routes.filter((route): route is string => typeof route === "string") : [];
        const exploded = await explodeScreen(this.deps, binding.project, shapeId, routes, { kind: "server", id: `chat:${binding.chatId}` });
        return { value: { group: agentShapeId(exploded.group), screens: exploded.screens.map(agentShapeId) } };
      }
      default:
        return refusal(`no such Instance tool ${name}`);
    }
  }

  private async call(binding: McpBinding, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    try {
      return await this.run(binding, name, args);
    } catch (error) {
      return refusal(error instanceof Refused || error instanceof ExplodeRefused ? error.message : errorText(error));
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
      [
        "screen_state",
        {
          type: "object",
          properties: {
            shapeId: { type: "string", description: text("screen_state").arguments.shapeId },
            route: { type: "string", description: text("screen_state").arguments.route },
            steps: { type: "array", items: { type: "object" }, description: text("screen_state").arguments.steps },
            mocks: { type: "array", items: { type: "object" }, description: text("screen_state").arguments.mocks },
            state: { type: "string", description: text("screen_state").arguments.state },
            newScreen: { type: "boolean", description: text("screen_state").arguments.newScreen },
          },
          required: ["shapeId", "route", "state"],
          additionalProperties: false,
        },
      ],
      [
        "screen_explode",
        {
          type: "object",
          properties: { shapeId: { type: "string", description: text("screen_explode").arguments.shapeId }, routes: { type: "array", items: { type: "string" }, description: text("screen_explode").arguments.routes } },
          required: ["shapeId", "routes"],
          additionalProperties: false,
        },
      ],
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
