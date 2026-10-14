import { randomUUID } from "node:crypto";
import { outsideChatTitle, outsideTurn, type ActivityInput, type Chat, type ChatCommand } from "@unframed/domain";
import type { ConnectionRecord } from "../agentConnections/book.ts";
import { errorText } from "../log.ts";
import type { ChatEngine } from "./chatEngine.ts";
import type { TurnChanges } from "./turnChanges.ts";
import type { McpBinding, McpTool, ToolAnswer } from "./mcp.ts";

type Bare<C> = C extends unknown ? Omit<C, "commandId" | "projectId" | "threadId"> : never;

/** A project's chats as the outside calls see them: its store, its turn changes and its folder. */
export interface OutsideAgent {
  readonly slug: string;
  readonly engine: ChatEngine;
  readonly turnChanges: TurnChanges;
}

/** What the runtime lends the outside chats: its project agents, its command path and its activities. */
export interface OutsideHost {
  readonly agent: (slug: string) => Promise<OutsideAgent>;
  readonly command: (agent: OutsideAgent, chatId: string, command: Bare<ChatCommand>) => Promise<void>;
  readonly activity: (agent: OutsideAgent, chatId: string, activity: ActivityInput) => Promise<void>;
  readonly clock: (slug: string) => Promise<number | null>;
}

export interface OutsideCall {
  readonly connection: ConnectionRecord;
  readonly sessionId: string;
  readonly slug: string;
  readonly tool: McpTool;
  readonly args: Record<string, unknown>;
}

/** The chat an outside session's calls into one project show in (spec 14, "The outside chat"). */
export const outsideChatOf = (chats: ReadonlyArray<Chat>, connectionId: string, sessionId: string): Chat | undefined =>
  chats
    .filter((chat) => chat.deletedAt === null && chat.outside?.connectionId === connectionId && chat.outside.sessionId === sessionId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];

/**
 * The outside calls (spec 14): one call from an outside session into one project. It finds or makes
 * the session's chat there, opens or continues its turn by the idle rule, records the call's
 * activities, runs the tool in that chat, and settles the turn once it has been quiet for the idle time.
 */
export class OutsideChats {
  private readonly lastCallAt = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly agents = new Map<string, OutsideAgent>();

  private readonly host: OutsideHost;
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(host: OutsideHost, idleMs: number, now: () => number = Date.now) {
    this.host = host;
    this.idleMs = idleMs;
    this.now = now;
  }

  async call(input: OutsideCall): Promise<ToolAnswer> {
    const agent = await this.host.agent(input.slug);
    const chatId = await this.bind(input.connection, input.sessionId, agent);
    const turnId = agent.engine.chat(chatId)?.latestTurn?.turnId ?? null;
    const binding: McpBinding = { project: input.slug, chatId };
    const callId = randomUUID();
    const title = `mcp__unframed__${input.tool.name}`;
    const at = () => new Date(this.now()).toISOString();
    await this.host.activity(agent, chatId, {
      id: `${callId}:started`,
      tone: "tool",
      kind: "tool.started",
      summary: title,
      payload: { itemId: callId, itemType: "mcp_tool_call", title, data: { toolName: title, input: input.args }, status: "inProgress" },
      turnId,
      createdAt: at(),
    });
    let answer: ToolAnswer;
    try {
      answer = await input.tool.call(binding, input.args);
    } catch (error) {
      answer = { value: { error: errorText(error) }, isError: true };
    }
    await this.host.activity(agent, chatId, {
      id: `${callId}:done`,
      tone: "tool",
      kind: answer.isError ? "tool.failed" : "tool.completed",
      summary: title,
      payload: {
        itemId: callId,
        itemType: "mcp_tool_call",
        title,
        data: { toolName: title, input: input.args, result: answer.value },
        status: answer.isError ? "failed" : "completed",
      },
      turnId,
      createdAt: at(),
    });
    this.quietFrom(agent, chatId);
    return answer;
  }

  /** The chat for this call, with its turn open: the idle rule decides whether this call joins the open turn. */
  private async bind(connection: ConnectionRecord, sessionId: string, agent: OutsideAgent): Promise<string> {
    const now = this.now();
    const createdAt = new Date(now).toISOString();
    let chat = outsideChatOf(agent.engine.chats(), connection.id, sessionId);
    if (chat === undefined) {
      const chatId = randomUUID();
      await this.host.command(agent, chatId, {
        type: "thread.outside.create",
        title: outsideChatTitle(connection.name, new Date(now)),
        outside: { connectionId: connection.id, sessionId, client: connection.client },
        createdAt,
      });
      chat = agent.engine.chat(chatId);
      if (chat === undefined) throw new Error("Could not start the outside chat for this call.");
    }
    const chatId = chat.id;
    const action = outsideTurn({
      openTurn: chat.latestTurn?.state === "running",
      lastCallAt: this.lastCallAt.get(chatId),
      now,
      idleMs: this.idleMs,
      runsInFlight: 0,
    });
    if (action === "settle-then-open") await this.settle(agent, chatId);
    if (action !== "continue") {
      await this.host.command(agent, chatId, { type: "thread.outside.turn.begin", turnId: randomUUID(), createdAt });
    }
    return chatId;
  }

  /** Records that the chat was just called, and arms the timer that settles its turn once it goes quiet. */
  private quietFrom(agent: OutsideAgent, chatId: string): void {
    this.lastCallAt.set(chatId, this.now());
    this.agents.set(chatId, agent);
    clearTimeout(this.timers.get(chatId));
    const timer = setTimeout(() => void this.settleIfQuiet(chatId), this.idleMs);
    timer.unref();
    this.timers.set(chatId, timer);
  }

  private settleIfQuiet(chatId: string): void {
    const last = this.lastCallAt.get(chatId);
    const agent = this.agents.get(chatId);
    if (last === undefined || agent === undefined || this.now() - last < this.idleMs) return;
    void this.settle(agent, chatId);
  }

  /** Settles the chat's running outside turn: its clock, its files, then the session leaves running. */
  async settle(agent: OutsideAgent, chatId: string): Promise<void> {
    clearTimeout(this.timers.get(chatId));
    this.timers.delete(chatId);
    const turn = agent.engine.chat(chatId)?.latestTurn ?? null;
    if (turn === null || turn.state !== "running") return;
    const clock = await this.host.clock(agent.slug).catch(() => null);
    await this.host.command(agent, chatId, { type: "thread.turn.settle", turnCount: turn.turnCount, clock });
    await this.host.command(agent, chatId, {
      type: "thread.turn.files.complete",
      turnCount: turn.turnCount,
      files: agent.turnChanges.files(chatId, turn.turnCount),
    });
    await this.host.command(agent, chatId, { type: "thread.session.set", session: { status: "ready", activeTurnId: null, lastError: null } });
  }
}
