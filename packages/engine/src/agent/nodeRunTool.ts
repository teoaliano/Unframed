import { randomUUID } from "node:crypto";
import type { TLRecord } from "@tldraw/tlschema";
import type { ChainStarted, RunChat } from "@unframed/contracts";
import { agentShapeId, ACTIVITY_FAILED, ACTIVITY_LANDED, ACTIVITY_STARTED, formatEstimate, NODE_RUN_DESCRIPTION, roomShapeId, spendRefusal, stepMessage } from "@unframed/domain";
import type { ConnectionBook } from "../agentConnections/book.ts";
import { errorText } from "../log.ts";
import type { ChainHooks, ChainInput, PlannedStep } from "../nodes/nodeRuns.ts";
import type { McpBinding, McpTool, ToolAnswer } from "./mcp.ts";

export const nodeRunTool = (run: (binding: McpBinding, args: Record<string, unknown>) => Promise<ToolAnswer>): McpTool => ({
  name: "node_run",
  description: NODE_RUN_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" }, description: "The node ids to run, as canvas_read names them. One runs that node; several run as a chain in dependency order." },
      downstream: { type: "boolean", description: "Also run the nodes after it that failed, are waiting, are out of date or never ran. Only with one id." },
      dryRun: { type: "boolean", description: "Only show each step's prompt, references and estimate. Nothing is sent or spent." },
    },
    required: ["ids"],
    additionalProperties: false,
  },
  call: (binding, args) => run(binding, args),
});

export type NodeRunArguments = { ok: true; ids: string[]; downstream: boolean; dryRun: boolean } | { ok: false; message: string };

export const nodeRunArguments = (args: Record<string, unknown>): NodeRunArguments => {
  if (!Array.isArray(args.ids) || args.ids.length === 0 || args.ids.some((id) => typeof id !== "string")) return { ok: false, message: "ids has to be a list of at least one node id." };
  if (args.downstream !== undefined && typeof args.downstream !== "boolean") return { ok: false, message: "downstream has to be true or false." };
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") return { ok: false, message: "dryRun has to be true or false." };
  if (args.downstream === true && args.ids.length !== 1) return { ok: false, message: "downstream runs from one node: pass one id." };
  return { ok: true, ids: args.ids as string[], downstream: args.downstream === true, dryRun: args.dryRun === true };
};

export interface NodeRunHost {
  readonly plan: (input: ChainInput) => Promise<{ readonly steps: ReadonlyArray<PlannedStep> }>;
  readonly run: (input: ChainInput) => Promise<ChainStarted>;
  readonly recordsOf: (project: string, ids: ReadonlyArray<string>) => Promise<Map<string, TLRecord | undefined>>;
  readonly recordTurn: (project: string, chatId: string, turn: number, before: Map<string, TLRecord | undefined>, after: Map<string, TLRecord | undefined>) => Promise<void>;
  readonly holds: { runStarted(chatId: string, turn: number): void; runEnded(chatId: string, turn: number): void };
  readonly activity: (project: string, chatId: string, draft: { kind: string; summary: string; turnId: string | null; payload: Record<string, unknown> }) => Promise<void>;
  readonly book: ConnectionBook;
}

export interface NodeRunCall {
  readonly project: string;
  readonly chatId: string;
  readonly turn: number;
  readonly turnId: string | null;
  readonly connectionId?: string | undefined;
  readonly ids: ReadonlyArray<string>;
  readonly downstream: boolean;
  readonly dryRun: boolean;
}

const refusal = (message: string): ToolAnswer => ({ value: { error: message }, isError: true });

const total = (steps: ReadonlyArray<PlannedStep>): number | null => {
  const paid = steps.filter((step) => step.paid);
  return paid.some((step) => step.estimate === null) ? null : paid.reduce((sum, step) => sum + (step.estimate ?? 0), 0);
};

export const nodeRunSummary = (steps: ReadonlyArray<PlannedStep>): string => {
  const sum = total(steps);
  const what = steps.length === 1 ? `Run ${steps[0]!.name}` : `Run a chain of ${steps.length} nodes (${steps.map((step) => step.name).join(", ")})`;
  return `${what}, ${sum === null ? "with no exact estimate" : formatEstimate(sum)}.`;
};

export class AgentNodeRuns {
  private readonly host: NodeRunHost;

  constructor(host: NodeRunHost) {
    this.host = host;
  }

