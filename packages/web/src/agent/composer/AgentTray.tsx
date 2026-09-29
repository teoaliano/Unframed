import type { ChatAttachment, ModelSelection } from "@unframed/contracts";
import {
  actionablePlan,
  continuableChat,
  DEFAULT_RUNTIME_MODE,
  implementPlanText,
  implementPlanTitle,
  pasteBecomesFile,
  pastedTextFileName,
  tabLabel,
  type InteractionMode,
  type RuntimeMode,
  type UserQuestion,
} from "@unframed/domain";
import { ArrowLeft, ArrowUp, Paperclip, Square } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AgentTrayProps as SlotProps } from "../../chrome/slots.ts";
import { useEngine } from "../../context.ts";
import { effectiveModel, noProviderReady, providerName, readyProviders } from "../providers.ts";
import { createChat, sendMessage } from "../send.ts";
import { useChatClient, useChats, useFollowUp, useHandoffVersion, useProviders, useRailUi, useWatchedThread, type ChatClient } from "../store.ts";
import { latestCompletedTool, returnQueued, sendQueued } from "../queue.tsx";
import { Tip } from "../../chrome/ui.tsx";
import { formatSize, useAttachments } from "./attachments.ts";
import { StashMenu, useStash } from "./stash.tsx";
import { ApprovalPanel, choiceOnly, openQuestion, PlanActions, PlanReady, QuestionPanel, waitingRequests } from "./panels.tsx";
import { platform } from "../../canvas/platform.ts";
import { showNotice } from "../../toasts.tsx";
import { AttachmentShelf } from "./AttachmentShelf.tsx";
import { ChipRow, contextSelection, useSelectionChips } from "./chips.tsx";
import { ComposerMenu, type MenuItem } from "./ComposerMenu.tsx";
import { mentionItems } from "./mentions.tsx";
import { slashItems, skillMenuItems } from "./commands.tsx";
import { ContextMeter, declaredTraits, latestUsage, ModelPicker, PlanToggle, RuntimeModePicker, TraitsPicker } from "./pickers.tsx";
import { PromptEditor, type PromptEditorHandle, type Trigger } from "./PromptEditor.tsx";
import { useMaybeEditor, useValue } from "tldraw";

export const PROMPT_LABEL = "Message the agent";

export const PLACEHOLDERS = {
  approval: "Resolve this approval request to continue",
  choiceOnly: "Choose an option above",
  customAnswer: "Type your own answer, or leave this blank to use the selected option",
  planFollowUp: "Add feedback to refine the plan, or leave this blank to implement it",
  noProvider: "Connect Claude or Codex to start",
  default: "Ask, or say what should change… @ to mention, / for commands",
} as const;

export interface AgentTrayProps {
  readonly client: ChatClient;
  readonly variant: "rail" | "toolbar";
  /** The chat the next message goes to; `null` starts one. */
  readonly chatId: string | null;
  /** What a new chat is tagged with: the selected artifacts. */
  readonly newChatTags: ReadonlyArray<string>;
  /** Called with the target chat before the message goes out (the toolbar opens the rail on it). */
  readonly beforeSend?: (chatId: string) => void;
  /** Called once the message was accepted. */
  readonly onSent?: () => void;
  /** A line under the chips (the toolbar's "continues" line). */
  readonly underChips?: ReactNode;
  /** A line beside Send (the toolbar's provider note). */
  readonly note?: (provider: string) => ReactNode;
  /** Tells the composer shell a menu of the tray is open, so Esc closes the menu first. */
  readonly onMenuOpen?: (key: string, open: boolean) => void;
  /** The element files may be dropped on (the whole rail); the tray itself when absent. */
  readonly dropTarget?: RefObject<HTMLElement | null>;
}

interface OpenMenu {
  readonly label: string;
  readonly trigger: Trigger;
  readonly items: ReadonlyArray<MenuItem>;
  readonly empty: string;
  readonly pick: (item: MenuItem) => void;
}

