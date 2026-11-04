import { randomUUID } from "node:crypto";
import { PLAN_NO_WRITES_MESSAGE, applyKitOps, cssName, resolve, type ActivityInput, type InteractionMode, type Kit, type KitOp } from "@unframed/domain";
import type { TLRecord } from "@tldraw/tlschema";
import type { Applied, CanvasChange, ChangeOrigin } from "../canvas/rooms.ts";
import { refusal, type McpBinding, type McpTool, type ToolAnswer } from "../agent/mcp.ts";
import { kitOf } from "./tokensFile.ts";
import { changedKitParts } from "./kitTurn.ts";
import type { TurnChanges } from "../agent/turnChanges.ts";

interface KitToolContext {
  readonly read: (project: string) => Promise<ReadonlyArray<TLRecord>>;
  readonly apply: (project: string, change: CanvasChange, origin: ChangeOrigin) => Promise<Applied>;
  readonly chatTurn: (project: string, chatId: string) => { turnCount: number | undefined; turnId: string | undefined; interactionMode: InteractionMode };
  readonly activity: (project: string, chatId: string, activity: ActivityInput) => void;
  readonly turnChanges: (project: string) => Promise<TurnChanges>;
}

const DOCUMENT_ID = "document:document";

const kitReadAnswer = (kit: Kit | null) => {
  if (kit === null) return { kit: null };
  const defaultMode = kit.modes[0]!;
  return {
    name: kit.name,
    modes: kit.modes,
    defaultMode,
    tokens: kit.tokens.map((token) => {
      const aliasOf = typeof token.value === "string" && /^\{.+\}$/.test(token.value) ? token.value.slice(1, -1) : undefined;
      const resolved = aliasOf === undefined ? undefined : resolve(kit, token.path, defaultMode);
      return {
        path: token.path,
        css: cssName(token.path),
        type: token.type,
        ...(token.value === undefined ? {} : { value: token.value }),
        ...(token.values === undefined ? {} : { values: token.values }),
        ...(aliasOf === undefined ? {} : { aliasOf, resolved }),
        ...(token.description === undefined ? {} : { description: token.description }),
        ...(token.formerNames === undefined ? {} : { formerNames: token.formerNames }),
      };
    }),
    ...(kit.from === undefined ? {} : { from: { library: kit.from.presetId, revision: kit.from.revision } }),
  };
};

const isArtifactShape = (record: TLRecord): boolean => record.typeName === "shape" && (record.type === "page" || record.type === "motion");

const modeMoves = (records: ReadonlyArray<TLRecord>, ops: ReadonlyArray<KitOp>): TLRecord[] => {
  const renames = new Map<string, string>();
  for (const op of ops) if (op.op === "renameMode") renames.set(op.name, op.to);
  if (renames.size === 0) return [];
  const puts: TLRecord[] = [];
  for (const record of records) {
    if (!isArtifactShape(record)) continue;
    const mode = (record as { props: { mode?: unknown } }).props.mode;
    if (typeof mode !== "string" || !renames.has(mode)) continue;
    puts.push({ ...record, props: { ...(record as { props: object }).props, mode: renames.get(mode)! } } as unknown as TLRecord);
  }
  return puts;
};

export class KitTools {
  private readonly context: KitToolContext;

  constructor(context: KitToolContext) {
    this.context = context;
  }

  async read(binding: McpBinding): Promise<ToolAnswer> {
    const kit = kitOf(await this.context.read(binding.project));
    return { value: kitReadAnswer(kit) };
  }

  async write(binding: McpBinding, args: Record<string, unknown>): Promise<ToolAnswer> {
    const { context } = this;
    const turn = context.chatTurn(binding.project, binding.chatId);
    if (turn.interactionMode === "plan") return refusal(PLAN_NO_WRITES_MESSAGE);
    if (!Array.isArray(args.ops)) return refusal("ops must be a list of kit operations");
    const ops = args.ops as KitOp[];
    if (ops.some((op) => op.op === "remove")) return refusal("Deleting the kit is the person's to do, in the Kit dialog.");
    const records = await context.read(binding.project);
    const before = kitOf(records);
    const result = applyKitOps(before, ops);
    if (!result.ok) return { value: { error: `op ${result.op}: ${result.refusal}` }, isError: true };
    if (result.kit === null) return refusal("The kit cannot be removed by a write.");
    const document = records.find((record) => record.id === DOCUMENT_ID) ?? { id: DOCUMENT_ID, typeName: "document", gridSize: 10, name: "", meta: {} };
    const meta = document.meta as Record<string, unknown>;
    const unframed = (meta.unframed ?? {}) as Record<string, unknown>;
    const next = { ...document, meta: { ...meta, unframed: { ...unframed, kit: result.kit } } } as unknown as TLRecord;
    const puts = [next, ...modeMoves(records, ops)];
    let applied: Applied;
    try {
      applied = await context.apply(binding.project, { put: puts, remove: [] }, { kind: "server", id: `chat:${binding.chatId}` });
    } catch (failure) {
      return refusal(failure instanceof Error && failure.message.trim() !== "" ? failure.message : "the kit could not be written");
    }
    if (turn.turnCount !== undefined) {
      const parts = changedKitParts(before, result.kit);
      const shapesBefore = new Map<string, TLRecord | undefined>();
      const shapesAfter = new Map<string, TLRecord | undefined>();
      for (const put of puts) {
        if (put.typeName !== "shape") continue;
        shapesBefore.set(put.id as string, records.find((record) => record.id === put.id));
        shapesAfter.set(put.id as string, put);
      }
      (await context.turnChanges(binding.project)).record(
        binding.chatId,
        turn.turnCount,
        new Map([...parts.before, ...shapesBefore]),
        new Map([...parts.after, ...shapesAfter]),
        applied.clock,
      );
    }
    context.activity(binding.project, binding.chatId, {
      id: `kit:${randomUUID()}`,
      tone: "tool",
      kind: "kit.written",
      summary: before === null ? "Created the kit" : "Updated the kit",
      payload: { kit: { name: result.kit.name, tokens: result.kit.tokens.length, modes: result.kit.modes } },
      turnId: turn.turnId ?? null,
      createdAt: new Date().toISOString(),
    });
    return { value: { ok: true, tokens: result.kit.tokens.length, modes: result.kit.modes, clock: applied.clock } };
  }

  tools(): McpTool[] {
    return [
      {
        name: "kit_read",
        description: KIT_READ_DESCRIPTION,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        call: (binding) => this.read(binding),
      },
      {
        name: "kit_write",
        description: KIT_WRITE_DESCRIPTION,
        inputSchema: { type: "object", properties: { ops: { type: "array", items: { type: "object" }, description: "The kit operations, in order. See kit_write's description for each op." } }, required: ["ops"] },
        call: (binding, args) => this.write(binding, args),
      },
    ];
  }
}

const KIT_READ_DESCRIPTION =
  "Read the project's kit: its tokens with their CSS names (use var(<css>) in CSS and unframed.token(\"<path>\") in script), the modes and the default mode. Answers { kit: null } when the project has no kit.";

const KIT_WRITE_DESCRIPTION =
  "Change the project's kit with one batch of ops, applied all or nothing, as one step of this turn that the person can revert. Ops: create {name, modes?}; rename {name}; setToken {path, type, value? | values?, description?}; renameToken {path, to}; deleteToken {path}; forgetFormerName {path, cssName}; addMode {name, copyFrom?}; renameMode {name, to}; deleteMode {name}; setDefaultMode {name}; reorder {paths}. Never redefine a kit CSS name in an artifact, and never set data-theme yourself.";
