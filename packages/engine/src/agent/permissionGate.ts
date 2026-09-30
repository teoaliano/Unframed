import { randomUUID } from "node:crypto";
import {
  answerPermission,
  CANCELLED_MESSAGE,
  decidePermission,
  requestTarget,
  type ApprovalDecision,
  type InteractionMode,
  type PermissionUpdate,
  type RequestType,
  type RuntimeEventDraft,
  type RuntimeMode,
  type UserQuestion,
} from "@unframed/domain";

export type GateResult =
  | { readonly behavior: "allow"; readonly updatedInput?: Record<string, unknown>; readonly updatedPermissions?: ReadonlyArray<PermissionUpdate> }
  | { readonly behavior: "deny"; readonly message: string; readonly interrupt: boolean };

export interface GateCall {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly turnId: string | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly toolUseId?: string;
  readonly suggestions?: ReadonlyArray<PermissionUpdate>;
  readonly signal?: AbortSignal;
}

/** The questions an `AskUserQuestion` call carries, each id its text (the SDK matches answers by it). */
export const questionsOf = (input: Readonly<Record<string, unknown>>): UserQuestion[] => {
  const raw = Array.isArray(input.questions) ? (input.questions as Array<Record<string, unknown>>) : [];
  return raw.map((question) => {
    const text = String(question.question ?? question.id ?? "");
    return {
      id: String(question.id ?? text),
      header: String(question.header ?? ""),
      question: text,
      options: Array.isArray(question.options)
        ? (question.options as Array<Record<string, unknown>>).map((option) => ({ label: String(option.label ?? ""), description: String(option.description ?? "") }))
        : [],
      ...(question.allowCustomAnswer === undefined ? {} : { allowCustomAnswer: question.allowCustomAnswer === true }),
      multiSelect: question.multiSelect === true,
    };
  });
};

/**
 * One chat session's permission decisions (spec 07): runs the pure policy for each tool
 * call, opens a request or a question when it says so and waits for the person, and turns
 * the answer into what the provider is told. A pending request is chat state: it is sent
 * out as a runtime event, so it survives a reload.
 */
export class PermissionGate {
  private readonly requests = new Map<string, { resolve: (decision: ApprovalDecision) => void }>();
  private readonly questions = new Map<string, { resolve: (answers: Readonly<Record<string, unknown>> | undefined) => void }>();
  private readonly captured = new Set<string>();
  private readonly emit: (draft: RuntimeEventDraft) => void;

  constructor(emit: (draft: RuntimeEventDraft) => void) {
    this.emit = emit;
  }

  get pending(): number {
    return this.requests.size + this.questions.size;
  }

  async decide(call: GateCall): Promise<GateResult> {
    const answer = decidePermission({ runtimeMode: call.runtimeMode, interactionMode: call.interactionMode, tool: call.toolName, input: call.input });
    const turn = call.turnId === undefined ? {} : { turnId: call.turnId };
    switch (answer.kind) {
      case "allow":
        return { behavior: "allow" };
      case "deny":
        return { behavior: "deny", message: answer.message, interrupt: false };
      case "capture-plan": {
        const key = call.toolUseId ?? answer.plan;
        if (answer.plan !== "" && !this.captured.has(key)) {
          this.captured.add(key);
          this.emit({ type: "turn.proposed.completed", ...turn, payload: { planMarkdown: answer.plan } });
        }
        return { behavior: "deny", message: answer.message, interrupt: false };
      }
      case "question": {
        const questions = questionsOf(call.input);
        const answers = await this.ask(questions, call.turnId, call.signal);
        if (answers === undefined) return { behavior: "deny", message: CANCELLED_MESSAGE, interrupt: false };
        return { behavior: "allow", updatedInput: { ...call.input, answers } };
      }
      case "ask": {
        const decision = await this.request(
          {
            requestType: answer.requestType,
            detail: requestTarget(call.toolName, call.input),
            args: { toolName: call.toolName, input: call.input, ...(call.toolUseId ? { toolUseId: call.toolUseId } : {}) },
          },
          call.turnId,
          call.signal,
        );
        return answerPermission(decision, call.toolName, call.suggestions);
      }
    }
  }

  /** Opens a request and waits for the person's decision; an abort answers it as cancelled. */
  request(
    request: { readonly requestType: RequestType; readonly detail: string; readonly args: Readonly<Record<string, unknown>> },
    turnId: string | undefined,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    const requestId = randomUUID();
    const turn = turnId === undefined ? {} : { turnId };
    return new Promise<ApprovalDecision>((resolve) => {
      this.requests.set(requestId, {
        resolve: (decision) => {
          this.emit({ type: "request.resolved", ...turn, requestId, payload: { requestType: request.requestType, decision } });
          resolve(decision);
        },
      });
      this.emit({ type: "request.opened", ...turn, requestId, payload: { ...request } });
      signal?.addEventListener("abort", () => this.respond(requestId, "cancel"), { once: true });
      if (signal?.aborted) this.respond(requestId, "cancel");
    });
  }

  /** Opens a question and waits for the answers; `undefined` when it was cancelled. */
  ask(questions: ReadonlyArray<UserQuestion>, turnId: string | undefined, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>> | undefined> {
    const requestId = randomUUID();
    const turn = turnId === undefined ? {} : { turnId };
    return new Promise((resolve) => {
      this.questions.set(requestId, {
        resolve: (answers) => {
          this.emit({ type: "user-input.resolved", ...turn, requestId, payload: { answers: answers ?? {}, ...(answers === undefined ? { cancelled: true } : {}) } });
          resolve(answers);
        },
      });
      this.emit({ type: "user-input.requested", ...turn, requestId, payload: { questions } });
      signal?.addEventListener("abort", () => this.answer(requestId, undefined), { once: true });
      if (signal?.aborted) this.answer(requestId, undefined);
    });
  }

  respond(requestId: string, decision: ApprovalDecision): boolean {
    const pending = this.requests.get(requestId);
    if (!pending) return false;
    this.requests.delete(requestId);
    pending.resolve(decision);
    return true;
  }

  answer(requestId: string, answers: Readonly<Record<string, unknown>> | undefined): boolean {
    const pending = this.questions.get(requestId);
    if (!pending) return false;
    this.questions.delete(requestId);
    pending.resolve(answers);
    return true;
  }

  /** Resolves every open request as cancelled and every open question as unanswered. */
  cancelAll(): void {
    for (const id of [...this.requests.keys()]) this.respond(id, "cancel");
    for (const id of [...this.questions.keys()]) this.answer(id, undefined);
  }
}
