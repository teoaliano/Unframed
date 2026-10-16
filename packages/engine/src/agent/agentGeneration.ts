import { randomUUID } from "node:crypto";
import type { TLRecord } from "@tldraw/tlschema";
import type { ImagePricingAnswer, ImageRunRequest, ModelEntry, RecipeRef, ResultRecipe, RunEvent, TextRunRequest, VideoStartRequest } from "@unframed/contracts";
import {
  canvasShapesOf,
  composeVideoRequest,
  estimateImageRun,
  estimateVideo,
  formatEstimate,
  formatVideoEstimate,
  LOCAL_CLIP_REFUSAL,
  modelParams,
  planAgentRun,
  recipeParams,
  renderLanding,
  roomShapeId,
  spendRefusal,
  TEXT_PARAMS_REFUSAL,
  unsupportedParam,
  VIDEO_RUNS_REFUSAL,
  videoSettings,
  type VideoSettings,
  type AgentRunPlan,
  type CanvasRecord,
  videoParams,
  type VideoEntry,
  type VideoPropValue,
} from "@unframed/domain";
import type { ConnectionBook } from "../agentConnections/book.ts";
import { errorText } from "../log.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import type { FinishHandler } from "../video/renderJobs.ts";
import type { ToolAnswer } from "./mcp.ts";

type Plan = Extract<AgentRunPlan, { ok: true }>;
/** A run as the run services acknowledge it. */
interface RunStarted {
  readonly runId: string;
  readonly batchId: string;
  readonly placeholders: ReadonlyArray<string>;
}
type Box = { x: number; y: number; w: number; h: number };
type Param = string | number | boolean;
type Kind = "image" | "video";
/** A video run's request and what it was composed from, or the refusal that stops it. */
type VideoPlan = { request: VideoStartRequest; settings: VideoSettings; plan: Plan } | { error: string };

const videoOf = (entry: ModelEntry | undefined) => videoParams(entry as VideoEntry | undefined);

/** What the generation needs from the rest of the engine. */
export interface GenerationHost {
  readonly records: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  /** The record of each id, as it is now (`undefined` when the canvas holds none). */
  readonly recordsOf: (project: string, ids: ReadonlyArray<string>) => Promise<Map<string, TLRecord | undefined>>;
  readonly runImage: (request: ImageRunRequest) => Promise<RunStarted>;
  readonly runText: (request: TextRunRequest) => Promise<RunStarted>;
  /** Starts a render job (spec 04): its placeholder is in the room when this answers. */
  readonly startVideo: (request: VideoStartRequest) => Promise<{ jobId: string; status: string; shapeId: string }>;
  /** Calls the handler once when the render job lands or ends without a clip (spec 04). */
  readonly onVideoFinished: (jobId: string, handler: FinishHandler) => () => void;
  /** The models of a kind, as the catalogue lists them. */
  readonly models: (kind: Kind) => Promise<ReadonlyArray<ModelEntry>>;
  readonly defaultModel: (kind: Kind) => Promise<string>;
  readonly pricing: (model: string) => Promise<ImagePricingAnswer>;
  /** Every run event of a project, until the returned function is called. */
  readonly track: (project: string, handler: (event: RunEvent) => void) => () => void;
  readonly book: ConnectionBook;
  /** Records a turn change of the chat: `before` empty for a created shape. */
  readonly recordTurn: (project: string, chatId: string, turn: number, before: Map<string, TLRecord | undefined>, after: Map<string, TLRecord | undefined>) => Promise<void>;
  /** The chat's outside turn holds: a paid run in flight keeps it open. */
  readonly holds: { runStarted(chatId: string): void; runEnded(chatId: string): void };
}

export interface GenerateCall {
  readonly project: string;
  readonly chatId: string;
  /** The open turn the run belongs to. */
  readonly turn: number;
  /** The outside connection whose spend limit applies. An in-app call has none. */
  readonly connectionId?: string | undefined;
  readonly medium: "image" | "video" | "text";
  /** Agent ids, as canvas_read names them. */
  readonly sources: ReadonlyArray<string>;
  readonly instruction: string;
  /** The model's parameters, as the composer's tray takes them. Text takes none. */
  readonly params: Readonly<Record<string, Param>>;
  /** Outputs of one image batch, 1 to 10. Text and video run once. */
  readonly runs: number;
  readonly dryRun: boolean;
  readonly model?: string | undefined;
}