/**
 * The composer's Agent tray (spec 08), built on t3code's composer: a Tiptap box, the
 * footer's pickers, Stop and Send. The rail's composer and the toolbar's are this one
 * component; only where a message goes differs.
 */
export const AgentTray = ({ client, variant, chatId, newChatTags, beforeSend, onSent, underChips, note, onMenuOpen, dropTarget }: AgentTrayProps) => {
  const ui = useRailUi(client);
  const { statuses } = useProviders(client);
  const chat = useWatchedThread(client, chatId);
  const running = chat?.latestTurn?.state === "running";
  const noProvider = noProviderReady(statuses);
  const ready = readyProviders(statuses);
  const canvas = useMaybeEditor();
  const box = useRef<PromptEditorHandle>(null);
  const [text, setText] = useState("");
  const chips = useSelectionChips(canvas, text.trim() === "");
  const [trigger, setTrigger] = useState<Trigger>();
  const [sending, setSending] = useState(false);
  const [draftModel, setDraftModel] = useState<ModelSelection | undefined>();
  const [draftRuntime, setDraftRuntime] = useState<RuntimeMode>(DEFAULT_RUNTIME_MODE);
  const [draftInteraction, setDraftInteraction] = useState<InteractionMode>("default");
  const showError = useCallback((message: string) => client.setUi({ error: message }), [client]);
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  /** The model a message runs on: the chat's, or for a new chat the one picked here, else the first ready provider's default. */
  const selection: ModelSelection = useMemo(
    () => chat?.modelSelection ?? draftModel ?? { provider: ready[0] ?? "claude", model: "", traits: {} },
    [chat?.modelSelection, draftModel, ready],
  );
  const runtimeMode = chat?.runtimeMode ?? draftRuntime;
  const interactionMode = chat?.interactionMode ?? draftInteraction;
  const model = effectiveModel(statuses, selection.provider, selection.model);
  const status = statuses?.[selection.provider];
  const setModelSelection = (next: ModelSelection) => {
    if (!chat) return setDraftModel(next);
    void client.dispatch({ type: "thread.meta.update", threadId: chat.id, modelSelection: next }).catch((error: unknown) => client.reportError(error));
  };
  const setRuntime = (mode: RuntimeMode) => {
    if (!chat) return setDraftRuntime(mode);
    void client.dispatch({ type: "thread.runtime-mode.set", threadId: chat.id, runtimeMode: mode }).catch((error: unknown) => client.reportError(error));
  };
  const setInteraction = (mode: InteractionMode) => {
    if (!chat) return setDraftInteraction(mode);
    void client.dispatch({ type: "thread.interaction-mode.set", threadId: chat.id, interactionMode: mode }).catch((error: unknown) => client.reportError(error));
  };
  const usage = latestUsage(chat);
  const compactable = (status?.commands ?? []).some((command) => command.name === "compact");
  const attachments = useAttachments(client.engine, showError);
  const files = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropElement, setDropElement] = useState<HTMLElement | null>(null);
  useEffect(() => setDropElement(dropTarget?.current ?? root.current), [dropTarget]);

  useEffect(() => {
    const element = dropElement;
    if (!element) return;
    let depth = 0;
    const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      setDragging(false);
      void attachments.add([...(event.dataTransfer?.files ?? [])]);
    };
    element.addEventListener("dragenter", enter);
    element.addEventListener("dragover", over);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    return () => {
      element.removeEventListener("dragenter", enter);
      element.removeEventListener("dragover", over);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
    };
  }, [dropElement, attachments]);

  /** Cmd+Shift+V (Ctrl+Shift+V off Mac) keeps the next large paste inline. */
  const inlineNext = useRef(0);

  /**
   * A paste of files attaches them (text pasted with them stays text); a large text paste
   * becomes a text file attachment, unless Cmd+Shift+V asked for it inline.
   */
  const onPaste = (event: ClipboardEvent): boolean => {
    const data = event.clipboardData;
    const pasted = [...(data?.files ?? [])];
    const pastedText = data?.getData("text/plain") ?? "";
    if (pasted.length > 0) {
      void attachments.add(pasted);
      if (pastedText === "") {
        event.preventDefault();
        return true;
      }
      return false;
    }
    const inline = Date.now() - inlineNext.current < 1500;
    inlineNext.current = 0;
    if (pastedText === "" || inline || !pasteBecomesFile(pastedText, text.length)) return false;
    event.preventDefault();
    const name = pastedTextFileName(attachments.staged.map((item) => item.name));
    const file = new File([pastedText], name, { type: "text/plain;charset=utf-8" });
    void attachments.add([file]);
    showNotice(`Large paste attached as ${name}`, "info", `${formatSize(file.size)} · Use ${platform() === "darwin" ? "⌘⇧V" : "Ctrl+Shift+V"} to keep a large paste inline.`);
    return true;
  };

  useEffect(() => {
    void client.loadProviders();
  }, [client]);

  const boxElement = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number>();
  useEffect(() => setHighlight(0), [trigger?.char, trigger?.query, trigger?.from]);
  // Reactive, so a shape that lands while the menu is open is offered.
  const mentionRows = useValue("mentions", () => (trigger?.char === "@" && canvas ? mentionItems(canvas, trigger.query) : undefined), [canvas, trigger]);
  const menu = useMemo((): OpenMenu | undefined => {
    if (!trigger || dismissedAt === trigger.from) return undefined;
    if (trigger.char === "@" && mentionRows) {
      const items = mentionRows;
      return {
        label: "Mentions",
        trigger,
        items,
        empty: "No matching shapes or files.",
        pick: (item) => {
          const chosen = items.find((known) => known.key === item.key);
          if (!chosen) return;
          box.current?.replaceTrigger(trigger, chosen.chip);
          if (chosen.shapeId !== undefined) chips.add([chosen.shapeId]);
        },
      };
    }
    if (trigger.char === "/") {
      const wholeDraft = text.trim() === `/${trigger.query}` && attachments.staged.length === 0;
      const items = slashItems({ query: trigger.query, status, provider: selection.provider, wholeDraft });
      return {
        label: "Commands",
        trigger,
        items,
        empty: status === undefined ? "Searching skills..." : "No matching command.",
        pick: (item) => {
          const chosen = items.find((known) => known.key === item.key);
          if (!chosen) return;
          if (chosen.kind === "builtin") {
            box.current?.replaceTrigger(trigger, "");
            if (chosen.name === "model") setModelOpen(true);
            else setInteraction(chosen.name === "plan" ? "plan" : "default");
          } else if (chosen.kind === "provider") {
            box.current?.replaceTrigger(trigger, `/${chosen.name} `);
          } else {
            box.current?.replaceTrigger(trigger, { kind: "skill", label: "", title: chosen.name, ref: chosen.name });
          }
        },
      };
    }
    if (trigger.char === "$") {
      const items = skillMenuItems(trigger.query, status, selection.provider);
      return {
        label: "Skills",
        trigger,
        items,
        empty: status === undefined ? "Searching skills..." : "No skills found. Try / to browse provider commands.",
        pick: (item) => box.current?.replaceTrigger(trigger, { kind: "skill", label: "", title: item.key.slice("skill:".length), ref: item.key.slice("skill:".length) }),
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, dismissedAt, mentionRows, chips, text, attachments.staged.length, status, selection.provider, chat?.id]);
  useEffect(() => {
    if (trigger === undefined || trigger.from !== dismissedAt) setDismissedAt(undefined);
  }, [trigger, dismissedAt]);
  useEffect(() => {
    onMenuOpen?.("agent-menu", menu !== undefined);
  }, [onMenuOpen, menu]);
  useEffect(() => () => onMenuOpen?.("agent-menu", false), [onMenuOpen]);

  // ArrowUp in an empty box recalls this chat's earlier messages, newest first; editing one ends the recall.
  const recall = useRef<{ index: number; text: string } | undefined>(undefined);
  useEffect(() => {
    recall.current = undefined;
  }, [chatId]);
  const history = (direction: "up" | "down"): boolean => {
    const earlier = (chat?.messages ?? []).filter((message) => message.role === "user").map((message) => message.text).reverse();
    const current = box.current?.text() ?? "";
    const recalled = recall.current;
    if (recalled && recalled.text !== current) recall.current = undefined;
    const line = box.current?.caretLine() ?? { first: true, last: true };
    if (!recall.current) {
      if (direction === "down" || current !== "" || earlier.length === 0) return false;
      recall.current = { index: 0, text: earlier[0]! };
      box.current?.setText(earlier[0]!);
      return true;
    }
    if (direction === "up") {
      if (!line.first) return false;
      const index = recall.current.index + 1;
      if (index >= earlier.length) return true;
      recall.current = { index, text: earlier[index]! };
      box.current?.setText(earlier[index]!);
      return true;
    }
    if (!line.last) return false;
    const index = recall.current.index - 1;
    if (index < 0) {
      recall.current = undefined;
      box.current?.clear();
      return true;
    }
    recall.current = { index, text: earlier[index]! };
    box.current?.setText(earlier[index]!);
    return true;
  };

  /** Keys the box gives the tray first: an open menu takes its arrows, Enter, Tab and Esc. */
  const onKey = (event: KeyboardEvent): boolean => {
    const command = platform() === "darwin" ? event.metaKey : event.ctrlKey;
    if (command && event.shiftKey && event.key.toLowerCase() === "v") {
      inlineNext.current = Date.now();
      return false;
    }
    if (command && !event.shiftKey && event.key.toLowerCase() === "s") {
      stashKey();
      return true;
    }
    // The stash menu opened from the keyboard may not have the focus yet: Esc in the box still closes it.
    if (event.key === "Escape" && stashOpen) {
      event.stopPropagation();
      setStashOpen(false);
      return true;
    }
    if (command && event.shiftKey && event.key === "Enter" && chat) {
      const oldest = client.queue(chat.id)[0];
      if (oldest) void sendQueued(client, chat.id, oldest.id);
      return true;
    }
    if (command && event.shiftKey && event.key.toLowerCase() === "a") {
      setModeOpen(true);
      return true;
    }
    if (!menu && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      return history(event.key === "ArrowUp" ? "up" : "down");
    }
    if (event.key === "Tab" && event.shiftKey && !menu) {
      setInteraction(interactionMode === "plan" ? "default" : "plan");
      return true;
    }
    if (menu) {
      const count = menu.items.length;
      if (event.key === "ArrowDown" && count > 0) setHighlight((highlight + 1) % count);
      else if (event.key === "ArrowUp" && count > 0) setHighlight((highlight - 1 + count) % count);
      else if ((event.key === "Enter" || event.key === "Tab") && !event.isComposing) {
        const item = menu.items[highlight] ?? menu.items[0];
        if (item) menu.pick(item);
      } else if (event.key === "Escape") {
        event.stopPropagation();
        setDismissedAt(menu.trigger.from);
      } else return false;
      return true;
    }
    return false;
  };

  // What waits on the person in this chat: an approval, a question, a plan to implement.
  const approvalPending = variant === "rail" && chat !== undefined && waitingRequests(chat, "approval").length > 0;
  const asked = variant === "rail" ? openQuestion(chat) : undefined;
  const [questionIndex, setQuestionIndex] = useState(0);
  const [chosen, setChosen] = useState<Record<string, ReadonlyArray<string>>>({});
  const ownAnswers = useRef<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setQuestionIndex(0);
    setChosen({});
    ownAnswers.current = {};
  }, [asked?.requestId]);
  const question = asked?.questions[questionIndex];
  const answering = asked !== undefined && question !== undefined;
  const planFollowUp = variant === "rail" && chat !== undefined && !running && !answering && interactionMode === "plan" && attachments.staged.length === 0 ? actionablePlan(chat) : undefined;

  const placeholder = approvalPending
    ? PLACEHOLDERS.approval
    : answering
      ? choiceOnly(question)
        ? PLACEHOLDERS.choiceOnly
        : PLACEHOLDERS.customAnswer
      : planFollowUp
        ? PLACEHOLDERS.planFollowUp
        : noProvider
          ? PLACEHOLDERS.noProvider
          : PLACEHOLDERS.default;

  /** One question's answer: what was typed for it, else the options chosen. */
  const answerOf = (current: UserQuestion, typed: string): string | string[] | undefined => {
    if (typed.trim() !== "") return typed.trim();
    const picked = chosen[current.id] ?? [];
    if (picked.length === 0) return undefined;
    return current.multiSelect ? [...picked] : picked[0];
  };
  const questionAnswered = answering && answerOf(question, text) !== undefined;
  const allAnswered = answering && asked.questions.every((each) => answerOf(each, each.id === question.id ? text : (ownAnswers.current[each.id] ?? "")) !== undefined);
  const lastQuestion = answering && questionIndex === asked.questions.length - 1;
  const canSend = answering ? !submitting && (lastQuestion ? allAnswered : questionAnswered) : planFollowUp ? !sending : !noProvider && !sending && (text.trim() !== "" || attachments.staged.length > 0);

  const moveQuestion = (index: number) => {
    if (!asked || !question) return;
    ownAnswers.current = { ...ownAnswers.current, [question.id]: box.current?.text() ?? "" };
    setQuestionIndex(index);
    const next = asked.questions[index];
    box.current?.setText(next ? (ownAnswers.current[next.id] ?? "") : "");
  };
  const chooseOption = (current: UserQuestion, label: string) => {
    setChosen((known) => {
      const was = known[current.id] ?? [];
      const next = current.multiSelect ? (was.includes(label) ? was.filter((item) => item !== label) : [...was, label]) : [label];
      return { ...known, [current.id]: next };
    });
    if (!current.multiSelect && asked && questionIndex < asked.questions.length - 1) {
      setTimeout(() => moveQuestion(questionIndex + 1), 200);
    }
  };
  /** Send while a question waits: the next question, or every answer at once from the last. */
  const answer = async () => {
    if (!asked || !question || !chat || !canSend) return;
    if (!lastQuestion) return moveQuestion(questionIndex + 1);
    const typed = { ...ownAnswers.current, [question.id]: box.current?.text() ?? "" };
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
  const dismissQuestion = () => {
    if (!asked || !chat) return;
    void client.dispatch({ type: "thread.user-input.dismiss", threadId: chat.id, requestId: asked.requestId }).catch((error: unknown) => client.reportError(error));
  };

  /** Implement: the chat back to building, then the plan after t3code's prefix; or the same in a new chat named after it. */
  const implementPlan = async (inNewChat: boolean) => {
    if (!chat || !planFollowUp || sending) return;
    const message = { text: implementPlanText(planFollowUp.planMarkdown), selection: [], attachments: [] };
    const source = { sourceProposedPlan: { threadId: chat.id, planId: planFollowUp.id } };
    setSending(true);
    client.setUi({ error: undefined });
    try {
      if (inNewChat) {
        const target = await createChat(
          client,
          { modelSelection: chat.modelSelection, runtimeMode: chat.runtimeMode, interactionMode: "default", tags: chat.tags, title: implementPlanTitle(planFollowUp.planMarkdown) },
          message.text,
        );
        await sendMessage(client, target, message, source);
      } else {
        await client.dispatch({ type: "thread.interaction-mode.set", threadId: chat.id, interactionMode: "default" });
        await sendMessage(client, chat.id, message, source);
      }
    } catch (error) {
      client.reportError(error);
    } finally {
      setSending(false);
    }
  };

  const followUp = useFollowUp(client);
  const stash = useStash(client.engine, client.project);
  const [stashOpen, setStashOpen] = useState(false);
  const restoreDraft = (draft: { readonly text: string; readonly selection: ReadonlyArray<string>; readonly attachments: ReadonlyArray<ChatAttachment> }) => {
    box.current?.setText(draft.text);
    chips.set(draft.selection);
    attachments.restore(draft.attachments);
  };
  /** Cmd+S: a draft goes to the stash; with an empty box the only entry comes back, or the menu opens. */
  const stashKey = () => {
    const draft = box.current?.text() ?? "";
    if (draft.trim() !== "" || attachments.staged.length > 0) {
      stash.push({ text: draft, selection: chips.shapes.map((shape) => shape.id), attachments: attachments.staged.flatMap((item) => (item.attachment ? [item.attachment] : [])) });
      box.current?.clear();
      attachments.clear();
      chips.set(canvas?.getSelectedShapeIds() ?? []);
    } else if (stash.entries.length === 1) {
      restoreDraft(stash.entries[0]!);
      stash.remove(stash.entries[0]!.id);
    } else {
      setStashOpen(true);
    }
  };
  const send = async (invert = false) => {
    if (answering) return answer();
    const message = box.current?.text() ?? "";
    if (planFollowUp && message.trim() === "") return implementPlan(false);
    if (noProvider || (message.trim() === "" && attachments.staged.length === 0) || sending) return;
    setSending(true);
    client.setUi({ error: undefined });
    try {
      let target = chatId;
      if (target === null) {
        target = await createChat(client, { modelSelection: selection, runtimeMode: draftRuntime, interactionMode: draftInteraction, tags: newChatTags }, message);
      }
      beforeSend?.(target);
      const context = contextSelection(canvas, chips.shapes);
      const uploaded = await attachments.settle();
      box.current?.clear();
      attachments.clear();
      chips.set(canvas?.getSelectedShapeIds() ?? []);
      const outgoing = { text: message, selection: context, attachments: uploaded };
      const current = client.thread(target);
      if (current?.latestTurn?.state === "running") {
        // Queue waits for the turn's next tool call or its end; Steer joins the turn now. Cmd+Enter flips it once.
        const steer = (followUp === "steer") !== invert;
        if (steer) await sendMessage(client, target, outgoing, { steer: true });
        else client.enqueue(target, outgoing, latestCompletedTool(current));
      } else {
        await sendMessage(client, target, outgoing);
      }
      onSent?.();
    } catch (error) {
      client.reportError(error);
      if ((box.current?.text() ?? "") === "") box.current?.setText(message);
    } finally {
      setSending(false);
    }
  };

  // A draft handed back to this chat (a cancelled queued message, Edit from here) lands in the box.
  const handoffs = useHandoffVersion(client);
  useEffect(() => {
    if (chatId === null) return;
    const drafts = client.takeHandoffs(chatId);
    if (drafts.length === 0) return;
    const current = box.current?.text() ?? "";
    const returned = drafts.map((draft) => draft.text).join("\n\n");
    box.current?.setText(current.trim() === "" ? returned : `${current}\n\n${returned}`);
    chips.set([...new Set(drafts.flatMap((draft) => draft.selection))]);
    attachments.restore(drafts.flatMap((draft) => draft.attachments));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffs, chatId, client]);

  const interrupt = () => {
    if (!chat?.latestTurn) return;
    // Stop gives every queued message back to the composer.
    returnQueued(client, chat.id);
    void client.dispatch({ type: "thread.turn.interrupt", threadId: chat.id, turnId: chat.latestTurn.turnId }).catch((error: unknown) => client.reportError(error));
  };


  return (
    <div className="unframed-agent-tray" data-variant={variant} data-testid="agent-tray" ref={root}>
      {approvalPending && chat && <ApprovalPanel client={client} chat={chat} />}
      {asked && question && <QuestionPanel state={{ ...asked, index: questionIndex, chosen }} onChoose={chooseOption} onDismiss={dismissQuestion} />}
      {planFollowUp && <PlanReady plan={planFollowUp} />}
      {dragging &&
        dropElement &&
        createPortal(
          <div className="unframed-agent-drop" data-testid="drop-overlay">
            Drop files to attach
          </div>,
          dropElement,
        )}
      <div className="unframed-agent-box" ref={boxElement} data-dragging={dragging ? "" : undefined}>
        <AttachmentShelf staged={attachments.staged} onRemove={attachments.remove} onRetry={attachments.retry} />
        <ChipRow
          shapes={chips.shapes}
          onRemove={(ids) => {
            chips.remove(ids);
            box.current?.focus();
          }}
        />
        {underChips}
        <PromptEditor
          placeholder={placeholder}
          label={PROMPT_LABEL}
          onChange={setText}
          onTrigger={setTrigger}
          onKey={onKey}
          onSubmit={(event) => void send(platform() === "darwin" ? event.metaKey : event.ctrlKey)}
          onPaste={onPaste}
          handle={box}
          disabled={answering && choiceOnly(question)}
          autofocus={variant === "toolbar"}
        />
        {menu && <ComposerMenu label={menu.label} items={menu.items} highlight={highlight} empty={menu.empty} anchor={boxElement} onPick={menu.pick} onHighlight={setHighlight} />}
        <div className="unframed-agent-footer">
          <div className="unframed-agent-footer__tools">
            <Tip label="Attach files" side="top">
              <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label="Attach files" onClick={() => files.current?.click()}>
                <Paperclip size={15} aria-hidden />
              </button>
            </Tip>
            <input
              ref={files}
              type="file"
              multiple
              hidden
              data-testid="attach-input"
              onChange={(event) => {
                const chosen = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = "";
                if (chosen.length > 0) void attachments.add(chosen);
              }}
            />
            <ModelPicker
              statuses={statuses}
              selection={selection}
              providerLocked={chat !== undefined}
              disabled={running}
              open={modelOpen}
              onOpenChange={setModelOpen}
              onPick={(provider, picked) =>
                setModelSelection({ provider, model: picked.id, traits: provider === selection.provider ? declaredTraits(picked, selection.traits) : {} })
              }
            />
            <TraitsPicker
              provider={selection.provider}
              model={model}
              traits={selection.traits}
              disabled={running}
              onChange={(traits) => setModelSelection({ ...selection, traits: declaredTraits(model, traits) })}
            />
            <RuntimeModePicker mode={runtimeMode} open={modeOpen} onOpenChange={setModeOpen} onChange={setRuntime} />
            <PlanToggle mode={interactionMode} onToggle={() => setInteraction(interactionMode === "plan" ? "default" : "plan")} />
            {usage && chat && (
              <ContextMeter
                usage={usage}
                compactUnavailable={!compactable}
                onCompact={() => void sendMessage(client, chat.id, { text: "/compact", selection: [], attachments: [] }, { steer: running }).catch((error: unknown) => client.reportError(error))}
              />
            )}
          </div>
          <div className="unframed-agent-footer__send">
            {note?.(providerName(selection.provider))}
            <StashMenu
              entries={stash.entries}
              open={stashOpen}
              onOpenChange={(open) => {
                setStashOpen(open);
                if (!open) box.current?.focus();
              }}
              onRestore={(entry) => {
                restoreDraft(entry);
                stash.remove(entry.id);
              }}
              onDelete={(entry) => stash.remove(entry.id)}
            />
            {running && (
              <button type="button" className="unframed-agent-stop" aria-label="Stop generation" onClick={interrupt}>
                <Square size={12} aria-hidden fill="currentColor" />
              </button>
            )}
            {answering ? (
              <>
                {questionIndex > 0 && (
                  <button type="button" className="unframed-agent-button" disabled={submitting} onClick={() => moveQuestion(questionIndex - 1)}>
                    Previous
                  </button>
                )}
                <button type="button" className="unframed-agent-button unframed-agent-button--primary" disabled={!canSend} onClick={() => void answer()}>
                  {submitting ? "Submitting..." : !lastQuestion ? "Next question" : questionIndex > 0 ? "Submit answers" : "Submit answer"}
                </button>
              </>
            ) : planFollowUp ? (
              <PlanActions refine={text.trim() !== ""} busy={sending} onSend={() => void send()} onNewChat={() => void implementPlan(true)} />
            ) : (
              <button type="button" className="unframed-agent-send" aria-label={running ? "Queue message" : "Send"} disabled={!canSend} onClick={() => void send()}>
                <ArrowUp size={15} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
      {/* The rail is closed while the toolbar's tray is open: its errors show here. */}
      {variant === "toolbar" && ui.error !== undefined && (
        <p role="alert" className="unframed-agent-tray__error">
          {ui.error}
        </p>
      )}
    </div>
  );
};

const ARTIFACT_TYPES = new Set(["page", "motion"]);

/**
 * The toolbar composer's Agent tray: the message continues the newest chat that has seen
 * every selected artifact, or starts one tagged with them, and says which; Send opens the
 * rail on that chat before the message goes out.
 */
export const ToolbarAgentTray = ({ project, close, onMenuOpen }: SlotProps) => {
  const client = useChatClient(useEngine(), project);
  const canvas = useMaybeEditor();
  const chats = useChats(client);
  const artifactKey = useValue(
    "selected artifacts",
    () => (canvas?.getSelectedShapes() ?? []).filter((shape) => ARTIFACT_TYPES.has(shape.type)).map((shape) => shape.id).join(" "),
    [canvas],
  );
  const artifacts = useMemo(() => (artifactKey === "" ? [] : artifactKey.split(" ")), [artifactKey]);
  const continuable = continuableChat(chats, artifacts);
  // An error the rail showed earlier is not about this message.
  useEffect(() => client.setUi({ error: undefined }), [client]);
  const [fresh, setFresh] = useState(false);
  const target = fresh || !continuable ? null : continuable.id;
  return (
    <AgentTray
      client={client}
      variant="toolbar"
      chatId={target}
      newChatTags={artifacts}
      beforeSend={(chatId) => client.setUi({ open: true, chosen: chatId, pinned: null })}
      onSent={close}
      {...(onMenuOpen ? { onMenuOpen } : {})}
      underChips={
        <div className="unframed-agent-target" data-testid="agent-target">
          <span className="unframed-agent-target__line">
            {target !== null && continuable ? (
              <>
                continues <em>{tabLabel(continuable)}</em>
              </>
            ) : (
              "new chat"
            )}
          </span>
          {target !== null ? (
            <button type="button" className="unframed-agent-button unframed-agent-button--ghost" onClick={() => setFresh(true)}>
              New chat instead
            </button>
          ) : continuable ? (
            <button type="button" className="unframed-agent-button unframed-agent-button--ghost" onClick={() => setFresh(false)}>
              Continue the earlier chat
            </button>
          ) : null}
          <span className="flex-1" />
          <Tip label="Back to tools (Esc)" side="top">
            <button type="button" className="unframed-agent-control unframed-agent-control--icon" aria-label="Back to tools (Esc)" onClick={close}>
              <ArrowLeft size={14} aria-hidden />
            </button>
          </Tip>
        </div>
      }
      note={(provider) => <span className="unframed-agent-note">{`${provider} · not metered`}</span>}
    />
  );
};
