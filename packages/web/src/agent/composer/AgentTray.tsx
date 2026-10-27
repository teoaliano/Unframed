import type { ChatAttachment, ModelSelection } from "@unframed/contracts";
import {
  actionablePlan,
  agentSelectionOf,
  appendRestoredPrompt,
  continuableChat,
  DEFAULT_RUNTIME_MODE,
  followUpAction,
  implementPlanText,
  implementPlanTitle,
  mergeRestored,
  pasteBecomesFile,
  pastedTextFileName,
  promptHistoryEntries,
  promptLengthError,
  stepPromptHistory,
  tabLabel,
  type InteractionMode,
  type PromptHistoryPosition,
  type RuntimeMode,
} from "@unframed/domain";
import { ArrowLeft, CornerUpRight, ListPlus, Paperclip } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AgentTrayProps as SlotProps } from "../../chrome/slots.ts";
import { useEngine } from "../../context.ts";
import { effectiveModel, noProviderReady, providerName, readyProviders } from "../providers.ts";
import { createChat, sendMessage } from "../send.ts";
import { EMPTY_DRAFT, NEW_CHAT, sameDraft, useChatClient, useChats, useDraftVersion, useFollowUp, useHandoffVersion, usePlanMode, useProviders, useRailUi, useWatchedThread, type ChatClient } from "../store.ts";
import { latestCompletedTool, returnQueued, sendQueued } from "../queue.tsx";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Tip } from "../../chrome/ui.tsx";
import { MessageAction, SendArrow, StopSquare } from "../../chrome/MessageAction.tsx";
import { formatSize, useAttachments } from "./attachments.ts";
import { StashMenu, useStash } from "./stash.tsx";
import { ApprovalPanel, choiceOnly, openQuestion, PlanActions, PlanReady, requestIdOf, useQuestionAnswers, waitingRequests } from "./panels.tsx";
import { useTypingGuard } from "./typingGuard.ts";
import { platform } from "../../canvas/platform.ts";
import { showNotice } from "../../toasts.tsx";
import { AttachmentShelf } from "./AttachmentShelf.tsx";
import { ChipRow, contextSelection, useSelectionChips } from "./chips.tsx";
import { ComposerMenu, type MenuItem } from "./ComposerMenu.tsx";
import { mentionItems } from "./mentions.tsx";
import { slashItems, skillMenuItems } from "./commands.tsx";
import { CompactControlsMenu, ContextMeter, declaredTraits, latestUsage, ModelPicker, TraitsPicker } from "./pickers.tsx";
import { PromptEditor, type PromptEditorHandle, type Trigger } from "./PromptEditor.tsx";
import { useMaybeEditor, useValue } from "tldraw";
import { Input } from "~/components/ui/input";
import { composerGlassClass } from "../../chrome/composerSurface.ts";

export const PROMPT_LABEL = "Message the agent";

/**
 * t3code's composer shell (ComposerSurface): a rounded glass box with the composer shadow
 * and a hairline outline, the outline turning to the ring while files are dragged over.
 */
const COMPOSER_SHELL =
  `${composerGlassClass} relative isolate flex flex-col gap-1.5 rounded-3xl px-3 pt-2.5 pb-2 shadow-composer dark:shadow-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border data-dragging:after:border-ring`;

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

