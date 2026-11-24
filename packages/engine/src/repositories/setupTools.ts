import { randomUUID } from "node:crypto";
import { PackageManager, type Instance, type RepositorySetup } from "@unframed/contracts";
import { agentShapeId, SETUP_LOGIN_REQUESTED, SETUP_LOGIN_RESOLVED, SETUP_PROPOSED, type ActivityInput, NO_CHROME_PREVIEW_MESSAGE, projectSlug, roomShapeId, screenUrl, SETUP_TOOL_TEXT } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import * as Schema from "effect/Schema";
import { refusal, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import { NotLive, untilLive } from "../instances/liveInstance.ts";
import { errorText } from "../log.ts";
import { isScreenShape } from "../screens/firstScreen.ts";
import type { ScreenRenderer } from "../screens/screenSnapshots.ts";

export const LOGIN_WAIT_MS = 15 * 60_000;


export interface SetupToolDeps {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly setupScreen: (project: string, chatId: string) => Promise<string | undefined>;
  readonly select: (project: string, shapeIds: ReadonlyArray<string>) => Promise<unknown>;
  readonly activity: (project: string, chatId: string, activity: ActivityInput) => void;
  readonly turnId: (project: string, chatId: string) => string | null;
  readonly start: (project: string, id: string) => Promise<Instance>;
  readonly status: (project: string, id: string) => Promise<Instance>;
  readonly render: () => ScreenRenderer | undefined;
  readonly saveSetup: (project: string, setup: RepositorySetup, from: string) => Promise<{ readonly copiedInto: ReadonlyArray<string> }>;
  readonly loginWaitMs?: number;
}

class Refused extends Error {}

const isPackageManager = Schema.is(PackageManager);

const strings = (value: unknown, name: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Refused(`${name} must be a list of strings`);
  return (value as string[]).map((item) => item.trim()).filter((item) => item !== "");
};

const text = (name: string) => SETUP_TOOL_TEXT[name]!;

export class SetupTools {
  private readonly deps: SetupToolDeps;
  private readonly logins = new Map<string, () => void>();

  constructor(deps: SetupToolDeps) {
    this.deps = deps;
  }

  confirmLogin(project: string): boolean {
    const resolve = this.logins.get(projectSlug(project));
    resolve?.();
    return resolve !== undefined;
  }

  private async screenOf(binding: McpBinding, shapeId: unknown) {
    const id = typeof shapeId === "string" && shapeId.trim() !== "" ? roomShapeId(shapeId.trim()) : await this.deps.setupScreen(binding.project, binding.chatId);
    const shape = id === undefined ? undefined : (await this.deps.read(binding.project)).find((record) => record.id === id);
    if (!isScreenShape(shape)) throw new Refused(id === undefined ? "name the Screen with shapeId" : `there is no Screen ${agentShapeId(id)}`);
    return shape;
  }

  private activity(binding: McpBinding, kind: string, summary: string, payload: unknown) {
    this.deps.activity(binding.project, binding.chatId, {
      id: `${kind}:${randomUUID()}`,
      tone: "info",
      kind,
      summary,
      payload,
      turnId: this.deps.turnId(binding.project, binding.chatId),
      createdAt: new Date().toISOString(),
    });
  }

  private async askLogin(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const screen = await this.screenOf(binding, args.shapeId);
    const message = typeof args.message === "string" && args.message.trim() !== "" ? args.message.trim() : "Log in to the app in this Screen.";
    const slug = projectSlug(binding.project);
    this.logins.get(slug)?.();
    const loggedIn = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.logins.get(slug) === done) this.logins.delete(slug);
        resolve(false);
      }, this.deps.loginWaitMs ?? LOGIN_WAIT_MS);
      timer.unref();
      const done = () => {
        clearTimeout(timer);
        if (this.logins.get(slug) === done) this.logins.delete(slug);
        resolve(true);
      };
      this.logins.set(slug, done);
    });
    this.activity(binding, SETUP_LOGIN_REQUESTED, message, { shapeId: screen.id, message });
    await this.deps.select(binding.project, [screen.id]).catch(() => undefined);
    const confirmed = await loggedIn;
    this.activity(binding, SETUP_LOGIN_RESOLVED, confirmed ? "Logged in" : "No login yet", { shapeId: screen.id, loggedIn: confirmed });
    return { value: { loggedIn: confirmed, shapeId: agentShapeId(screen.id) } };
  }

  private async snapshot(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const screen = await this.screenOf(binding, args.shapeId);
    const render = this.deps.render();
    if (render === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    const instance = await untilLive(
      () => this.deps.start(binding.project, screen.props.instance),
      () => this.deps.status(binding.project, screen.props.instance),
    );
    const url = screenUrl(instance.proxyPort, screen.props.route);
    const picture = await render({ url, w: Math.round(screen.props.w), h: Math.round(screen.props.h), dials: undefined });
    if (picture === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    return {
      value: { shapeId: agentShapeId(screen.id), url, route: screen.props.route, w: Math.round(screen.props.w), h: Math.round(screen.props.h) },
      images: [{ data: picture.toString("base64"), mimeType: "image/png" }],
    };
  }

  private async save(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const runCommand = typeof args.runCommand === "string" ? args.runCommand.trim() : "";
    if (runCommand === "") throw new Refused("runCommand is the command that starts the dev server");
    if (!isPackageManager(args.packageManager)) throw new Refused("packageManager is one of npm, pnpm, yarn or bun");
    if (args.port !== undefined && (typeof args.port !== "number" || !Number.isInteger(args.port) || args.port < 1 || args.port > 65_535)) throw new Refused("port is a whole number from 1 to 65535");
    const setup: RepositorySetup = {
      setupCommand: typeof args.setupCommand === "string" ? args.setupCommand.trim() : "",
      runCommand,
      packageManager: args.packageManager,
      portMode: typeof args.port === "number" ? { mode: "single", port: args.port } : { mode: "free" },
      files: strings(args.files, "files"),
      mocks: strings(args.mocks, "mocks"),
      warnings: strings(args.warnings, "warnings"),
    };
    const screen = await this.screenOf(binding, undefined);
    const saved = await this.deps.saveSetup(binding.project, setup, screen.props.instance);
    this.activity(binding, SETUP_PROPOSED, "Setup proposed done", { shapeId: screen.id });
    return { value: { saved: true, files: setup.files, copiedInto: saved.copiedInto } };
  }

  private async call(binding: McpBinding, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    try {
      if (name === "ask_login") return await this.askLogin(binding, args);
      if (name === "screen_snapshot") return await this.snapshot(binding, args);
      if (name === "setup_save") return await this.save(binding, args);
      return refusal(`no such Setup tool ${name}`);
    } catch (error) {
      return refusal(error instanceof Refused || error instanceof NotLive ? error.message : errorText(error));
    }
  }

  tools(): McpTool[] {
    const schema = (name: string, properties: Record<string, Record<string, unknown>>, required: string[] = []) => ({
      type: "object",
      properties: Object.fromEntries(Object.entries(properties).map(([key, shape]) => [key, { ...shape, description: text(name).arguments[key] ?? "" }])),
      ...(required.length === 0 ? {} : { required }),
      additionalProperties: false,
    });
    const string = { type: "string" };
    const list = { type: "array", items: { type: "string" } };
    const definitions: Array<[string, Record<string, unknown>]> = [
      ["ask_login", schema("ask_login", { shapeId: string, message: string })],
      ["screen_snapshot", schema("screen_snapshot", { shapeId: string })],
      [
        "setup_save",
        schema(
          "setup_save",
          { setupCommand: string, runCommand: string, packageManager: { type: "string", enum: ["npm", "pnpm", "yarn", "bun"] }, port: { type: "number" }, files: list, mocks: list, warnings: list },
          ["runCommand", "packageManager", "files", "mocks", "warnings"],
        ),
      ],
    ];
    return definitions.map(([name, inputSchema]) => ({
      name,
      description: text(name).description,
      inputSchema,
      scope: "setup" as const,
      call: (binding, args) => this.call(binding, name, args),
    }));
  }
}