  async detail(project: string, args: Record<string, unknown>): Promise<string | undefined> {
    const checked = nodeRunArguments(args);
    if (!checked.ok) return undefined;
    try {
      const { steps } = await this.host.plan({ project, ids: checked.ids.map(roomShapeId), downstream: checked.downstream, agent: true });
      return nodeRunSummary(steps);
    } catch {
      return undefined;
    }
  }

  async run(call: NodeRunCall): Promise<ToolAnswer> {
    const ids = call.ids.map(roomShapeId);
    const input: ChainInput = { project: call.project, ids, downstream: call.downstream, agent: true };
    let steps: ReadonlyArray<PlannedStep>;
    try {
      steps = (await this.host.plan(input)).steps;
    } catch (error) {
      return refusal(errorText(error));
    }
    const spend = call.connectionId === undefined ? undefined : this.host.book.spendOf(call.connectionId);
    const sum = total(steps);
    if (call.dryRun) {
      return {
        value: {
          dryRun: true,
          steps: steps.map((step) => ({ node: agentShapeId(step.node), prompt: step.prompt, references: step.references, estimate: step.estimate === null ? null : formatEstimate(step.estimate) })),
          estimate: sum === null ? null : formatEstimate(sum),
          spendLimit: spend === undefined || spend.limit === null ? null : { usd: spend.limit.usd, period: spend.limit.period, spent: spend.spent },
        },
      };
    }
    if (spend !== undefined) {
      let running = 0;
      for (const [index, step] of steps.entries()) {
        running += step.estimate ?? 0;
        const refused = spendRefusal({ limit: spend.limit, spent: spend.spent, reserved: 0, estimate: step.estimate === null && step.paid ? null : running });
        if (refused !== undefined) return refusal(steps.length === 1 ? refused : stepMessage(index + 1, step.name, refused));
      }
    }

    const chat: RunChat = { id: call.chatId, turn: call.turn };
    const keys = new Map<number, string>();
    const connection = call.connectionId;
    const hooks: ChainHooks = {
      beforeStep: async (step, index) => {
        if (connection === undefined) return;
        const now = this.host.book.spendOf(connection);
        const refused = spendRefusal({ limit: now.limit, spent: now.spent, reserved: 0, estimate: step.estimate === null && step.paid ? null : (step.estimate ?? 0) });
        if (refused !== undefined) throw new Error(refused);
        const key = `${call.chatId}:${randomUUID()}`;
        keys.set(index, key);
        await this.host.book.reserve(connection, key, step.estimate ?? 0);
      },
      onStepStarted: (step) => {
        void this.host.activity(call.project, call.chatId, { kind: ACTIVITY_STARTED, summary: `Started ${step.name}`, turnId: call.turnId, payload: { count: 1 } });
      },
      afterStep: (step, index, outcome) => {
        const key = keys.get(index);
        if (connection !== undefined && key !== undefined) {
          if (outcome.cost !== null) void this.host.book.settle(connection, key, outcome.cost);
          else if (outcome.ok) void this.host.book.settle(connection, key, step.estimate ?? 0);
          else void this.host.book.release(connection, key);
        }
        void this.host.activity(call.project, call.chatId, outcome.ok
          ? { kind: ACTIVITY_LANDED, summary: `${step.name} landed`, turnId: call.turnId, payload: { cost: outcome.cost ?? step.estimate } }
          : { kind: ACTIVITY_FAILED, summary: `${step.name} did not land`, turnId: call.turnId, payload: { count: 1 } });
      },
      onFinished: () => {
        void this.host
          .recordsOf(call.project, ids.length === 0 ? [] : [...new Set(steps.map((step) => step.node))])
          .then((after) => this.host.recordTurn(call.project, call.chatId, call.turn, before, after))
          .finally(() => this.host.holds.runEnded(call.chatId, call.turn));
      },
    };
    const nodes = [...new Set(steps.map((step) => step.node))];
    const before = await this.host.recordsOf(call.project, nodes);
    this.host.holds.runStarted(call.chatId, call.turn);
    let started: ChainStarted;
    try {
      started = await this.host.run({ ...input, chat, hooks, expect: steps.map((step) => step.node) });
    } catch (error) {
      this.host.holds.runEnded(call.chatId, call.turn);
      return refusal(errorText(error));
    }
    await this.host.recordTurn(call.project, call.chatId, call.turn, before, await this.host.recordsOf(call.project, nodes));
    return { value: { chainId: started.chainId, nodes: started.nodes.map(agentShapeId), status: "running", estimate: sum === null ? null : formatEstimate(sum) } };
  }
}
