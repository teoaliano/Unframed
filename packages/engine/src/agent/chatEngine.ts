import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  decide,
  emptyProjectChats,
  NO_EVENTS,
  projectChats,
  type Chat,
  type ChatCommand,
  type ChatEvent,
  type PendingEvent,
  type ProjectChats,
  type Rejection,
} from "@unframed/domain";

export type ActorKind = "client" | "server" | "provider";

/** A command the store refused, with the decider's sentence. */
export class CommandRejected extends Error {
  readonly code: Rejection["code"];
  constructor(rejection: Rejection) {
    super(rejection.message);
    this.code = rejection.code;
  }
}

export interface DispatchOptions {
  readonly actor?: ActorKind;
  readonly causationEventId?: string | null;
}

/** Called after each commit with its events, the model before and the model after. */
export type CommitListener = (events: ReadonlyArray<ChatEvent>, before: ProjectChats, after: ProjectChats) => void;

const PROJECTORS = ["threads", "messages", "activities", "sessions", "turns", "pending_approvals", "proposed_plans"] as const;

const json = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

const readEvent = (row: Record<string, unknown>): ChatEvent => ({
  sequence: Number(row.sequence),
  eventId: String(row.event_id),
  aggregateKind: "thread",
  aggregateId: String(row.stream_id),
  occurredAt: String(row.occurred_at),
  commandId: row.command_id === null ? null : String(row.command_id),
  causationEventId: row.causation_event_id === null ? null : String(row.causation_event_id),
  correlationId: row.correlation_id === null ? null : String(row.correlation_id),
  type: String(row.event_type) as ChatEvent["type"],
  payload: JSON.parse(String(row.payload_json)),
  metadata: JSON.parse(String(row.metadata_json)),
});

/**
 * One project's chat store (spec 07, t3code's orchestration engine): one queue that takes
 * commands one at a time. For each: look up its receipt, decide against the in-memory
 * model, then in ONE SQLite transaction append the events, apply the SQL projectors and
 * write the receipt. Only after the commit does the model change and do listeners hear.
 */
export class ChatEngine {
  private current: ProjectChats;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<CommitListener>();
  private readonly versions = new Map<string, number>();
  private readonly statements: Record<string, StatementSync>;
  private closed = false;

  readonly project: string;
  private readonly db: DatabaseSync;
  private readonly now: () => string;

