/**
 * The agent's preview tools (spec 09, after t3code's preview toolkit): a headless browser tab
 * per chat, bound to this project's artifacts instead of arbitrary URLs. The agent opens what
 * it made, looks at it and clicks through it. The tab only ever loads the preview origin, and
 * the tools read the canvas, never write it.
 */
import { randomUUID } from "node:crypto";
import {
  agentShapeId,
  artifactTitle,
  artifactUrl,
  EVALUATE_LIMIT,
  FILL_VIEWPORT,
  locatorSelector,
  NO_CHROME_PREVIEW_MESSAGE,
  PREVIEW_TOOL_TEXT,
  previewViewport,
  projectSlug,
  roomShapeId,
  shapeKind,
  waitTimeout,
  type ArtifactKind,
  type PreviewViewport,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { ElementHandle, KeyInput, Page } from "puppeteer-core";
import type { McpBinding, McpTool, ToolAnswer } from "../agent/mcp.ts";
import { errorText } from "../log.ts";
import type { HeadlessChrome } from "./headlessChrome.ts";

const LOG_LIMIT = 100;
const TEXT_LIMIT = 20_000;
const ELEMENT_LIMIT = 200;

interface Entry {
  readonly level: string;
  readonly text: string;
  readonly timestamp: string;
}

interface Action {
  readonly id: string;
  readonly action: string;
  status: "running" | "succeeded" | "failed";
  readonly startedAt: string;
  completedAt?: string;
  error?: string;
}

interface Tab {
  readonly project: string;
  readonly chatId: string;
  readonly page: Page;
  artifact: { readonly shapeId: string; readonly kind: ArtifactKind; readonly title: string; readonly file: string } | undefined;
  viewport: PreviewViewport;
  colorScheme: "light" | "dark" | "system";
  readonly console: Entry[];
  readonly network: Array<{ url: string; method: string; status: number | null; failed: boolean; errorText?: string; timestamp: string }>;
  readonly actions: Action[];
}

export interface PreviewDeps {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly chrome: HeadlessChrome;
  readonly findChrome: () => Promise<string | undefined>;
  readonly previewPort: () => number;
  /** Spec 01's open-project registry: the project's closer closes every preview tab of it. */
  readonly registerCloser: (project: string, close: () => Promise<void>) => void;
}

class Refused extends Error {}

const refuse = (message: string): ToolAnswer => ({ value: { error: message }, isError: true });

const push = <T>(list: T[], item: T) => {
  list.push(item);
  if (list.length > LOG_LIMIT) list.splice(0, list.length - LOG_LIMIT);
};

const now = () => new Date().toISOString();

/** The page's interactive elements, as t3code's snapshot lists them. Runs in the page. */
const ELEMENTS_SCRIPT = `(() => {
  const found = [];
  const pathOf = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 6; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (node.id) { parts[0] = "#" + CSS.escape(node.id); break; }
    }
    return parts.join(" > ");
  };
  for (const element of document.querySelectorAll("a[href], button, input, select, textarea, summary, [role], [tabindex], [contenteditable='true']")) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const name = (element.getAttribute("aria-label") || element.innerText || element.value || element.getAttribute("placeholder") || element.getAttribute("title") || "").trim().slice(0, 120);
    found.push({ tag: element.tagName.toLowerCase(), role: element.getAttribute("role"), name, selector: pathOf(element), x: box.x, y: box.y, width: box.width, height: box.height });
    if (found.length >= ${ELEMENT_LIMIT}) break;
  }
  return found;
})()`;

export class PreviewTools {
  private readonly tabs = new Map<string, Tab>();
  /** Projects whose closer is registered. */
  private readonly registered = new Set<string>();
  private readonly deps: PreviewDeps;

  constructor(deps: PreviewDeps) {
    this.deps = deps;
  }

  private origins(): string[] {
    const port = this.deps.previewPort();
    return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
  }

  /** Only the preview origin: every rule of that origin holds for the agent's tab too. */
  private allowed(url: string): boolean {
    if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return true;
    try {
      return this.origins().includes(new URL(url).origin);
    } catch {
      return false;
    }
  }

  private async artifactOf(project: string, shapeId: unknown): Promise<NonNullable<Tab["artifact"]>> {
    const id = typeof shapeId === "string" ? shapeId.trim() : "";
    const shape = (await this.deps.read(project)).find((record) => record.id === roomShapeId(id)) as (TLRecord & { type: string; props: Record<string, unknown> }) | undefined;
    if (!shape || shape.typeName !== "shape") throw new Refused(`no shape ${id}`);
    if (shape.type !== "page" && shape.type !== "motion") throw new Refused(`shape ${id} is a ${shapeKind(shape.type)}, not a page or motion`);
    const file = typeof shape.props.file === "string" ? shape.props.file : "";
    if (file === "") throw new Refused(`${shape.type} ${id} has no file yet`);
    return { shapeId: agentShapeId(shape.id), kind: shape.type, title: artifactTitle(shape.props), file };
  }

  private async openTab(binding: McpBinding): Promise<Tab> {
    const known = this.tabs.get(binding.chatId);
    if (known && !known.page.isClosed()) return known;
    const page = await this.deps.chrome.use((browser) => browser.newPage());
    if (page === undefined) throw new Refused(NO_CHROME_PREVIEW_MESSAGE);
    this.deps.chrome.hold(`preview ${binding.chatId}`);
    const tab: Tab = {
      project: projectSlug(binding.project),
      chatId: binding.chatId,
      page,
      artifact: undefined,
      viewport: { mode: "fill", ...FILL_VIEWPORT },
      colorScheme: "system",
      console: [],
      network: [],
      actions: [],
    };
    await page.setViewport({ width: tab.viewport.width, height: tab.viewport.height });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (this.allowed(request.url())) void request.continue().catch(() => undefined);
      // A navigation away answers 204, which the browser does not navigate to: the artifact stays shown.
      else if (request.isNavigationRequest()) void request.respond({ status: 204, body: "" }).catch(() => undefined);
      else void request.abort("blockedbyclient").catch(() => undefined);
    });
    page.on("console", (message) => push(tab.console, { level: message.type(), text: message.text(), timestamp: now() }));
    page.on("pageerror", (error) => push(tab.console, { level: "error", text: error instanceof Error ? error.message : String(error), timestamp: now() }));
    page.on("requestfinished", (request) => push(tab.network, { url: request.url(), method: request.method(), status: request.response()?.status() ?? null, failed: false, timestamp: now() }));
    page.on("requestfailed", (request) =>
      push(tab.network, { url: request.url(), method: request.method(), status: null, failed: true, errorText: request.failure()?.errorText ?? "failed", timestamp: now() }),
    );
    page.on("close", () => {
      if (this.tabs.get(binding.chatId) === tab) this.tabs.delete(binding.chatId);
      this.deps.chrome.release(`preview ${binding.chatId}`);
    });
    this.tabs.set(binding.chatId, tab);
    if (!this.registered.has(tab.project)) {
      this.registered.add(tab.project);
      this.deps.registerCloser(tab.project, async () => {
        this.registered.delete(tab.project);
        await this.closeProject(tab.project);
      });
    }
    return tab;
  }

  private tab(binding: McpBinding): Tab {
    const tab = this.tabs.get(binding.chatId);
    if (!tab || tab.page.isClosed()) throw new Refused("There is no preview tab yet. Open one with preview_open.");
    return tab;
  }

  private async status(tab: Tab | undefined) {
    if (!tab || tab.page.isClosed()) return { exists: false, artifact: null, url: null, title: null, loading: false, viewport: null };
    const loading = await tab.page.evaluate("document.readyState !== 'complete'").catch(() => true);
    const viewport = tab.page.viewport();
    return {
      exists: true,
      artifact: tab.artifact ?? null,
      url: tab.page.url(),
      title: await tab.page.title().catch(() => ""),
      loading: loading === true,
      viewport: { ...tab.viewport, measured: viewport === null ? null : { width: viewport.width, height: viewport.height } },
      colorScheme: tab.colorScheme,
    };
  }

  /** Runs one action on the tab and writes it in the tab's timeline. */
  private async act<T>(tab: Tab, action: string, work: () => Promise<T>): Promise<T> {
    const entry: Action = { id: randomUUID(), action, status: "running", startedAt: now() };
    push(tab.actions, entry);
    try {
      const result = await work();
      entry.status = "succeeded";
      return result;
    } catch (error) {
      entry.status = "failed";
      entry.error = errorText(error);
      throw error;
    } finally {
      entry.completedAt = now();
    }
  }

  private async show(tab: Tab, artifact: NonNullable<Tab["artifact"]>) {
    await this.act(tab, `open ${artifact.shapeId}`, async () => {
      tab.artifact = artifact;
      const url = artifactUrl({ appHostname: "localhost", previewPort: this.deps.previewPort(), project: tab.project, file: artifact.file, kind: artifact.kind });
      await tab.page.goto(url, { waitUntil: "load", timeout: 20_000 });
    });
  }

  /** Exactly one element for a locator or a selector, or the sentence that says why not. */
  private async target(tab: Tab, args: Record<string, unknown>): Promise<ElementHandle<Element>> {
    const given = typeof args.locator === "string" && args.locator.trim() !== "" ? args.locator : typeof args.selector === "string" && args.selector.trim() !== "" ? args.selector : undefined;
    if (given === undefined) throw new Refused("pass a locator or a selector");
    const selector = typeof args.locator === "string" && args.locator.trim() !== "" ? locatorSelector(args.locator) : String(args.selector);
    let found: ElementHandle<Element>[];
    try {
      found = await tab.page.$$(selector);
    } catch (error) {
      throw new Refused(`${given} is not a selector the browser understands: ${errorText(error)}`);
    }
    if (found.length !== 1) {
      await Promise.all(found.map((handle) => handle.dispose()));
      throw new Refused(`${given} matches ${found.length} elements; this needs exactly one`);
    }
    return found[0]!;
  }

  private async run(binding: McpBinding, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    if ((await this.deps.findChrome()) === undefined) return refuse(NO_CHROME_PREVIEW_MESSAGE);
    switch (name) {
      case "preview_status":
        return { value: await this.status(this.tabs.get(binding.chatId)) };
      case "preview_open":
      case "preview_navigate": {
        const artifact = await this.artifactOf(binding.project, args.shapeId);
        const tab = await this.openTab(binding);
        await this.show(tab, artifact);
        return { value: await this.status(tab) };
      }
      case "preview_resize": {
        const tab = this.tab(binding);
        const asked = previewViewport(args);
        if ("error" in asked) throw new Refused(asked.error);
        await this.act(tab, `resize ${asked.viewport.width}x${asked.viewport.height}`, () => tab.page.setViewport({ width: asked.viewport.width, height: asked.viewport.height }));
        tab.viewport = asked.viewport;
        return { value: { viewport: asked.viewport } };
      }
      case "preview_set_appearance": {
        const tab = this.tab(binding);
        const scheme = args.colorScheme;
        if (scheme !== "light" && scheme !== "dark" && scheme !== "system") throw new Refused("colorScheme must be light, dark or system");
        await this.act(tab, `appearance ${scheme}`, () => tab.page.emulateMediaFeatures(scheme === "system" ? [] : [{ name: "prefers-color-scheme", value: scheme }]));
        tab.colorScheme = scheme;
        return { value: { colorScheme: scheme } };
      }
      case "preview_snapshot": {
        const tab = this.tab(binding);
        const status = await this.status(tab);
        const [visibleText, interactiveElements, accessibilityTree] = await Promise.all([
          tab.page.evaluate("document.body ? document.body.innerText : ''").then((text) => String(text).slice(0, TEXT_LIMIT)),
          tab.page.evaluate(ELEMENTS_SCRIPT),
          tab.page.accessibility.snapshot({ interestingOnly: true }).catch(() => null),
        ]);
        const viewport = tab.page.viewport() ?? tab.viewport;
        const withImage = args.includeImage !== false;
        const png = withImage ? Buffer.from(await tab.page.screenshot({ type: "png" })).toString("base64") : undefined;
        return {
          value: {
            url: status.url,
            title: status.title,
            loading: status.loading,
            artifact: status.artifact,
            visibleText,
            interactiveElements,
            accessibilityTree,
            consoleEntries: tab.console,
            networkEntries: tab.network,
            actionTimeline: tab.actions,
            ...(withImage ? { screenshot: { mimeType: "image/png", width: viewport.width, height: viewport.height } } : {}),
          },
          ...(png === undefined ? {} : { images: [{ data: png, mimeType: "image/png" }] }),
        };
      }
      case "preview_click": {
        const tab = this.tab(binding);
        const hasPoint = args.x !== undefined || args.y !== undefined;
        if (hasPoint) {
          if (typeof args.x !== "number" || typeof args.y !== "number") throw new Refused("x and y must be supplied together, as numbers");
          const { x, y } = args;
          await this.act(tab, `click ${x},${y}`, () => tab.page.mouse.click(x, y));
          return { value: { clicked: { x, y } } };
        }
        const handle = await this.target(tab, args);
        await this.act(tab, `click ${String(args.locator ?? args.selector)}`, () => handle.click());
        await handle.dispose();
        return { value: { clicked: String(args.locator ?? args.selector) } };
      }
      case "preview_type": {
        const tab = this.tab(binding);
        if (typeof args.text !== "string") throw new Refused("text must be a string");
        const text = args.text;
        const handle = await this.target(tab, args);
        await this.act(tab, `type into ${String(args.locator ?? args.selector)}`, async () => {
          await handle.focus();
          if (args.clear === true) await handle.evaluate("(element) => { if ('value' in element) element.value = ''; else element.textContent = ''; }" as never);
          await tab.page.keyboard.sendCharacter(text);
        });
        await handle.dispose();
        return { value: { typed: text.length } };
      }
      case "preview_press": {
        const tab = this.tab(binding);
        if (typeof args.key !== "string" || args.key === "") throw new Refused("key must be a key name");
        const modifiers = Array.isArray(args.modifiers) ? args.modifiers.filter((key): key is string => typeof key === "string") : [];
        await this.act(tab, `press ${[...modifiers, args.key].join("+")}`, async () => {
          for (const key of modifiers) await tab.page.keyboard.down(key as KeyInput);
          await tab.page.keyboard.press(args.key as KeyInput);
          for (const key of [...modifiers].reverse()) await tab.page.keyboard.up(key as KeyInput);
        });
        return { value: { pressed: [...modifiers, args.key].join("+") } };
      }
      case "preview_scroll": {
        const tab = this.tab(binding);
        const deltaX = typeof args.deltaX === "number" ? args.deltaX : 0;
        const deltaY = typeof args.deltaY === "number" ? args.deltaY : 0;
        if (args.locator !== undefined || args.selector !== undefined) {
          const handle = await this.target(tab, args);
          await this.act(tab, `scroll ${deltaX},${deltaY}`, () => handle.evaluate(`(element) => element.scrollBy(${deltaX}, ${deltaY})` as never));
          await handle.dispose();
        } else {
          await this.act(tab, `scroll ${deltaX},${deltaY}`, () => tab.page.evaluate(`window.scrollBy(${deltaX}, ${deltaY})`));
        }
        return { value: { scrolled: { deltaX, deltaY } } };
      }
      case "preview_evaluate": {
        const tab = this.tab(binding);
        if (typeof args.expression !== "string" || args.expression.trim() === "") throw new Refused("expression must be JavaScript");
        const expression = args.expression;
        const value = await this.act(tab, "evaluate", () => tab.page.evaluate(expression));
        const text = JSON.stringify(value ?? null) ?? "null";
        if (Buffer.byteLength(text, "utf8") > EVALUATE_LIMIT) throw new Refused(`the value is ${Buffer.byteLength(text, "utf8")} bytes of JSON; at most ${EVALUATE_LIMIT} come back`);
        return { value: { value: JSON.parse(text) } };
      }
      case "preview_wait_for": {
        const tab = this.tab(binding);
        const timeout = waitTimeout(args.timeoutMs);
        const selectors = [
          ...(typeof args.locator === "string" && args.locator.trim() !== "" ? [locatorSelector(args.locator)] : []),
          ...(typeof args.selector === "string" && args.selector.trim() !== "" ? [args.selector] : []),
        ];
        const text = typeof args.text === "string" && args.text !== "" ? args.text : undefined;
        if (selectors.length === 0 && text === undefined) throw new Refused("pass a locator, a selector or a text to wait for");
        await this.act(tab, "wait", async () => {
          const deadline = Date.now() + timeout;
          for (;;) {
            let met = true;
            for (const selector of selectors) if ((await tab.page.$$(selector)).length === 0) met = false;
            if (met && text !== undefined) met = String(await tab.page.evaluate("document.body ? document.body.innerText : ''")).includes(text);
            if (met) return;
            if (Date.now() > deadline) throw new Refused(`still waiting after ${timeout} ms`);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        });
        return { value: { waited: true } };
      }
      default:
        return refuse(`no such preview tool ${name}`);
    }
  }

  private async call(binding: McpBinding, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    try {
      return await this.run(binding, name, args);
    } catch (error) {
      return refuse(error instanceof Refused ? error.message : errorText(error));
    }
  }

  /** Closes the chat's tab: its session closed. */
  async closeChat(chatId: string): Promise<void> {
    const tab = this.tabs.get(chatId);
    this.tabs.delete(chatId);
    await tab?.page.close().catch(() => undefined);
  }

  /** Closes every preview tab of a project: the open-project registry's closer. */
  async closeProject(project: string): Promise<void> {
    const slug = projectSlug(project);
    await Promise.all([...this.tabs.values()].filter((tab) => tab.project === slug).map((tab) => this.closeChat(tab.chatId)));
  }

  tools(): McpTool[] {
    const property = (description: string, type: string, extra: Record<string, unknown> = {}) => ({ type, description, ...extra });
    const text = (name: string) => PREVIEW_TOOL_TEXT[name]!;
    const schema = (name: string, properties: Record<string, (description: string) => Record<string, unknown>>, required: string[] = []) => ({
      type: "object",
      properties: Object.fromEntries(Object.entries(properties).map(([key, make]) => [key, make(text(name).arguments[key] ?? "")])),
      ...(required.length === 0 ? {} : { required }),
    });
    const string = (description: string) => property(description, "string");
    const number = (description: string) => property(description, "number");
    const boolean = (description: string) => property(description, "boolean");
    const definitions: Array<[string, Record<string, unknown>]> = [
      ["preview_status", { type: "object", properties: {} }],
      ["preview_open", schema("preview_open", { shapeId: string }, ["shapeId"])],
      ["preview_navigate", schema("preview_navigate", { shapeId: string }, ["shapeId"])],
      [
        "preview_resize",
        schema(
          "preview_resize",
          {
            mode: (description) => property(description, "string", { enum: ["fill", "freeform", "preset"] }),
            preset: (description) => property(description, "string"),
            width: number,
            height: number,
            orientation: (description) => property(description, "string", { enum: ["portrait", "landscape"] }),
          },
          ["mode"],
        ),
      ],
      ["preview_set_appearance", schema("preview_set_appearance", { colorScheme: (description) => property(description, "string", { enum: ["light", "dark", "system"] }) }, ["colorScheme"])],
      ["preview_snapshot", schema("preview_snapshot", { includeImage: boolean })],
      ["preview_click", schema("preview_click", { locator: string, selector: string, x: number, y: number })],
      ["preview_type", schema("preview_type", { text: string, locator: string, selector: string, clear: boolean }, ["text"])],
      ["preview_press", schema("preview_press", { key: string, modifiers: (description) => property(description, "array", { items: { type: "string" } }) }, ["key"])],
      ["preview_scroll", schema("preview_scroll", { deltaX: number, deltaY: number, locator: string, selector: string })],
      ["preview_evaluate", schema("preview_evaluate", { expression: string }, ["expression"])],
      ["preview_wait_for", schema("preview_wait_for", { locator: string, selector: string, text: string, timeoutMs: number })],
    ];
    return definitions.map(([name, inputSchema]) => ({
      name,
      description: text(name).description,
      inputSchema,
      call: (binding, args) => this.call(binding, name, args),
    }));
  }
}
