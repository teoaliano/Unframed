import { visibleChats, nextActive } from "@unframed/domain";
import { Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMaybeEditor, useValue } from "tldraw";
import { iconButtonClass, Tip } from "../../chrome/ui.tsx";
import { useEngine } from "../../context.ts";
import { AgentTray } from "../composer/AgentTray.tsx";
import { noProviderReady, readyProviders } from "../providers.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { createChat, messageOf } from "../send.ts";
import { useChatClient, useChats, useProviders, useRailUi } from "../store.ts";
import { Transcript } from "../transcript/Transcript.tsx";
import { NoProvider } from "./NoProvider.tsx";
import { TabStrip } from "./TabStrip.tsx";
import { ThreadSearch } from "./ThreadSearch.tsx";
import { platform } from "../../canvas/platform.ts";

export interface AgentRailProps {
  readonly project: string;
  /** The editor's left column (spec 09): no transition, no Close, no Locate. */
  readonly embedded?: boolean;
  /** The artifacts the tab strip is filtered to, in place of the canvas selection. */
  readonly filterTo?: ReadonlyArray<string>;
  readonly onLocate?: (shapeId: string) => void;
  readonly onOpenEditor?: (shapeId: string) => void;
  readonly onClose?: () => void;
  /** The canvas rail's slide: its element and whether it is arriving or leaving. */
  readonly motion?: { readonly ref: (element: HTMLElement | null) => void; readonly state: "open" | "closed" };
}

const ARTIFACT_TYPES = new Set(["page", "motion"]);

const smallIconButton = `${iconButtonClass} size-8 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`;

/**
 * The chat rail (spec 08): the project's chats as folder tabs filtered by the selected
 * artifacts, the active chat's transcript, its pending panels and the composer's Agent
 * tray, behind one component that the canvas and the artifact editor both mount.
 */
export const AgentRail = ({ project, embedded, filterTo, onLocate, onOpenEditor, onClose, motion }: AgentRailProps) => {
  const engine = useEngine();
  const client = useChatClient(engine, project);
  const editor = useMaybeEditor();
  const ui = useRailUi(client);
  const chats = useChats(client);
  const { statuses } = useProviders(client);
  const root = useRef<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void client.loadProviders();
  }, [client]);

  const selectionKey = useValue(
    "selected artifacts",
    () => (filterTo ? filterTo.join(" ") : (editor?.getSelectedShapes() ?? []).filter((shape) => ARTIFACT_TYPES.has(shape.type)).map((shape) => shape.id).join(" ")),
    [editor, filterTo],
  );
  const selectedArtifacts = useMemo(() => (selectionKey === "" ? [] : selectionKey.split(" ")), [selectionKey]);

  // A chat chosen from search stays shown until the selection next changes.
  const lastSelection = useRef(selectionKey);
  useEffect(() => {
    if (lastSelection.current === selectionKey) return;
    lastSelection.current = selectionKey;
    if (client.ui.pinned !== null) client.setUi({ pinned: null });
  }, [client, selectionKey]);

  const visible = useMemo(() => {
    const shown = visibleChats(chats, selectedArtifacts);
    const pinned = ui.pinned === null ? undefined : chats.find((chat) => chat.id === ui.pinned);
    return pinned && !shown.includes(pinned) ? [pinned, ...shown] : shown;
  }, [chats, selectedArtifacts, ui.pinned]);
  const active = ui.pinned !== null && visible.some((chat) => chat.id === ui.pinned) ? ui.pinned : nextActive(ui.chosen, visible);
  const activeSummary = visible.find((chat) => chat.id === active);
  const none = noProviderReady(statuses);
  const artifactsSelected = selectedArtifacts.length > 0;

  // Keys typed in the rail are the rail's: tldraw's canvas shortcuts never see them.
  useEffect(() => {
    const element = root.current;
    if (!element || !editor) return;
    const mark = (event: KeyboardEvent) => editor.markEventAsHandled(event);
    element.addEventListener("keydown", mark);
    element.addEventListener("keyup", mark);
    return () => {
      element.removeEventListener("keydown", mark);
      element.removeEventListener("keyup", mark);
    };
  }, [editor]);

  const newChat = () => {
    client.setUi({ chosen: null, pinned: null });
    void startEmptyChat();
  };
  const startEmptyChat = async () => {
    const provider = readyProviders(statuses)[0];
    if (!provider) return;
    await createChat(client, { modelSelection: { provider, model: "", traits: {} }, runtimeMode: "full-access", interactionMode: "default", tags: selectedArtifacts }).catch(() => undefined);
  };

  return (
    <aside
      ref={(element) => {
        root.current = element;
        motion?.ref(element);
      }}
      aria-label="Agent"
      className="unframed-agent-rail"
      data-state={motion?.state}
      data-embedded={embedded ? "" : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // tldraw's shortcuts listen on the document: keys typed in the rail stop here.
        event.stopPropagation();
        const command = platform() === "darwin" ? event.metaKey : event.ctrlKey;
        if (command && !event.shiftKey && event.key.toLowerCase() === "k") {
          event.preventDefault();
          client.setUi({ searchOpen: true });
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header className="unframed-agent-rail__header">
        <Sparkles size={16} aria-hidden className="text-icon" />
        <span className="unframed-agent-rail__title">Agent</span>
        <span className="flex-1" />
        <Tip label="Search chats">
          <button type="button" aria-label="Search chats" className={smallIconButton} onClick={() => client.setUi({ searchOpen: true })}>
            <Search size={16} aria-hidden />
          </button>
        </Tip>
        <Tip label={artifactsSelected ? "New chat about the selected artifacts" : "New chat"}>
          <button type="button" aria-label="New chat" className={smallIconButton} disabled={none} onClick={newChat}>
            <Plus size={17} aria-hidden />
          </button>
        </Tip>
        <Tip label="Delete this chat">
          <button
            type="button"
            aria-label="Delete chat"
            className={smallIconButton}
            disabled={!activeSummary || activeSummary.status === "running"}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </Tip>
        {!embedded && (
          <Tip label="Close">
            <button type="button" aria-label="Close" className={smallIconButton} onClick={onClose}>
              <X size={17} aria-hidden />
            </button>
          </Tip>
        )}
      </header>
      <div className="unframed-agent-rail__strip">
        <TabStrip client={client} chats={visible} active={active} selectedCount={selectedArtifacts.length} />
        {ui.searchOpen && <ThreadSearch client={client} chats={chats} onClose={() => client.setUi({ searchOpen: false })} />}
      </div>
      <div className="unframed-agent-rail__body">
        {none && statuses ? (
          <NoProvider client={client} />
        ) : active ? (
          <Transcript client={client} chatId={active} embedded={embedded === true} {...(onLocate ? { onLocate } : {})} {...(onOpenEditor ? { onOpenEditor } : {})} />
        ) : null}
      </div>
      {ui.error !== undefined && (
        <p role="alert" className="unframed-agent-rail__error">
          {ui.error}
        </p>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this chat?"
        description="The conversation is removed for good. What the agent changed on the canvas stays."
        actions={[
          {
            label: "Delete chat",
            destructive: true,
            onClick: () => {
              if (!active) return;
              client.setUi({ chosen: null, pinned: null });
              client.dispatch({ type: "thread.delete", threadId: active }).catch((error: unknown) => client.setUi({ error: messageOf(error) }));
            },
          },
        ]}
      />
      <div className="unframed-agent-rail__composer">
        <AgentTray client={client} variant="rail" chatId={active} newChatTags={selectedArtifacts} dropTarget={root} />
      </div>
    </aside>
  );
};
