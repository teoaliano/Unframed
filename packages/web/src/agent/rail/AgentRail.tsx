import { clearAllChats, clearedNotice, visibleChats, nextActive } from "@unframed/domain";
import { BrushCleaning, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMaybeEditor, useValue } from "tldraw";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Tip } from "../../chrome/ui.tsx";
import { useEngine } from "../../context.ts";
import { showNotice } from "../../toasts.tsx";
import { AgentTray } from "../composer/AgentTray.tsx";
import { noProviderReady } from "../providers.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
// Loaded when first opened: the diff renderer and its highlighter are heavy, and a page that never diffs should not pay for them.
const DiffPanel = lazy(() => import("../diff/DiffPanel.tsx").then((module) => ({ default: module.DiffPanel })));
import { NEW_CHAT, useChatClient, useChats, useProviders, useRailUi, useWatchedThread } from "../store.ts";
import { EMPTY_CHAT, Transcript } from "../transcript/Transcript.tsx";
import { NoProvider } from "./NoProvider.tsx";
import { TabStrip } from "./TabStrip.tsx";
import { ThreadSearch } from "./ThreadSearch.tsx";
import { platform } from "../../canvas/platform.ts";

export interface AgentRailProps {
  readonly project: string;
  /** The editor's left column (spec 09): no transition, no Close, no Locate. */
  readonly embedded?: boolean;
  /** Inside the kit Sheet, on a window too narrow to dock it: the Sheet is the surface and the motion. */
  readonly inSheet?: boolean;
  /** The artifacts the tab strip is filtered to, in place of the canvas selection. */
  readonly filterTo?: ReadonlyArray<string>;
  readonly onLocate?: (shapeId: string) => void;
  readonly onOpenEditor?: (shapeId: string) => void;
  readonly onClose?: () => void;
  /** The canvas rail's slide: its element and whether it is arriving or leaving. */
  readonly motion?: { readonly ref: (element: HTMLElement | null) => void; readonly state: "open" | "closed" };
}

const ARTIFACT_TYPES = new Set(["page", "motion"]);

/*
 * 380 px, docked left over the canvas where the editor's chat column sits, on solid
 * --background with the kit's border: on glass it crossed spec 02's pan budget. It stops
 * above the bottom-left zoom controls, which stay usable. The slide is a CSS transition on
 * `transform` (not Tailwind's `translate`), so reopening mid-exit reverses from where it is.
 */
const RAIL_CLASS =
  "pointer-events-auto absolute top-0 left-0 bottom-[52px] z-[600] box-border flex w-[380px] flex-col rounded-br-xl border-r border-b bg-background font-sans text-foreground [transform:none] opacity-100 [transition:transform_260ms_var(--ease-drawer),opacity_200ms_ease-out] starting:data-[state=open]:[transform:translateX(-100%)] starting:data-[state=open]:opacity-0 data-[state=closed]:pointer-events-none data-[state=closed]:[transform:translateX(-100%)] data-[state=closed]:opacity-0 data-[state=closed]:[transition:transform_200ms_var(--ease-drawer),opacity_160ms_ease-out] motion-reduce:[transition:opacity_160ms_ease-out] motion-reduce:data-[state=closed]:[transform:none] motion-reduce:data-[state=closed]:[transition:opacity_160ms_ease-out]";

/** The editor's left column, or the Sheet: the same rail in place, with no surface or motion of its own. */
const EMBEDDED_CLASS = "relative box-border flex size-full min-h-0 flex-col font-sans text-foreground";

/**
 * The room at the top of the docked rail for the top-left chrome card (spec 02), which sits
 * over it: as tall as the card reaches, plus its margin, so a shell that moves the card
 * (spec 01) moves the row with it.
 */
