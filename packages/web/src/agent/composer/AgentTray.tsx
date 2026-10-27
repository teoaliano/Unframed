import type { ChatAttachment, ModelSelection } from "@unframed/contracts";
import {
  actionablePlan,
  agentSelectionOf,
  appendRestoredPrompt,
  attachmentChip,
  chipRefs,
  COMPACTION_SUGGESTION_MIN_TOKENS,
  compactsBeforeSend,
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
  resolveQueuedEditExit,
  stepPromptHistory,
  tabLabel,
  withoutChips,
  type InteractionMode,
  type PromptHistoryPosition,
  type RuntimeMode,
} from "@unframed/domain";
import { ArrowLeft, Check, CircleAlert, CornerUpRight, ListPlus, Minimize2, Paperclip } from "lucide-react";
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
import { ChipRow, contextSelection, useSelectionChips } from "./chips.tsx";
import { ComposerMenu, type MenuItem } from "./ComposerMenu.tsx";
import { mentionItems } from "./mentions.tsx";
import { slashItems, skillMenuItems } from "./commands.tsx";
import { CompactControlsMenu, ContextMeter, declaredTraits, latestUsage, ModelPicker, TraitsPicker } from "./pickers.tsx";
import { chipOfToken, PromptEditor, type PromptEditorHandle, type Trigger } from "./PromptEditor.tsx";
import { UpNext } from "./UpNext.tsx";
import { useRestingComposer, useRestingTransition } from "./resting.ts";
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
  /** Notices above the composer (the rail's error line). */
  readonly notices?: ReadonlyArray<ComposerNotice>;
}

/** Whether Cmd or Ctrl, and Shift, are held: Send then shows the other follow-up action (t3code's). */
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

/**
 * The composer's Agent tray (spec 08), built on t3code's composer: a Tiptap box, the
 * footer's pickers, Stop and Send. The rail's composer and the toolbar's are this one
 * component; only where a message goes differs.
 */
