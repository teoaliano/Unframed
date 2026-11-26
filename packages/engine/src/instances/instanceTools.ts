import type { Instance, ScreenMock, ScreenStep } from "@unframed/contracts";
import { agentShapeId, checkMocks, checkSteps, flowCapacity, FLOW_CREATE_TEXT, FLOW_NO_STATES, flowTooMany, INSTANCE_TOOL_TEXT, logTail, NO_CHROME_PREVIEW_MESSAGE, NO_STATE_BRIDGE, normaliseRoute, roomShapeId, SCREEN_ELEMENT_TEXT, SCREEN_STATE_TEXT } from "@unframed/domain";
import { inspectJsx } from "@unframed/domain/jsx";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TLRecord } from "@tldraw/tlschema";
import { refusal, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { errorText } from "../log.ts";
import { isScreenShape, screenBeside, type ScreenShape } from "../screens/firstScreen.ts";
import { flowRecords } from "../screens/flows.ts";
import { findInWorktree } from "../screens/directEdits.ts";
import { proofFailure, proofUrl, screenStatePayload, type ElementLocator, type Proof, type StateProver } from "../screens/screenState.ts";
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
  readonly locate: ElementLocator;
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
  name === "flow_create" ? FLOW_CREATE_TEXT : name === "screen_state" ? SCREEN_STATE_TEXT : name === "screen_element" ? SCREEN_ELEMENT_TEXT : INSTANCE_TOOL_TEXT[name]!;

interface CheckedState {
  readonly route: string;
  readonly steps: ReadonlyArray<ScreenStep>;
  readonly mocks: ReadonlyArray<ScreenMock>;
  readonly state: string;
}

const checkState = (args: Record<string, unknown>, fallbackRoute: string, where = ""): CheckedState => {
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

const screenNamed = (records: ReadonlyArray<TLRecord>, args: Record<string, unknown>): ScreenShape => {
  const shapeId = optionalString(args.shapeId);
  if (shapeId === undefined) throw new Refused("name a Screen with shapeId");
  const found = records.find((record) => record.id === roomShapeId(shapeId));
  if (!isScreenShape(found)) throw new Refused(`there is no Screen ${shapeId}`);
  return found;
};

const imagesOf = (proof: Proof) => [{ data: proof.png.toString("base64"), mimeType: "image/png" }];

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
    return held || proof.ok ? proof : { ok: true, png: proof.png };
  }

  private async screenState(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const source = screenNamed(await this.deps.read(binding.project), args);
    const state = checkState(args, source.props.route);
    const instance = await this.live(binding.project, source.props.instance);
    const size = { w: Math.round(source.props.w), h: Math.round(source.props.h) };
    const proof = await this.proveState(binding.project, instance, state, size);
    const images = imagesOf(proof);
    if (!proof.ok) return { value: { error: proofFailure(proof, state.steps), ...(proof.step === undefined ? {} : { step: proof.step + 1 }) }, isError: true, images };
    const saved = { route: state.route, steps: [...state.steps], mocks: [...state.mocks], state: state.state };
    const now = await this.deps.read(binding.project);
    const current = screenNamed(now, args);
    const record = args.newScreen === true ? screenBeside(now, instance, current) : current;
    const put = { ...record, props: { ...(record as typeof current).props, ...saved } } as TLRecord;
    await this.deps.apply(binding.project, { put: [put], remove: [] }, { kind: "server", id: `chat:${binding.chatId}` });
    return { value: { screen: agentShapeId(put.id), route: state.route, state: state.state }, images };
  }

  private async screenElement(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const screen = screenNamed(await this.deps.read(binding.project), args);
    const selector = optionalString(args.selector);
    if (selector === undefined) throw new Refused("pass a CSS selector for the element");
    const instance = await this.live(binding.project, screen.props.instance);
    const state = screenStatePayload(screen.props);
    const token = state === undefined ? undefined : await this.deps.stateToken(binding.project, instance.id, state);
    const located = await this.deps.locate({ url: proofUrl(instance.proxyPort, screen.props.route, token), w: Math.round(screen.props.w), h: Math.round(screen.props.h), steps: state?.steps.length ?? 0, selector });
    if (located === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    if (!located.bridge) throw new Refused(NO_STATE_BRIDGE);
    if (!located.matched) throw new Refused(`nothing on the Screen matches ${selector}`);
    const found = located.found;
    if (found === null || found.source === null) throw new Refused(`no React source was found for the ${located.tag ?? "element"} that ${selector} matches`);
    const file = await findInWorktree(instance.worktree, found.source.file);
    const jsx = file === undefined ? undefined : inspectJsx(await readFile(join(instance.worktree, file), "utf8"), file, { line: found.source.line, col: found.source.col, tag: found.tag });
    return {
      value: {
        file: file ?? found.source.file,
        line: jsx?.line ?? found.source.line,
        col: jsx?.col ?? found.source.col,
        ...(jsx === undefined ? {} : { endLine: jsx.endLine, endCol: jsx.endCol }),
        tag: found.tag,
        component: found.owner,
        instanceOf: found.instanceOf,
        props: found.props,
        instanceIndex: found.instanceIndex,
        instanceCount: found.instanceCount,
        selfMapped: found.selfMapped,
        ...(jsx === undefined ? {} : { jsx: jsx.span.split("\n").slice(0, 40).join("\n") }),
      },
    };
  }

  private async flowCreate(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const source = screenNamed(await this.deps.read(binding.project), args);
    const asked = Array.isArray(args.states) ? args.states : [];
    if (asked.length === 0) throw new Refused(FLOW_NO_STATES);
    const states = asked.map((raw, at) => {
      const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      return { ...checkState(entry, source.props.route, `State ${at + 1}: `), action: typeof entry.action === "string" ? entry.action : undefined };
    });
    const size = { w: Math.round(source.props.w), h: Math.round(source.props.h) };
    const most = flowCapacity(size.w, size.h);
    if (states.length > most) throw new Refused(flowTooMany(most));
    const instance = await this.live(binding.project, source.props.instance);
    for (const [at, state] of states.entries()) {
      const proof = await this.proveState(binding.project, instance, state, size);
      if (!proof.ok) return { value: { error: `State ${at + 1}, ${state.state}: ${proofFailure(proof, state.steps)}. Nothing was built.`, state: at + 1 }, isError: true, images: imagesOf(proof) };
    }
    const records = await this.deps.read(binding.project);
    const built = flowRecords(records, screenNamed(records, args), instance, states);
    if ("error" in built) throw new Refused(built.error);
    await this.deps.apply(binding.project, { put: [...built.put], remove: [] }, { kind: "server", id: `chat:${binding.chatId}` });
    return { value: { group: agentShapeId(built.group), screens: built.screens.map(agentShapeId) } };
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
      case "flow_create":
        return this.flowCreate(binding, args);
      case "screen_element":
        return this.screenElement(binding, args);
      default:
        return refusal(`no such Instance tool ${name}`);
    }
  }

  private async call(binding: McpBinding, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    try {
      return await this.run(binding, name, args);
    } catch (error) {
      return refusal(errorText(error));
    }
  }

  tools(): McpTool[] {
    const schema = (name: string, properties: Record<string, string>, required: string[] = []) => ({
      type: "object",
      properties: Object.fromEntries(
        Object.entries(properties).map(([key, type]) => [key, { type, ...(type === "array" ? { items: { type: "object" } } : {}), description: text(name).arguments[key] ?? "" }]),
      ),
      ...(required.length === 0 ? {} : { required }),
      additionalProperties: false,
    });
    const definitions: Array<[string, Record<string, unknown>]> = [
      ["instance_create", schema("instance_create", { shapeId: "string", base: "string", branch: "string" })],
      ["instance_remove", schema("instance_remove", { id: "string", deleteBranch: "boolean", force: "boolean" }, ["id"])],
      ["instance_status", schema("instance_status", { id: "string" })],
      ["instance_start", schema("instance_start", { id: "string" }, ["id"])],
      ["instance_stop", schema("instance_stop", { id: "string" }, ["id"])],
      ["screen_state", schema("screen_state", { shapeId: "string", route: "string", steps: "array", mocks: "array", state: "string", newScreen: "boolean" }, ["shapeId", "route", "state"])],
      ["flow_create", schema("flow_create", { shapeId: "string", states: "array" }, ["shapeId", "states"])],
      ["screen_element", schema("screen_element", { shapeId: "string", selector: "string" }, ["shapeId", "selector"])],
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
