import type { ChatAttachment, ElementChip, ModelSelection } from "@unframed/contracts";
import {
  actionablePlan,
  agentSelectionOf,
  appendRestoredPrompt,
  attachmentChip,
  chipRefs,
  COMPACTION_SUGGESTION_MIN_TOKENS,
  compactsBeforeSend,
  RESUME_MESSAGE,
  resumableTurn,
  composerKeyIntent,
  composerRequiresModifier,
  continuableChat,
  DEFAULT_RUNTIME_MODE,
  ensureChips,
  followUpAction,
  formatTokens,
  implementPlanText,
  implementPlanTitle,
  mergeRestored,
  offersCompactBeforeSend,
  pasteBecomesFile,
  pastedTextFileName,
  promptHistoryEntries,
  promptLengthError,
  restingImagePreviewCounts,
  queuedEditBlockedReason,
  queuedEditChanged,
  resolveQueuedEditExit,
  type QueuedEditContent,
  stepPromptHistory,
  tabLabel,
  withoutChips,
  type InteractionMode,
  type PromptHistoryPosition,
  type RuntimeMode,
} from "@unframed/domain";
import { ArrowLeft, Check, CircleAlert, CornerUpRight, ListPlus, Minimize2, Paperclip, Play } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AgentTrayProps as SlotProps } from "../../chrome/slots.ts";
import { useEngine } from "../../context.ts";
import { effectiveModel, noProviderReady, providerName, readyProviders } from "../providers.ts";
import { createChat, sendMessage } from "../send.ts";
import {
  EMPTY_DRAFT,
  NEW_CHAT,
  sameDraft,
  TOOLBAR_DRAFT,
  useChatClient,
  useChats,
  useDraftVersion,
  useFollowUp,
  useHandoffVersion,
  usePlanMode,
  useProviders,
  useQueue,
  useRailUi,
  useSendShortcut,
  useWatchedThread,
  type ChatClient,
  type ChatDraft,
  type QueuedMessage,
} from "../store.ts";
import { latestCompletedTool, returnQueued, sendQueued } from "../queue.tsx";
import { Button } from "~/components/ui/button";
import { Tip } from "../../chrome/ui.tsx";
import { MessageAction, SendArrow, StopSquare } from "../../chrome/MessageAction.tsx";
import { formatSize, useAttachments } from "./attachments.ts";
import { StashBadge, StashDrawer, useStash } from "./stash.tsx";
import { NoticeStack, type ComposerNotice } from "./notices.tsx";
import { ApprovalPanel, choiceOnly, openQuestion, PlanActions, PlanReady, requestIdOf, useQuestionAnswers, waitingRequests } from "./panels.tsx";
import { useTypingGuard } from "./typingGuard.ts";
import { pasteIntoComposer, pastesInline, typesIntoComposer } from "./focusRedirect.ts";
import { platform } from "../../canvas/platform.ts";
import { showNotice } from "../../toasts.tsx";
import { AttachmentShelf } from "./AttachmentShelf.tsx";
import { ChipRow, ElementChipRow, contextSelection, useSelectionChips } from "./chips.tsx";
import { ComposerMenu, type MenuItem } from "./ComposerMenu.tsx";
import { mentionItems } from "./mentions.tsx";
import { slashItems, skillMenuItems } from "./commands.tsx";
import { CompactControlsMenu, ContextMeter, declaredTraits, latestUsage, ModelPicker, TraitsPicker } from "./pickers.tsx";
import { chipOfToken, PromptEditor, type CaretMark, type PromptEditorHandle, type Trigger } from "./PromptEditor.tsx";
import { UpNext } from "./UpNext.tsx";
import { useRestingComposer, useRestingTransition } from "./resting.ts";
import { useMaybeEditor, useValue } from "tldraw";
import { Input } from "~/components/ui/input";
import { composerGlassClass } from "../../chrome/composerSurface.ts";

export const PROMPT_LABEL = "Message the agent";

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
  readonly chatId: string | null;
  readonly newChatTags: ReadonlyArray<string>;
  readonly beforeSend?: (chatId: string) => void;
  readonly onSent?: () => void;
  readonly underChips?: ReactNode;
  readonly note?: (provider: string) => ReactNode;
  readonly onMenuOpen?: (key: string, open: boolean) => void;
  readonly dropTarget?: RefObject<HTMLElement | null>;
  readonly notices?: ReadonlyArray<ComposerNotice>;
}

