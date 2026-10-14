import { randomUUID } from "node:crypto";
import type { TLRecord } from "@tldraw/tlschema";
import type { ImagePricingAnswer, ImageRunRequest, RecipeRef, RunEvent, TextRunRequest } from "@unframed/contracts";
import { canvasShapesOf, estimateImageRun, formatEstimate, planAgentRun, roomShapeId, spendRefusal, type AgentRunPlan, type CanvasRecord } from "@unframed/domain";
import type { ConnectionBook } from "../agentConnections/book.ts";
import { errorText } from "../log.ts";
import { shapeBoxes } from "../runs/shapeBounds.ts";
import type { ToolAnswer } from "./mcp.ts";

type Plan = Extract<AgentRunPlan, { ok: true }>;
/** A run as the run services acknowledge it. */
interface RunStarted {
  readonly runId: string;
  readonly batchId: string;
  readonly placeholders: ReadonlyArray<string>;
}
type Box = { x: number; y: number; w: number; h: number };

/** What the generation needs from the rest of the engine. */
export interface GenerationHost {
  readonly records: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  /** The record of each id, as it is now (`undefined` when the canvas holds none). */
  readonly recordsOf: (project: string, ids: ReadonlyArray<string>) => Promise<Map<string, TLRecord | undefined>>;
  readonly runImage: (request: ImageRunRequest) => Promise<RunStarted>;
  readonly runText: (request: TextRunRequest) => Promise<RunStarted>;
  readonly pricing: (model: string) => Promise<ImagePricingAnswer>;
  readonly defaultImageModel: () => Promise<string>;
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
  readonly medium: "image" | "text";
  /** Agent ids, as canvas_read names them. */
  readonly sources: ReadonlyArray<string>;
  readonly instruction: string;
  /** Outputs of one image batch, 1 to 10. Text runs once. */
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

/**
 * `generate` (spec 14, "Generation by agents"): one paid run through the composer's own run
 * services. The refusals are the composer's sentences, plus the sketch refusal and the spend limit's.
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
    const records = await this.host.records(call.project);
    const shapes = canvasShapesOf(records as unknown as CanvasRecord[], shapeBoxes(records as TLRecord[]));
    const sources = call.sources.map((id) => roomShapeId(id));
    const plan = planAgentRun({ shapes, sources, instruction: call.instruction, medium: call.medium });
    if (!plan.ok) return refusal(plan.message);

    const model = call.medium === "image" ? (call.model ?? (await this.host.defaultImageModel())) : undefined;
    const estimate = model === undefined ? null : await this.imageEstimate(model, plan, call.runs);
    const spend = call.connectionId === undefined ? undefined : this.host.book.spendOf(call.connectionId);

    if (call.dryRun) {
      return {
        value: {
          dryRun: true,
          prompt: plan.prompt,
          references: plan.references,
          estimate: estimate === null ? null : `${formatEstimate(estimate.each)} each`,
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

    const anchor = union(shapes.filter((shape) => sources.includes(shape.id)).map((shape) => shape.bounds));
    const events: RunEvent[] = [];
    let runId: string | undefined;
    let stopTracking: (() => void) | undefined;
    const onEvent = (event: RunEvent) => this.onEvent(call, ledgerKey, estimate?.each ?? null, event, () => stopTracking?.());
    stopTracking = this.host.track(call.project, (event) => (runId === undefined ? events.push(event) : onEvent(event)));

    let started: RunStarted;
    try {
      started =
        model === undefined
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
        estimate: estimate === null ? null : `${formatEstimate(estimate.each)} each`,
        status: "running",
      },
    };
  }

  /** The image estimate for `runs` outputs, or `null` when no exact price exists. Text has none. */
  private async imageEstimate(model: string, plan: Plan, runs: number): Promise<{ each: number; total: number } | null> {
    const pricing = await this.host.pricing(model).catch(() => undefined);
    if (pricing === undefined) return null;
    const referenceImages = plan.references.filter((ref) => "file" in ref && ref.kind === "image").length;
    const each = estimateImageRun({ endpoints: pricing.endpoints, chosen: {}, referenceImages, outputs: 1 });
    return each === null ? null : { each, total: each * runs };
  }

  private imageRequest(call: GenerateCall, plan: Plan, model: string, anchor: Box): ImageRunRequest {
    const references = plan.references.map((ref) => ({ ...ref }) as RecipeRef);
    return {
      project: call.project,
      model,
      params: {},
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
