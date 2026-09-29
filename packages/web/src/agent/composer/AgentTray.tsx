import type { ModelSelection } from "@unframed/contracts";
import { continuableChat, DEFAULT_RUNTIME_MODE, tabLabel, type InteractionMode, type RuntimeMode } from "@unframed/domain";
import { ArrowLeft, ArrowUp, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentTrayProps as SlotProps } from "../../chrome/slots.ts";
import { useEngine } from "../../context.ts";
import { noProviderReady, providerName, readyProviders } from "../providers.ts";
import { createChat, messageOf, sendMessage } from "../send.ts";
import { useChatClient, useChats, useProviders, useWatchedThread, type ChatClient } from "../store.ts";
import { Tip } from "../../chrome/ui.tsx";
import { ChipRow, contextSelection, useSelectionChips } from "./chips.tsx";
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
  /** A band above the box (the toolbar's "continues" line). */
  readonly top?: ReactNode;
  /** A line beside Send (the toolbar's provider note). */
  readonly note?: (provider: string) => ReactNode;
}

/**
 * The composer's Agent tray (spec 08), built on t3code's composer: a Tiptap box, the
 * footer's pickers, Stop and Send. The rail's composer and the toolbar's are this one
 * component; only where a message goes differs.
 */
export const AgentTray = ({ client, variant, chatId, newChatTags, beforeSend, onSent, top, note }: AgentTrayProps) => {
  const { statuses } = useProviders(client);
  const chat = useWatchedThread(client, chatId);
  const running = chat?.latestTurn?.state === "running";
  const none = noProviderReady(statuses);
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

  useEffect(() => {
    void client.loadProviders();
  }, [client]);

  /** The model a message runs on: the chat's, or for a new chat the one picked here, else the first ready provider's default. */
  const selection: ModelSelection = useMemo(
    () => chat?.modelSelection ?? draftModel ?? { provider: ready[0] ?? "claude", model: "", traits: {} },
    [chat?.modelSelection, draftModel, ready],
  );

  const placeholder = none ? PLACEHOLDERS.noProvider : PLACEHOLDERS.default;
  const canSend = !none && !sending && text.trim() !== "";

  const send = useCallback(async () => {
    const message = box.current?.text() ?? "";
    if (none || message.trim() === "" || sending) return;
    setSending(true);
    client.setUi({ error: undefined });
    try {
      let target = chatId;
      if (target === null) {
        target = await createChat(client, { modelSelection: selection, runtimeMode: draftRuntime, interactionMode: draftInteraction, tags: newChatTags }, message);
      }
      beforeSend?.(target);
      const context = contextSelection(canvas, chips.shapes);
      box.current?.clear();
      chips.set(canvas?.getSelectedShapeIds() ?? []);
      await sendMessage(client, target, { text: message, selection: context, attachments: [] });
      onSent?.();
    } catch (error) {
      client.setUi({ error: messageOf(error) });
      if ((box.current?.text() ?? "") === "") box.current?.setText(message);
    } finally {
      setSending(false);
    }
  }, [none, sending, client, chatId, selection, draftRuntime, draftInteraction, newChatTags, beforeSend, onSent, canvas, chips]);

  const interrupt = () => {
    if (!chat?.latestTurn) return;
    void client.dispatch({ type: "thread.turn.interrupt", threadId: chat.id, turnId: chat.latestTurn.turnId }).catch((error: unknown) => client.setUi({ error: messageOf(error) }));
  };

  void setDraftModel;
  void setDraftRuntime;
  void setDraftInteraction;
  void trigger;

  return (
    <div className="unframed-agent-tray" data-variant={variant} data-testid="agent-tray">
      {top}
      <div className="unframed-agent-box">
        <ChipRow
          shapes={chips.shapes}
          onRemove={(ids) => {
            chips.remove(ids);
            box.current?.focus();
          }}
        />
        <PromptEditor
          placeholder={placeholder}
          label={PROMPT_LABEL}
          onChange={setText}
          onTrigger={setTrigger}
          onKey={() => false}
          onSubmit={() => void send()}
          onPaste={() => false}
          handle={box}
          autofocus={variant === "toolbar"}
        />
        <div className="unframed-agent-footer">
          <div className="unframed-agent-footer__tools" />
          <div className="unframed-agent-footer__send">
            {note?.(providerName(selection.provider))}
            {running && (
              <button type="button" className="unframed-agent-stop" aria-label="Stop generation" onClick={interrupt}>
                <Square size={12} aria-hidden fill="currentColor" />
              </button>
            )}
            <button type="button" className="unframed-agent-send" aria-label={running ? "Queue message" : "Send"} disabled={!canSend} onClick={() => void send()}>
              <ArrowUp size={15} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ARTIFACT_TYPES = new Set(["page", "motion"]);

/**
 * The toolbar composer's Agent tray: the message continues the newest chat that has seen
 * every selected artifact, or starts one tagged with them, and says which; Send opens the
 * rail on that chat before the message goes out.
 */
export const ToolbarAgentTray = ({ project, close }: SlotProps) => {
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
      top={
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
