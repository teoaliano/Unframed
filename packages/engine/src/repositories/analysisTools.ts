import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Instance, ScreenMock, ScreenStep } from "@unframed/contracts";
import {
  agentShapeId,
  ANALYSIS_TOOL_TEXT,
  checkMocks,
  checkSteps,
  isMockFileName,
  MOCK_MODULES_FOLDER,
  mockFileSummary,
  MOCKS_FOLDER,
  NO_CHROME_PREVIEW_MESSAGE,
  normaliseRoute,
  placeableRoutes,
  restoreRoute,
  roomShapeId,
  routeFor,
  SCREEN_DEFAULT_VIEWPORT,
  searchDesignSystem,
  withoutRestore,
  type CodeMap,
  type MockLogEntry,
  type PreparedState,
  type RepoAnalysis,
  type RouteStates,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import { refusal, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import type { InstanceTools } from "../instances/instanceTools.ts";
import type { InstancePatch } from "../instances/instancePatch.ts";
import { listFiles } from "../instances/mockFiles.ts";
import { NotLive } from "../instances/liveInstance.ts";
import type { ScreenStatePayload } from "../instances/stateTokens.ts";
import { errorText } from "../log.ts";
import { isScreenShape, type ScreenShape } from "../screens/firstScreen.ts";
import { writeFrozen, type Freezer, type RestoreProver } from "../screens/frozenStates.ts";
import { routeScreenRecords, shownRoutes, stateScreenRecords, type PlacedState } from "../screens/placement.ts";
import { proofFailure, proofUrl } from "../screens/screenState.ts";
import { readAnalysis, savePrepared } from "./analysis.ts";

const PATCH_ANSWER_CHARS = 200_000;
const LOG_ANSWER = 100;

export interface AnalysisToolDeps {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
  readonly list: (project: string) => Promise<ReadonlyArray<Instance>>;
  readonly status: (project: string, id: string) => Promise<Instance>;
  readonly gitCommonDir: (project: string) => Promise<string | undefined>;
  readonly analyse: (worktree: string, gitCommonDir: string) => Promise<{ readonly analysis: RepoAnalysis; readonly files: number }>;
  readonly mockLog: (project: string, id: string) => Promise<ReadonlyArray<MockLogEntry>>;
  readonly shareSetupFiles: (project: string, from: string, files: ReadonlyArray<string>) => Promise<{ readonly copiedInto: ReadonlyArray<string> }>;
  readonly projectFolder: (project: string) => Promise<string | undefined>;
  readonly patch: (project: string, id: string) => Promise<InstancePatch>;
  readonly stateToken: (project: string, id: string, payload: ScreenStatePayload) => Promise<string>;
  readonly instances: InstanceTools;
  readonly freeze: Freezer | undefined;
  readonly proveRestore: RestoreProver | undefined;
}

class Refused extends Error {}

const optionalString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

const text = (name: string) => ANALYSIS_TOOL_TEXT[name]!;

const mockPath = (file: string): string => {
  const path = file.trim().replace(/^\.unframed\/mocks\//, "").replace(/^\/+/, "");
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Refused("file is a path under .unframed/mocks/, such as items.mock.js");
  if (parts.length === 1 && isMockFileName(path)) return path;
  if (parts[0] === "modules" && parts.length > 1 && /\.(?:m?js)$/.test(path)) return path;
  throw new Refused("file is a .mock.js file in .unframed/mocks/, such as items.mock.js, or a replacement module under modules/, such as modules/src/api/client.js");
};

const stateOf = (raw: unknown, fallbackRoute: string, at: number): PlacedState & { readonly case?: string } => {
  const where = `State ${at + 1}: `;
  const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const route = normaliseRoute(typeof entry.route === "string" ? entry.route : fallbackRoute);
  if (route === undefined) throw new Refused(`${where}the route is a path in the app, such as /settings`);
  const steps = checkSteps(entry.steps);
  if ("error" in steps) throw new Refused(`${where}${steps.error}`);
  const mocks = checkMocks(entry.mocks);
  if ("error" in mocks) throw new Refused(`${where}${mocks.error}`);
  const state = typeof entry.state === "string" ? entry.state.trim() : "";
  if (state === "") throw new Refused(`${where}describe the state in a few plain words with state, such as "an empty list"`);
  const kase = optionalString(entry.case);
  return { route, steps: steps.steps, mocks: mocks.mocks, state, ...(kase === undefined ? {} : { case: kase }) };
};

export class AnalysisTools {
  private readonly deps: AnalysisToolDeps;

  constructor(deps: AnalysisToolDeps) {
    this.deps = deps;
  }

  private async screenNamed(project: string, shapeId: string): Promise<ScreenShape> {
    const found = (await this.deps.read(project)).find((record) => record.id === roomShapeId(shapeId));
    if (!isScreenShape(found)) throw new Refused(`there is no Screen ${shapeId}`);
    return found;
  }

  private async target(project: string, args: Record<string, unknown>): Promise<{ readonly instance: Instance; readonly screen: ScreenShape | undefined }> {
    const shapeId = optionalString(args.shapeId);
    if (shapeId !== undefined) {
      const screen = await this.screenNamed(project, shapeId);
      const instance = await this.deps.status(project, screen.props.instance);
      if (instance.state === "removed") throw new Refused("that Screen's worktree was removed");
      return { instance, screen };
    }
    const instance = (await this.deps.list(project)).find((candidate) => candidate.state !== "removed");
    if (instance === undefined) throw new Refused("this Repository has no Instance; create one with instance_create");
    return { instance, screen: undefined };
  }

  private async analysisOf(project: string, instance: Instance, refresh = false): Promise<RepoAnalysis> {
    if (!refresh) {
      const saved = await readAnalysis(instance.worktree);
      if (saved.codeMap !== undefined && saved.designSystem !== undefined && saved.states !== undefined) return saved as RepoAnalysis;
    }
    const gitCommonDir = await this.deps.gitCommonDir(project);
    if (gitCommonDir === undefined) throw new Refused("this project is not a Repository");
    return (await this.deps.analyse(instance.worktree, gitCommonDir)).analysis;
  }

  private routeStates(analysis: RepoAnalysis, route: string): RouteStates | undefined {
    const pattern = routeFor(analysis.states, route);
    return analysis.states.routes.find((entry) => entry.route === (pattern ?? withoutRestore(route)));
  }

  private async analyse(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { instance } = await this.target(binding.project, args);
    const gitCommonDir = await this.deps.gitCommonDir(binding.project);
    if (gitCommonDir === undefined) throw new Refused("this project is not a Repository");
    const { analysis, files } = await this.deps.analyse(instance.worktree, gitCommonDir);
    return {
      value: {
        instance: instance.id,
        worktree: instance.worktree,
        files,
        stack: analysis.codeMap.stack,
        routes: analysis.codeMap.routes.map((route) => ({ path: route.path, file: route.file, line: route.line, group: route.group, name: route.name, ...(route.example === undefined ? {} : { example: route.example }) })),
        dialogs: analysis.codeMap.dialogs.length,
        flags: analysis.codeMap.flags.length,
        components: analysis.designSystem.components.length,
        tokens: analysis.designSystem.tokens.length,
        states: analysis.states.routes.map((entry) => ({ route: entry.route, cases: entry.cases.length, prepared: entry.prepared.length })),
      },
    };
  }

  private async codeMap(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { instance } = await this.target(binding.project, args);
    const map = (await this.analysisOf(binding.project, instance)).codeMap;
    const section = optionalString(args.section);
    if (section === undefined) return { value: map };
    if (!["stack", "routes", "dialogs", "flags", "features", "notes"].includes(section)) throw new Refused("section is one of stack, routes, dialogs, flags, features or notes");
    return { value: { [section]: map[section as keyof CodeMap] } };
  }

  private async designSearch(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { instance } = await this.target(binding.project, args);
    const query = optionalString(args.query);
    if (query === undefined) throw new Refused("say what to look for with query, such as \"button\"");
    const kind = args.kind === "component" || args.kind === "token" ? args.kind : undefined;
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(100, Math.round(args.limit)) : undefined;
    const index = (await this.analysisOf(binding.project, instance)).designSystem;
    return { value: searchDesignSystem(index, query, { ...(kind === undefined ? {} : { kind }), ...(limit === undefined ? {} : { limit }) }) };
  }

  private async routeStatesTool(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { instance, screen } = await this.target(binding.project, args);
    const route = optionalString(args.route) ?? screen?.props.route;
    if (route === undefined) throw new Refused("name the route, or a Screen whose route to use");
    const analysis = await this.analysisOf(binding.project, instance);
    const entry = this.routeStates(analysis, route);
    return { value: entry ?? { route: withoutRestore(route), files: 0, cases: [], prepared: [] } };
  }

  private async mocksRead(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { instance } = await this.target(binding.project, args);
    const folder = join(instance.worktree, MOCKS_FOLDER);
    const names = (await readdir(folder).catch(() => [] as string[])).filter(isMockFileName).sort();
    const files = [];
    for (const name of names) files.push(mockFileSummary(name, await readFile(join(folder, name), "utf8").catch(() => "")));
    const modulesFolder = join(instance.worktree, MOCK_MODULES_FOLDER);
    const modules = (await listFiles(modulesFolder, modulesFolder)).sort();
    const requests = [...(await this.deps.mockLog(binding.project, instance.id))].reverse().slice(0, LOG_ANSWER);
    return { value: { folder: MOCKS_FOLDER, files, modules, requests } };
  }

  private async mockWrite(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { instance } = await this.target(binding.project, args);
    const file = mockPath(typeof args.file === "string" ? args.file : "");
    if (typeof args.content !== "string") throw new Refused("content is the whole file");
    const path = `${MOCKS_FOLDER}/${file}`;
    await mkdir(dirname(join(instance.worktree, path)), { recursive: true });
    await writeFile(join(instance.worktree, path), args.content);
    const shared = await this.deps.shareSetupFiles(binding.project, instance.id, [path]);
    return { value: { file: path, copiedInto: shared.copiedInto } };
  }

  async placeRoutes(project: string, origin: ChangeOrigin, options: { readonly screen?: ScreenShape; readonly instance: Instance; readonly asked?: ReadonlyArray<string> }) {
    const analysis = await this.analysisOf(project, options.instance);
    const records = await this.deps.read(project);
    const chosen = placeableRoutes(analysis.codeMap.routes, { ...(options.asked === undefined ? {} : { asked: options.asked }), shown: shownRoutes(records, options.instance.id) });
    const size = options.screen === undefined ? SCREEN_DEFAULT_VIEWPORT : { w: Math.round(options.screen.props.w), h: Math.round(options.screen.props.h) };
    const placed = routeScreenRecords(records, options.instance, chosen.place, size);
    if (placed.put.length > 0) await this.deps.apply(project, { put: [...placed.put], remove: [] }, origin);
    return { placed: chosen.place.map((route) => route.path), skipped: chosen.skipped, frames: placed.frames.map(agentShapeId), screens: placed.screens.map(agentShapeId) };
  }

  async placeAfterSetup(project: string): Promise<number> {
    const live = (await this.deps.list(project)).filter((instance) => instance.state !== "removed");
    const records = await this.deps.read(project);
    const screen = records.filter(isScreenShape).find((candidate) => live.some((instance) => instance.id === candidate.props.instance));
    const instance = live.find((candidate) => candidate.id === screen?.props.instance) ?? live[0];
    if (instance === undefined) return 0;
    const placed = await this.placeRoutes(project, { kind: "server", id: "setup" }, { instance, ...(screen === undefined ? {} : { screen }) });
    return placed.screens.length;
  }

  private async screensPlace(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { instance, screen } = await this.target(binding.project, args);
    let asked: string[] | undefined;
    if (args.routes !== undefined) {
      if (!Array.isArray(args.routes) || args.routes.some((route) => typeof route !== "string")) throw new Refused("routes is a list of paths, such as [\"/\", \"/posts/1\"]");
      asked = (args.routes as string[]).map((route) => normaliseRoute(route) ?? route);
    }
    return { value: await this.placeRoutes(binding.project, { kind: "server", id: `chat:${binding.chatId}` }, { instance, ...(screen === undefined ? {} : { screen }), ...(asked === undefined ? {} : { asked }) }) };
  }

  private async place(project: string, screen: ScreenShape, instance: Instance, states: ReadonlyArray<PlacedState>, origin: ChangeOrigin) {
    const records = await this.deps.read(project);
    const current = records.find((record) => record.id === screen.id);
    const placed = stateScreenRecords(records, isScreenShape(current) ? current : screen, instance, states);
    if ("error" in placed) throw new Refused(placed.error);
    if (placed.put.length > 0) await this.deps.apply(project, { put: [...placed.put], remove: [] }, origin);
    return placed;
  }

  private async statesPlace(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const shapeId = optionalString(args.shapeId);
    if (shapeId === undefined) throw new Refused("name the Screen whose route the states belong to with shapeId");
    const screen = await this.screenNamed(binding.project, shapeId);
    const asked = Array.isArray(args.states) ? args.states : [];
    if (asked.length === 0) throw new Refused("give at least one state");
    const states = asked.map((raw, at) => stateOf(raw, screen.props.route, at));
    const instance = await this.deps.instances.live(binding.project, screen.props.instance);
    const size = { w: Math.round(screen.props.w), h: Math.round(screen.props.h) };
    for (const [at, state] of states.entries()) {
      const proof = await this.deps.instances.proveState(binding.project, instance, state, size);
      if (!proof.ok) return { value: { error: `State ${at + 1}, ${state.state}: ${proofFailure(proof, state.steps)}. Nothing was placed or saved.`, state: at + 1 }, isError: true, images: [{ data: proof.png.toString("base64"), mimeType: "image/png" }] };
    }
    const analysis = await this.analysisOf(binding.project, instance);
    const pattern = this.routeStates(analysis, screen.props.route)?.route ?? withoutRestore(screen.props.route);
    const recipes: PreparedState[] = states.map((state) => ({ state: state.state, route: state.route, steps: [...state.steps], mocks: [...state.mocks], ...(state.case === undefined ? {} : { case: state.case }) }));
    await savePrepared(instance.worktree, pattern, recipes);
    const placed = await this.place(binding.project, screen, instance, states, { kind: "server", id: `chat:${binding.chatId}` });
    return { value: { route: pattern, frame: placed.frames.map(agentShapeId)[0], screens: placed.screens.map(agentShapeId) } };
  }

  async showStates(project: string, shapeId: string): Promise<{ readonly placed: number; readonly cases: number; readonly route: string }> {
    const screen = await this.screenNamed(project, shapeId);
    const instance = await this.deps.status(project, screen.props.instance);
    if (instance.state === "removed") throw new Refused("that Screen's worktree was removed");
    const analysis = await this.analysisOf(project, instance);
    const entry = this.routeStates(analysis, screen.props.route);
    const route = entry?.route ?? withoutRestore(screen.props.route);
    const prepared = (entry?.prepared ?? []).flatMap((recipe, at) => {
      try {
        return [stateOf(recipe, screen.props.route, at)];
      } catch {
        return [];
      }
    });
    if (prepared.length === 0) return { placed: 0, cases: entry?.cases.length ?? 0, route };
    const placed = await this.place(project, screen, instance, prepared, { kind: "server", id: "show-states" });
    return { placed: placed.screens.length, cases: entry?.cases.length ?? 0, route };
  }

  private async stateFreeze(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const shapeId = optionalString(args.shapeId);
    if (shapeId === undefined) throw new Refused("name the Screen to freeze with shapeId");
    if (this.deps.freeze === undefined || this.deps.proveRestore === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    const screen = await this.screenNamed(binding.project, shapeId);
    const steps = checkSteps(screen.props.steps);
    const mocks = checkMocks(screen.props.mocks);
    const allSteps: ReadonlyArray<ScreenStep> = "steps" in steps ? steps.steps : [];
    const screenMocks: ReadonlyArray<ScreenMock> = "mocks" in mocks ? mocks.mocks : [];
    const keepAsked = args.keep === undefined ? [] : args.keep;
    if (!Array.isArray(keepAsked) || keepAsked.some((value) => typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > allSteps.length)) {
      throw new Refused(`keep is a list of step numbers from 1 to ${allSteps.length}`);
    }
    const kept = allSteps.filter((_, at) => (keepAsked as number[]).includes(at + 1));
    const instance = await this.deps.instances.live(binding.project, screen.props.instance);
    const size = { w: Math.round(screen.props.w), h: Math.round(screen.props.h) };
    const tokenFor = async (payload: ScreenStatePayload) => (payload.steps.length === 0 && payload.mocks.length === 0 ? undefined : this.deps.stateToken(binding.project, instance.id, payload));
    const frozen = await this.deps.freeze({ url: proofUrl(instance.proxyPort, screen.props.route, await tokenFor({ steps: allSteps, mocks: screenMocks })), ...size, steps: allSteps.length });
    if (frozen === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    if (!frozen.ok) throw new Refused(`could not freeze the Screen: ${frozen.reason}`);
    const folder = await this.deps.projectFolder(binding.project);
    if (folder === undefined) throw new Refused("the project's folder is missing");
    const id = await writeFrozen(folder, frozen.state);
    const route = restoreRoute(frozen.state.url, id);
    const proof = await this.deps.proveRestore({ url: proofUrl(instance.proxyPort, route, await tokenFor({ steps: kept, mocks: screenMocks })), ...size, steps: kept.length });
    if (proof === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    const images = [{ data: proof.png.toString("base64"), mimeType: "image/png" }];
    if (!proof.restored) return { value: { error: "the frozen state did not come back on reload: a typed field was not found again. Nothing changed." }, isError: true, images };
    const now = (await this.deps.read(binding.project)).find((record) => record.id === screen.id);
    if (!isScreenShape(now)) throw new Refused(`there is no Screen ${shapeId}`);
    await this.deps.apply(binding.project, { put: [{ ...now, props: { ...now.props, route, steps: [...kept] } } as TLRecord], remove: [] }, { kind: "server", id: `chat:${binding.chatId}` });
    return { value: { screen: agentShapeId(screen.id), route, id, fields: frozen.state.fields.length, collections: Object.keys(frozen.state.collections), steps: kept.length }, images };
  }

  private async instancePatch(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const id = optionalString(args.id);
    if (id === undefined) throw new Refused("pass the Instance's id");
    const patch = await this.deps.patch(binding.project, id);
    const truncated = patch.patch.length > PATCH_ANSWER_CHARS;
    return { value: { base: patch.base, files: patch.files, patch: truncated ? patch.patch.slice(0, PATCH_ANSWER_CHARS) : patch.patch, truncated } };
  }

  private async call(run: () => Promise<ToolAnswer>): Promise<ToolAnswer> {
    try {
      return await run();
    } catch (error) {
      return refusal(error instanceof Refused || error instanceof NotLive ? error.message : errorText(error));
    }
  }

  tools(): McpTool[] {
    const string = { type: "string" };
    const shape = { shapeId: string };
    const define = (
      name: string,
      properties: Record<string, Record<string, unknown>>,
      required: string[],
      run: (binding: McpBinding, args: Record<string, unknown>) => Promise<ToolAnswer>,
    ): McpTool => ({
      name,
      description: text(name).description,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, { ...value, description: text(name).arguments[key] ?? "" }])),
        ...(required.length === 0 ? {} : { required }),
        additionalProperties: false,
      },
      scope: "repository",
      call: (binding, args) => this.call(() => run(binding, args)),
    });
    return [
      define("repo_analyse", shape, [], (binding, args) => this.analyse(binding, args)),
      define("code_map_read", { ...shape, section: { type: "string", enum: ["stack", "routes", "dialogs", "flags", "features", "notes"] } }, [], (binding, args) => this.codeMap(binding, args)),
      define("design_search", { ...shape, query: string, kind: { type: "string", enum: ["component", "token"] }, limit: { type: "number" } }, ["query"], (binding, args) => this.designSearch(binding, args)),
      define("route_states", { ...shape, route: string }, [], (binding, args) => this.routeStatesTool(binding, args)),
      define("mocks_read", shape, [], (binding, args) => this.mocksRead(binding, args)),
      define("mock_write", { ...shape, file: string, content: string }, ["file", "content"], (binding, args) => this.mockWrite(binding, args)),
      define("screens_place", { ...shape, routes: { type: "array", items: string } }, [], (binding, args) => this.screensPlace(binding, args)),
      define("states_place", { shapeId: string, states: { type: "array", items: { type: "object" } } }, ["shapeId", "states"], (binding, args) => this.statesPlace(binding, args)),
      define("state_freeze", { shapeId: string, keep: { type: "array", items: { type: "number" } } }, ["shapeId"], (binding, args) => this.stateFreeze(binding, args)),
      define("instance_patch", { id: string }, ["id"], (binding, args) => this.instancePatch(binding, args)),
    ];
  }
}
