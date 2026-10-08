/**
 * The chat decider (spec 07, t3code's shape): `decide(command, model, now)` answers the
 * events a command becomes, or the sentence it is refused with. It never does I/O; the
 * engine resolves attachments and tags against the stored files and the canvas first.
 */
import { attachmentLimitError, promptLengthError } from "./attachments.ts";
import type {
  Chat,
  ChatCommand,
  Decision,
  MessageAttachment,
  ModelSelection,
  PendingEvent,
  ProjectChats,
  Rejection,
  RejectionCode,
} from "./chatModel.ts";
import { DEFAULT_RUNTIME_MODE } from "./chatModel.ts";
import { requestActivity } from "./chatProjector.ts";

export const TITLE_MAX = 60;

export const NO_EVENTS = "Command produced no events.";

const reject = (code: RejectionCode, message: string): Decision => ({ ok: false, rejection: { code, message } });

const accept = (...events: PendingEvent[]): Decision => ({ ok: true, events });

const event = (type: PendingEvent["type"], chatId: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>): PendingEvent => ({
  type,
  aggregateId: chatId,
  payload: { threadId: chatId, ...payload },
  ...(metadata === undefined ? {} : { metadata }),
});

/** A name the person typed: trimmed and cut to 60 characters. */
export const userTitle = (typed: string): string => typed.trim().slice(0, TITLE_MAX).trim();

