import type { ApprovalDecision, ChatAttachment } from "@unframed/contracts";
import { DEFAULT_APPROVAL_OPTIONS, openRequests, planTitle, type ApprovalOption, type Chat, type ChatActivity, type ProposedPlan, type UserQuestion } from "@unframed/domain";
import { Check, ChevronDown, ChevronRight, Ellipsis, ListChecks, ListTodo, MessageCircleQuestion, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { MessageAction } from "../../chrome/MessageAction.tsx";
import type { ChatClient } from "../store.ts";
import type { PromptEditorHandle } from "./PromptEditor.tsx";
import { record } from "../record.ts";
import { composerGlassClass } from "../../chrome/composerSurface.ts";
import { ChatMarkdown } from "../transcript/ChatMarkdown.tsx";

/** A request's id, as its payload carries it. */
export const requestIdOf = (activity: ChatActivity): string => String(record(activity.payload).requestId);

/** The chat's open requests of a kind that its running turn waits on: a turn that ended waits on nothing. */
export const waitingRequests = (chat: Chat, kind: "approval" | "user-input"): ChatActivity[] => {
  const running = chat.latestTurn?.state === "running" ? chat.latestTurn.turnId : undefined;
  return openRequests(chat, kind).filter((activity) => activity.turnId === null || activity.turnId === running);
};

const APPROVAL_HEADERS: Record<string, string> = {
  command_execution_approval: "Command approval",
  file_read_approval: "File read approval",
  file_change_approval: "File change approval",
  mcp_elicitation_approval: "App access approval",
  permission_approval: "App permission approval",
};

/**
 * t3code's composer banner (ComposerBanner): the glass strip above the composer that holds
 * what waits on the person. An approval takes its warning tint.
 */
export const BANNER = cn(
  composerGlassClass,
  "relative flex flex-col gap-1.5 rounded-2xl border border-(--banner-border) bg-(--banner-surface)/(--banner-surface-opacity) px-3 py-2 text-xs/4 text-(--banner-foreground) shadow-(--shadow-app-floating)",
);
export const WARNING_BANNER = cn(
  BANNER,
  "border-(--banner-warning-border)/(--banner-warning-border-opacity) bg-linear-to-b from-(--banner-warning-tint)/(--banner-warning-tint-opacity) to-(--banner-warning-tint)/(--banner-warning-tint-opacity)",
);

/** The banner's first line: its icon, what it is, and anything beside it. */
export const BANNER_ROW = "flex min-h-6 min-w-0 items-center gap-1.5";

/** How much of a request's target the panel shows before it says how much it held back. */
export const TARGET_SHOWN = 300;

const DECISIONS: ReadonlySet<string> = new Set(["accept", "acceptForSession", "decline", "cancel"]);

/** The answers a request offers: the provider's when it named them, else the fixed four (a request stored before options existed names none). */
export const approvalOptions = (payload: Readonly<Record<string, unknown>>): ReadonlyArray<ApprovalOption> => {
  if (!Array.isArray(payload.options)) return DEFAULT_APPROVAL_OPTIONS;
  const options = payload.options
    .map(record)
    .filter((option) => typeof option.decision === "string" && DECISIONS.has(option.decision) && typeof option.label === "string" && option.label.trim() !== "")
    .map((option) => ({
      decision: option.decision as ApprovalDecision,
      label: String(option.label),
      ...(typeof option.warning === "string" && option.warning.trim() !== "" ? { warning: option.warning } : {}),
    }));
  return options.length > 0 ? options : DEFAULT_APPROVAL_OPTIONS;
};

/** An answer with a warning shows it on hover and to a screen reader (t3code's). */
const withWarning = (option: ApprovalOption, element: ReactElement) =>
  option.warning ? (
    <Tooltip key={option.decision}>
      <TooltipTrigger render={element} />
      <TooltipPopup side="top">{option.warning}</TooltipPopup>
    </Tooltip>
  ) : (
    element
  );

/**
 * The pending approval (t3code's panel): the request's kind, the tool, its target in full
 * up to 300 characters with how many more it did not show, the provider's reason, then the
 * answers it offers: Decline and Approve as buttons, the rest in the menu. It clears at once
 * on a click; a refused answer shows what is really pending again. One the typing guard
 * holds is not shown yet.
 */
export const ApprovalPanel = ({ client, chat, held }: { readonly client: ChatClient; readonly chat: Chat; readonly held: ReadonlySet<string> }) => {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const pending = waitingRequests(chat, "approval").filter((activity) => !answered.has(requestIdOf(activity)) && !held.has(requestIdOf(activity)));
  const request = pending[0];
  if (!request) return null;
  const payload = record(request.payload);
  const requestId = String(payload.requestId);
  const args = record(payload.args);
  const target = typeof payload.detail === "string" ? payload.detail : "";
  const reason = typeof payload.reason === "string" && payload.reason.trim() !== "" ? payload.reason : undefined;
  const shown = target.slice(0, TARGET_SHOWN);
  const hidden = target.length - shown.length;
  const header = APPROVAL_HEADERS[String(payload.requestType)] ?? "File change approval";
  const options = approvalOptions(payload);
  const primary = options.filter((option) => option.decision === "decline" || option.decision === "accept");
  const more = options.filter((option) => option.decision !== "decline" && option.decision !== "accept");
  const respond = (decision: ApprovalDecision) => {
    setAnswered((known) => new Set([...known, requestId]));
    client.dispatch({ type: "thread.approval.respond", threadId: chat.id, requestId, decision }).catch((error: unknown) => {
      client.reportError(error);
      setAnswered((known) => new Set([...known].filter((id) => id !== requestId)));
    });
  };
  return (
    <section className={WARNING_BANNER} role="group" aria-label={header} data-testid="approval-panel">
      <header className={BANNER_ROW}>
        <ShieldAlert aria-hidden className="size-4 shrink-0 text-(--banner-warning-icon)" />
        <span className="shrink-0 text-2xs font-medium text-(--banner-warning-title)" data-testid="panel-title">
          {header}
        </span>
        {typeof args.toolName === "string" && (
          <span className="min-w-0 truncate text-2xs text-(--banner-secondary)" data-testid="panel-tool">
            {args.toolName}
          </span>
        )}
        {pending.length > 1 && <span className="ml-auto shrink-0 text-2xs text-(--banner-secondary) tabular-nums" data-testid="panel-count">{`1/${pending.length}`}</span>}
      </header>
      {/* Whitespace kept, so padding that pushes a second command out of sight shows. */}
      <code
        className="block max-h-20 w-full min-w-0 overflow-auto font-mono text-xs whitespace-pre-wrap wrap-anywhere text-(--banner-foreground) [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--banner-ring-focus)/(--banner-ring-focus-opacity)"
        tabIndex={0}
        data-testid="approval-target"
      >
        {shown}
      </code>
      {hidden > 0 && (
        <p className="m-0 text-xs text-(--banner-warning-text)" data-testid="approval-warning">{`and ${hidden} more characters not shown. Decline unless you know what they are.`}</p>
      )}
      {reason !== undefined && (
        <p className="m-0 w-full min-w-0 text-2xs text-(--banner-description) wrap-break-word" data-testid="approval-reason">
          {reason}
        </p>
      )}
      <div className="flex items-center justify-end gap-1.5">
        {primary.map((option) =>
          withWarning(
            option,
            <Button
              key={option.decision}
              variant={option.decision === "accept" ? "default" : "outline"}
              size="xs"
              aria-description={option.warning}
              onClick={() => respond(option.decision)}
            >
              {option.warning ? <TriangleAlert aria-hidden className="size-3 shrink-0" /> : null}
              <span className="max-w-40 truncate">{option.label}</span>
            </Button>,
          ),
        )}
        {more.length > 0 && (
          <Menu>
            <MenuTrigger render={<Button variant="outline" size="icon-xs" aria-label="More approval options" />}>
              <Ellipsis aria-hidden />
            </MenuTrigger>
            <MenuPopup side="top" align="end">
              {more.map((option) =>
                withWarning(
                  option,
                  <MenuItem key={option.decision} aria-description={option.warning} onClick={() => respond(option.decision)}>
                    {option.warning ? <TriangleAlert aria-hidden className="size-3 text-(--banner-warning-icon)" /> : null}
                    <span className="min-w-0 whitespace-normal wrap-break-word">{option.label}</span>
                  </MenuItem>,
                ),
              )}
            </MenuPopup>
          </Menu>
        )}
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------------------
// Questions.

export interface QuestionState {
  readonly request: ChatActivity;
  readonly requestId: string;
  readonly questions: ReadonlyArray<UserQuestion>;
  readonly index: number;
  /** The options chosen per question, by label. */
  readonly chosen: Readonly<Record<string, ReadonlyArray<string>>>;
  /** The questions may be dismissed without an answer: the turn does not wait on them. */
  readonly dismissable: boolean;
}

/** The chat's open question, if any, as the panel shows it. */
export const openQuestion = (chat: Chat | undefined): { request: ChatActivity; requestId: string; questions: ReadonlyArray<UserQuestion>; dismissable: boolean } | undefined => {
  const request = chat ? waitingRequests(chat, "user-input")[0] : undefined;
  if (!request) return undefined;
  const payload = record(request.payload);
  const questions = Array.isArray(payload.questions) ? (payload.questions as UserQuestion[]) : [];
  return { request, requestId: String(payload.requestId), questions, dismissable: payload.responseMode === "message" };
};

/** A question that takes only its options: no answer of one's own. */
export const choiceOnly = (question: UserQuestion | undefined): boolean => question !== undefined && question.options.length > 0 && question.allowCustomAnswer !== true;

/**
 * The agent's question (t3code's panel): its header, "i/N", the question and its options
 * (keys 1 to 9 choose while focus is outside a field; a single choice moves on after a
 * moment). An answer of one's own is typed in the composer.
 */
export const QuestionPanel = ({
  state,
  onChoose,
  onDismiss,
}: {
  readonly state: QuestionState;
  readonly onChoose: (question: UserQuestion, label: string) => void;
  readonly onDismiss: () => void;
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const question = state.questions[state.index];
  useEffect(() => {
    if (!question) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const option = question.options[n - 1];
      if (!option) return;
      event.preventDefault();
      onChoose(question, option.label);
    };
    // Capture: the rail stops keys from bubbling to the document, where tldraw listens.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [question, onChoose]);
  if (!question) return null;
  const chosen = state.chosen[question.id] ?? [];
  return (
    <section className={BANNER} role="group" aria-label={question.header} data-testid="question-panel">
      <header className={BANNER_ROW}>
        <MessageCircleQuestion aria-hidden className="size-3.5 shrink-0 text-(--banner-icon)" />
        <span className="shrink-0 font-medium text-(--banner-title)" data-testid="panel-title">
          {question.header}
        </span>
        {collapsed && <span className="min-w-0 flex-1 truncate text-(--banner-secondary)">{question.question}</span>}
        <span className="ml-auto shrink-0 text-3xs font-medium text-(--banner-secondary) tabular-nums" data-testid="panel-count">{`${state.index + 1}/${state.questions.length}`}</span>
        <Button variant="ghost-muted" size="icon-xs" aria-label={collapsed ? "Show question" : "Hide question"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
        </Button>
        {state.dismissable && (
          <Button variant="ghost-muted" size="icon-xs" aria-label="Dismiss question without answering" onClick={onDismiss}>
            <X aria-hidden />
          </Button>
        )}
      </header>
      {!collapsed && (
        <div className="pe-1 pb-1 wrap-anywhere">
          <div className="text-(--banner-foreground)/(--banner-body-opacity)" data-testid="panel-question">
            <ChatMarkdown text={question.question} />
          </div>
          {question.multiSelect && (
            <p className="m-0 mt-1 flex items-center gap-1 text-xs text-(--banner-secondary)">
              <ListChecks aria-hidden className="size-3" /> Select one or more options.
            </p>
          )}
          <div className="mt-2 flex flex-col gap-0.5" role={question.multiSelect ? "group" : "radiogroup"} aria-label={question.question}>
            {question.options.map((option, index) => {
              const selected = chosen.includes(option.label);
              return (
                <Button
                  key={option.label}
                  variant="ghost"
                  size="sm-multiline"
                  role={question.multiSelect ? "checkbox" : "radio"}
                  aria-checked={selected}
                  data-pressed={selected ? "" : undefined}
                  className="w-full justify-start"
                  onClick={() => onChoose(question, option.label)}
                >
                  <kbd className="flex size-5 shrink-0 items-center justify-center font-sans text-3xs font-medium text-(--banner-secondary) tabular-nums">{index + 1}</kbd>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1 text-start">
                    <span className="text-sm font-medium">{option.label}</span>
                    {option.description !== "" && <span className="text-2xs font-normal text-(--banner-description)">{option.description}</span>}
                  </span>
                  {selected && <Check aria-hidden className="size-3.5 shrink-0 text-(--banner-option-icon-selected)" />}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------------------
// A plan ready to implement.

/** Above the composer once a plan waits (t3code's banner): "Plan ready" and its title. */
export const PlanReady = ({ plan }: { readonly plan: ProposedPlan }) => {
  const title = planTitle(plan.planMarkdown);
  return (
    <section className={BANNER} data-testid="plan-ready">
      <div className={BANNER_ROW}>
        <ListTodo aria-hidden className="size-3.5 shrink-0 text-(--banner-icon)" />
        <span className="shrink-0 font-medium text-(--banner-title)">Plan ready</span>
        {title !== undefined && <span className="min-w-0 flex-1 truncate text-(--banner-foreground)/(--banner-body-opacity)">{title}</span>}
      </div>
    </section>
  );
};

/** In place of Send while a plan waits: Refine with a draft, else Implement and its menu. */
export const PlanActions = ({ refine, busy, onSend, onNewChat }: { readonly refine: boolean; readonly busy: boolean; readonly onSend: () => void; readonly onNewChat: () => void }) => {
  if (refine) {
    return (
      <MessageAction tone="pill" disabled={busy} onClick={onSend}>
        {busy ? "Sending..." : "Refine"}
      </MessageAction>
    );
  }
  return (
    <div className="flex items-center" data-testid="implement-actions">
      <MessageAction tone="pillStart" disabled={busy} onClick={onSend}>
        {busy ? "Sending..." : "Implement"}
      </MessageAction>
      <Menu>
        <MenuTrigger render={<MessageAction tone="pillEnd" aria-label="Implementation actions" disabled={busy} />}>
          <ChevronDown aria-hidden />
        </MenuTrigger>
        <MenuPopup side="top" align="end">
          <MenuItem onClick={onNewChat}>Implement in a new chat</MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
};

/** The composer's staged files, as an answer takes them: each question keeps its own (t3code's per-question attachment draft). */
export interface AnswerFiles {
  readonly staged: ReadonlyArray<{ readonly status: "uploading" | "ready" | "failed" }>;
  readonly ready: () => ChatAttachment[];
  readonly settle: () => Promise<ChatAttachment[]>;
  readonly replace: (attachments: ReadonlyArray<ChatAttachment>) => void;
}

/**
 * Answering the chat's open question from the composer (t3code's flow): an option chosen
 * in the panel or an answer typed in the box, per question, and files attached to it; Send
 * moves to the next and sends every answer from the last. `text` is the box's current
 * answer. A file alone answers a question that takes an answer of one's own. A question the
 * typing guard holds is not asked yet.
 */
export const useQuestionAnswers = (client: ChatClient, chat: Chat | undefined, box: RefObject<PromptEditorHandle | null>, text: string, held: ReadonlySet<string>, files: AnswerFiles) => {
  const open = openQuestion(chat);
  const asked = open && !held.has(open.requestId) ? open : undefined;
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<Record<string, ReadonlyArray<string>>>({});
  const typedAnswers = useRef<Record<string, string>>({});
  const attachedFiles = useRef<Record<string, ReadonlyArray<ChatAttachment>>>({});
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setIndex(0);
    setChosen({});
    typedAnswers.current = {};
    attachedFiles.current = {};
  }, [asked?.requestId]);
  const question = asked?.questions[index];

  /** One question's answer: what was typed for it, else the options chosen. */
  const answerOf = (current: UserQuestion, typed: string): string | string[] | undefined => {
    if (typed.trim() !== "") return typed.trim();
    const picked = chosen[current.id] ?? [];
    if (picked.length === 0) return undefined;
    return current.multiSelect ? [...picked] : picked[0];
  };
  /** How many files a question holds: the box's for the one shown. */
  const fileCount = (current: UserQuestion): number =>
    choiceOnly(current) ? 0 : current.id === question?.id ? files.staged.filter((item) => item.status !== "failed").length : (attachedFiles.current[current.id]?.length ?? 0);
  const answers = (current: UserQuestion, typed: string): boolean => answerOf(current, typed) !== undefined || fileCount(current) > 0;
  const lastQuestion = asked !== undefined && index === asked.questions.length - 1;
  const ready =
    asked !== undefined &&
    question !== undefined &&
    !submitting &&
    (lastQuestion
      ? asked.questions.every((each) => answers(each, each.id === question.id ? text : (typedAnswers.current[each.id] ?? "")))
      : answers(question, text));

  const move = (to: number) => {
    if (!asked || !question) return;
    typedAnswers.current = { ...typedAnswers.current, [question.id]: box.current?.text() ?? "" };
    attachedFiles.current = { ...attachedFiles.current, [question.id]: files.ready() };
    setIndex(to);
    const next = asked.questions[to];
    box.current?.setText(next ? (typedAnswers.current[next.id] ?? "") : "");
    files.replace(next ? (attachedFiles.current[next.id] ?? []) : []);
  };
  const choose = (current: UserQuestion, label: string) => {
    setChosen((known) => {
      const was = known[current.id] ?? [];
      const next = current.multiSelect ? (was.includes(label) ? was.filter((item) => item !== label) : [...was, label]) : [label];
      return { ...known, [current.id]: next };
    });
    if (!current.multiSelect && asked && index < asked.questions.length - 1) setTimeout(() => move(index + 1), 200);
  };
  const answer = async () => {
    if (!asked || !question || !chat || !ready) return;
    if (!lastQuestion) return move(index + 1);
    const typed = { ...typedAnswers.current, [question.id]: box.current?.text() ?? "" };
    setSubmitting(true);
    try {
      const attached = { ...attachedFiles.current, [question.id]: await files.settle() };
      const answers: Record<string, string | string[]> = {};
      const attachmentsByQuestionId: Record<string, ChatAttachment[]> = {};
      for (const each of asked.questions) {
        const value = answerOf(each, typed[each.id] ?? "");
        if (value !== undefined) answers[each.id] = value;
        const eachFiles = choiceOnly(each) ? [] : (attached[each.id] ?? []);
        if (eachFiles.length > 0) attachmentsByQuestionId[each.id] = [...eachFiles];
      }
      // The box keeps the answer until the question goes; then the composer puts the draft back.
      await client.dispatch({
        type: "thread.user-input.respond",
        threadId: chat.id,
        requestId: asked.requestId,
        answers,
        ...(Object.keys(attachmentsByQuestionId).length === 0 ? {} : { attachmentsByQuestionId }),
      });
    } catch (error) {
      client.reportError(error);
    } finally {
      setSubmitting(false);
    }
  };
  const dismiss = () => {
    if (!asked || !chat) return;
    void client.dispatch({ type: "thread.user-input.dismiss", threadId: chat.id, requestId: asked.requestId }).catch((error: unknown) => client.reportError(error));
  };
  const panel =
    asked && question ? <QuestionPanel state={{ ...asked, index, chosen }} onChoose={choose} onDismiss={dismiss} /> : null;
  return { question, requestId: asked?.requestId, answering: question !== undefined, index, lastQuestion, ready, submitting, move, answer, panel };
};