export const AgentTray = ({ client, variant, chatId, newChatTags, beforeSend, onSent, underChips, note, onMenuOpen, dropTarget, notices = [] }: AgentTrayProps) => {
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
  const draftKey: string | undefined = variant === "rail" ? (chatId ?? NEW_CHAT) : TOOLBAR_DRAFT;
  const [initialDraft] = useState(() => (draftKey === undefined ? EMPTY_DRAFT : client.draft(draftKey)));
  // A box that opens on a question shows its answer; the draft waits on the client.
  const [initialText] = useState(() => (variant === "rail" && openQuestion(chat) !== undefined ? "" : initialDraft.text));
  const [text, setText] = useState(initialText);
  const draftKeyRef = useRef(draftKey);
  const attachmentsRef = useRef<ReturnType<typeof useAttachments>>(null!);
  const draftVersion = useDraftVersion(client, draftKey ?? "");
  const chips = useSelectionChips(canvas, text.trim() === "");
  /** The context chips this draft's @ mentions added: they belong to the draft, not to the canvas selection. */
  const mentionIds = useRef<ReadonlyArray<string>>([]);
  /** A question holds the box for its answer: the draft is set aside on the client until it goes. */
  const answeringRef = useRef(false);
  /** A queued message open in the box (t3code's queued edit): the chat's draft waits on the client meanwhile. */
  const [editing, setEditing] = useState<{ readonly id: string; readonly chatId: string; readonly originalText: string } | null>(null);
  const editingRef = useRef(editing);
  const setEdit = (next: typeof editing) => {
    editingRef.current = next;
    setEditing(next);
  };
  const guard = useTypingGuard(
    chatId ?? NEW_CHAT,
    variant === "rail" && chat ? [...waitingRequests(chat, "approval"), ...waitingRequests(chat, "user-input")].map(requestIdOf) : [],
  );
  /** The draft this tray last wrote, and the key it last showed: only another writer's draft, or another key's, is put in the box. */
  const ownDraft = useRef<ChatDraft | undefined>(undefined);
  const shownKey = useRef<string | undefined>(undefined);
  const saveDraft = (value: string) => {
    if (draftKeyRef.current === undefined || answeringRef.current || editingRef.current !== null) return;
    ownDraft.current = { text: value, mentions: mentionIds.current, attachments: attachmentsRef.current.ready() };
    client.setDraft(draftKeyRef.current, ownDraft.current);
  };
  /** The attachments the draft's chips named at its last change. */
  const chipped = useRef<ReadonlyArray<string>>(chipRefs(initialText));
  /** Unfolds a resting composer: typing in it is using it. */
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
      // t3code's: a file's chip deleted takes the file with it (an image stays), and a chip of
      // an attachment the draft lacks (undone, or copied from another draft) brings it back.
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
  /** After a send or a stash the chips go back to the selection, and no mention is the draft's any more. */
  const forgetMentions = () => {
    mentionIds.current = [];
  };
  // Declared before the handoff effect: on a chat switch the chat's draft lands first, then any handoff joins it.
  useEffect(() => {
    draftKeyRef.current = draftKey;
    // Another chat's draft ends an edit as Cancel would.
    if (editingRef.current !== null && editingRef.current.chatId !== chatId) setEdit(null);
    if (draftKey === undefined || editingRef.current !== null) return;
    const stored = client.draft(draftKey);
    // Our own write comes back as a change; applying it could undo an upload or a keystroke since.
    if (shownKey.current === draftKey && stored === ownDraft.current) return;
    shownKey.current = draftKey;
    const shown = { text: box.current?.text() ?? "", mentions: mentionIds.current, attachments: attachmentsRef.current.ready() };
    if (sameDraft(shown, stored)) return;
    // The draft's attachments come with it; a question's answer keeps what it has staged.
    if (!answeringRef.current && !sameDraft({ ...EMPTY_DRAFT, attachments: shown.attachments }, { ...EMPTY_DRAFT, attachments: stored.attachments }))
      attachmentsRef.current.replace(stored.attachments);
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
  const [traitsOpen, setTraitsOpen] = useState(false);
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
  const attachments = useAttachments(client.engine, showError, {
    onReady: (item, attachment) => {
      client.rememberAttachments([attachment]);
      const chip = chipOfToken(attachmentChip(attachment));
      if (item.chip && chip && !answeringRef.current && editingRef.current === null) box.current?.insertChip(chip);
    },
    // t3code's insertAttachmentReferencesForDraft: the draft switched away from gets the file, and its chip at the end.
    onMoved: (owner, attachment, chip) => {
      client.rememberAttachments([attachment]);
      const draft = client.draft(owner);
      client.setDraft(owner, { ...draft, text: chip ? ensureChips(draft.text, [attachmentChip(attachment)]) : draft.text, attachments: [...draft.attachments, attachment] });
    },
  });
  attachmentsRef.current = attachments;
  // A change to what is staged saves the draft; not at mount, nor before the box exists, which would save it empty.
  const stagedOnce = useRef(false);
  useEffect(() => {
    if (!stagedOnce.current) {
      stagedOnce.current = true;
      return;
    }
    if (box.current?.element()) saveDraft(box.current.text());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments.staged]);
  /** Where an attachment goes: a paste or a drop into a prompt the person has written in also puts its chip at the caret. */
  const intake = (chip: boolean) => ({
    ...(draftKeyRef.current !== undefined ? { owner: draftKeyRef.current } : {}),
    chip: chip && withoutChips(box.current?.text() ?? "").trim() !== "",
  });
  const intakeRef = useRef(intake);
  intakeRef.current = intake;
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
      void attachments.add([...(event.dataTransfer?.files ?? [])], intakeRef.current(true));
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

  /** A large text paste becomes a text file attachment, unless Cmd+Shift+V asked for it inline. */
  const attachLargePaste = (pastedText: string): boolean => {
    const inline = Date.now() - inlineNext.current < 1500;
    inlineNext.current = 0;
    if (pastedText === "" || inline || !pasteBecomesFile(pastedText, text.length)) return false;
    const name = pastedTextFileName(attachments.staged.map((item) => item.name));
    const file = new File([pastedText], name, { type: "text/plain;charset=utf-8" });
    void attachments.add([file], intake(true));
    showNotice(`Large paste attached as ${name}`, "info", `${formatSize(file.size)} · Use ${platform() === "darwin" ? "⌘⇧V" : "Ctrl+Shift+V"} to keep a large paste inline.`);
    return true;
  };

  /** A paste of files attaches them (text pasted with them stays text); a large text paste becomes a file. */
  const onPaste = (event: ClipboardEvent): boolean => {
    const data = event.clipboardData;
    const pasted = [...(data?.files ?? [])];
    const pastedText = data?.getData("text/plain") ?? "";
    if (pasted.length > 0) {
      void attachments.add(pasted, intake(true));
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
    // t3code's control chords; a held Cmd+Shift+M or E does not repeat its toggle.
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
    // Alt+ArrowUp at the start of the box edits the newest queued message (t3code's).
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
    // An open menu takes Enter, whichever Enter sends; the other chords still send.
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
      setEdit(null);
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
    : editing !== null
      ? lengthError === undefined && text.trim() !== ""
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
  /**
   * A draft put back (a stash entry, queued messages given back, Edit from here) joins the
   * current one: its text after the draft's, its chips and attachments added (t3code's).
   * While a question holds the box it joins the draft set aside.
   */
  const restoreDraft = (draft: { readonly text: string; readonly selection: ReadonlyArray<string>; readonly attachments: ReadonlyArray<ChatAttachment> }) => {
    const aside = answeringRef.current || editingRef.current !== null ? draftKeyRef.current : undefined;
    if (aside !== undefined) client.setDraft(aside, { ...client.draft(aside), text: appendRestoredPrompt(client.draft(aside).text, draft.text), mentions: mentionIds.current });
    else box.current?.setText(appendRestoredPrompt(box.current.text(), draft.text));
    chips.add(draft.selection);
    attachments.restore(draft.attachments);
  };
  /** Cmd+S: a draft goes to the stash; with an empty box the only entry comes back, or the menu opens. */
  const stashKey = () => {
    const draft = box.current?.text() ?? "";
    if (draft.trim() !== "" || attachments.staged.length > 0) {
      stash.push({ text: draft, selection: chips.shapes.map((shape) => shape.id), attachments: attachments.ready() });
      setStashPulse((pulse) => pulse + 1);
      forgetMentions();
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
  /** `invert` does the other follow-up action; `thenNewChat` opens the rail's new chat once the message is out. */
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
    if (noProvider || (message.trim() === "" && attachments.staged.length === 0) || sending) return;
    setSending(true);
    client.setUi({ error: undefined });
    try {
      // Before a new chat exists: the switch to it shows its own, empty, draft.
      const uploaded = await attachments.settle();
      const context = contextSelection(canvas, chips.shapes);
      let target = chatId;
      if (target === null) {
        target = await createChat(client, { modelSelection: selection, runtimeMode: draftRuntime, interactionMode, tags: newChatTags }, message);
      }
      beforeSend?.(target);
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
      } else if (target === chatId && compactsBeforeSend({ tokens: compactTokens, keepFullHistory: keepFull, text: message })) {
        // t3code's: the message waits behind the /compact turn, as a queued message does.
        await sendMessage(client, target, { text: "/compact", selection: [], attachments: [] });
        client.enqueue(target, outgoing, latestCompletedTool(client.thread(target)));
      } else {
        await sendMessage(client, target, outgoing);
      }
      setFullHistory(target, false);
      onSent?.();
      if (thenNewChat) client.setUi({ chosen: NEW_CHAT, pinned: null });
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

  const queue = useQueue(client, variant === "rail" ? chatId : null);

  // Compact before send (t3code's): a Claude chat whose prompt cache has likely expired offers to compact first.
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
  const beginEdit = (item: QueuedMessage) => {
    if (chatId === null || answeringRef.current) return;
    historyPosition.current = null;
    setEdit({ id: item.id, chatId, originalText: item.message.text });
    box.current?.setText(item.message.text);
  };
  /** Ends the edit and puts the chat's draft back in the box. */
  const endEdit = (options?: { readonly focus?: boolean }) => {
    setEdit(null);
    box.current?.setText(draftKeyRef.current === undefined ? "" : client.draft(draftKeyRef.current).text, options);
  };
  const updateQueued = (edit: { readonly id: string; readonly chatId: string }, text: string) =>
    client.updateQueue(edit.chatId, (current) => current.map((item) => (item.id === edit.id ? { ...item, message: { ...item.message, text } } : item)));
  /** Update queued message: the new text replaces the queued one in place, while it is still waiting. */
  const saveEdit = () => {
    const edit = editingRef.current;
    const message = box.current?.text() ?? "";
    if (!edit || message.trim() === "" || promptLengthError(message) !== undefined) return;
    // One that left the queue meanwhile is the watcher's below.
    if (!client.queue(edit.chatId).some((item) => item.id === edit.id && item.state === "waiting")) return;
    updateQueued(edit, message);
    endEdit();
  };
  // The edited message went out (or came back) before it was saved: t3code's reconciliation.
  useEffect(() => {
    const edit = editingRef.current;
    if (!edit || edit.chatId !== chatId || queue.some((item) => item.id === edit.id && item.state === "waiting")) return;
    const current = box.current?.text() ?? "";
    const draft = draftKeyRef.current === undefined ? EMPTY_DRAFT : client.draft(draftKeyRef.current);
    const recovery = resolveQueuedEditExit({
      editChanged: current !== edit.originalText,
      threadDraftEmpty: draft.text.trim() === "" && draft.mentions.length === 0 && attachments.staged.length === 0,
    });
    if (recovery === "kept") {
      setEdit(null);
      saveDraft(current);
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

  // The rail is closed while the toolbar's tray is open: its errors show here.
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
    // An edit in progress is kept: it goes back with the rest.
    const edit = editingRef.current;
    if (edit !== null) {
      const message = box.current?.text() ?? "";
      if (message.trim() !== "") updateQueued(edit, message);
      endEdit();
    }
    // Stop gives every queued message back to the composer.
    returnQueued(client, chat.id);
    void client.dispatch({ type: "thread.turn.interrupt", threadId: chat.id, turnId: chat.latestTurn.turnId }).catch((error: unknown) => client.reportError(error));
  };

  // Type-to-focus and paste-to-focus (t3code's): what goes into the rail outside a field lands in the box.
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
    <div className="flex flex-col gap-1.5" data-variant={variant} data-testid="agent-tray" ref={root}>
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
      {/* Resting (t3code's): the prompt on one line with Send beside it, the controls in a strip under it. */}
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
        {/* One line: the access and plan controls sit in the More menu, as in t3code's compact footer. */}
        {/* Nothing overlaps: the tools share the line's width, the traits and then the model label truncate first, and Send's group keeps its size. */}
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
                if (chosen.length > 0) void attachments.add(chosen, intake(false));
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

/**
 * The round Send (t3code's primary action). While a turn runs it says what the message will
 * do, "Queue message" or "Steer message" by the Follow-up behavior setting, the other while
 * the other action's chord is held (Cmd, or Cmd+Shift when the Send shortcut needs Cmd for
 * this prompt), and a Cmd-click or Ctrl-click does the other for one message. While a queued
 * message is open in the box it is a check, "Update queued message".
 */
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
  /** This send runs /compact first. */
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

/**
 * t3code's compact-before-send chip, beside Send: "Compact" with the tokens a send would
 * compact first, or "Full" once clicked, to send with the whole history.
 */
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