/** The agent's name for a chat: the reply's first line, surrounding quotes stripped, trimmed, at most 60 characters. */
export const agentTitle = (reply: string): string => {
  const first = reply.trim().split(/\r?\n/)[0] ?? "";
  const unquoted = first.trim().replace(/^["'“‘`]+|["'”’`]+$/g, "");
  return unquoted.trim().slice(0, TITLE_MAX).trim();
};

const sameSelection = (a: ModelSelection, b: ModelSelection): boolean =>
  a.provider === b.provider &&
  a.model === b.model &&
  a.traits.effort === b.traits.effort &&
  a.traits.thinking === b.traits.thinking &&
  a.traits.fastMode === b.traits.fastMode;

const isRunning = (chat: Chat): boolean => chat.latestTurn?.state === "running";

/** Checks a model change; `undefined` when it may be applied. */
const modelChangeRefusal = (chat: Chat, selection: ModelSelection): Decision | undefined => {
  if (selection.provider !== chat.modelSelection.provider) return reject("conflict", "A chat stays on the provider it started on.");
  if (isRunning(chat) && !sameSelection(selection, chat.modelSelection)) {
    return reject("conflict", "A turn is running; change the model when it finishes.");
  }
  return undefined;
};

const isResolvedAttachment = (value: unknown): value is MessageAttachment => {
  const record = value as Partial<MessageAttachment>;
  return typeof record.type === "string" && (record.kind === "image" || record.kind === "file") && typeof record.size === "number";
};

/** A question that was cleared by an interrupt or a restart, never answered. */
const isCancelled = (activity: { readonly kind: string; readonly payload: unknown }): boolean =>
  activity.kind === "user-input.resolved" && (activity.payload as { cancelled?: unknown } | null)?.cancelled === true;

const answered = (value: unknown): boolean =>
  (typeof value === "string" && value.trim() !== "") ||
  (Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.trim() !== ""));

/** Decides one command against a project's chats. */
export const decide = (command: ChatCommand, model: ProjectChats, now: string): Decision => {
  if (command.type === "project.chats.clear") {
    // Decided here, in the queue, not from the web's view: a chat that started a turn since the person asked is kept.
    const chats = Object.values(model.chats).filter((chat) => chat.deletedAt === null);
    if (chats.length === 0) return reject("not_found", "This project has no chats to delete.");
    const idle = chats.filter((chat) => !isRunning(chat));
    if (idle.length === 0) return reject("conflict", "Every chat is still running, so nothing was deleted.");
    return accept(...idle.map((chat) => event("thread.deleted", chat.id, { deletedAt: now })));
  }

  const id = command.threadId;
  const existing = model.chats[id];
  const live = existing !== undefined && existing.deletedAt === null ? existing : undefined;

  if (command.type === "thread.create") {
    if (existing) return reject("conflict", `Thread '${id}' already exists and cannot be created twice.`);
    return accept(
      event("thread.created", id, {
        projectId: command.projectId,
        modelSelection: command.modelSelection,
        runtimeMode: command.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        interactionMode: command.interactionMode ?? "default",
        tags: [...new Set(command.tags ?? [])],
        createdAt: command.createdAt,
      }),
    );
  }

  if (!live) return reject("not_found", `Thread '${id}' does not exist.`);
  const chat = live;

  switch (command.type) {
    case "thread.delete":
      return accept(event("thread.deleted", id, { deletedAt: now }));

    case "thread.meta.update": {
      const payload: Record<string, unknown> = {};
      if (command.modelSelection !== undefined) {
        const refusal = modelChangeRefusal(chat, command.modelSelection);
        if (refusal) return refusal;
        payload.modelSelection = command.modelSelection;
      }
      if (command.title !== undefined) {
        const title = userTitle(command.title);
        payload.title = title;
        payload.titledBy = title === "" ? null : "user";
      }
      if (Object.keys(payload).length === 0) return reject("bad_request", NO_EVENTS);
      return accept(event("thread.meta-updated", id, payload));
    }

    case "thread.runtime-mode.set":
      return accept(event("thread.runtime-mode-set", id, { runtimeMode: command.runtimeMode }));

    case "thread.interaction-mode.set":
      return accept(event("thread.interaction-mode-set", id, { interactionMode: command.interactionMode }));

    case "thread.turn.start": {
      const running = isRunning(chat);
      const steer = running && command.steer === true;
      if (running && !steer) return reject("conflict", "The agent is still answering the previous message.");
      const events: PendingEvent[] = [];
      let selection = chat.modelSelection;
      if (command.modelSelection !== undefined) {
        const refusal = modelChangeRefusal(chat, command.modelSelection);
        if (refusal) return refusal;
        if (!sameSelection(command.modelSelection, chat.modelSelection)) {
          selection = command.modelSelection;
          events.push(event("thread.meta-updated", id, { modelSelection: selection }));
        }
      }
      const { message } = command;
      if (message.text.trim() === "" && message.attachments.length === 0) return reject("bad_request", "Say something first.");
      const tooLong = promptLengthError(message.text);
      if (tooLong) return reject("bad_request", tooLong);
      const attachments = message.attachments.filter(isResolvedAttachment);
      if (attachments.length !== message.attachments.length) {
        const unread = message.attachments.find((attachment) => !isResolvedAttachment(attachment));
        return reject("bad_request", `'${unread?.name ?? "attachment"}' is empty or could not be read.`);
      }
      const overLimit = attachmentLimitError(attachments);
      if (overLimit) return reject("bad_request", overLimit);

      const turnId = steer ? chat.latestTurn!.turnId : `turn:${message.messageId}`;
      const turnCount = steer ? chat.latestTurn!.turnCount : (chat.turns.at(-1)?.turnCount ?? 0) + 1;
      events.push(
        event("thread.message-sent", id, {
          messageId: message.messageId,
          role: "user",
          text: message.text,
          turnId,
          streaming: false,
          attachments: attachments.map(({ id: attachmentId, name, type, kind, size }) => ({ id: attachmentId, name, type, kind, size })),
          ...(message.context ? { context: { selection: [...message.context.selection] } } : {}),
          createdAt: command.createdAt,
        }),
        event("thread.turn-start-requested", id, {
          turnId,
          turnCount,
          messageId: message.messageId,
          steer,
          modelSelection: selection,
          runtimeMode: chat.runtimeMode,
          interactionMode: chat.interactionMode,
          ...(command.sourceProposedPlan ? { sourceProposedPlan: command.sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        }),
      );
      const source = command.sourceProposedPlan;
      if (source) {
        const plan = model.chats[source.threadId]?.proposedPlans.find((known) => known.id === source.planId);
        if (plan && plan.implementedAt === null) {
          events.push(
            event("thread.proposed-plan-upserted", source.threadId, {
              plan: { ...plan, implementedAt: now, implementationThreadId: id, updatedAt: now },
            }),
          );
        }
      }
      return accept(...events);
    }

    case "thread.turn.interrupt":
      return accept(event("thread.turn-interrupt-requested", id, { turnId: command.turnId ?? chat.latestTurn?.turnId ?? null }));

    case "thread.approval.respond": {
      const request = requestActivity(chat, "approval", command.requestId);
      if (request?.kind !== "approval.requested") return reject("not_found", "That request is no longer waiting for an answer.");
      return accept(
        event("thread.approval-response-requested", id, { requestId: command.requestId, decision: command.decision }, { requestId: command.requestId }),
      );
    }

    case "thread.user-input.respond": {
      const request = requestActivity(chat, "user-input", command.requestId);
      if (request === undefined || isCancelled(request)) return reject("not_found", "This question is no longer pending.");
      if (request.kind === "user-input.resolved") return reject("conflict", "This question has already been answered.");
      const questions = ((request.payload as { questions?: Array<{ id?: unknown }> }).questions ?? []).map((question) => String(question.id));
      if (questions.some((question) => !answered(command.answers[question]))) return reject("bad_request", "Answer each question before sending.");
      return accept(
        event("thread.user-input-response-requested", id, { requestId: command.requestId, answers: command.answers }, { requestId: command.requestId }),
      );
    }

    case "thread.user-input.dismiss": {
      const request = requestActivity(chat, "user-input", command.requestId);
      if (request === undefined || isCancelled(request)) return reject("not_found", "This question is no longer pending.");
      if (request.kind === "user-input.resolved") return reject("conflict", "This question has already been answered.");
      if ((request.payload as { responseMode?: unknown }).responseMode !== "message") {
        return reject("conflict", "This question needs an answer. Answer it or stop the turn.");
      }
      return accept(
        event("thread.activity-appended", id, {
          activity: {
            id: `dismiss:${command.requestId}`,
            tone: "info",
            kind: "user-input.resolved",
            summary: "Question dismissed",
            payload: { requestId: command.requestId, dismissed: true },
            turnId: request.turnId,
            createdAt: now,
          },
        }),
      );
    }

    case "thread.turn.revert": {
      if (isRunning(chat)) return reject("conflict", "Wait for the turn to finish before reverting.");
      const turn = chat.turns.find((known) => known.turnCount === command.turnCount);
      if (!turn) return reject("not_found", "That turn is not in this chat.");
      if (turn.reverted || turn.revertRequestedAt !== undefined) return reject("conflict", "That turn is already reverted.");
      return accept(event("thread.turn-revert-requested", id, { turnCount: command.turnCount }));
    }

    case "thread.checkpoint.revert": {
      if (isRunning(chat)) return reject("conflict", "Wait for the turn to finish before reverting.");
      const count = chat.turns.at(-1)?.turnCount ?? 0;
      if (!Number.isInteger(command.turnCount) || command.turnCount < 0 || command.turnCount > count) {
        return reject("bad_request", "That turn is not in this chat.");
      }
      // The later turns leave the chat at once, so a message sent right after the rewind is
      // numbered after the kept turns; the canvas and the provider catch up in the reactor.
      const later = chat.turns.filter((turn) => turn.turnCount > command.turnCount).sort((a, b) => b.turnCount - a.turnCount);
      return accept(
        event("thread.checkpoint-revert-requested", id, {
          turnCount: command.turnCount,
          restoreCanvas: command.restoreCanvas,
          dropped: later.length,
          revertTurns: later.filter((turn) => !turn.reverted).map((turn) => turn.turnCount),
        }),
        event("thread.reverted", id, { turnCount: command.turnCount }),
      );
    }

    case "thread.session.stop":
      return accept(event("thread.session-stop-requested", id, {}));

    case "thread.session.set":
      return accept(event("thread.session-set", id, { session: command.session }));

    case "thread.message.assistant.delta":
    case "thread.message.reasoning.delta":
      if (command.delta === "") return reject("bad_request", NO_EVENTS);
      return accept(
        event("thread.message-sent", id, {
          messageId: command.messageId,
          role: command.type === "thread.message.assistant.delta" ? "assistant" : "reasoning",
          text: command.delta,
          turnId: command.turnId,
          streaming: true,
          createdAt: now,
        }),
      );

    case "thread.message.assistant.complete":
    case "thread.message.reasoning.complete":
      return accept(
        event("thread.message-sent", id, {
          messageId: command.messageId,
          role: command.type === "thread.message.assistant.complete" ? "assistant" : "reasoning",
          text: command.text ?? "",
          turnId: command.turnId,
          streaming: false,
          createdAt: now,
        }),
      );

    case "thread.proposed-plan.upsert": {
      const known = chat.proposedPlans.find((plan) => plan.id === command.planId);
      return accept(
        event("thread.proposed-plan-upserted", id, {
          plan: {
            id: command.planId,
            turnId: command.turnId,
            planMarkdown: command.planMarkdown,
            implementedAt: known?.implementedAt ?? null,
            implementationThreadId: known?.implementationThreadId ?? null,
            createdAt: known?.createdAt ?? now,
            updatedAt: now,
          },
        }),
      );
    }

    case "thread.activity.append":
      return accept(event("thread.activity-appended", id, { activity: command.activity }));

    case "thread.tags.add": {
      const fresh = [...new Set(command.ids)].filter((tag) => !chat.tags.includes(tag));
      if (fresh.length === 0) return reject("bad_request", NO_EVENTS);
      return accept(event("thread.tagged", id, { ids: fresh }));
    }

    case "thread.tags.remove": {
      const gone = [...new Set(command.ids)].filter((tag) => chat.tags.includes(tag));
      if (gone.length === 0) return reject("not_found", "This chat is not linked to that artifact.");
      return accept(event("thread.untagged", id, { ids: gone }));
    }

    case "thread.turn.files.complete":
      return accept(event("thread.turn-files-completed", id, { turnCount: command.turnCount, files: command.files }));

    case "thread.turn.reverted.complete":
      return accept(
        event("thread.turn-reverted", id, { turn: command.turnCount, restored: command.restored, skipped: command.skipped, at: now }),
      );

    case "thread.title.generate.complete": {
      const title = agentTitle(command.title);
      if (chat.titledBy === "user" || title === "") return reject("bad_request", NO_EVENTS);
      return accept(event("thread.meta-updated", id, { title, titledBy: "agent" }));
    }

    case "thread.turn.settle": {
      const turn = chat.turns.find((known) => known.turnCount === command.turnCount);
      return accept(
        event("thread.turn-settled", id, {
          turnCount: command.turnCount,
          turnId: turn?.turnId ?? null,
          clock: command.clock,
          ...(command.usage === undefined ? {} : { usage: command.usage }),
        }),
      );
    }
  }
};

export type { Rejection };
