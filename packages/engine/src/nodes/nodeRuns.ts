import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  unframedError,
  UnframedError,
  type ChainStarted,
  type ModelEntry,
  type NodeVersion,
  type RecipeRef,
  type RenderedInputs,
  type RunChat,
  type ResultRecipe,
  type VideoStartRequest,
} from "@unframed/contracts";
import {
  artifactUrl,
  audioRunParams,
  canvasShapesOf,
  estimateVideo,
  inputFingerprint,
  linkedFiles,
  modelParams,
  CHAIN_CHANGED_MESSAGE,
  chainStepsOf,
  frameImagesOf,
  isPaidMedium,
  NODE_FIRST_MESSAGE,
  NODE_SKETCH_MESSAGE,
  NO_KEY_MESSAGE,
  nodeCatalogueOf,
  nodeImageEstimate,
  nodeListEstimate,
  nodeProvider,
  GENERATION_PROVIDERS,
  providerField,
  providerKeysOf,
  type NodeCatalogue,
  NO_CHROME_RENDER_MESSAGE,
  NODE_PAGE_SYSTEM,
  nodeCanvasOf,
  nodeName,
  nodePromptText,
  nodeRequest,
  pageAnswer,
  PAGE_REJECTED_MESSAGE,
  pageTitle,
  projectSlug,
  RESTART_STOP,
  SKETCH_REFUSAL,
  stepMessage,
  upstreamFailedLine,
  videoSettings,
  voiceOf,
  type CanvasRecord,
  type NodeCanvas,
  type NodeFacts,
  type PromptPart,
  type Slot,
  type VideoEntry,
  type VideoPropValue,
} from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Artifacts } from "../artifacts/layer.ts";
import { prepareArtifactHtml } from "../artifacts/artifactHtml.ts";
import { ensureBridge, writeNodePage } from "../artifacts/artifactStore.ts";
import { pinComponents } from "../artifacts/componentRegistry.ts";
import { CanvasRooms } from "../canvas/rooms.ts";
import { ensureTokens, kitOf } from "../kits/tokensFile.ts";
import { errorText, logError, logInfo } from "../log.ts";
import { MediaStore } from "../media/mediaStore.ts";
import { Catalogue } from "../openRouter/catalogue.ts";
import { chatRequestBody, completeText, type ReferencePart } from "../openRouter/text.ts";
import { VideoCatalogue } from "../openRouter/videoCatalogue.ts";
import { providerCatalogues } from "../runs/providers.ts";
import { fileStamp, mimeForFile, writeLoneSidecar, writeResultFile } from "../runs/resultFiles.ts";
import { Runs } from "../runs/runs.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import { Config } from "../services.ts";
import { SettingsStore } from "../settingsStore.ts";
import { RenderJobs } from "../video/renderJobs.ts";
import { applyNodeChange, dropVersion, fillVersion, finishRun, isNode, nodeOrigin, nodeSidecarFields, claimNodes, startVersions, stopNode, type NodeTarget } from "./versions.ts";

export const NODE_GONE = "There is no such node on this canvas.";
export const NODE_BUSY = (name: string) => `${name} is running. Wait for it to finish.`;
export const VERSION_RUNNING = "That version is still being made.";
export const VERSION_GONE = "That version is not on this node.";
const NO_SUCH_NODE = "That node is no longer on the canvas.";
export interface PlannedStep {
  readonly node: string;
  readonly name: string;
  readonly medium: NodeFacts["medium"];
  readonly model: string;
  readonly prompt: string;
  readonly references: ReadonlyArray<string>;
  readonly estimate: number | null;
  readonly paid: boolean;
}

export interface ChainHooks {
  readonly beforeStep?: (step: PlannedStep, index: number) => Promise<void>;
  readonly afterStep?: (step: PlannedStep, index: number, outcome: { readonly ok: boolean; readonly cost: number | null }) => void;
  readonly onStepStarted?: (step: PlannedStep, index: number) => void;
  readonly onFinished?: (outcome: { readonly ran: number; readonly total: number; readonly errors: ReadonlyArray<string> }) => void;
}

export interface ChainInput {
  readonly project: string;
  readonly ids: ReadonlyArray<string>;
  readonly downstream?: boolean | undefined;
  readonly scope?: "pending" | "all" | undefined;
  readonly rendered?: RenderedInputs | undefined;
  readonly chat?: RunChat | undefined;
  readonly agent?: boolean | undefined;
  readonly expect?: ReadonlyArray<string> | undefined;
  readonly hooks?: ChainHooks | undefined;
}

