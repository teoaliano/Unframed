import { randomUUID } from "node:crypto";
import { changeNote, outsideChatTitle, outsideTurn, type ActivityInput, type Chat, type ChatCommand } from "@unframed/domain";
import type { ConnectionRecord } from "../agentConnections/book.ts";
import { errorText } from "../log.ts";
import type { ChatEngine } from "./chatEngine.ts";
import type { ChangeLogRow } from "../canvas/rooms.ts";
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
  /** The canvas changes since a clock, for the change note. */
  readonly changeLog: (slug: string, since: number) => Promise<ReadonlyArray<ChangeLogRow>>;
}

export interface OutsideCall {
  readonly connection: ConnectionRecord;
  readonly sessionId: string;
  readonly slug: string;
  readonly tool: McpTool;
  readonly args: Record<string, unknown>;
}

/** The chat an outside session's calls into one project show in. */
export const outsideChatOf = (chats: ReadonlyArray<Chat>, connectionId: string, sessionId: string): Chat | undefined =>
  chats
    .filter((chat) => chat.deletedAt === null && chat.outside?.connectionId === connectionId && chat.outside.sessionId === sessionId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];

/**
 * The outside calls: one call from an outside session into one project. It finds or makes
 * the session's chat there, opens or continues its turn by the idle rule, records the call's
 * activities, runs the tool in that chat, and settles the turn once it has been quiet for the idle time.
 */
export class OutsideChats {
  private readonly lastCallAt = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly agents = new Map<string, OutsideAgent>();
  /** The room clock at the end of each chat's last call: the change note counts from here. */
  private readonly clockAtLastCall = new Map<string, number>();
  /** Paid runs each chat's agent started that have not landed or failed yet. */
  private readonly inFlight = new Map<string, number>();
  /** Chats whose settle was asked for while a run was in flight: they settle when the last run ends. */
  private readonly deferred = new Set<string>();

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
    const binding: McpBinding = { project: input.slug, chatId, connectionId: input.connection.id };
    const callId = randomUUID();
    const title = `mcp__unframed__${input.tool.name}`;
    const at = () => new Date(this.now()).toISOString();
    const note = await this.changeNoteFor(agent, chatId);
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
    const clock = await this.host.clock(agent.slug).catch(() => null);
    if (clock !== null) this.clockAtLastCall.set(chatId, clock);
    return note === undefined ? answer : { ...answer, notes: [note] };
  }

  /** The change note an outside call's result starts with, when the canvas changed since the chat's last call. */
  private async changeNoteFor(agent: OutsideAgent, chatId: string): Promise<string | undefined> {
    const since = this.clockAtLastCall.get(chatId) ?? agent.engine.chat(chatId)?.lastClock ?? null;
    if (since === null) return undefined;
    return changeNote(await this.host.changeLog(agent.slug, since).catch(() => []), chatId);
  }

  /** Settles the open outside turns of one session in every project it touched, and tells each chat it ended. */
  async endSession(sessionId: string, agents: ReadonlyArray<OutsideAgent>): Promise<void> {
    for (const agent of agents) {
      for (const chat of agent.engine.chats()) {
        if (chat.deletedAt !== null || chat.outside?.sessionId !== sessionId) continue;
        await this.settle(agent, chat.id);
        await this.note(agent, chat.id, "outside.session-ended", "This session ended.");
      }
    }
  }

  /** Tells each chat of a revoked connection that it is disconnected, and settles its open turns. */
  async disconnect(connectionId: string, agents: ReadonlyArray<OutsideAgent>): Promise<void> {
    for (const agent of agents) {
      for (const chat of agent.engine.chats()) {
        if (chat.deletedAt !== null || chat.outside?.connectionId !== connectionId) continue;
        await this.settle(agent, chat.id);
        await this.note(agent, chat.id, "outside.disconnected", "Disconnected. This connection was revoked in Settings.");
      }
    }
  }

  /** A project is closing: its open outside turns settle first, so a rename, delete or shutdown leaves none open. */
  async settleOpen(agent: OutsideAgent): Promise<void> {
    for (const chat of agent.engine.chats()) if (chat.outside !== undefined) await this.settle(agent, chat.id);
  }

  private async note(agent: OutsideAgent, chatId: string, kind: string, summary: string): Promise<void> {
    await this.host.activity(agent, chatId, { id: randomUUID(), tone: "info", kind, summary, payload: {}, turnId: null, createdAt: new Date(this.now()).toISOString() });
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
      runsInFlight: this.inFlight.get(chatId) ?? 0,
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
    this.arm(chatId, this.idleMs);
  }

  private arm(chatId: string, ms: number): void {
    clearTimeout(this.timers.get(chatId));
    const timer = setTimeout(() => void this.settleIfQuiet(chatId), ms);
    timer.unref();
    this.timers.set(chatId, timer);
  }

  /**
   * A timer can fire a little early by the wall clock (Node's loop time lags Date.now()), so a
   * chat that is not yet quiet re-arms for the time left instead of waiting for another call.
   */
  private settleIfQuiet(chatId: string): void {
    const last = this.lastCallAt.get(chatId);
    const agent = this.agents.get(chatId);
    if (last === undefined || agent === undefined) return;
    const left = this.idleMs - (this.now() - last);
    if (left > 0) {
      this.arm(chatId, left);
      return;
    }
    void this.settle(agent, chatId);
  }

  /** A paid run an agent started in this chat's open turn has been accepted. */
  runStarted(chatId: string): void {
    this.inFlight.set(chatId, (this.inFlight.get(chatId) ?? 0) + 1);
  }

  /** A paid run of the chat landed or failed. The turn settles now if it was asked to, or if it has gone quiet. */
  runEnded(chatId: string): void {
    const remaining = (this.inFlight.get(chatId) ?? 1) - 1;
    if (remaining > 0) this.inFlight.set(chatId, remaining);
    else this.inFlight.delete(chatId);
    if (remaining > 0) return;
    const agent = this.agents.get(chatId);
    const last = this.lastCallAt.get(chatId);
    if (agent === undefined) return;
    if (this.deferred.has(chatId) || (last !== undefined && this.now() - last >= this.idleMs)) {
      this.deferred.delete(chatId);
      void this.settle(agent, chatId);
    }
  }

  /** Settles the chat's running outside turn: its clock, its files, then the session leaves running. */
  async settle(agent: OutsideAgent, chatId: string): Promise<void> {
    clearTimeout(this.timers.get(chatId));
    this.timers.delete(chatId);
    const chat = agent.engine.chat(chatId);
    // Only an outside chat settles here: an in-app chat's turn belongs to its own agent.
    if (chat?.outside === undefined) return;
    // A paid run is never cut off: the turn settles once the last of its runs has landed.
    if ((this.inFlight.get(chatId) ?? 0) > 0) {
      this.deferred.add(chatId);
      return;
    }
    const turn = chat.latestTurn ?? null;
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