const ChromeRow = () => {
  const [height, setHeight] = useState(60);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = document.querySelector<HTMLElement>(".unframed-chrome-left");
    const element = row.current;
    if (!card || !element) return;
    const measure = () => {
      const top = element.parentElement?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(0, Math.round(card.getBoundingClientRect().bottom - top + 12)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return <div ref={row} className="shrink-0 border-b" style={{ height }} data-testid="rail-chrome-row" />;
};

/**
 * The chat rail (spec 08): the project's chats as folder tabs filtered by the selected
 * artifacts, the active chat's transcript, its pending panels and the composer's Agent
 * tray, behind one component that the canvas and the artifact editor both mount.
 */
export const AgentRail = ({ project, embedded, inSheet, filterTo, onLocate, onOpenEditor, onClose, motion }: AgentRailProps) => {
  const engine = useEngine();
  const client = useChatClient(engine, project);
  const editor = useMaybeEditor();
  const ui = useRailUi(client);
  const chats = useChats(client);
  const { statuses } = useProviders(client);
  const root = useRef<HTMLElement | null>(null);
  /** The chat the delete confirmation is about: the active one from the header, any from its tab menu. */
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  /** Clear all's counts, taken when its confirmation opens and kept after, so the dialog's words hold still while it closes. */
  const [clearCounts, setClearCounts] = useState(() => clearAllChats([]));

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
  // New chat leaves no tab active: the next message starts a chat.
  const drafting = ui.chosen === NEW_CHAT;
  const active = drafting ? null : ui.pinned !== null && visible.some((chat) => chat.id === ui.pinned) ? ui.pinned : nextActive(ui.chosen, visible);
  const activeSummary = visible.find((chat) => chat.id === active);
  // The session's failure shows here only when the transcript cannot say it: a failed turn's reply already ends with it.
  const activeChat = useWatchedThread(client, active);
  const lastError = activeChat?.session?.lastError ?? null;
  const lastText = activeChat?.messages.at(-1)?.text ?? "";
  const errorLine = ui.error ?? (lastError !== null && lastError.trim() !== "" && !lastText.includes(lastError.trim()) ? lastError : undefined);
  const none = noProviderReady(statuses);
  const artifactsSelected = selectedArtifacts.length > 0;
  // Every chat of the project, not only the visible ones: Clear all ignores the selection filter.
  const clearAll = clearAllChats(chats);

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

  const newChat = () => client.setUi({ chosen: NEW_CHAT, pinned: null });

  return (
    <aside
      ref={(element) => {
        root.current = element;
        motion?.ref(element);
      }}
      aria-label="Agent"
      className={embedded || inSheet ? EMBEDDED_CLASS : RAIL_CLASS}
      data-state={motion?.state}
      data-embedded={embedded ? "" : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // tldraw's shortcuts listen on the document: keys typed in the rail stop here.
        event.stopPropagation();
        // So the Sheet never hears Escape: the rail closes it, unless a menu of its own took the key.
        if (inSheet && event.key === "Escape" && !event.defaultPrevented && root.current?.contains(event.target as Node)) onClose?.();
        const command = platform() === "darwin" ? event.metaKey : event.ctrlKey;
        if (command && !event.shiftKey && event.key.toLowerCase() === "k") {
          event.preventDefault();
          client.setUi({ searchOpen: true });
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        // The canvas's own menu never opens over the rail; a text field keeps the browser's.
        event.stopPropagation();
        const target = event.target as HTMLElement;
        if (!target.closest("input, textarea, [contenteditable='true']")) event.preventDefault();
      }}
    >
      {/* Docked, the top-left chrome card sits over this row as the rail's own top line. */}
      {!embedded && !inSheet && <ChromeRow />}
      <header className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-3.5">
        <Sparkles aria-hidden className="size-4 shrink-0 text-foreground" />
        <h2 className="m-0 ml-1 flex-1 text-sm font-medium">Agent</h2>
        <Tip label="Search chats">
          <Button variant="ghost" size="icon-sm" aria-label="Search chats" onClick={() => client.setUi({ searchOpen: true })}>
            <Search aria-hidden />
          </Button>
        </Tip>
        <Tip label={artifactsSelected ? "New chat about the selected artifacts" : "New chat"}>
          <Button variant="ghost" size="icon-sm" aria-label="New chat" disabled={none} onClick={newChat}>
            <Plus aria-hidden />
          </Button>
        </Tip>
        <Tip label="Delete this chat">
          <Button variant="ghost" size="icon-sm" aria-label="Delete chat" disabled={!activeSummary || activeSummary.status === "running"} onClick={() => setDeleting(active)}>
            <Trash2 aria-hidden />
          </Button>
        </Tip>
        {!embedded && (
          // aria-disabled, not disabled, so the tooltip can say why it does nothing.
          <Tip label={clearAll.tooltip}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear all chats"
              aria-disabled={clearAll.disabled || undefined}
              onClick={() => {
                if (clearAll.disabled) return;
                setClearCounts(clearAll);
                setClearing(true);
              }}
            >
              <BrushCleaning aria-hidden />
            </Button>
          </Tip>
        )}
        {/* Close stands apart, so reaching for it never lands on Clear all chats. */}
        {!embedded && <Separator orientation="vertical" className="mx-1 h-4" />}
        {!embedded && (
          <Tip label="Close">
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X aria-hidden />
            </Button>
          </Tip>
        )}
      </header>
      <div className="relative shrink-0">
        <TabStrip client={client} chats={visible} active={active} selectedCount={selectedArtifacts.length} onDelete={setDeleting} />
        {ui.searchOpen && <ThreadSearch client={client} chats={chats} onClose={() => client.setUi({ searchOpen: false })} />}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {none && statuses ? (
          <NoProvider client={client} />
        ) : active ? (
          <Transcript client={client} chatId={active} embedded={embedded === true} {...(onLocate ? { onLocate } : {})} {...(onOpenEditor ? { onOpenEditor } : {})} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col p-3.5" data-testid="transcript">
            <p className="m-0 mt-auto text-xs text-muted-foreground">{EMPTY_CHAT}</p>
          </div>
        )}
      </div>
      {errorLine !== undefined && (
        <Alert variant="error" className="mx-2.5 mb-2">
          <AlertDescription>{errorLine}</AlertDescription>
        </Alert>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this chat?"
        description="The conversation is removed for good. What the agent changed on the canvas stays."
        actions={[
          {
            label: "Delete chat",
            destructive: true,
            onClick: () => {
              if (!deleting) return;
              if (deleting === active) client.setUi({ chosen: null, pinned: null });
              client.dispatch({ type: "thread.delete", threadId: deleting }).catch((error: unknown) => client.reportError(error));
            },
          },
        ]}
      />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title="Clear all chats?"
        description={clearCounts.description}
        actions={[
          {
            label: clearCounts.action,
            destructive: true,
            onClick: () => {
              if (activeSummary && activeSummary.status !== "running") client.setUi({ chosen: null, pinned: null });
              const before = new Set(client.chats().map((chat) => chat.id));
              client.dispatch({ type: "project.chats.clear" }).then(
                // Counted from what the engine removed, which may differ from what the dialog counted.
                async ({ sequence }) => {
                  await client.shellReached(sequence);
                  const left = client.chats().filter((chat) => before.has(chat.id));
                  const notice = clearedNotice(before.size - left.length, left.filter((chat) => chat.status === "running").length);
                  showNotice(notice.title, "info", notice.description);
                },
                (error: unknown) => client.reportError(error),
              );
            },
          },
        ]}
      />
      {ui.diff && activeChat && ui.diff.threadId === activeChat.id && (
        <Suspense fallback={null}>
          <DiffPanel key={activeChat.id} client={client} chat={activeChat} diff={ui.diff} />
        </Suspense>
      )}
      <div className="shrink-0 px-2.5 pb-2.5">
        <AgentTray client={client} variant="rail" chatId={active} newChatTags={selectedArtifacts} dropTarget={root} />
      </div>
    </aside>
  );
};
