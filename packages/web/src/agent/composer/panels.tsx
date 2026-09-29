import { Menu } from "@base-ui/react/menu";
import type { ApprovalDecision } from "@unframed/contracts";
import { openRequests, planTitle, type Chat, type ChatActivity, type ProposedPlan, type UserQuestion } from "@unframed/domain";
import { ChevronDown, ChevronRight, Ellipsis, ListChecks, X } from "lucide-react";
import { useEffect, useState } from "react";
import { itemClass, popupClass } from "../../chrome/ui.tsx";
import { messageOf } from "../send.ts";
import type { ChatClient } from "../store.ts";

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

const APPROVAL_HEADERS: Record<string, string> = {
  command_execution_approval: "Command approval",
  file_read_approval: "File read approval",
  file_change_approval: "File change approval",
  mcp_elicitation_approval: "App access approval",
  permission_approval: "App permission approval",
};

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
  const pending = openRequests(chat, "approval").filter((activity) => !answered.has(String(record(activity.payload).requestId)));
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
      client.setUi({ error: messageOf(error) });
      setAnswered((known) => new Set([...known].filter((id) => id !== requestId)));
    });
  };
  return (
    <section className="unframed-agent-panel" role="group" aria-label={header} data-testid="approval-panel">
      <header className="unframed-agent-panel__header">
        <span className="unframed-agent-panel__title">{header}</span>
        {typeof args.toolName === "string" && <span className="unframed-agent-panel__tool">{args.toolName}</span>}
        {pending.length > 1 && <span className="unframed-agent-panel__count">{`1/${pending.length}`}</span>}
      </header>
      <code className="unframed-agent-panel__target" tabIndex={0} data-testid="approval-target">
        {shown}
      </code>
      {hidden > 0 && <p className="unframed-agent-panel__warning">{`and ${hidden} more characters not shown. Decline unless you know what they are.`}</p>}
      <div className="unframed-agent-panel__actions">
        <button type="button" className="unframed-agent-button" onClick={() => respond("decline")}>
          Decline
        </button>
        <button type="button" className="unframed-agent-button unframed-agent-button--primary" onClick={() => respond("accept")}>
          Approve
        </button>
        <Menu.Root>
          <Menu.Trigger className="unframed-agent-control unframed-agent-control--icon" aria-label="More approval options">
            <Ellipsis size={14} aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="top" align="end" sideOffset={4} className="z-[1100]">
              <Menu.Popup className={popupClass}>
                <Menu.Item className={itemClass} onClick={() => respond("acceptForSession")}>
                  Always allow this session
                </Menu.Item>
                <Menu.Item className={itemClass} onClick={() => respond("cancel")}>
                  Cancel
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
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
  const request = chat ? openRequests(chat, "user-input")[0] : undefined;
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
    <section className="unframed-agent-panel" role="group" aria-label={question.header} data-testid="question-panel">
      <header className="unframed-agent-panel__header">
        <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label={collapsed ? "Show question" : "Hide question"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
        </button>
        <span className="unframed-agent-panel__title">{question.header}</span>
        <span className="unframed-agent-panel__count">{`${state.index + 1}/${state.questions.length}`}</span>
        {state.dismissable && (
          <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label="Dismiss question without answering" onClick={onDismiss}>
            <X size={13} aria-hidden />
          </button>
        )}
      </header>
      {!collapsed && (
        <>
          <p className="unframed-agent-panel__question">{question.question}</p>
          {question.multiSelect && (
            <p className="unframed-agent-panel__hint">
              <ListChecks size={12} aria-hidden /> Select one or more options.
            </p>
          )}
          <div className="unframed-agent-options" role={question.multiSelect ? "group" : "radiogroup"} aria-label={question.question}>
            {question.options.map((option, index) => (
              <button
                key={option.label}
                type="button"
                role={question.multiSelect ? "checkbox" : "radio"}
                aria-checked={chosen.includes(option.label)}
                className="unframed-agent-option"
                onClick={() => onChoose(question, option.label)}
              >
                <span className="unframed-agent-option__key">{index + 1}</span>
                <span className="unframed-agent-option__label">{option.label}</span>
                {option.description !== "" && <span className="unframed-agent-option__description">{option.description}</span>}
              </button>
            ))}
          </div>
        </>
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
    <section className="unframed-agent-banner" data-testid="plan-ready">
      <span className="unframed-agent-banner__label">Plan ready</span>
      {title !== undefined && <span className="unframed-agent-banner__title">{title}</span>}
    </section>
  );
};

/** In place of Send while a plan waits: Refine with a draft, else Implement and its menu. */
export const PlanActions = ({ refine, busy, onSend, onNewChat }: { readonly refine: boolean; readonly busy: boolean; readonly onSend: () => void; readonly onNewChat: () => void }) => {
  if (refine) {
    return (
      <button type="button" className="unframed-agent-button unframed-agent-button--primary" disabled={busy} onClick={onSend}>
        {busy ? "Sending..." : "Refine"}
      </button>
    );
  }
  return (
    <div className="unframed-agent-split" data-testid="implement-actions">
      <button type="button" className="unframed-agent-button unframed-agent-button--primary" disabled={busy} onClick={onSend}>
        {busy ? "Sending..." : "Implement"}
      </button>
      <Menu.Root>
        <Menu.Trigger className="unframed-agent-button unframed-agent-button--primary" aria-label="Implementation actions" disabled={busy}>
          <ChevronDown size={13} aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="top" align="end" sideOffset={4} className="z-[1100]">
            <Menu.Popup className={popupClass}>
              <Menu.Item className={itemClass} onClick={onNewChat}>
                Implement in a new chat
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
};
