import type { ApprovalDecision } from "@unframed/contracts";
import { openRequests, planTitle, type Chat, type ChatActivity, type ProposedPlan, type UserQuestion } from "@unframed/domain";
import { Check, ChevronDown, ChevronRight, Ellipsis, ListChecks, ListTodo, MessageCircleQuestion, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { MessageAction } from "../../chrome/MessageAction.tsx";
import type { ChatClient } from "../store.ts";
import type { PromptEditorHandle } from "./PromptEditor.tsx";
import { record } from "../record.ts";
import { composerGlassClass } from "../../chrome/composerSurface.ts";

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
const BANNER =
  `${composerGlassClass} relative flex flex-col gap-1.5 rounded-2xl border px-3 py-2 text-xs/4 shadow-composer dark:shadow-composer-dark`;
const WARNING_BANNER = `${BANNER} border-warning/28 bg-linear-to-b from-warning/8 to-warning/8`;

/** The banner's first line: its icon, what it is, and anything beside it. */
const BANNER_ROW = "flex min-h-6 min-w-0 items-center gap-1.5";

/** How much of a request's target the panel shows before it says how much it held back. */
export const TARGET_SHOWN = 300;

/**
 * The pending approval (t3code's panel): the request's kind, the tool, and its target in
 * full up to 300 characters with how many more it did not show, then Decline, Approve and
 * the other answers. It clears at once on a click; a refused answer shows what is really
 * pending again.
 */
export const ApprovalPanel = ({ client, chat }: { readonly client: ChatClient; readonly chat: Chat }) => {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const pending = waitingRequests(chat, "approval").filter((activity) => !answered.has(String(record(activity.payload).requestId)));
  const request = pending[0];
  if (!request) return null;
  const payload = record(request.payload);
  const requestId = String(payload.requestId);
  const args = record(payload.args);
  const target = typeof payload.detail === "string" ? payload.detail : "";
  const shown = target.slice(0, TARGET_SHOWN);
  const hidden = target.length - shown.length;
  const header = APPROVAL_HEADERS[String(payload.requestType)] ?? "File change approval";
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
        <ShieldAlert aria-hidden className="size-4 shrink-0 text-warning" />
        <span className="shrink-0 text-2xs font-medium text-warning" data-testid="panel-title">
          {header}
        </span>
        {typeof args.toolName === "string" && (
          <span className="min-w-0 truncate text-2xs text-muted-foreground" data-testid="panel-tool">
            {args.toolName}
          </span>
        )}
        {pending.length > 1 && <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums" data-testid="panel-count">{`1/${pending.length}`}</span>}
      </header>
      {/* Whitespace kept, so padding that pushes a second command out of sight shows. */}
      <code
        className="block max-h-20 w-full min-w-0 overflow-auto font-mono text-xs whitespace-pre-wrap wrap-anywhere text-foreground [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        tabIndex={0}
        data-testid="approval-target"
      >
        {shown}
      </code>
      {hidden > 0 && (
        <p className="m-0 text-xs text-warning-foreground" data-testid="approval-warning">{`and ${hidden} more characters not shown. Decline unless you know what they are.`}</p>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <Button variant="outline" size="xs" onClick={() => respond("decline")}>
          Decline
        </Button>
        <Button size="xs" onClick={() => respond("accept")}>
          Approve
        </Button>
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="icon-xs" aria-label="More approval options" />}>
            <Ellipsis aria-hidden />
          </MenuTrigger>
          <MenuPopup side="top" align="end">
            <MenuItem onClick={() => respond("acceptForSession")}>Always allow this session</MenuItem>
            <MenuItem onClick={() => respond("cancel")}>Cancel</MenuItem>
          </MenuPopup>
        </Menu>
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
        <MessageCircleQuestion aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-muted-foreground" data-testid="panel-title">
          {question.header}
        </span>
        {collapsed && <span className="min-w-0 flex-1 truncate text-secondary-label">{question.question}</span>}
        <span className="ml-auto shrink-0 text-3xs font-medium text-muted-foreground tabular-nums" data-testid="panel-count">{`${state.index + 1}/${state.questions.length}`}</span>
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
          <p className="m-0 text-sm text-foreground/85" data-testid="panel-question">
            {question.question}
          </p>
          {question.multiSelect && (
            <p className="m-0 mt-1 flex items-center gap-1 text-xs text-secondary-label">
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
                  <kbd className="flex size-5 shrink-0 items-center justify-center font-sans text-3xs font-medium text-muted-foreground tabular-nums">{index + 1}</kbd>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1 text-start">
                    <span className="text-sm font-medium">{option.label}</span>
                    {option.description !== "" && <span className="text-2xs font-normal text-secondary-label">{option.description}</span>}
                  </span>
                  {selected && <Check aria-hidden className="size-3.5 shrink-0 text-highlight" />}
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
        <ListTodo aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-muted-foreground">Plan ready</span>
        {title !== undefined && <span className="min-w-0 flex-1 truncate text-foreground/85">{title}</span>}
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

/**
 * Answering the chat's open question from the composer (t3code's flow): an option chosen
 * in the panel or an answer typed in the box, per question; Send moves to the next and
 * sends every answer from the last. `text` is the box's current draft.
 */
export const useQuestionAnswers = (client: ChatClient, chat: Chat | undefined, box: RefObject<PromptEditorHandle | null>, text: string) => {
  const asked = openQuestion(chat);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<Record<string, ReadonlyArray<string>>>({});
  const typedAnswers = useRef<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setIndex(0);
    setChosen({});
    typedAnswers.current = {};
  }, [asked?.requestId]);
  const question = asked?.questions[index];

  /** One question's answer: what was typed for it, else the options chosen. */
  const answerOf = (current: UserQuestion, typed: string): string | string[] | undefined => {
    if (typed.trim() !== "") return typed.trim();
    const picked = chosen[current.id] ?? [];
    if (picked.length === 0) return undefined;
    return current.multiSelect ? [...picked] : picked[0];
  };
  const lastQuestion = asked !== undefined && index === asked.questions.length - 1;
  const ready =
    asked !== undefined &&
    question !== undefined &&
    !submitting &&
    (lastQuestion
      ? asked.questions.every((each) => answerOf(each, each.id === question.id ? text : (typedAnswers.current[each.id] ?? "")) !== undefined)
      : answerOf(question, text) !== undefined);

  const move = (to: number) => {
    if (!asked || !question) return;
    typedAnswers.current = { ...typedAnswers.current, [question.id]: box.current?.text() ?? "" };
    setIndex(to);
    const next = asked.questions[to];
    box.current?.setText(next ? (typedAnswers.current[next.id] ?? "") : "");
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
    const answers: Record<string, string | string[]> = {};
    for (const each of asked.questions) {
      const value = answerOf(each, typed[each.id] ?? "");
      if (value !== undefined) answers[each.id] = value;
    }
    setSubmitting(true);
    try {
      await client.dispatch({ type: "thread.user-input.respond", threadId: chat.id, requestId: asked.requestId, answers });
      box.current?.clear();
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
  return { question, answering: question !== undefined, index, lastQuestion, ready, submitting, move, answer, panel };
};