const useModifiersHeld = (): { readonly command: boolean; readonly shift: boolean } => {
  const [held, setHeld] = useState({ command: false, shift: false });
  useEffect(() => {
    const update = (event: KeyboardEvent) => setHeld({ command: event.metaKey || event.ctrlKey, shift: event.shiftKey });
    const reset = () => setHeld({ command: false, shift: false });
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

const elementKey = (chip: ElementChip): string => `${chip.shapeId}\u0000${chip.selector}`;

const markAt = (at: CaretMark | undefined) => (at === undefined ? {} : { at });

const withElements = (elements: ReadonlyArray<ElementChip>) => (elements.length > 0 ? { elements } : {});

export const AgentTray = ({ client, variant, chatId, newChatTags, beforeSend, onSent, underChips, note, onMenuOpen, dropTarget, notices = [] }: AgentTrayProps) => {
  const ui = useRailUi(client);
  const { statuses } = useProviders(client);
  const chat = useWatchedThread(client, chatId);
  const running = chat?.latestTurn?.state === "running";
  const noProvider = noProviderReady(statuses);
  const ready = readyProviders(statuses);
  const canvas = useMaybeEditor();
  const box = useRef<PromptEditorHandle>(null);
  const draftKey: string | undefined = variant === "rail" ? (chatId ?? NEW_CHAT) : TOOLBAR_DRAFT;
  const [initialDraft] = useState(() => (draftKey === undefined ? EMPTY_DRAFT : client.draft(draftKey)));
  const [initialText] = useState(() => (variant === "rail" && openQuestion(chat) !== undefined ? "" : initialDraft.text));
  const [text, setText] = useState(initialText);
  const draftKeyRef = useRef(draftKey);
  const attachmentsRef = useRef<ReturnType<typeof useAttachments>>(null!);
  const draftVersion = useDraftVersion(client, draftKey ?? "");
  const chips = useSelectionChips(canvas, text.trim() === "");
  const mentionIds = useRef<ReadonlyArray<string>>([]);
  const answeringRef = useRef(false);
  const [editing, setEditing] = useState<{ readonly id: string; readonly chatId: string; readonly original: QueuedEditContent } | null>(null);
  const editingRef = useRef(editing);
  const aside = useRef<{ readonly chips: ReadonlyArray<string>; readonly mentions: ReadonlyArray<string> }>({ chips: [], mentions: [] });
  const setEdit = (next: typeof editing) => {
    editingRef.current = next;
    setEditing(next);
  };
  const [elements, setElementsState] = useState<ReadonlyArray<ElementChip>>(initialDraft.elements ?? []);
  const elementsRef = useRef(elements);
  const setElements = (next: ReadonlyArray<ElementChip>) => {
    elementsRef.current = next;
    setElementsState(next);
  };
  const guard = useTypingGuard(
    chatId ?? NEW_CHAT,
    variant === "rail" && chat ? [...waitingRequests(chat, "approval"), ...waitingRequests(chat, "user-input")].map(requestIdOf) : [],
  );
  const ownDraft = useRef<ChatDraft | undefined>(undefined);
  const shownKey = useRef<string | undefined>(undefined);
  const saveDraft = (value: string) => {
    if (draftKeyRef.current === undefined || answeringRef.current || editingRef.current !== null) return;
    ownDraft.current = { text: value, mentions: mentionIds.current, attachments: attachmentsRef.current.ready(), elements: elementsRef.current };
    client.setDraft(draftKeyRef.current, ownDraft.current);
  };
  const chipped = useRef<ReadonlyArray<string>>(chipRefs(initialText));
  const expandResting = useRef(() => {});
  const onDraftChange = (value: string, typed: boolean) => {
    setText(value);
    if (typed) expandResting.current();
    if (answeringRef.current) return;
    const refs = chipRefs(value);
    const before = chipped.current;
    chipped.current = refs;
    if (typed) {
      guard.onType();
      const staged = attachmentsRef.current.staged;
      for (const item of staged) {
        const id = item.attachment?.id;
        if (id !== undefined && item.kind === "file" && before.includes(id) && !refs.includes(id)) attachmentsRef.current.remove(item.key);
      }
      const held = new Set(staged.flatMap((item) => (item.attachment ? [item.attachment.id] : [])));
      const missing = refs.filter((ref) => !held.has(ref)).flatMap((ref) => client.knownAttachment(ref) ?? []);
      if (missing.length > 0) attachmentsRef.current.restore(missing);
    }
    saveDraft(value);
  };
  const forgetMentions = () => {
    mentionIds.current = [];
  };
  useEffect(() => {
    const sameChat = draftKeyRef.current === draftKey;
    draftKeyRef.current = draftKey;
    let chipIds = chips.shapes.map((shape) => shape.id);
    if (editingRef.current !== null && editingRef.current.chatId !== chatId) {
      setEdit(null);
      chipIds = [...aside.current.chips];
      mentionIds.current = aside.current.mentions;
    }
    if (draftKey === undefined || editingRef.current !== null) return;
    const stored = client.draft(draftKey);
    if (shownKey.current === draftKey && stored === ownDraft.current) return;
    shownKey.current = draftKey;
    const shown = { text: box.current?.text() ?? "", mentions: mentionIds.current, attachments: attachmentsRef.current.ready(), elements: elementsRef.current };
    if (sameDraft(shown, stored)) return;
    if (!answeringRef.current && !sameDraft({ ...EMPTY_DRAFT, attachments: shown.attachments }, { ...EMPTY_DRAFT, attachments: stored.attachments }))
      attachmentsRef.current.replace(stored.attachments);
    const kept = chipIds.filter((id) => !mentionIds.current.includes(id));
    mentionIds.current = stored.mentions;
    chips.set([...kept, ...stored.mentions.filter((id) => !kept.includes(id))]);
    const incoming = stored.elements ?? [];
    const added = incoming.some((chip) => !shown.elements.some((shownChip) => shownChip.shapeId === chip.shapeId && shownChip.selector === chip.selector));
    if (!answeringRef.current) setElements(incoming);
    if (shown.text !== stored.text && !answeringRef.current) box.current?.setText(stored.text, { focus: false, undoable: false });
    if (added && sameChat && !answeringRef.current) box.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, draftKey, draftVersion]);
  const [trigger, setTrigger] = useState<Trigger>();
  const [sending, setSending] = useState(false);
  const [draftModel, setDraftModel] = useState<ModelSelection | undefined>();
  const [draftRuntime, setDraftRuntime] = useState<RuntimeMode>(DEFAULT_RUNTIME_MODE);
  const [draftInteraction, setDraftInteraction] = useState<InteractionMode>("default");
  const showError = useCallback((message: string) => client.setUi({ error: message }), [client]);
  const [modelOpen, setModelOpen] = useState(false);
  const [traitsOpen, setTraitsOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  const selection: ModelSelection = useMemo(
    () => (chat ? agentSelectionOf(chat.modelSelection) : undefined) ?? draftModel ?? { provider: ready[0] ?? "claude", model: "", traits: {} },
    [chat?.modelSelection, draftModel, ready],
  );
  const runtimeMode = chat?.runtimeMode ?? draftRuntime;
  const planMode = usePlanMode(client);
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
  const attachments = useAttachments(client.engine, showError, {
    onReady: (item, attachment) => {
      client.rememberAttachments([attachment]);
      const chip = chipOfToken(attachmentChip(attachment));
      if (item.chip && chip && !answeringRef.current) box.current?.insertChip(chip, item.at);
    },
    onMoved: (owner, attachment, chip) => {
      client.rememberAttachments([attachment]);
      const draft = client.draft(owner);
      client.setDraft(owner, { ...draft, text: chip ? ensureChips(draft.text, [attachmentChip(attachment)]) : draft.text, attachments: [...draft.attachments, attachment] });
    },
  });
  attachmentsRef.current = attachments;
  const stagedOnce = useRef(false);
  useEffect(() => {
    if (!stagedOnce.current) {
      stagedOnce.current = true;
      return;
    }
    if (box.current?.element()) saveDraft(box.current.text());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments.staged]);
  const intake = (chip: boolean) =>
    answeringRef.current
      ? { chip: false }
      : {
          ...(draftKeyRef.current !== undefined && editingRef.current === null ? { owner: draftKeyRef.current } : {}),
          ...(chip && withoutChips(box.current?.text() ?? "").trim() !== "" ? { chip: true, ...markAt(box.current?.caretMark()) } : { chip: false }),
        };
  const refusesFiles = useRef(false);
  const addFiles = (chosen: ReadonlyArray<File>, chip: boolean) => {
    if (refusesFiles.current) return;
    void attachments.add(chosen, intake(chip));
  };
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  const removeAttachment = (key: string) => {
    const item = attachments.staged.find((known) => known.key === key);
    attachments.remove(key);
    if (item?.attachment) box.current?.removeChips(item.attachment.id);
  };
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
      addFilesRef.current([...(event.dataTransfer?.files ?? [])], true);
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
  }, [dropElement]);

  const inlineNext = useRef(0);

  const attachLargePaste = (pastedText: string): boolean => {
    const inline = Date.now() - inlineNext.current < 1500;
    inlineNext.current = 0;
    if (pastedText === "" || inline || refusesFiles.current || !pasteBecomesFile(pastedText, text.length)) return false;
    const name = pastedTextFileName(attachments.staged.map((item) => item.name));
    const file = new File([pastedText], name, { type: "text/plain;charset=utf-8" });
    addFiles([file], true);
    showNotice(`Large paste attached as ${name}`, "info", `${formatSize(file.size)} · Use ${platform() === "darwin" ? "⌘⇧V" : "Ctrl+Shift+V"} to keep a large paste inline.`);
    return true;
  };

  const onPaste = (event: ClipboardEvent): boolean => {
    const data = event.clipboardData;
    const pasted = [...(data?.files ?? [])];
    const pastedText = data?.getData("text/plain") ?? "";
    if (pasted.length > 0) {
      addFiles(pasted, true);
      if (pastedText === "") {
        event.preventDefault();
        return true;
      }
      return false;
    }
    if (!attachLargePaste(pastedText)) return false;
    event.preventDefault();
    return true;
  };

  useEffect(() => {
    void client.loadProviders();
  }, [client]);

  const boxElement = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number>();
  useEffect(() => setHighlight(0), [trigger?.char, trigger?.query, trigger?.from]);
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
  useEffect(() => {
    onMenuOpen?.("more-controls", modeOpen);
  }, [onMenuOpen, modeOpen]);
  useEffect(() => () => onMenuOpen?.("more-controls", false), [onMenuOpen]);

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
    const step = stepPromptHistory({ direction, entries: promptHistoryEntries(chat?.messages ?? []), position, currentPrompt: current });
    if (!step) return false;
    historyPosition.current = step.position;
    box.current?.setText(step.prompt);
    return true;
  };

  const onKey = (event: KeyboardEvent): boolean => {
    const command = platform() === "darwin" ? event.metaKey : event.ctrlKey;
    if (command && event.shiftKey && event.key.toLowerCase() === "v") {
      inlineNext.current = Date.now();
      return false;
    }
    if (command && !event.shiftKey && event.key.toLowerCase() === "s") {
      if (editingRef.current === null) stashKey();
      return true;
    }
    if (command && event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
      setModeOpen(true);
      return true;
    }
    if (command && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m") {
      if (!event.repeat && !running) setModelOpen((open) => !open);
      return true;
    }
    if (command && event.shiftKey && !event.altKey && event.key.toLowerCase() === "e") {
      if (!event.repeat && !running) setTraitsOpen(true);
      return true;
    }
    if (!menu && event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey && event.key === "ArrowUp" && variant === "rail" && chatId !== null) {
      const latest = client.queue(chatId).at(-1);
      if (!latest || latest.state !== "waiting" || editingRef.current !== null || answeringRef.current || !box.current?.caretAtStart()) return false;
      if (!event.repeat) beginEdit(latest);
      return true;
    }
    const intent = composerKeyIntent({ key: event, mac: platform() === "darwin", sendShortcut, prompt: box.current?.text() ?? "", running, newChat: chatId === null });
    if (intent === "steer-queued") {
      if (!chat) return false;
      const oldest = client.queue(chat.id)[0];
      if (oldest) void sendQueued(client, chat.id, oldest.id);
      return true;
    }
    if (!menu && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      return history(event.key === "ArrowUp" ? "backward" : "forward");
    }
    if (planMode && event.key === "Tab" && event.shiftKey && !menu) {
      setInteraction(interactionMode === "plan" ? "default" : "plan");
      return true;
    }
    if (menu && intent !== "alternate" && intent !== "background") {
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
    if (intent === null) return false;
    void send(intent === "alternate", intent === "background" && variant === "rail");
    return true;
  };

  const approvalPending = variant === "rail" && chat !== undefined && waitingRequests(chat, "approval").some((request) => !guard.held.has(requestIdOf(request)));
  const questions = useQuestionAnswers(client, variant === "rail" ? chat : undefined, box, text, guard.held, attachments);
  const { question, answering } = questions;
  answeringRef.current = answering;
  refusesFiles.current = answering && choiceOnly(question);
  const questionKey = answering ? `${chatId}:${questions.requestId}` : undefined;
  const shownQuestion = useRef<string | undefined>(undefined);
  useEffect(() => {
    const was = shownQuestion.current;
    shownQuestion.current = questionKey;
    if (questionKey === was) return;
    if (questionKey !== undefined) {
      if (editingRef.current !== null) {
        chips.set(aside.current.chips);
        mentionIds.current = aside.current.mentions;
      }
      setEdit(null);
      box.current?.setText("", { focus: false, undoable: false });
      attachments.replace([]);
      setElements([]);
      return;
    }
    if (draftKeyRef.current === undefined) return;
    const draft = client.draft(draftKeyRef.current);
    if ((box.current?.text() ?? "") !== draft.text) box.current?.setText(draft.text, { focus: false, undoable: false });
    attachments.replace(draft.attachments);
    setElements(draft.elements ?? []);
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
    : editing !== null
      ? lengthError === undefined && !sending && (text.trim() !== "" || attachments.staged.length > 0)
      : lengthError === undefined && (planFollowUp ? !sending : !noProvider && !sending && (text.trim() !== "" || attachments.staged.length > 0));

  const showResume =
    variant === "rail" && chat !== undefined && !running && !answering && editing === null && !noProvider && resumableTurn(chat) && text.trim() === "" && attachments.staged.length === 0;
  const resume = async () => {
    if (!chat || sending) return;
    setSending(true);
    client.setUi({ error: undefined });
    try {
      await sendMessage(client, chat.id, { text: RESUME_MESSAGE, selection: [], attachments: [] });
    } catch (error) {
      client.reportError(error);
    } finally {
      setSending(false);
    }
  };

  const implementPlan = async (inNewChat: boolean) => {
    if (!chat || !planFollowUp || sending) return;
    const message = { text: implementPlanText(planFollowUp.planMarkdown), selection: [], attachments: [] };
    const source = { sourceProposedPlan: { threadId: chat.id, planId: planFollowUp.id } };
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
  const sendShortcut = useSendShortcut(client);
  const stash = useStash(client.engine, client.project);
  const [stashOpen, setStashOpen] = useState(false);
  const [stashPulse, setStashPulse] = useState(0);
  useEffect(() => {
    onMenuOpen?.("stash", stashOpen);
  }, [onMenuOpen, stashOpen]);
  useEffect(() => () => onMenuOpen?.("stash", false), [onMenuOpen]);
  const closeStash = () => {
    setStashOpen(false);
    box.current?.focus();
  };
  const restoreDraft = (draft: { readonly text: string; readonly selection: ReadonlyArray<string>; readonly attachments: ReadonlyArray<ChatAttachment>; readonly elements?: ReadonlyArray<ElementChip> }) => {
    const key = draftKeyRef.current;
    if (editingRef.current !== null && key !== undefined) {
      const current = client.draft(key);
      client.setDraft(key, {
        ...current,
        text: appendRestoredPrompt(current.text, draft.text),
        attachments: mergeRestored(current.attachments, draft.attachments, (item) => `${item.kind}\u0000${item.size}\u0000${item.name}`),
        elements: mergeRestored(current.elements ?? [], draft.elements ?? [], elementKey),
      });
      aside.current = { ...aside.current, chips: mergeRestored(aside.current.chips, draft.selection, (id) => id) };
      return;
    }
    const setAside = answeringRef.current ? key : undefined;
    if (setAside !== undefined) {
      const current = client.draft(setAside);
      client.setDraft(setAside, { ...current, text: appendRestoredPrompt(current.text, draft.text), mentions: mentionIds.current, elements: mergeRestored(current.elements ?? [], draft.elements ?? [], elementKey) });
    } else {
      setElements(mergeRestored(elementsRef.current, draft.elements ?? [], elementKey));
      box.current?.setText(appendRestoredPrompt(box.current.text(), draft.text));
    }
    chips.add(draft.selection);
    attachments.restore(draft.attachments);
  };
  const stashKey = () => {
    const draft = box.current?.text() ?? "";
    if (draft.trim() !== "" || attachments.staged.length > 0 || elementsRef.current.length > 0) {
      stash.push({ text: draft, selection: chips.shapes.map((shape) => shape.id), attachments: attachments.ready(), elements: elementsRef.current });
      setStashPulse((pulse) => pulse + 1);
      forgetMentions();
      setElements([]);
      attachments.clear();
      box.current?.clear();
      chips.set(canvas?.getSelectedShapeIds() ?? []);
    } else if (stash.entries.length === 1) {
      restoreDraft(stash.entries[0]!);
      stash.remove(stash.entries[0]!.id);
    } else {
      setStashOpen((open) => !open);
    }
  };
  const send = async (invert = false, thenNewChat = false) => {
    if (answering) {
      guard.onSend();
      return questions.answer();
    }
    if (editingRef.current !== null) return saveEdit();
    const message = box.current?.text() ?? "";
    const sentFrom = draftKeyRef.current;
    if (promptLengthError(message) !== undefined) return;
    guard.onSend();
    if (planFollowUp && message.trim() === "") return implementPlan(false);
    const pointed = elementsRef.current;
    if (noProvider || (message.trim() === "" && attachments.staged.length === 0 && pointed.length === 0) || sending) return;
    setSending(true);
    client.setUi({ error: undefined });
    try {
      const uploaded = await attachments.settle();
      const context = [...new Set([...contextSelection(canvas, chips.shapes), ...pointed.map((chip) => chip.shapeId)])];
      const chipIds = chips.shapes.map((shape) => shape.id);
      let target = chatId;
      if (target === null) {
        target = await createChat(client, { modelSelection: selection, runtimeMode: draftRuntime, interactionMode, tags: newChatTags }, message);
      }
      beforeSend?.(target);
      forgetMentions();
      setElements([]);
      box.current?.clear();
      if (sentFrom !== undefined) client.setDraft(sentFrom, EMPTY_DRAFT);
      attachments.clear();
      chips.set(canvas?.getSelectedShapeIds() ?? []);
      const outgoing = { text: message, selection: context, attachments: uploaded, ...(pointed.length > 0 ? { elements: pointed } : {}) };
      const current = client.thread(target);
      if (!planMode && current?.interactionMode === "plan") await client.dispatch({ type: "thread.interaction-mode.set", threadId: target, interactionMode: "default" });
      if (current?.latestTurn?.state === "running") {
        if (followUpAction(followUp, invert) === "steer") await sendMessage(client, target, outgoing, { steer: true });
        else client.enqueue(target, outgoing, latestCompletedTool(current), chipIds);
      } else if (target === chatId && compactsBeforeSend({ tokens: compactTokens, keepFullHistory: keepFull, text: message })) {
        await sendMessage(client, target, { text: "/compact", selection: [], attachments: [] });
        client.enqueue(target, outgoing, latestCompletedTool(client.thread(target)), chipIds);
      } else {
        await sendMessage(client, target, outgoing);
      }
      setFullHistory(target, false);
      onSent?.();
      if (thenNewChat) client.setUi({ chosen: NEW_CHAT, pinned: null });
    } catch (error) {
      client.reportError(error);
      if ((box.current?.text() ?? "") === "") box.current?.setText(message);
      if (elementsRef.current.length === 0) setElements(pointed);
    } finally {
      setSending(false);
    }
  };

  const handoffs = useHandoffVersion(client);
  useEffect(() => {
    if (chatId === null) return;
    const drafts = client.takeHandoffs(chatId);
    if (drafts.length === 0) return;
    restoreDraft({
      text: drafts.map((draft) => draft.text).join("\n\n"),
      selection: drafts.flatMap((draft) => draft.selection),
      attachments: drafts.flatMap((draft) => draft.attachments),
      elements: drafts.flatMap((draft) => draft.elements ?? []),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffs, chatId, client]);

  const queue = useQueue(client, variant === "rail" ? chatId : null);

  const [, setMinute] = useState(0);
  const mayGoStale = selection.provider === "claude" && (usage?.usedTokens ?? 0) >= COMPACTION_SUGGESTION_MIN_TOKENS;
  useEffect(() => {
    if (!mayGoStale) return;
    const timer = window.setInterval(() => setMinute((minute) => minute + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [mayGoStale]);
  const [fullHistoryChats, setFullHistoryChats] = useState<ReadonlySet<string>>(() => new Set());
  const keepFull = chatId !== null && fullHistoryChats.has(chatId);
  const setFullHistory = (id: string, keep: boolean) =>
    setFullHistoryChats((current) => {
      if (current.has(id) === keep) return current;
      const next = new Set(current);
      if (keep) next.add(id);
      else next.delete(id);
      return next;
    });
  const compactTokens =
    chat !== undefined &&
    usage !== undefined &&
    compactable &&
    !running &&
    editing === null &&
    !approvalPending &&
    !answering &&
    planFollowUp === undefined &&
    client.queue(chat.id).length === 0 &&
    chat.messages.some((message) => message.role === "user" && (message.text.trim().toLowerCase() !== "/compact" || (message.attachments?.length ?? 0) > 0)) &&
    offersCompactBeforeSend({ provider: selection.provider, usedTokens: usage.usedTokens, updatedAt: usage.updatedAt, now: new Date().toISOString() })
      ? usage.usedTokens
      : null;
  const editContent = (): QueuedEditContent => ({
    text: box.current?.text() ?? "",
    chips: chips.shapes.map((shape) => shape.id),
    attachments: attachments.ready().map((attachment) => attachment.id),
  });
  const beginEdit = (item: QueuedMessage) => {
    if (chatId === null || answeringRef.current) return;
    historyPosition.current = null;
    if (editingRef.current === null) aside.current = { chips: chips.shapes.map((shape) => shape.id), mentions: mentionIds.current };
    const itemChips = item.chips ?? item.message.selection;
    setEdit({ id: item.id, chatId, original: { text: item.message.text, chips: itemChips, attachments: item.message.attachments.map((attachment) => attachment.id) } });
    mentionIds.current = [];
    attachments.replace(item.message.attachments);
    chips.set(itemChips);
    setElements(item.message.elements ?? []);
    box.current?.setText(item.message.text);
  };
  const endEdit = (options?: { readonly focus?: boolean }) => {
    setEdit(null);
    const draft = draftKeyRef.current === undefined ? EMPTY_DRAFT : client.draft(draftKeyRef.current);
    mentionIds.current = draft.mentions;
    attachments.replace(draft.attachments);
    chips.set(aside.current.chips);
    setElements(draft.elements ?? []);
    box.current?.setText(draft.text, options);
  };
  const stillQueued = (edit: { readonly id: string; readonly chatId: string }) => client.queue(edit.chatId).some((item) => item.id === edit.id && item.state === "waiting");
  const updateQueued = (edit: { readonly id: string; readonly chatId: string }, message: QueuedMessage["message"], chipIds: ReadonlyArray<string>) =>
    client.updateQueue(edit.chatId, (current) => current.map((item) => (item.id === edit.id ? { ...item, message, chips: chipIds } : item)));
  const saveEdit = async () => {
    const edit = editingRef.current;
    const message = box.current?.text() ?? "";
    if (!edit || sending || promptLengthError(message) !== undefined || (message.trim() === "" && attachments.staged.length === 0)) return;
    if (!stillQueued(edit)) return;
    setSending(true);
    try {
      const uploaded = await attachments.settle();
      if (editingRef.current !== edit || !stillQueued(edit)) return;
      if (attachmentsRef.current.staged.some((item) => item.status === "failed")) return showError("Retry or remove failed uploads before saving.");
      updateQueued(edit, { text: message, selection: contextSelection(canvas, chips.shapes), attachments: uploaded, ...withElements(elementsRef.current) }, chips.shapes.map((shape) => shape.id));
      endEdit();
    } finally {
      setSending(false);
    }
  };
  useEffect(() => {
    const edit = editingRef.current;
    if (!edit || edit.chatId !== chatId || queue.some((item) => item.id === edit.id && item.state === "waiting")) return;
    const draft = draftKeyRef.current === undefined ? EMPTY_DRAFT : client.draft(draftKeyRef.current);
    const recovery = resolveQueuedEditExit({
      editChanged: queuedEditChanged(edit.original, editContent()) || attachments.staged.some((item) => item.status !== "ready"),
      threadDraftEmpty: draft.text.trim() === "" && draft.mentions.length === 0 && draft.attachments.length === 0,
    });
    if (recovery === "kept") {
      setEdit(null);
      saveDraft(box.current?.text() ?? "");
    } else {
      endEdit({ focus: false });
    }
    if (recovery === "clean") return;
    showNotice(
      "Queued message is no longer queued",
      recovery === "kept" ? "info" : "warning",
      recovery === "kept" ? "Your unsaved edit was kept in the composer." : "Your unsaved edit was discarded.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, chatId]);

  const trayNotices: ReadonlyArray<ComposerNotice> =
    variant === "toolbar" && ui.error !== undefined
      ? [...notices, { id: "error", variant: "error", icon: <CircleAlert />, title: ui.error, dismissLabel: "Dismiss error", onDismiss: () => client.setUi({ error: undefined }) }]
      : notices;

  const resting = useRestingComposer({
    enabled: variant === "rail" && chatId !== null,
    chatId,
    rail: dropElement,
    shell: boxElement,
    text,
    expandedChrome:
      approvalPending ||
      answering ||
      planFollowUp !== undefined ||
      menu !== undefined ||
      stashOpen ||
      dragging ||
      noProvider ||
      trayNotices.length > 0 ||
      lengthError !== undefined ||
      editing !== null ||
      attachments.staged.some((item) => item.status !== "ready"),
  });
  expandResting.current = resting.expand;
  useRestingTransition(boxElement, resting.resting);
  const restingImages = resting.resting ? attachments.staged.filter((item) => item.kind === "image") : [];
  const restingCounts = restingImagePreviewCounts(restingImages.length);

  const interrupt = () => {
    if (!chat?.latestTurn) return;
    const edit = editingRef.current;
    if (edit !== null) {
      const message = box.current?.text() ?? "";
      if (message.trim() !== "" || attachments.ready().length > 0)
        updateQueued(edit, { text: message, selection: contextSelection(canvas, chips.shapes), attachments: attachments.ready(), ...withElements(elementsRef.current) }, chips.shapes.map((shape) => shape.id));
      endEdit();
    }
    returnQueued(client, chat.id);
    void client.dispatch({ type: "thread.turn.interrupt", threadId: chat.id, turnId: chat.latestTurn.turnId }).catch((error: unknown) => client.reportError(error));
  };

  const boxTakesText = !(answering && choiceOnly(question));
  const redirect = useRef({ attachLargePaste, boxTakesText });
  redirect.current = { attachLargePaste, boxTakesText };
  useEffect(() => {
    const rail = variant === "rail" ? dropElement : null;
    if (!rail) return;
    const mac = platform() === "darwin";
    const onRailKey = (event: KeyboardEvent) => {
      if (pastesInline(event, rail, mac)) inlineNext.current = Date.now();
      else if (typesIntoComposer(event, rail) && box.current?.insertTextAtEnd(event.key)) event.preventDefault();
    };
    const onRailPaste = (event: ClipboardEvent) => {
      const pasted = pasteIntoComposer(event, rail);
      if (pasted === null || !redirect.current.boxTakesText) return;
      if (!redirect.current.attachLargePaste(pasted) && !box.current?.insertTextAtEnd(pasted)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    rail.addEventListener("keydown", onRailKey);
    rail.addEventListener("paste", onRailPaste);
    return () => {
      rail.removeEventListener("keydown", onRailKey);
      rail.removeEventListener("paste", onRailPaste);
    };
  }, [variant, dropElement]);

  return (
    <div className="flex min-h-0 flex-col gap-1.5" data-variant={variant} data-testid="agent-tray" ref={root}>
      <div className="-mx-1 flex min-h-0 shrink flex-col gap-1.5 overflow-y-auto overscroll-contain px-1 empty:hidden">
        <NoticeStack items={trayNotices} />
        {variant === "rail" && chatId !== null && (
          <UpNext
            client={client}
            chatId={chatId}
            running={running}
            editingId={editing?.chatId === chatId ? editing.id : null}
            editBlockedReason={queuedEditBlockedReason({ openQuestionCount: answering ? 1 : 0 })}
            onEdit={beginEdit}
            onCancelEdit={() => endEdit()}
          />
        )}
        {approvalPending && chat && <ApprovalPanel client={client} chat={chat} held={guard.held} />}
        {questions.panel}
        {planFollowUp && <PlanReady plan={planFollowUp} />}
      </div>
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
      {(stashOpen || stash.entries.length > 0) && (
        <div className="flex items-end gap-1.5">
          <div className="min-w-0 flex-1">
            {stashOpen && (
              <StashDrawer
                entries={stash.entries}
                box={() => box.current?.element() ?? null}
                onRestore={(entry) => {
                  restoreDraft(entry);
                  stash.remove(entry.id);
                  closeStash();
                }}
                onDelete={(entry) => stash.remove(entry.id)}
                onClose={closeStash}
              />
            )}
          </div>
          <StashBadge count={stash.entries.length} open={stashOpen} pulse={stashPulse} onToggle={() => (stashOpen ? closeStash() : setStashOpen(true))} />
        </div>
      )}
      <div
        className={`${COMPOSER_SHELL} ${resting.resting ? "grid! grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1 pt-1.5! pb-1!" : ""}`}
        ref={boxElement}
        data-testid="agent-composer"
        data-dragging={dragging ? "" : undefined}
        data-resting={resting.resting ? "true" : undefined}
        {...resting.shellProps}
      >
        <div className={resting.resting ? "col-span-2 row-start-1 flex flex-col gap-1.5 empty:hidden" : "contents"}>
          <AttachmentShelf staged={resting.resting ? attachments.staged.filter((item) => item.kind === "file") : attachments.staged} onRemove={removeAttachment} onRetry={attachments.retry} />
          {!answering && (
            <ElementChipRow
              chips={elements}
              onRemove={(removed) => {
                setElements(elementsRef.current.filter((chip) => elementKey(chip) !== elementKey(removed)));
                saveDraft(box.current?.text() ?? "");
                box.current?.focus();
              }}
            />
          )}
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
        </div>
        <div className={resting.resting ? "col-start-1 row-start-2 flex min-w-0 items-center gap-1" : "min-w-0"} data-composer-prompt>
          <PromptEditor
            resting={resting.resting}
            placeholder={placeholder}
            label={PROMPT_LABEL}
            onChange={onDraftChange}
            onFocus={guard.onFocus}
            onBlur={guard.onBlur}
            initialText={initialText}
            onTrigger={setTrigger}
            onKey={onKey}
            onPaste={onPaste}
            handle={box}
            disabled={answering && choiceOnly(question)}
            autofocus={variant === "toolbar"}
          />
          {restingImages.length > 0 && (
            <div className="flex shrink-0 items-center gap-1" data-testid="resting-images">
              {restingImages.slice(0, restingCounts.visibleCount).map((item) => (
                <img key={item.key} src={item.preview} alt={item.name} className="size-7 rounded-md border border-border/80 object-cover" />
              ))}
              {restingCounts.overflowCount > 0 && (
                <Button variant="ghost-muted" size="xs" aria-label={`Show ${restingCounts.overflowCount} more images`} onClick={() => box.current?.focus()}>
                  {`+${restingCounts.overflowCount}`}
                </Button>
              )}
            </div>
          )}
        </div>
        {lengthError !== undefined && (
          <p role="alert" className="m-0 px-0.5 text-xs text-destructive" data-testid="prompt-length-error">
            {lengthError}
          </p>
        )}
        {menu && <ComposerMenu label={menu.label} items={menu.items} highlight={highlight} empty={menu.empty} anchor={boxElement} onPick={menu.pick} onHighlight={setHighlight} />}
        <div className={resting.resting ? "contents" : "flex items-center gap-1"}>
          <div
            className={
              resting.resting
                ? "col-span-2 row-start-3 -mx-1 flex min-w-0 items-center gap-0.5 text-muted-foreground [&_button]:text-xs!"
                : "flex min-w-0 flex-1 items-center gap-0.5"
            }
            data-composer-controls
            data-resting-controls={resting.resting ? "" : undefined}
            data-testid={resting.resting ? "resting-controls" : undefined}
          >
            <Tip label="Attach files" side="top">
              <Button variant="ghost-muted" size="icon-sm" aria-label="Attach files" disabled={answering && choiceOnly(question)} onClick={() => files.current?.click()}>
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
                if (chosen.length > 0) addFiles(chosen, false);
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
              open={traitsOpen}
              onOpenChange={setTraitsOpen}
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
          <div className={`ml-auto flex shrink-0 items-center gap-1.5 ${resting.resting ? "col-start-2 row-start-2" : ""}`} data-composer-actions>
            {note?.(providerName(selection.provider))}
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
            ) : showResume ? (
              <Tip label="Resume thread" side="top">
                <span className="inline-flex">
                  <MessageAction tone="send" aria-label="Resume thread" disabled={sending} onClick={() => void resume()}>
                    <Play aria-hidden className="size-4 fill-current" />
                  </MessageAction>
                </span>
              </Tip>
            ) : planFollowUp && editing === null ? (
              <PlanActions refine={text.trim() !== ""} busy={sending} onSend={() => void send()} onNewChat={() => void implementPlan(true)} />
            ) : (
              <>
                {compactTokens !== null && chat && (
                  <CompactChip tokens={compactTokens} keepFull={keepFull} onToggle={() => setFullHistory(chat.id, !keepFull)} />
                )}
                <SendButton
                  running={running}
                  compacts={compactsBeforeSend({ tokens: compactTokens, keepFullHistory: keepFull, text })}
                  editing={editing !== null}
                  followUp={followUp}
                  alternateNeedsShift={composerRequiresModifier(sendShortcut, text)}
                  disabled={!canSend}
                  onSend={(alternate) => void send(alternate)}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SendButton = ({
  running,
  compacts,
  editing,
  followUp,
  alternateNeedsShift,
  disabled,
  onSend,
}: {
  readonly running: boolean;
  readonly compacts: boolean;
  readonly editing: boolean;
  readonly followUp: "queue" | "steer";
  readonly alternateNeedsShift: boolean;
  readonly disabled: boolean;
  readonly onSend: (alternate: boolean) => void;
}) => {
  const held = useModifiersHeld();
  if (editing) {
    return (
      <MessageAction tone="send" aria-label="Update queued message" disabled={disabled} onClick={() => onSend(false)}>
        <Check aria-hidden className="size-4" />
      </MessageAction>
    );
  }
  if (!running) {
    return (
      <MessageAction tone="send" aria-label={compacts ? "Compact and send" : "Send"} disabled={disabled} onClick={() => onSend(false)}>
        <SendArrow />
      </MessageAction>
    );
  }
  const action = followUpAction(followUp, held.command && (held.shift || !alternateNeedsShift));
  const mac = platform() === "darwin";
  const chord = alternateNeedsShift ? (mac ? "⇧⌘Enter" : "Ctrl+Shift+Enter") : mac ? "⌘Enter" : "Ctrl+Enter";
  const tip = `Click to ${followUp}, ${mac ? "⌘" : "Ctrl"}-click or ${chord} to ${followUpAction(followUp, true)}`;
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

const CompactChip = ({ tokens, keepFull, onToggle }: { readonly tokens: number; readonly keepFull: boolean; readonly onToggle: () => void }) => {
  const count = formatTokens(tokens);
  return (
    <Tip
      side="top"
      label={
        <>
          <div>{keepFull ? `Next send keeps all ${count} tokens.` : `Next send compacts ${count} tokens first.`}</div>
          <div>{keepFull ? "Click to compact first" : "Click to keep full history"}</div>
        </>
      }
    >
      <Button
        variant={keepFull ? "outline" : "warning-outline"}
        size="compact"
        aria-pressed={!keepFull}
        aria-label={`Compact ${count} tokens of history before sending`}
        onClick={onToggle}
      >
        <Minimize2 aria-hidden />
        {keepFull ? "Full" : "Compact"}
        <span className="tabular-nums">{count}</span>
      </Button>
    </Tip>
  );
};

const ARTIFACT_TYPES = new Set(["page", "motion"]);

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