const refusal = (message: string): ToolAnswer => ({ value: { error: message }, isError: true });

/** The union of the boxes: the anchor a run's results land beside (spec 03). */
const union = (boxes: ReadonlyArray<Box>): Box => {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

/** The string form a model's estimate takes its chosen values as. */
const chosenOf = (params: Readonly<Record<string, Param>>): { quality?: string; resolution?: string } => ({
  ...(params.quality === undefined ? {} : { quality: String(params.quality) }),
  ...(params.resolution === undefined ? {} : { resolution: String(params.resolution) }),
});

/**
 * `generate` (spec 14, "Generation by agents"): one paid run through the composer's own run
 * services. The refusals are the composer's sentences, plus the sketch, parameter, clip and
 * spend limit's.
 */
export class AgentGeneration {
  private readonly host: GenerationHost;
  /** Each run's landed outputs' costs, by run id, until the run finishes. */
  private readonly costs = new Map<string, Array<number | null>>();
  /** Each placeholder as the run created it: the "before" of its fill. */
  private readonly placeholders = new Map<string, TLRecord | undefined>();

  constructor(host: GenerationHost) {
    this.host = host;
  }

  async generate(call: GenerateCall): Promise<ToolAnswer> {
    if (call.medium === "text" && Object.keys(call.params).length > 0) return refusal(TEXT_PARAMS_REFUSAL);
    if (call.medium === "video" && call.runs !== 1) return refusal(VIDEO_RUNS_REFUSAL);
    const records = await this.host.records(call.project);
    const shapes = canvasShapesOf(records as unknown as CanvasRecord[], shapeBoxes(records as TLRecord[]));
    const sources = call.sources.map((id) => roomShapeId(id));
    const plan = planAgentRun({ shapes, sources, instruction: call.instruction, medium: call.medium });
    if (!plan.ok) return refusal(plan.message);

    const kind: Kind | undefined = call.medium === "text" ? undefined : call.medium;
    const model = kind === undefined ? undefined : (call.model ?? (await this.host.defaultModel(kind)));
    const entry = kind === undefined || model === undefined ? undefined : await this.entryFor(kind, model);
    if (entry === "unknown") return refusal(`Unframed has no ${kind} model called "${model}".`);
    const known = entry;

    if (kind === "image" && model !== undefined) {
      const refused = unsupportedParam(model, call.params, modelParams(known as Parameters<typeof modelParams>[0]).supported);
      if (refused !== undefined) return refusal(refused);
    }
    if (kind === "video" && model !== undefined) {
      const refused = unsupportedParam(model, call.params, (key, value) => videoOf(known).supported(key, value));
      if (refused !== undefined) return refusal(refused);
    }

    const video = kind === "video" && model !== undefined ? this.videoRequest(plan, known, call, shapes, model) : undefined;
    if (video !== undefined && "error" in video) return refusal(video.error);
    const estimate = kind === undefined || model === undefined ? null : await this.estimateFor(kind, model, plan, known, call, video);
    const spend = call.connectionId === undefined ? undefined : this.host.book.spendOf(call.connectionId);

    if (call.dryRun) {
      return {
        value: {
          dryRun: true,
          prompt: plan.prompt,
          references: plan.references,
          estimate: estimate === null ? null : estimate.label,
          spendLimit: spend === undefined || spend.limit === null ? null : { usd: spend.limit.usd, period: spend.limit.period, spent: spend.spent },
        },
      };
    }
    if (spend !== undefined) {
      const refused = spendRefusal({ limit: spend.limit, spent: spend.spent, reserved: 0, estimate: estimate?.total ?? null });
      if (refused !== undefined) return refusal(refused);
    }

    const ledgerKey = call.connectionId === undefined ? undefined : `${call.chatId}:${randomUUID()}`;
    if (ledgerKey !== undefined && call.connectionId !== undefined) await this.host.book.reserve(call.connectionId, ledgerKey, estimate?.total ?? 0);

    if (kind === "video" && video !== undefined && !("error" in video)) {
      return this.startVideoRun(call, video.request, ledgerKey, estimate);
    }

    const anchor = union(shapes.filter((shape) => sources.includes(shape.id)).map((shape) => shape.bounds));
    const events: RunEvent[] = [];
    let runId: string | undefined;
    let stopTracking: (() => void) | undefined;
    const onEvent = (event: RunEvent) => this.onEvent(call, ledgerKey, estimate?.each ?? null, event, () => stopTracking?.());
    stopTracking = this.host.track(call.project, (event) => (runId === undefined ? events.push(event) : onEvent(event)));

    let started: RunStarted;
    try {
      started =
        model === undefined || kind === undefined
          ? await this.host.runText(this.textRequest(call, plan, anchor))
          : await this.host.runImage(this.imageRequest(call, plan, model, anchor));
    } catch (error) {
      stopTracking();
      if (ledgerKey !== undefined && call.connectionId !== undefined) await this.host.book.release(call.connectionId, ledgerKey);
      return refusal(errorText(error));
    }
    runId = started.runId;
    this.host.holds.runStarted(call.chatId);
    const placed = await this.host.recordsOf(call.project, started.placeholders.map((id) => roomShapeId(id)));
    for (const [id, record] of placed) this.placeholders.set(id, record);
    await this.host.recordTurn(call.project, call.chatId, call.turn, new Map(), placed);
    for (const event of events.splice(0)) if (event.runId === runId) onEvent(event);

    return {
      value: {
        runId: started.runId,
        batchId: started.batchId,
        placeholders: started.placeholders.map((id) => id.replace(/^shape:/, "")),
        estimate: estimate === null ? null : estimate.label,
        status: "running",
      },
    };
  }

  /** The catalogue entry of a model, `undefined` when the catalogue does not list it, `"unknown"` when it lists others and not this one. */
  private async entryFor(kind: Kind, model: string): Promise<ModelEntry | "unknown" | undefined> {
    const models = await this.host.models(kind);
    if (models.length === 0) return undefined;
    return models.find((candidate) => candidate.id === model) ?? "unknown";
  }

  /**
   * A video request composed from the shapes, or the refusal that stops it. Video references are
   * project files and links, which go as they are; a local clip needs a share link the agent cannot give.
   */
  private videoRequest(plan: Plan, entry: ModelEntry | undefined, call: GenerateCall, shapes: ReadonlyArray<{ id: string; bounds: Box }>, model: string): VideoPlan {
    if (plan.references.some((ref) => "file" in ref && ref.kind === "video")) return { error: LOCAL_CLIP_REFUSAL };
    const props = call.params as Readonly<Record<string, VideoPropValue>>;
    const composed = composeVideoRequest({ composition: plan.composition, entry: entry as VideoEntry | undefined, props });
    const settings = videoSettings(entry as VideoEntry | undefined, props);
    const anchor = union(shapes.filter((shape) => plan.sources.includes(shape.id)).map((shape) => shape.bounds));
    const { prompt, input_references, frame_images } = composed.request;
    return {
      request: {
        project: call.project,
        prompt,
        input_references,
        frame_images,
        model,
        ...settings,
        shareLocalVideos: false,
        landing: renderLanding(anchor, shapes.map((shape) => shape.bounds), settings),
        recipe: {
          medium: "video",
          model,
          params: recipeParams(composed.mode, settings, false),
          selectionPrompt: plan.selectionPrompt,
          instruction: plan.instruction,
          references: plan.references.map((ref) => ({ ...ref }) as RecipeRef),
          sources: [...plan.sources],
        } as ResultRecipe,
      },
      settings,
      plan,
    };
  }

  /** The estimate of a run (the composer's text) and its total, or `null` when no exact price exists. */
  private async estimateFor(
    kind: Kind,
    model: string,
    plan: Plan,
    entry: ModelEntry | undefined,
    call: GenerateCall,
    video: VideoPlan | undefined,
  ): Promise<{ each: number; total: number; label: string } | null> {
    if (kind === "video") {
      if (video === undefined || "error" in video) return null;
      const each = estimateVideo({ pricing: entry?.pricing, resolution: video.settings.resolution, duration: video.settings.duration });
      return each === null ? null : { each, total: each, label: formatVideoEstimate(each) };
    }
    const pricing = await this.host.pricing(model).catch(() => undefined);
    if (pricing === undefined) return null;
    const referenceImages = plan.references.filter((ref) => "file" in ref && ref.kind === "image").length;
    const each = estimateImageRun({ endpoints: pricing.endpoints, chosen: chosenOf(call.params), referenceImages, outputs: 1 });
    return each === null ? null : { each, total: each * call.runs, label: `${formatEstimate(each)} each` };
  }

  /** One render job: its placeholder answers at once, its fill and ledger follow when it finishes. */
  private async startVideoRun(
    call: GenerateCall,
    request: VideoStartRequest,
    ledgerKey: string | undefined,
    estimate: { each: number; total: number; label: string } | null,
  ): Promise<ToolAnswer> {
    let started: { jobId: string; status: string; shapeId: string };
    try {
      started = await this.host.startVideo(request);
    } catch (error) {
      if (ledgerKey !== undefined && call.connectionId !== undefined) await this.host.book.release(call.connectionId, ledgerKey);
      return refusal(errorText(error));
    }
    this.host.holds.runStarted(call.chatId);
    const placed = await this.host.recordsOf(call.project, [started.shapeId]);
    for (const [id, record] of placed) this.placeholders.set(id, record);
    await this.host.recordTurn(call.project, call.chatId, call.turn, new Map(), placed);
    this.host.onVideoFinished(started.jobId, (outcome) => {
      const each = estimate?.each ?? null;
      if (ledgerKey !== undefined && call.connectionId !== undefined) {
        if (!outcome.ok) void this.host.book.release(call.connectionId, ledgerKey);
        // A cost the upstream did not report counts at the estimate, so the ledger never reads low.
        else void this.host.book.settle(call.connectionId, ledgerKey, outcome.cost ?? each ?? 0);
      }
      const before = new Map([[started.shapeId, this.placeholders.get(started.shapeId)]]);
      void this.host
        .recordsOf(call.project, [started.shapeId])
        .then((after) => this.host.recordTurn(call.project, call.chatId, call.turn, before, after))
        .finally(() => this.host.holds.runEnded(call.chatId));
    });
    return {
      value: {
        runId: started.jobId,
        batchId: started.jobId,
        placeholders: [started.shapeId.replace(/^shape:/, "")],
        estimate: estimate === null ? null : estimate.label,
        status: "running",
      },
    };
  }

  private imageRequest(call: GenerateCall, plan: Plan, model: string, anchor: Box): ImageRunRequest {
    const references = plan.references.map((ref) => ({ ...ref }) as RecipeRef);
    return {
      project: call.project,
      model,
      params: Object.fromEntries(Object.entries(call.params).map(([key, value]) => [key, String(value)])),
      selectionPrompt: plan.selectionPrompt,
      instruction: plan.instruction,
      outputs: Array.from({ length: call.runs }, () => ({ prompt: plan.prompt, references })),
      sources: [...plan.sources],
      anchor,
      chat: { id: call.chatId, turn: call.turn },
    };
  }

  private textRequest(call: GenerateCall, plan: Plan, anchor: Box): TextRunRequest {
    return {
      project: call.project,
      selectionPrompt: plan.selectionPrompt,
      instruction: plan.instruction,
      prompt: plan.prompt,
      references: plan.references.map((ref) => ({ ...ref }) as RecipeRef),
      sources: [...plan.sources],
      anchor,
      chat: { id: call.chatId, turn: call.turn },
    };
  }

  /** An output's fill is a turn change; the run's end settles the ledger and releases the hold. */
  private onEvent(call: GenerateCall, ledgerKey: string | undefined, each: number | null, event: RunEvent, stop: () => void): void {
    if (event.type === "output" && event.ok) {
      this.costs.set(event.runId, [...(this.costs.get(event.runId) ?? []), event.cost]);
      const before = new Map([[event.shapeId, this.placeholders.get(event.shapeId)]]);
      void this.host.recordsOf(call.project, [event.shapeId]).then((after) => this.host.recordTurn(call.project, call.chatId, call.turn, before, after));
      return;
    }
    if (event.type !== "finished") return;
    stop();
    const costs = this.costs.get(event.runId) ?? [];
    this.costs.delete(event.runId);
    if (ledgerKey !== undefined && call.connectionId !== undefined) {
      if (event.succeeded === 0) void this.host.book.release(call.connectionId, ledgerKey);
      else {
        // A cost the upstream did not report counts at the estimate, so the ledger never reads low.
        const landed = costs.reduce<number>((sum, cost) => sum + (cost ?? each ?? 0), 0);
        void this.host.book.settle(call.connectionId, ledgerKey, landed);
      }
    }
    this.host.holds.runEnded(call.chatId);
  }
}