/** Whether Cmd or Ctrl is held: Send then shows the other follow-up action (t3code's). */
const useCommandHeld = (): boolean => {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const update = (event: KeyboardEvent) => setHeld(event.metaKey || event.ctrlKey);
    const reset = () => setHeld(false);
    window.addEventListener("keydown", update, true);
    window.addEventListener("keyup", update, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", update, true);
      window.removeEventListener("keyup", update, true);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return held;
};

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
  // A rail's draft lives on the client, one per chat, so the editor's rail and the canvas
  // rail show the same text whichever is mounted. The toolbar's tray keeps its own.
  const draftKey = variant === "rail" ? (chatId ?? NEW_CHAT) : undefined;
  const [initialDraft] = useState(() => (draftKey === undefined ? EMPTY_DRAFT : client.draft(draftKey)));
  // A box that opens on a question shows its answer; the draft waits on the client.
  const [initialText] = useState(() => (variant === "rail" && openQuestion(chat) !== undefined ? "" : initialDraft.text));
  const [text, setText] = useState(initialText);
  const draftKeyRef = useRef(draftKey);
  const draftVersion = useDraftVersion(client, draftKey ?? "");
  const chips = useSelectionChips(canvas, text.trim() === "");
  /** The context chips this draft's @ mentions added: they belong to the draft, not to the canvas selection. */
  const mentionIds = useRef<ReadonlyArray<string>>([]);
  /** A question holds the box for its answer: the draft is set aside on the client until it goes. */
  const answeringRef = useRef(false);
  const guard = useTypingGuard(
    chatId ?? NEW_CHAT,
    variant === "rail" && chat ? [...waitingRequests(chat, "approval"), ...waitingRequests(chat, "user-input")].map(requestIdOf) : [],
  );
  const saveDraft = (value: string) => {
    if (draftKeyRef.current !== undefined && !answeringRef.current) client.setDraft(draftKeyRef.current, { text: value, mentions: mentionIds.current });
  };
  const onDraftChange = (value: string, typed: boolean) => {
    setText(value);
    if (answeringRef.current) return;
    if (typed) guard.onType();
    saveDraft(value);
  };
  /** After a send or a stash the chips go back to the selection, and no mention is the draft's any more. */
  const forgetMentions = () => {
    mentionIds.current = [];
  };
  // Declared before the handoff effect: on a chat switch the chat's draft lands first, then any handoff joins it.
  useEffect(() => {
    draftKeyRef.current = draftKey;
    if (draftKey === undefined) return;
    const stored = client.draft(draftKey);
    const shown = { text: box.current?.text() ?? "", mentions: mentionIds.current };
    if (sameDraft(shown, stored)) return;
    const kept = chips.shapes.map((shape) => shape.id).filter((id) => !mentionIds.current.includes(id));
    // Set first: the text below fires a change, which saves the draft with these mentions.
    mentionIds.current = stored.mentions;
    chips.set([...kept, ...stored.mentions.filter((id) => !kept.includes(id))]);
    if (shown.text !== stored.text && !answeringRef.current) box.current?.setText(stored.text, { focus: false, undoable: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, draftKey, draftVersion]);
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
    () => (chat ? agentSelectionOf(chat.modelSelection) : undefined) ?? draftModel ?? { provider: ready[0] ?? "claude", model: "", traits: {} },
    [chat?.modelSelection, draftModel, ready],
  );
  const runtimeMode = chat?.runtimeMode ?? draftRuntime;
  const planMode = usePlanMode(client);
  // With plan mode off, as t3code ships it, every chat runs in build mode.
  const interactionMode = planMode ? (chat?.interactionMode ?? draftInteraction) : "default";
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
          if (chosen.shapeId !== undefined) {
            chips.add([chosen.shapeId]);
            if (!mentionIds.current.includes(chosen.shapeId)) mentionIds.current = [...mentionIds.current, chosen.shapeId];
            saveDraft(box.current?.text() ?? "");
          }
        },
      };
    }
    if (trigger.char === "/") {
      const wholeDraft = text.trim() === `/${trigger.query}` && attachments.staged.length === 0;
      const items = slashItems({ query: trigger.query, status, provider: selection.provider, wholeDraft, planMode });
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
  // The More menu too: an Escape in it closes the menu, not the toolbar's composer.
  useEffect(() => {
    onMenuOpen?.("more-controls", modeOpen);
  }, [onMenuOpen, modeOpen]);
  useEffect(() => () => onMenuOpen?.("more-controls", false), [onMenuOpen]);

  // ArrowUp recalls this chat's earlier messages (t3code's prompt history); editing one ends the recall.
  const historyPosition = useRef<PromptHistoryPosition | null>(null);
  useEffect(() => {
    historyPosition.current = null;
  }, [chatId]);
  const history = (direction: "backward" | "forward"): boolean => {
    if (answeringRef.current || attachments.staged.length > 0) return false;
    const current = box.current?.text() ?? "";
    const position = historyPosition.current;
    if (position === null && current.length > 0) return false;
    if (!box.current?.caretOnVisualEdge(direction === "backward" ? "start" : "end")) return false;
    // Built on the keypress: the messages change with every streamed reply.
    const step = stepPromptHistory({ direction, entries: promptHistoryEntries(chat?.messages ?? []), position, currentPrompt: current });
    if (!step) return false;
    historyPosition.current = step.position;
    box.current?.setText(step.prompt);
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
      return history(event.key === "ArrowUp" ? "backward" : "forward");
    }
    if (planMode && event.key === "Tab" && event.shiftKey && !menu) {
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
  const approvalPending = variant === "rail" && chat !== undefined && waitingRequests(chat, "approval").some((request) => !guard.held.has(requestIdOf(request)));
  const questions = useQuestionAnswers(client, variant === "rail" ? chat : undefined, box, text, guard.held);
  const { question, answering } = questions;
  answeringRef.current = answering;
  // A question takes the box for its answer; once it goes, the draft set aside comes back.
  const questionKey = answering ? `${chatId}:${questions.requestId}` : undefined;
  const shownQuestion = useRef<string | undefined>(undefined);
  useEffect(() => {
    const was = shownQuestion.current;
    shownQuestion.current = questionKey;
    if (questionKey === was) return;
    if (questionKey !== undefined) {
      box.current?.setText("", { focus: false, undoable: false });
      return;
    }
    if (draftKeyRef.current === undefined) return;
    const draft = client.draft(draftKeyRef.current).text;
    if ((box.current?.text() ?? "") !== draft) box.current?.setText(draft, { focus: false, undoable: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionKey]);
  const lengthError = answering ? undefined : promptLengthError(text);
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

  const canSend = answering
    ? questions.ready
    : lengthError === undefined && (planFollowUp ? !sending : !noProvider && !sending && (text.trim() !== "" || attachments.staged.length > 0));

  /** Implement: the chat back to building, then the plan after t3code's prefix; or the same in a new chat named after it. */
  const implementPlan = async (inNewChat: boolean) => {
    if (!chat || !planFollowUp || sending) return;
    const message = { text: implementPlanText(planFollowUp.planMarkdown), selection: [], attachments: [] };
    const source = { sourceProposedPlan: { threadId: chat.id, planId: planFollowUp.id } };
    // A plan belongs to an in-app chat; an outside chat has no plan to implement.
    const planSelection = agentSelectionOf(chat.modelSelection);
    if (planSelection === undefined) return;
    setSending(true);
    client.setUi({ error: undefined });
    try {
      if (inNewChat) {
        const target = await createChat(
          client,
          { modelSelection: planSelection, runtimeMode: chat.runtimeMode, interactionMode: "default", tags: chat.tags, title: implementPlanTitle(planFollowUp.planMarkdown) },
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
  /**
   * A draft put back (a stash entry, queued messages given back, Edit from here) joins the
   * current one: its text after the draft's, its chips and attachments added (t3code's).
   * While a question holds the box it joins the draft set aside.
   */
  const restoreDraft = (draft: { readonly text: string; readonly selection: ReadonlyArray<string>; readonly attachments: ReadonlyArray<ChatAttachment> }) => {
    const aside = answeringRef.current ? draftKeyRef.current : undefined;
    if (aside !== undefined) client.setDraft(aside, { text: appendRestoredPrompt(client.draft(aside).text, draft.text), mentions: mentionIds.current });
    else box.current?.setText(appendRestoredPrompt(box.current.text(), draft.text));
    chips.add(draft.selection);
    attachments.restore(draft.attachments);
  };
  /** Cmd+S: a draft goes to the stash; with an empty box the only entry comes back, or the menu opens. */
  const stashKey = () => {
    const draft = box.current?.text() ?? "";
    if (draft.trim() !== "" || attachments.staged.length > 0) {
      stash.push({ text: draft, selection: chips.shapes.map((shape) => shape.id), attachments: attachments.staged.flatMap((item) => (item.attachment ? [item.attachment] : [])) });
      forgetMentions();
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
    if (answering) {
      guard.onSend();
      return questions.answer();
    }
    const message = box.current?.text() ?? "";
    const sentFrom = draftKeyRef.current;
    if (promptLengthError(message) !== undefined) return;
    guard.onSend();
    if (planFollowUp && message.trim() === "") return implementPlan(false);
    if (noProvider || (message.trim() === "" && attachments.staged.length === 0) || sending) return;
    setSending(true);
    client.setUi({ error: undefined });
    try {
      let target = chatId;
      if (target === null) {
        target = await createChat(client, { modelSelection: selection, runtimeMode: draftRuntime, interactionMode, tags: newChatTags }, message);
      }
      beforeSend?.(target);
      const context = contextSelection(canvas, chips.shapes);
      const uploaded = await attachments.settle();
      forgetMentions();
      box.current?.clear();
      // A new chat's send switches this tray to the chat it made, so the draft it came from is cleared by key.
      if (sentFrom !== undefined) client.setDraft(sentFrom, EMPTY_DRAFT);
      attachments.clear();
      chips.set(canvas?.getSelectedShapeIds() ?? []);
      const outgoing = { text: message, selection: context, attachments: uploaded };
      const current = client.thread(target);
      if (!planMode && current?.interactionMode === "plan") await client.dispatch({ type: "thread.interaction-mode.set", threadId: target, interactionMode: "default" });
      if (current?.latestTurn?.state === "running") {
        // Queue waits for the turn's next tool call or its end; Steer joins the turn now. Cmd+Enter flips it once.
        if (followUpAction(followUp, invert) === "steer") await sendMessage(client, target, outgoing, { steer: true });
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
    restoreDraft({
      text: drafts.map((draft) => draft.text).join("\n\n"),
      selection: drafts.flatMap((draft) => draft.selection),
      attachments: drafts.flatMap((draft) => draft.attachments),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffs, chatId, client]);

  const interrupt = () => {
    if (!chat?.latestTurn) return;
    // Stop gives every queued message back to the composer.
    returnQueued(client, chat.id);
    void client.dispatch({ type: "thread.turn.interrupt", threadId: chat.id, turnId: chat.latestTurn.turnId }).catch((error: unknown) => client.reportError(error));
  };


  return (
    <div className="flex flex-col gap-1.5" data-variant={variant} data-testid="agent-tray" ref={root}>
      {approvalPending && chat && <ApprovalPanel client={client} chat={chat} held={guard.held} />}
      {questions.panel}
      {planFollowUp && <PlanReady plan={planFollowUp} />}
      {dragging &&
        dropElement &&
        createPortal(
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-foreground"
            data-testid="drop-overlay"
          >
            Drop files to attach
          </div>,
          dropElement,
        )}
      <div className={COMPOSER_SHELL} ref={boxElement} data-testid="agent-composer" data-dragging={dragging ? "" : undefined}>
        <AttachmentShelf staged={attachments.staged} onRemove={attachments.remove} onRetry={attachments.retry} />
        <ChipRow
          shapes={chips.shapes}
          onRemove={(ids) => {
            chips.remove(ids);
            if (mentionIds.current.some((id) => ids.includes(id))) {
              mentionIds.current = mentionIds.current.filter((id) => !ids.includes(id));
              saveDraft(box.current?.text() ?? "");
            }
            box.current?.focus();
          }}
        />
        {underChips}
        <PromptEditor
          placeholder={placeholder}
          label={PROMPT_LABEL}
          onChange={onDraftChange}
          onFocus={guard.onFocus}
          onBlur={guard.onBlur}
          initialText={initialText}
          onTrigger={setTrigger}
          onKey={onKey}
          onSubmit={(event) => void send(platform() === "darwin" ? event.metaKey : event.ctrlKey)}
          onPaste={onPaste}
          handle={box}
          disabled={answering && choiceOnly(question)}
          autofocus={variant === "toolbar"}
        />
        {lengthError !== undefined && (
          <p role="alert" className="m-0 px-0.5 text-xs text-destructive" data-testid="prompt-length-error">
            {lengthError}
          </p>
        )}
        {menu && <ComposerMenu label={menu.label} items={menu.items} highlight={highlight} empty={menu.empty} anchor={boxElement} onPick={menu.pick} onHighlight={setHighlight} />}
        {/* One line: the access and plan controls sit in the More menu, as in t3code's compact footer. */}
        {/* Nothing overlaps: the tools share the line's width, the traits and then the model label truncate first, and Send's group keeps its size. */}
        <div className="flex items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <Tip label="Attach files" side="top">
              <Button variant="ghost-muted" size="icon-sm" aria-label="Attach files" onClick={() => files.current?.click()}>
                <Paperclip aria-hidden />
              </Button>
            </Tip>
            <Input
              ref={files}
              type="file"
              multiple
              hidden
              unstyled
              nativeInput
              className="hidden"
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
            <CompactControlsMenu
              runtimeMode={runtimeMode}
              onRuntimeMode={setRuntime}
              {...(planMode ? { interactionMode, onInteractionMode: setInteraction } : {})}
              open={modeOpen}
              onOpenChange={setModeOpen}
            />
            {usage && chat && (
              <ContextMeter
                usage={usage}
                compactUnavailable={!compactable}
                onCompact={() => void sendMessage(client, chat.id, { text: "/compact", selection: [], attachments: [] }, { steer: running }).catch((error: unknown) => client.reportError(error))}
              />
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
              <MessageAction tone="stop" aria-label="Stop generation" onClick={interrupt}>
                <StopSquare />
              </MessageAction>
            )}
            {answering ? (
              <>
                {questions.index > 0 && (
                  <Button variant="outline" size="sm" disabled={questions.submitting} onClick={() => questions.move(questions.index - 1)}>
                    Previous
                  </Button>
                )}
                <MessageAction tone="pill" disabled={!canSend} onClick={() => void questions.answer()}>
                  {questions.submitting ? "Submitting..." : !questions.lastQuestion ? "Next question" : questions.index > 0 ? "Submit answers" : "Submit answer"}
                </MessageAction>
              </>
            ) : planFollowUp ? (
              <PlanActions refine={text.trim() !== ""} busy={sending} onSend={() => void send()} onNewChat={() => void implementPlan(true)} />
            ) : (
              <SendButton running={running} followUp={followUp} disabled={!canSend} onSend={(alternate) => void send(alternate)} />
            )}
          </div>
        </div>
      </div>
      {/* The rail is closed while the toolbar's tray is open: its errors show here. */}
      {variant === "toolbar" && ui.error !== undefined && (
        <Alert variant="error">
          <AlertDescription>{ui.error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
};

/**
 * The round Send (t3code's primary action). While a turn runs it says what the message will
 * do, "Queue message" or "Steer message" by the Follow-up behavior setting, the other while
 * Cmd or Ctrl is held, and a Cmd-click or Ctrl-click does the other for one message.
 */
const SendButton = ({ running, followUp, disabled, onSend }: { readonly running: boolean; readonly followUp: "queue" | "steer"; readonly disabled: boolean; readonly onSend: (alternate: boolean) => void }) => {
  const commandHeld = useCommandHeld();
  if (!running) {
    return (
      <MessageAction tone="send" aria-label="Send" disabled={disabled} onClick={() => onSend(false)}>
        <SendArrow />
      </MessageAction>
    );
  }
  const action = followUpAction(followUp, commandHeld);
  const mac = platform() === "darwin";
  const tip = `Click to ${followUp}, ${mac ? "⌘" : "Ctrl"}-click or ${mac ? "⌘Enter" : "Ctrl+Enter"} to ${followUpAction(followUp, true)}`;
  return (
    <Tip label={tip} side="top">
      <span className="inline-flex">
        <MessageAction tone="send" aria-label={action === "queue" ? "Queue message" : "Steer message"} disabled={disabled} onClick={(event) => onSend(event.metaKey || event.ctrlKey)}>
          {action === "queue" ? <ListPlus aria-hidden className="size-4" /> : <CornerUpRight aria-hidden className="size-4" />}
        </MessageAction>
      </span>
    </Tip>
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
        <div className="flex min-h-7 items-center gap-1.5 px-0.5 text-xs text-muted-foreground" data-testid="agent-target">
          <span className="min-w-0 truncate" data-testid="agent-target-line">
            {target !== null && continuable ? (
              <>
                continues <em className="text-foreground">{tabLabel(continuable)}</em>
              </>
            ) : (
              "new chat"
            )}
          </span>
          {target !== null ? (
            <Button variant="ghost" size="xs" onClick={() => setFresh(true)}>
              New chat instead
            </Button>
          ) : continuable ? (
            <Button variant="ghost" size="xs" onClick={() => setFresh(false)}>
              Continue the earlier chat
            </Button>
          ) : null}
          <span className="flex-1" />
          <Tip label="Back to tools (Esc)" side="top">
            <Button variant="ghost-muted" size="icon-xs" aria-label="Back to tools (Esc)" onClick={close}>
              <ArrowLeft aria-hidden />
            </Button>
          </Tip>
        </div>
      }
      note={(provider) => <span className="text-xs whitespace-nowrap text-muted-foreground">{`${provider} · not metered`}</span>}
    />
  );
};