export class NodeRuns extends Context.Service<
  NodeRuns,
  {
    readonly plan: (input: ChainInput) => Effect.Effect<{ readonly steps: ReadonlyArray<PlannedStep> }, UnframedError>;
    readonly run: (input: ChainInput) => Effect.Effect<ChainStarted, UnframedError>;
    readonly useVersion: (project: string, shapeId: string, versionId: string) => Effect.Effect<Record<string, never>, UnframedError>;
    readonly removeVersion: (project: string, shapeId: string, versionId: string) => Effect.Effect<Record<string, never>, UnframedError>;
    readonly renders: (project: string, files: ReadonlyArray<string>) => Effect.Effect<{ renders: Record<string, string> }, UnframedError>;
  }
>()("unframed/engine/NodeRuns") {}

const isTextLike = (file: string) => /\.(html?|css|m?js|svg|json|txt|md)$/i.test(file);
export const newestRenders = async (folder: string, files: ReadonlyArray<string>): Promise<Map<string, string>> => {
  const wanted = new Set(files);
  const found = new Map<string, { file: string; at: string }>();
  if (wanted.size === 0) return new Map();
  const names = await readdir(folder).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const raw = await readFile(join(folder, name), "utf8").catch(() => "");
    if (!raw.includes('"render"')) continue;
    try {
      const sidecar = JSON.parse(raw) as { source?: unknown; of?: unknown; at?: unknown };
      if (sidecar.source !== "render" || typeof sidecar.of !== "string" || !wanted.has(sidecar.of)) continue;
      const file = name.replace(/\.json$/, ".mp4");
      const at = typeof sidecar.at === "string" ? sidecar.at : "";
      const known = found.get(sidecar.of);
      if (!known || known.at < at) found.set(sidecar.of, { file, at });
    } catch {
      continue;
    }
  }
  return new Map([...found].map(([of, entry]) => [of, entry.file]));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const nodeRunsLayer = Layer.effect(
  NodeRuns,
  Effect.gen(function* () {
    const rooms = yield* CanvasRooms;
    const runs = yield* Runs;
    const renderJobs = yield* RenderJobs;
    const media = yield* MediaStore;
    const settings = yield* SettingsStore;
    const catalogue = yield* Catalogue;
    const videoCatalogue = yield* VideoCatalogue;
    const artifacts = yield* Artifacts;
    const config = yield* Config;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    const liveRuns = new Set<string>();
    const liveChains = new Set<string>();

    const folderOf = async (project: string) => {
      const folder = await media.folder(project);
      if (folder === undefined) throw unframedError("not_found", `There is no project named "${projectSlug(project)}".`);
      return folder;
    };

    const readCanvas = async (project: string): Promise<{ records: ReadonlyArray<TLRecord>; canvas: NodeCanvas; folder: string }> => {
      const folder = await folderOf(project);
      const records = await runPromise(rooms.read(project));
      const shapes = canvasShapesOf(records as unknown as CanvasRecord[], shapeBoxes(records as TLRecord[]));
      const motions = shapes.filter((shape) => shape.kind === "motion" && shape.file !== undefined).map((shape) => shape.file!);
      const renders = await newestRenders(folder, motions);
      return { records, canvas: nodeCanvasOf(records as unknown as CanvasRecord[], shapes, renders), folder };
    };

    const catalogues = providerCatalogues({
      vercelOrigin: config.vercelOrigin,
      openRouter: (medium) => runPromise(medium === "image" ? catalogue.listImageModels : catalogue.listTextModels),
    });

    const LISTS: Record<NodeCatalogue, () => Promise<ReadonlyArray<ModelEntry>>> = {
      image: async () => (await runPromise(catalogue.listImageModels)).models,
      video: async () => (await runPromise(videoCatalogue.list)).models,
      text: async () => (await runPromise(catalogue.listTextModels)).models,
      audio: async () => [],
    };

    const models = async (node: NodeFacts): Promise<ReadonlyArray<ModelEntry>> => {
      const provider = nodeProvider(node);
      const list = provider === "openrouter" ? LISTS[nodeCatalogueOf(node.medium)]() : runPromise(settings.read).then((current) => catalogues[provider](current, node.medium as "image" | "text")).then((answer) => answer.models);
      return list.catch(() => []);
    };

    const DEFAULTS: Record<NodeCatalogue, "imageModel" | "videoModel" | "textModel" | "audioModel"> = { image: "imageModel", video: "videoModel", text: "textModel", audio: "audioModel" };

    const modelOf = async (node: NodeFacts): Promise<string> => {
      if (node.model !== "") return node.model;
      const current = await runPromise(settings.read);
      const provider = nodeProvider(node);
      return provider === "openrouter" ? current[DEFAULTS[nodeCatalogueOf(node.medium)]] : GENERATION_PROVIDERS[provider].defaultModel(current, node.medium as "image" | "text");
    };

    const entryOf = async (node: NodeFacts): Promise<ModelEntry | undefined> => {
      const model = await modelOf(node);
      return (await models(node)).find((each) => each.id === model);
    };

    const framesFor = async (canvas: NodeCanvas): Promise<(id: string) => ReadonlyArray<string>> => {
      const found = new Map<string, ReadonlyArray<string>>();
      for (const node of canvas.nodes.values()) if (node.medium === "video") found.set(node.id, frameImagesOf(await entryOf(node)));
      return (id) => found.get(id) ?? [];
    };

    interface Composed {
      readonly node: NodeFacts;
      readonly model: string;
      readonly entry: ModelEntry | undefined;
      readonly parts: ReadonlyArray<PromptPart>;
      readonly instruction: string;
      readonly references: ReadonlyArray<Slot>;
      readonly frames: ReadonlyArray<{ role: "first" | "last"; slot: Slot }>;
      readonly sources: ReadonlyArray<string>;
      readonly fingerprint: string;
    }

    const compose = async (canvas: NodeCanvas, id: string, assume: ReadonlySet<string>, agent: boolean, rendered: RenderedInputs): Promise<Composed | { error: string }> => {
      const node = canvas.nodes.get(id);
      if (!node) return { error: NODE_GONE };
      const provider = nodeProvider(node);
      if (provider !== "openrouter" && !GENERATION_PROVIDERS[provider].hasKey(providerKeysOf(await runPromise(settings.read)))) return { error: GENERATION_PROVIDERS[provider].noKeyMessage };
      const model = await modelOf(node);
      const entry = await entryOf(node);
      const referenceCap = node.medium === "image" ? modelParams(entry).referenceCap : undefined;
      const request = nodeRequest({ node, canvas, frames: frameImagesOf(entry), referenceCap, model, assume });
      if (!request.ok) return { error: request.message };
      const drawn = [...request.references, ...request.frames.map((frame) => frame.slot)].filter((slot) => slot.source.type === "composite" || slot.source.type === "sketch");
      if (drawn.some((slot) => rendered[slot.shapeId] === undefined)) return { error: agent ? SKETCH_REFUSAL : NODE_SKETCH_MESSAGE };
      const needsPicture = request.references.some((slot) => slot.source.type === "page");
      if (needsPicture && (await artifacts.findChrome()) === undefined && config.testRenderer !== "ok") return { error: NO_CHROME_RENDER_MESSAGE };
      return { node, model, entry, parts: request.parts, instruction: request.instruction, references: request.references, frames: request.frames, sources: request.sources, fingerprint: inputFingerprint(node, canvas) };
    };

    const pageHtml = async (folder: string, file: string, files: "entry" | "linked"): Promise<{ text: string; linked: string[] } | { error: string }> => {
      const html = await readFile(join(folder, file), "utf8").catch(() => undefined);
      if (html === undefined) return { error: `The page ${file} is no longer in the project folder.` };
      if (files === "entry") return { text: html, linked: [] };
      const names = await readdir(folder).catch(() => [] as string[]);
      const sizes = new Map<string, number>();
      for (const name of names) sizes.set(name, await stat(join(folder, name)).then((info) => info.size, () => 0));
      const linked = linkedFiles(html, sizes);
      if ("error" in linked) return { error: linked.error };
      const parts = [html];
      for (const name of linked.files) {
        if (!isTextLike(name)) continue;
        parts.push(`<!-- ${name} -->\n${await readFile(join(folder, name), "utf8").catch(() => "")}`);
      }
      return { text: parts.join("\n\n"), linked: [...linked.files] };
    };

    const capture = async (folder: string, file: string, files: "entry" | "linked", project: string): Promise<{ file: string } | { error: string }> => {
      const read = await pageHtml(folder, file, files);
      if ("error" in read) return read;
      const hash = createHash("sha256");
      hash.update(await readFile(join(folder, file)));
      for (const name of read.linked) hash.update(await readFile(join(folder, name)).catch(() => Buffer.alloc(0)));
      const pageHash = hash.digest("hex").slice(0, 32);
      for (const name of (await readdir(folder).catch(() => [] as string[])).filter((each) => /-capture-.*\.json$/.test(each)).sort().reverse()) {
        try {
          const sidecar = JSON.parse(await readFile(join(folder, name), "utf8")) as { of?: string; pageHash?: string; files?: string; viewport?: { w: number; h: number }; source?: string };
          if (sidecar.source === "capture" && sidecar.of === file && sidecar.pageHash === pageHash && sidecar.files === files && sidecar.viewport?.w === 1280 && sidecar.viewport.h === 800) {
            return { file: name.replace(/\.json$/, ".png") };
          }
        } catch {
          continue;
        }
      }
      let bytes: Buffer | undefined;
      if (config.testRenderer === "ok") bytes = Buffer.from(`capture of ${file} ${pageHash}`);
      else if (config.testRenderer === undefined) {
        const url = artifactUrl({ appHostname: "localhost", previewPort: (await runPromise(settings.view)).previewPort, project, file, kind: "page" });
        bytes = await artifacts.chrome.use(async (browser) => {
          const page = await browser.newPage();
          try {
            await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
            await page.goto(url, { waitUntil: "load", timeout: 20_000 });
            await sleep(500);
            return Buffer.from(await page.screenshot({ type: "png" }));
          } finally {
            await page.close().catch(() => undefined);
          }
        });
      }
      if (bytes === undefined) return { error: NO_CHROME_RENDER_MESSAGE };
      const base = await writeResultFile(folder, `${fileStamp(Date.now())}-capture-${projectSlug(file.replace(/\.html?$/i, "")) || "page"}`, "png", bytes);
      await writeLoneSidecar(folder, base, { kind: "capture", source: "capture", of: file, pageHash, files, viewport: { w: 1280, h: 800 }, createdAt: new Date().toISOString() }).catch(() => undefined);
      return { file: `${base}.png` };
    };
    const sentRefs = async (folder: string, project: string, composed: Composed, rendered: RenderedInputs) => {
      const one = async (slot: Slot): Promise<RecipeRef | { error: string }> => {
        switch (slot.source.type) {
          case "file":
            return { kind: slot.kind, file: slot.source.file };
          case "link":
            return { kind: "video", url: slot.source.url };
          case "page": {
            const taken = await capture(folder, slot.source.file, slot.source.files, project);
            return "error" in taken ? taken : { kind: "image", file: taken.file };
          }
          default:
            return rendered[slot.shapeId] ?? { error: SKETCH_REFUSAL };
        }
      };
      const references: RecipeRef[] = [];
      for (const slot of composed.references) {
        const ref = await one(slot);
        if ("error" in ref) return ref;
        references.push(ref);
      }
      const frames: Array<{ role: "first" | "last"; ref: RecipeRef }> = [];
      for (const frame of composed.frames) {
        const ref = await one(frame.slot);
        if ("error" in ref) return ref;
        frames.push({ role: frame.role, ref });
      }
      return { references, frames };
    };

    const promptOf = async (folder: string, composed: Composed): Promise<{ prompt: string; selectionPrompt: string } | { error: string }> => {
      const pages = new Map<string, string>();
      for (const part of composed.parts) {
        if (part.type !== "page") continue;
        const read = await pageHtml(folder, part.file, part.files);
        if ("error" in read) return read;
        pages.set(part.wireId, read.text);
      }
      const text = (part: Extract<PromptPart, { type: "page" }>) => pages.get(part.wireId) ?? "";
      return { prompt: nodePromptText(composed.parts, composed.instruction, text), selectionPrompt: nodePromptText(composed.parts, "", text) };
    };

    const estimateOf = async (composed: Composed): Promise<number | null> => {
      const { node } = composed;
      if (nodeProvider(node) !== "openrouter") return node.medium === "image" ? nodeListEstimate({ entry: composed.entry, runs: node.runs }) : null;
      if (node.medium === "image") {
        const pricing = await runPromise(catalogue.imagePricing(composed.model)).catch(() => undefined);
        if (!pricing) return null;
        return nodeImageEstimate({ endpoints: pricing.endpoints, params: node.params, referenceImages: composed.references.filter((slot) => slot.kind === "image").length, runs: node.runs });
      }
      if (node.medium === "video") {
        const settingsOf = videoSettings(composed.entry as VideoEntry | undefined, node.params as Record<string, VideoPropValue>);
        return estimateVideo({ pricing: composed.entry?.pricing, resolution: settingsOf.resolution, duration: settingsOf.duration });
      }
      return null;
    };

    const stepOf = async (canvas: NodeCanvas, composed: Composed): Promise<PlannedStep> => ({
      node: composed.node.id,
      name: nodeName(canvas, composed.node.id),
      medium: composed.node.medium,
      model: composed.model,
      prompt: nodePromptText(composed.parts, composed.instruction, (part) => `[the HTML of ${part.file}]`),
      references: composed.references.map((slot) => `${slot.kind} ${slot.number}`),
      estimate: await estimateOf(composed),
      paid: isPaidMedium(composed.node.medium),
    });
    const validate = async (input: ChainInput): Promise<{ canvas: NodeCanvas; folder: string; steps: string[]; planned: PlannedStep[] }> => {
      const { canvas, folder } = await readCanvas(input.project);
      for (const id of input.ids) if (!canvas.nodes.has(id) && canvas.shapes.find((shape) => shape.id === id)?.kind !== "group") throw unframedError("not_found", NODE_GONE);
      const plan = chainStepsOf(canvas, input.ids, input.downstream === true ? (input.scope ?? "pending") : undefined, await framesFor(canvas));
      if (!plan.ok) throw unframedError("bad_request", plan.message);
      if (input.downstream === true && input.ids.length === 1 && plan.steps[0] !== input.ids[0]) throw unframedError("bad_request", NODE_FIRST_MESSAGE);
      if (input.expect !== undefined && input.expect.join(" ") !== plan.steps.join(" ")) throw unframedError("bad_request", CHAIN_CHANGED_MESSAGE);
      const planned: PlannedStep[] = [];
      for (const [index, id] of plan.steps.entries()) {
        const composed = await compose(canvas, id, new Set(plan.steps.slice(0, index)), input.agent === true, input.rendered ?? {});
        if ("error" in composed) throw unframedError("bad_request", plan.steps.length === 1 ? composed.error : stepMessage(index + 1, nodeName(canvas, id), composed.error));
        planned.push(await stepOf(canvas, composed));
      }
      return { canvas, folder, steps: [...plan.steps], planned };
    };

    type StepOutcome = { readonly ok: true; readonly cost: number | null } | { readonly ok: false; readonly error: string; readonly cost: number | null };
    const failed = (error: string): StepOutcome => ({ ok: false, error, cost: null });

    const pageRun = async (project: string, folder: string, composed: Composed, refs: ReadonlyArray<RecipeRef>, prompt: string, selectionPrompt: string, target: NodeTarget): Promise<StepOutcome> => {
      const current = await runPromise(settings.read);
      if (current.key === "") return failed(NO_KEY_MESSAGE);
      const startedAt = Date.now();
      const runId = `run-${startedAt}-${randomUUID().slice(0, 8)}`;
      const batchId = `b-${startedAt}`;
      let versionId: string | undefined;
      await applyNodeChange(
        rooms,
        runPromise,
        project,
        (get) => {
          const made = startVersions(get, target.shapeId, { runId, chainId: target.chainId, claim: target.claim, batchId, count: 1, fingerprint: target.fingerprint, startedAt });
          versionId = made?.ids[0];
          return made?.change;
        },
        runId,
      );
      if (versionId === undefined) return failed(NO_SUCH_NODE);
      const id = versionId;
      liveRuns.add(runId);
      try {
        const inlined: ReferencePart[] = [];
        for (const ref of refs) {
          const url = "url" in ref ? ref.url : `data:${mimeForFile(ref.file)};base64,${(await readFile(join(folder, ref.file))).toString("base64")}`;
          inlined.push(ref.kind === "video" ? { type: "video_url", video_url: { url } } : { type: "image_url", image_url: { url } });
        }
        const outcome = await completeText(config.openRouterOrigin, current.key, chatRequestBody(composed.model, prompt, inlined, NODE_PAGE_SYSTEM));
        let error: string | undefined;
        const cost = outcome.ok ? outcome.cost : null;
        if (!outcome.ok) error = outcome.error;
        else {
          const answer = pageAnswer(outcome.text);
          const recipe: ResultRecipe = {
            medium: "text",
            model: composed.model,
            params: {},
            selectionPrompt,
            instruction: composed.instruction,
            references: [...refs],
            sources: [...composed.sources],
            ...nodeSidecarFields(target, id),
          };
          if (answer.ok) {
            const records = await runPromise(rooms.read(project));
            const html = (await pinComponents(folder, records, prepareArtifactHtml(answer.html, "page"))).html;
            await ensureBridge(folder);
            await ensureTokens(folder, kitOf(records));
            const title = pageTitle(html) ?? "";
            const written = await writeNodePage(folder, {
              html,
              stamp: fileStamp(startedAt),
              slug: projectSlug(title || prompt).slice(0, 48),
              sidecar: {
                kind: "page",
                source: "node",
                title,
                prompt,
                model: composed.model,
                cost: outcome.cost,
                recipe,
                ...(nodeSidecarFields(target, id) as { node: { shapeId: string; versionId: string } }),
                batchId,
                runIndex: 1,
                runCount: 1,
                createdAt: new Date().toISOString(),
              },
            });
            logInfo(`page →  ${join(folder, written.file)}${outcome.cost === null ? "" : `  ($${outcome.cost.toFixed(4)})`}`);
            await applyNodeChange(rooms, runPromise, project, (get) => fillVersion(get, target.shapeId, id, { file: written.file, fileName: title || written.file }), runId);
          } else {
            const base = `${fileStamp(startedAt)}-page-rejected`;
            const saved = await writeResultFile(folder, base, "txt", Buffer.from(outcome.text, "utf8"));
            await writeLoneSidecar(folder, saved, { kind: "page", source: "node", rejected: true, prompt, model: composed.model, cost: outcome.cost, recipe, ...nodeSidecarFields(target, id), createdAt: new Date().toISOString(), file: `${saved}.txt` });
            error = `${PAGE_REJECTED_MESSAGE} The answer is in ${saved}.txt.`;
          }
        }
        if (error !== undefined) await applyNodeChange(rooms, runPromise, project, (get) => dropVersion(get, target.shapeId, id), runId);
        await applyNodeChange(rooms, runPromise, project, (get) => finishRun(get, target.shapeId, runId, error === undefined ? [] : [error]), runId);
        return error === undefined ? { ok: true, cost } : { ok: false, error, cost };
      } catch (caught) {
        const error = errorText(caught);
        await applyNodeChange(rooms, runPromise, project, (get) => dropVersion(get, target.shapeId, id), runId);
        await applyNodeChange(rooms, runPromise, project, (get) => finishRun(get, target.shapeId, runId, [error]), runId);
        return failed(error);
      } finally {
        liveRuns.delete(runId);
      }
    };

    interface StepRun {
      readonly project: string;
      readonly composed: Composed;
      readonly prompt: string;
      readonly selectionPrompt: string;
      readonly references: ReadonlyArray<RecipeRef>;
      readonly frames: ReadonlyArray<{ role: "first" | "last"; ref: RecipeRef }>;
      readonly into: NodeTarget;
      readonly input: ChainInput;
      readonly box: { x: number; y: number; w: number; h: number };
      readonly done: (outcome: StepOutcome) => void;
    }

    const IMAGE_PARAMS = new Set(["quality", "background", "resolution", "aspect_ratio", "size", "output_format"]);
    const chatOf = (input: ChainInput) => (input.chat === undefined ? {} : { chat: input.chat });
    const fileUrlOf = (ref: RecipeRef) => ("url" in ref ? ref.url : `project-file:${ref.file}`);

    const STARTERS: Record<"image" | "text" | "audio" | "video", (run: StepRun) => Promise<string>> = {
      image: async ({ project, composed, prompt, selectionPrompt, references, into, input, box }) => {
        const params = Object.fromEntries(Object.entries(composed.node.params).filter(([key]) => IMAGE_PARAMS.has(key)).map(([key, value]) => [key, String(value)]));
        const outputs = Array.from({ length: Math.min(10, Math.max(1, composed.node.runs ?? 1)) }, () => ({ prompt, references: [...references] }));
        const request = { project, model: composed.model, params, selectionPrompt, instruction: composed.instruction, outputs, sources: [...composed.sources], anchor: box, ...chatOf(input), ...providerField(nodeProvider(composed.node)) };
        return (await runPromise(runs.image(request, into))).runId;
      },
      text: async ({ project, composed, prompt, selectionPrompt, references, into, input, box }) => {
        const request = { project, model: composed.model, selectionPrompt, instruction: composed.instruction, prompt, references: [...references], sources: [...composed.sources], anchor: box, ...chatOf(input), ...providerField(nodeProvider(composed.node)) };
        return (await runPromise(runs.text(request, into))).runId;
      },
      audio: async ({ project, composed, prompt, selectionPrompt, into, box }) => {
        const voice = voiceOf(composed.node.params);
        if (voice === undefined) throw unframedError("bad_request", "Pick a voice for this line.");
        const request = { project, model: composed.model, voice, params: audioRunParams(composed.node.params) as never, selectionPrompt, instruction: composed.instruction, prompt, sources: [...composed.sources], anchor: box };
        return (await runPromise(runs.audio(request, into))).runId;
      },
      video: async ({ project, composed, prompt, selectionPrompt, references, frames, into, input, box, done }) => {
        const props = composed.node.params as Record<string, VideoPropValue>;
        const chosen = videoSettings(composed.entry as VideoEntry | undefined, props);
        const request = {
          project,
          prompt,
          input_references: references.map((ref) => (ref.kind === "video" ? { type: "video_url", video_url: { url: fileUrlOf(ref) } } : { type: "image_url", image_url: { url: fileUrlOf(ref) } })),
          frame_images: frames.map((frame) => ({ type: "image_url", image_url: { url: fileUrlOf(frame.ref) }, frame_type: frame.role === "first" ? "first_frame" : "last_frame" })),
          model: composed.model,
          ...chosen,
          shareLocalVideos: input.agent !== true && props.shareLocalVideos !== false,
          landing: box,
          recipe: {
            medium: "video",
            model: composed.model,
            params: { inputMode: frames.length > 0 ? (frames.length > 1 ? "first_last" : "first_frame") : "reference", ...chosen },
            selectionPrompt,
            instruction: composed.instruction,
            references: [...references, ...frames.map((frame) => frame.ref)],
            sources: [...composed.sources],
          } as ResultRecipe,
        } as VideoStartRequest;
        const job = await runPromise(renderJobs.start(request, into));
        renderJobs.onFinished(job.jobId, (outcome) => done(outcome.ok ? { ok: true, cost: outcome.cost } : failed("The render failed.")));
        return job.jobId;
      },
    };

    const runStep = async (project: string, folder: string, composed: Composed, rendered: RenderedInputs, target: NodeTarget, input: ChainInput, box: { x: number; y: number; w: number; h: number }): Promise<StepOutcome> => {
      const prompted = await promptOf(folder, composed);
      if ("error" in prompted) return failed(prompted.error);
      const sent = await sentRefs(folder, project, composed, rendered);
      if ("error" in sent) return failed(sent.error);
      const medium = composed.node.medium;
      if (medium === "page") return pageRun(project, folder, composed, sent.references, prompted.prompt, prompted.selectionPrompt, target);
      return new Promise<StepOutcome>((resolve) => {
        let settled = false;
        let live: string | undefined;
        const done = (outcome: StepOutcome) => {
          if (settled) return;
          settled = true;
          if (live !== undefined) liveRuns.delete(live);
          resolve(outcome);
        };
        const into: NodeTarget = { ...target, onFinished: ({ succeeded, errors, cost }) => done(succeeded > 0 ? { ok: true, cost } : failed(errors.join("; ") || "The run did not land.")) };
        STARTERS[medium]({ project, composed, prompt: prompted.prompt, selectionPrompt: prompted.selectionPrompt, references: sent.references, frames: sent.frames, into, input, box, done }).then(
          (runId) => {
            if (settled) return;
            live = runId;
            liveRuns.add(runId);
          },
          (error: unknown) => done(failed(error instanceof UnframedError ? error.message : errorText(error))),
        );
      });
    };

    const nodeBox = (records: ReadonlyArray<TLRecord>, id: string) => shapeBoxes(records as TLRecord[]).get(id)?.page ?? { x: 0, y: 0, w: 0, h: 0 };

    const execute = async (input: ChainInput, chainId: string, steps: ReadonlyArray<string>, planned: ReadonlyArray<PlannedStep>, folder: string) => {
      const { project } = input;
      const errors: string[] = [];
      let ran = 0;
      let failedAt = -1;
      let failedName = "";
      let at = 0;
      const fail = async (index: number, name: string, error: string) => {
        errors.push(error);
        failedAt = index;
        failedName = name;
        await applyNodeChange(
          rooms,
          runPromise,
          project,
          (get) => {
            const node = get(steps[index]!);
            if (!isNode(node) || node.props.error !== undefined || (node.props.run !== undefined && node.props.run.runId !== "")) return undefined;
            return stopNode(get, steps[index]!, error);
          },
          chainId,
        );
      };
      try {
        for (const [index, id] of steps.entries()) {
          at = index;
          const { records, canvas } = await readCanvas(project);
          const step = planned[index]!;
          const composed = await compose(canvas, id, new Set(), input.agent === true, input.rendered ?? {});
          if ("error" in composed) {
            await fail(index, nodeName(canvas, id), composed.error);
            break;
          }
          try {
            await input.hooks?.beforeStep?.(step, index);
          } catch (error) {
            await fail(index, nodeName(canvas, id), errorText(error));
            break;
          }
          input.hooks?.onStepStarted?.(step, index);
          const outcome = await runStep(project, folder, composed, input.rendered ?? {}, { shapeId: id, claim: chainId, chainId: steps.length > 1 ? chainId : null, step: index + 1, fingerprint: composed.fingerprint }, input, nodeBox(records, id));
          input.hooks?.afterStep?.(step, index, { ok: outcome.ok, cost: outcome.cost });
          if (!outcome.ok) {
            await fail(index, nodeName(canvas, id), outcome.error);
            break;
          }
          ran++;
        }
      } catch (error) {
        logError(`${chainId}: ${errorText(error)}`);
        if (failedAt < 0) await fail(at, planned[at]?.name ?? steps[at]!, errorText(error)).catch(() => undefined);
      } finally {
        for (const [index, id] of steps.entries()) {
          if (index <= failedAt || (failedAt < 0 && index < ran)) continue;
          const reason = failedAt >= 0 ? upstreamFailedLine(failedName) : RESTART_STOP;
          await applyNodeChange(rooms, runPromise, project, (get) => stopNode(get, id, reason, chainId), chainId);
        }
        liveChains.delete(chainId);
        input.hooks?.onFinished?.({ ran, total: steps.length, errors });
        if (steps.length > 1) await runPromise(runs.publish(project, { type: "chainFinished", runId: chainId, chainId, ran, total: steps.length, errors }));
      }
    };

    const run = (input: ChainInput) =>
      Effect.tryPromise({
        try: async () => {
          const { steps, planned, folder, canvas } = await validate(input);
          const chainId = `chain-${Date.now()}-${randomUUID().slice(0, 8)}`;
          liveChains.add(chainId);
          let busy: string | undefined;
          await runPromise(
            rooms.applyWhen(
              input.project,
              (get) => {
                const claimed = claimNodes(get, steps, chainId, Date.now());
                if ("busy" in claimed) {
                  busy = claimed.busy;
                  return undefined;
                }
                return claimed.change;
              },
              nodeOrigin(chainId),
            ),
          );
          if (busy !== undefined) {
            liveChains.delete(chainId);
            throw unframedError("bad_request", NODE_BUSY(nodeName(canvas, busy)));
          }
          if (steps.length > 1) await runPromise(runs.publish(input.project, { type: "chain", runId: chainId, chainId, nodes: steps }));
          void execute(input, chainId, steps, planned, folder).catch((error: unknown) => logError(`${chainId}: ${errorText(error)}`));
          return { chainId, nodes: steps };
        },
        catch: (error) => (error instanceof UnframedError ? error : unframedError("internal", errorText(error))),
      });

    const plan = (input: ChainInput) =>
      Effect.tryPromise({
        try: async () => ({ steps: (await validate(input)).planned }),
        catch: (error) => (error instanceof UnframedError ? error : unframedError("internal", errorText(error))),
      });

    const versionOp = (project: string, shapeId: string, versionId: string, decide: (version: NodeVersion, versions: ReadonlyArray<NodeVersion>) => Record<string, unknown> | string) =>
      Effect.gen(function* () {
        let refusal: { code: "not_found" | "bad_request"; message: string } | undefined;
        yield* rooms.applyWhen(
          project,
          (get) => {
            const node = get(shapeId);
            if (!isNode(node)) {
              refusal = { code: "not_found", message: NODE_GONE };
              return undefined;
            }
            const version = node.props.versions.find((each) => each.id === versionId);
            if (!version) {
              refusal = { code: "not_found", message: VERSION_GONE };
              return undefined;
            }
            const decided = decide(version, node.props.versions);
            if (typeof decided === "string") {
              refusal = { code: "bad_request", message: decided };
              return undefined;
            }
            return { put: [{ ...node, props: { ...node.props, ...decided } } as unknown as TLRecord], remove: [] };
          },
          { kind: "server", id: `node:${shapeId}` },
        );
        if (refusal) return yield* unframedError(refusal.code, refusal.message);
        return {} as Record<string, never>;
      });

    const useVersion = (project: string, shapeId: string, versionId: string) =>
      versionOp(project, shapeId, versionId, (version) => (version.status !== "done" || version.error !== undefined ? VERSION_RUNNING : { currentVersionId: versionId }));

    const removeVersion = (project: string, shapeId: string, versionId: string) =>
      versionOp(project, shapeId, versionId, (version, versions) => {
        if (version.status === "running") return VERSION_RUNNING;
        const rest = versions.filter((each) => each.id !== versionId);
        return { versions: rest, currentVersionId: rest.find((each) => each.status === "done" && each.error === undefined)?.id ?? null };
      });

    const renders = (project: string, files: ReadonlyArray<string>) =>
      Effect.tryPromise({
        try: async () => ({ renders: Object.fromEntries(await newestRenders(await folderOf(project), files)) }),
        catch: (error) => (error instanceof UnframedError ? error : unframedError("internal", errorText(error))),
      });
    yield* rooms.afterOpen((project, room) => {
      const put: TLRecord[] = [];
      for (const record of room.read()) {
        if (!isNode(record)) continue;
        const marker = record.props.run;
        const stale = record.props.versions.filter((version) => version.status === "running" && version.durable !== true && !liveRuns.has(version.runId));
        const queued = marker !== undefined && marker.runId === "" && !liveChains.has(marker.chainId ?? "");
        const deadRun = marker !== undefined && marker.runId !== "" && !liveRuns.has(marker.runId) && !record.props.versions.some((version) => version.runId === marker.runId && version.durable === true);
        if (stale.length === 0 && !queued && !deadRun) continue;
        const versions = record.props.versions.filter((version) => !stale.includes(version));
        const props: Record<string, unknown> = { ...record.props, versions };
        if (queued || deadRun) delete props.run;
        if (queued) props.error = RESTART_STOP;
        if (props.currentVersionId !== null && !versions.some((version) => version.id === props.currentVersionId)) props.currentVersionId = versions.find((version) => version.status === "done" && version.error === undefined)?.id ?? null;
        put.push({ ...record, props } as unknown as TLRecord);
      }
      if (put.length > 0) room.change({ put, remove: [] }, { kind: "server", id: `nodes:boot:${project}` });
    });

    yield* rooms.afterCommit((_project, change, room) => {
      if (change.removed.length === 0 && !change.put.some((id) => (change.records.get(id) as { type?: string } | undefined)?.type === "wire")) return;
      const orphans = room
        .read()
        .filter((record) => record.typeName === "shape" && (record as { type?: string }).type === "wire")
        .filter((record) => {
          const ends = (record as unknown as { props: { from?: string; to?: string } }).props;
          return room.get(String(ends.from)) === undefined || room.get(String(ends.to)) === undefined;
        })
        .map((record) => record.id);
      if (orphans.length > 0) room.change({ put: [], remove: orphans }, { kind: "server", id: "wires:ends" });
    });

    return NodeRuns.of({ plan, run, useVersion, removeVersion, renders });
  }),
);