  constructor(project: string, db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
    this.project = project;
    this.db = db;
    this.now = now;
    const prepare = (sql: string) => db.prepare(sql);
    this.statements = {
      receipt: prepare("SELECT aggregate_id, status, result_sequence, error FROM orchestration_command_receipts WHERE command_id = ?"),
      insertReceipt: prepare(
        "INSERT OR REPLACE INTO orchestration_command_receipts (command_id, aggregate_id, accepted_at, result_sequence, status, error) VALUES (?, ?, ?, ?, ?, ?)",
      ),
      insertEvent: prepare(
        `INSERT INTO orchestration_events (sequence, event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json)
         VALUES (?, ?, 'thread', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      thread: prepare(
        `INSERT OR REPLACE INTO projection_threads (thread_id, project_id, title, titled_by, tags_json, model_selection_json, runtime_mode,
          interaction_mode, last_clock, latest_turn_json, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      message: prepare(
        `INSERT OR REPLACE INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
          context_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      activity: prepare(
        `INSERT OR REPLACE INTO projection_thread_activities (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence,
          created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      session: prepare(
        "INSERT OR REPLACE INTO projection_thread_sessions (thread_id, status, provider, active_turn_id, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ),
      turn: prepare(
        `INSERT OR REPLACE INTO projection_turns (thread_id, turn_id, turn_count, pending_message_id, assistant_message_id, state,
          requested_at, started_at, completed_at, usage_json, files_json, reverted_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      approval: prepare(
        `INSERT OR REPLACE INTO projection_pending_approvals (request_id, thread_id, turn_id, status, decision, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM projection_pending_approvals WHERE request_id = ?), ?), ?)`,
      ),
      plan: prepare(
        `INSERT OR REPLACE INTO projection_thread_proposed_plans (plan_id, thread_id, turn_id, plan_markdown, implemented_at,
          implementation_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      state: prepare("INSERT OR REPLACE INTO projection_state (projector, last_applied_sequence, updated_at) VALUES (?, ?, ?)"),
    };
    this.current = this.bootstrap();
  }

  /** Replays every event into the model, and the SQL projectors from their own cursors. */
  private bootstrap(): ProjectChats {
    let model = emptyProjectChats(this.project);
    const events = this.db.prepare("SELECT * FROM orchestration_events ORDER BY sequence").all().map(readEvent);
    const cursors = new Map(
      this.db
        .prepare("SELECT projector, last_applied_sequence FROM projection_state")
        .all()
        .map((row) => [String(row.projector), Number(row.last_applied_sequence)] as const),
    );
    const behind = Math.min(...PROJECTORS.map((name) => cursors.get(name) ?? 0));
    const replay: ChatEvent[] = [];
    for (const event of events) {
      const before = model;
      model = projectChats(model, event);
      this.versions.set(event.aggregateId, (this.versions.get(event.aggregateId) ?? -1) + 1);
      if (event.sequence > behind) replay.push(event);
      if (event.sequence > behind) this.writeProjections([event], before, model);
    }
    if (replay.length > 0) this.writeCursors(model.sequence);
    return model;
  }

  get model(): ProjectChats {
    return this.current;
  }

  chat(id: string): Chat | undefined {
    return this.current.chats[id];
  }

  /** Every committed event past `after`, of one chat when `chatId` is given. */
  eventsAfter(after: number, chatId?: string): ChatEvent[] {
    const rows =
      chatId === undefined
        ? this.db.prepare("SELECT * FROM orchestration_events WHERE sequence > ? ORDER BY sequence").all(after)
        : this.db.prepare("SELECT * FROM orchestration_events WHERE stream_id = ? AND sequence > ? ORDER BY sequence").all(chatId, after);
    return rows.map(readEvent);
  }

  onCommit(listener: CommitListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Queues a command. Answers `{sequence}` once its events are committed, or rejects with `CommandRejected`. */
  dispatch(command: ChatCommand, options: DispatchOptions = {}): Promise<{ sequence: number }> {
    const run = this.queue.then(() => this.process(command, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Waits for every command queued so far. */
  settled(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  private process(command: ChatCommand, options: DispatchOptions): { sequence: number } {
    if (this.closed) throw new CommandRejected({ code: "bad_request", message: "This project was closed." });
    const receipt = this.statements.receipt!.get(command.commandId) as Record<string, unknown> | undefined;
    if (receipt) {
      if (String(receipt.aggregate_id) !== command.threadId) {
        throw new CommandRejected({ code: "conflict", message: "That command id was already used for another chat." });
      }
      if (receipt.status === "accepted") return { sequence: Number(receipt.result_sequence) };
      const stored = JSON.parse(String(receipt.error)) as Rejection;
      throw new CommandRejected(stored);
    }
    const now = this.now();
    const decision = decide(command, this.current, now);
    const rejection: Rejection | undefined = !decision.ok
      ? decision.rejection
      : decision.events.length === 0
        ? { code: "bad_request", message: NO_EVENTS }
        : undefined;
    if (rejection !== undefined || !decision.ok) {
      const refused = rejection ?? { code: "bad_request", message: NO_EVENTS };
      this.statements.insertReceipt!.run(command.commandId, command.threadId, now, null, "rejected", JSON.stringify(refused));
      throw new CommandRejected(refused);
    }
    return this.commit(command, decision.events, now, options);
  }

  private commit(command: ChatCommand, pending: ReadonlyArray<PendingEvent>, now: string, options: DispatchOptions): { sequence: number } {
    const before = this.current;
    let sequence = before.sequence;
    const events: ChatEvent[] = pending.map((event) => {
      sequence++;
      return {
        ...event,
        sequence,
        eventId: randomUUID(),
        aggregateKind: "thread",
        occurredAt: now,
        commandId: command.commandId,
        causationEventId: options.causationEventId ?? null,
        correlationId: command.commandId,
        metadata: event.metadata ?? {},
      };
    });
    const after = events.reduce(projectChats, before);
    const versions = new Map(this.versions);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const event of events) {
        const version = (versions.get(event.aggregateId) ?? -1) + 1;
        versions.set(event.aggregateId, version);
        this.statements.insertEvent!.run(
          event.sequence,
          event.eventId,
          event.aggregateId,
          version,
          event.type,
          event.occurredAt,
          event.commandId,
          event.causationEventId,
          event.correlationId,
          options.actor ?? "server",
          JSON.stringify(event.payload),
          JSON.stringify(event.metadata),
        );
      }
      this.writeProjections(events, before, after);
      this.writeCursors(sequence);
      this.statements.insertReceipt!.run(command.commandId, command.threadId, now, sequence, "accepted", null);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    for (const [id, version] of versions) this.versions.set(id, version);
    this.current = after;
    for (const listener of [...this.listeners]) {
      try {
        listener(events, before, after);
      } catch {
        // A listener never undoes a commit.
      }
    }
    return { sequence };
  }

  private writeCursors(sequence: number): void {
    const at = this.now();
    for (const name of PROJECTORS) this.statements.state!.run(name, sequence, at);
  }

  /** The SQL projectors: each event writes the rows it changed, read from the model after it. */
  private writeProjections(events: ReadonlyArray<ChatEvent>, before: ProjectChats, after: ProjectChats): void {
    const s = this.statements;
    for (const event of events) {
      const chat = after.chats[event.aggregateId];
      if (!chat) continue;
      const p = event.payload as Record<string, any>;
      s.thread!.run(
        chat.id,
        chat.projectId,
        chat.title,
        chat.titledBy,
        JSON.stringify(chat.tags),
        JSON.stringify(chat.modelSelection),
        chat.runtimeMode,
        chat.interactionMode,
        chat.lastClock,
        json(chat.latestTurn),
        chat.createdAt,
        chat.updatedAt,
        chat.deletedAt,
      );
      const writeTurns = () => {
        for (const turn of chat.turns) {
          s.turn!.run(
            chat.id,
            turn.turnId,
            turn.turnCount,
            turn.pendingMessageId,
            turn.assistantMessageId,
            turn.state,
            turn.requestedAt,
            turn.startedAt,
            turn.completedAt,
            json(turn.usage),
            json(turn.files),
            json(turn.reverted),
          );
        }
      };
      switch (event.type) {
        case "thread.message-sent": {
          const message = chat.messages.find((known) => known.id === p.messageId);
          if (message) {
            s.message!.run(
              message.id,
              chat.id,
              message.turnId,
              message.role,
              message.text,
              message.streaming ? 1 : 0,
              json(message.attachments),
              json(message.context),
              message.createdAt,
              message.updatedAt,
            );
          }
          if (p.role === "assistant") writeTurns();
          break;
        }
        case "thread.activity-appended": {
          const activity = chat.activities.find((known) => known.sequence === event.sequence);
          if (activity) {
            s.activity!.run(
              activity.id,
              chat.id,
              activity.turnId,
              activity.tone,
              activity.kind,
              activity.summary,
              JSON.stringify(activity.payload ?? null),
              activity.sequence,
              activity.createdAt,
            );
            const requestId = (activity.payload as { requestId?: unknown } | null)?.requestId;
            if (typeof requestId === "string" && (activity.kind === "approval.requested" || activity.kind === "approval.resolved")) {
              const resolved = activity.kind === "approval.resolved";
              const decision = (activity.payload as { decision?: unknown }).decision;
              s.approval!.run(
                requestId,
                chat.id,
                activity.turnId,
                resolved ? "resolved" : "pending",
                resolved && typeof decision === "string" ? decision : null,
                requestId,
                activity.createdAt,
                resolved ? activity.createdAt : null,
              );
            }
          }
          break;
        }
        case "thread.session-set":
          if (chat.session) {
            s.session!.run(chat.id, chat.session.status, chat.modelSelection.provider, chat.session.activeTurnId, chat.session.lastError, event.occurredAt);
          }
          writeTurns();
          break;
        case "thread.turn-start-requested":
        case "thread.turn-files-completed":
        case "thread.turn-reverted":
        case "thread.turn-settled":
          writeTurns();
          break;
        case "thread.proposed-plan-upserted": {
          const plan = chat.proposedPlans.find((known) => known.id === p.plan?.id);
          if (plan) {
            s.plan!.run(plan.id, chat.id, plan.turnId, plan.planMarkdown, plan.implementedAt, plan.implementationThreadId, plan.createdAt, plan.updatedAt);
          }
          break;
        }
        case "thread.reverted": {
          const previous = before.chats[chat.id];
          const kept = new Set(chat.turns.map((turn) => turn.turnId));
          for (const turn of previous?.turns ?? []) {
            if (kept.has(turn.turnId)) continue;
            this.db.prepare("DELETE FROM projection_turns WHERE thread_id = ? AND turn_id = ?").run(chat.id, turn.turnId);
            this.db.prepare("DELETE FROM projection_thread_messages WHERE thread_id = ? AND turn_id = ?").run(chat.id, turn.turnId);
            this.db.prepare("DELETE FROM projection_thread_activities WHERE thread_id = ? AND turn_id = ?").run(chat.id, turn.turnId);
            this.db.prepare("DELETE FROM projection_thread_proposed_plans WHERE thread_id = ? AND turn_id = ?").run(chat.id, turn.turnId);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------------------------------
  // The provider session runtime rows.

  sessionRuntime(chatId: string): { provider: string; status: string; resumeCursor: unknown } | undefined {
    const row = this.db.prepare("SELECT provider, status, resume_cursor_json FROM provider_session_runtime WHERE thread_id = ?").get(chatId);
    if (!row) return undefined;
    return {
      provider: String(row.provider),
      status: String(row.status),
      resumeCursor: row.resume_cursor_json === null ? undefined : JSON.parse(String(row.resume_cursor_json)),
    };
  }

  writeSessionRuntime(chatId: string, row: { provider: string; runtimeMode: string; status: string; resumeCursor?: unknown }): void {
    const known = this.sessionRuntime(chatId);
    const cursor = row.resumeCursor !== undefined ? row.resumeCursor : known?.resumeCursor;
    this.db
      .prepare(
        "INSERT OR REPLACE INTO provider_session_runtime (thread_id, provider, runtime_mode, status, last_seen_at, resume_cursor_json) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(chatId, row.provider, row.runtimeMode, row.status, this.now(), cursor === undefined ? null : JSON.stringify(cursor));
  }
}
