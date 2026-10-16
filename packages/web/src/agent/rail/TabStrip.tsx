import type { ChatSummary } from "@unframed/contracts";
import { inlineTabs, linkedArtifacts, shapeKind, tabLabel, tabTooltip, type RecapShape } from "@unframed/domain";
import { Check, ChevronDown, CircleAlert, Pencil, Trash2, Unlink } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMaybeEditor, useValue, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from "~/components/ui/menu";
import { Tip } from "../../chrome/ui.tsx";
import { showUndo } from "../../toasts.tsx";
import { KIND_ICONS } from "../composer/chips.tsx";
import type { ChatClient } from "../store.ts";

/** A tab's status: its turn runs, or it finished or failed since the person last viewed it. */
type TabStatus = "running" | "finished" | "failed";

/** A chat's state for the seen marks: a new turn or a new outcome changes it. */
const stateKey = (chat: ChatSummary) => `${chat.status}:${chat.turnCount}`;

/** The state each chat had when the person last viewed it, or when the rail first saw it, per client. */
const seenByClient = new WeakMap<ChatClient, Map<string, string>>();
const seenFor = (client: ChatClient): Map<string, string> => {
  let seen = seenByClient.get(client);
  if (!seen) {
    seen = new Map();
    seenByClient.set(client, seen);
  }
  return seen;
};

/**
 * A running chat shows a spinner. A chat that finished or failed since it was last viewed
 * shows a checkmark or a warning until the person views it; the active chat counts as viewed.
 * Idle chats show nothing.
 */
const statusOf = (chat: ChatSummary, active: string | null, seen: ReadonlyMap<string, string>): TabStatus | undefined => {
  if (chat.status === "running") return "running";
  if (chat.id === active) return undefined;
  const known = seen.get(chat.id);
  if (known === undefined || known === stateKey(chat)) return undefined;
  return chat.status === "failed" ? "failed" : "finished";
};

const TabStatusIcon = ({ status, measure = false }: { readonly status: TabStatus | undefined; readonly measure?: boolean }) => {
  if (status === undefined) return null;
  const label = status === "running" ? "Running" : status === "finished" ? "Finished" : "Failed";
  return (
    <span role="img" aria-label={label} data-testid={measure ? undefined : "chat-status"} data-status={measure ? undefined : status} className="inline-flex shrink-0">
      {status === "running" && <Spinner size="xs" aria-hidden />}
      {status === "finished" && <Check aria-hidden className="text-success" />}
      {status === "failed" && <CircleAlert aria-hidden className="text-destructive" />}
    </span>
  );
};

export interface TabStripProps {
  readonly client: ChatClient;
  readonly chats: ReadonlyArray<ChatSummary>;
  /** Every chat of the project, so the seen marks record a chat the selection filter hides. */
  readonly observed: ReadonlyArray<ChatSummary>;
  readonly active: string | null;
  /** How many artifacts are selected, for the empty strip's copy. */
  readonly selectedCount: number;
  /** Asks to delete a chat; the rail confirms first. */
  readonly onDelete: (id: string) => void;
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

interface Linked {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

/**
 * Detach, in a chat's menu: unlinks one page or motion from the chat. One linked artifact is
 * one item; several open a submenu to pick from. Only artifacts still on the canvas show.
 * A toast says what was detached and offers Undo, which links it again.
 */
const DetachItems = ({ client, chat }: { readonly client: ChatClient; readonly chat: ChatSummary }) => {
  const editor = useMaybeEditor();
  const key = useValue(
    "linked artifacts",
    () =>
      JSON.stringify(
        chat.tags.flatMap((id): RecapShape[] => {
          const shape = editor?.getShape(id as TLShapeId);
          if (!shape) return [];
          const props = shape.props as Record<string, unknown>;
          const title = text(props.title);
          const fileName = text(props.fileName);
          return [{ id: shape.id, kind: shapeKind(shape.type), ...(title !== undefined ? { title } : {}), ...(fileName !== undefined ? { fileName } : {}) }];
        }),
      ),
    [editor, chat.tags],
  );
  const linked = useMemo(() => linkedArtifacts(chat.tags, JSON.parse(key) as RecapShape[]), [chat.tags, key]);
  const report = (error: unknown) => client.reportError(error);
  const detach = (artifact: Linked) =>
    client.dispatch({ type: "thread.tags.remove", threadId: chat.id, ids: [artifact.id] }).then(
      () => showUndo(`Detached from ${artifact.label}`, () => client.dispatch({ type: "thread.tags.add", threadId: chat.id, ids: [artifact.id] }).catch(report)),
      report,
    );
  if (linked.length === 0) return null;
  if (linked.length === 1) {
    const only = linked[0]!;
    return (
      <MenuItem onClick={() => detach(only)}>
        <Unlink aria-hidden />
        <Tip label={only.label} side="right">
          <span className="min-w-0 truncate">Detach from {only.label}</span>
        </Tip>
      </MenuItem>
    );
  }
  return (
    <MenuSub>
      <MenuSubTrigger>
        <Unlink aria-hidden />
        Detach from
      </MenuSubTrigger>
      <MenuSubPopup className="max-w-[260px]" aria-label="Detach from">
        {linked.map((artifact) => {
          const Icon = KIND_ICONS[artifact.kind as keyof typeof KIND_ICONS];
          return (
            <MenuItem key={artifact.id} onClick={() => detach(artifact)}>
              {Icon && <Icon aria-hidden />}
              <Tip label={artifact.label} side="right">
                <span className="min-w-0 truncate">{artifact.label}</span>
              </Tip>
            </MenuItem>
          );
        })}
      </MenuSubPopup>
    </MenuSub>
  );
};

const TAB_MENU_TRIGGER = "chat-tab-menu";

const STRIP_CLASS = "relative flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b px-2";

/** A tab's width limit, shared by the tabs and by the measuring row that sizes them. */
const TAB_CLASS = "min-w-0 max-w-36";

/**
 * One panel tab per visible chat (t3code's right panel tabs), newest first. As many tabs show
 * as fit the strip, always including the active chat; the rest sit behind a More menu that
 * names how many they are. A chat's status shows as an icon (see `statusOf`). Every chat has one
 * menu (Rename, Detach and Delete): a right-click on its tab or its row under More opens it, and
 * so does a click on the active tab. The selected look is the kit Button's pressed state.
 */
export const TabStrip = ({ client, chats, observed, active, selectedCount, onDelete }: TabStripProps) => {
  const choose = (id: string) => client.setUi({ chosen: id, pinned: client.ui.pinned === id ? id : null });
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly value: string }>();
  const [menuFor, setMenuFor] = useState<{ readonly id: string; readonly anchor: HTMLElement }>();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const measurer = useRef<HTMLDivElement>(null);
  // Before the first measure every chat fits, so the first paint is never narrower than the strip.
  const [space, setSpace] = useState({ room: Infinity, gap: 0 });
  // Each chat's tab width, then the More trigger's, as the measuring row lays them out.
  const [widths, setWidths] = useState<ReadonlyArray<number>>([]);
  const seen = seenFor(client);
  const menuChat = menuFor && chats.find((chat) => chat.id === menuFor.id);
  const rename = (chat: ChatSummary) => {
    abandoned.current = false;
    choose(chat.id);
    setRenaming({ id: chat.id, value: chat.title });
  };
  const abandoned = useRef(false);
  const commit = () => {
    if (!renaming) return;
    const { id, value } = renaming;
    setRenaming(undefined);
    if (abandoned.current) return;
    const chat = chats.find((known) => known.id === id);
    if (chat && value.trim() === chat.title.trim()) return;
    client.dispatch({ type: "thread.meta.update", threadId: id, title: value }).catch((error: unknown) => client.reportError(error));
  };
  /** A chat under More: its menu opens below the More trigger; choosing it makes it a tab. */
  const openMoreMenu = (id: string) => {
    choose(id);
    setMoreOpen(false);
    if (moreTrigger.current) setMenuFor({ id, anchor: moreTrigger.current });
  };

  // Before paint: the viewed chat's state is kept for the seen marks, and a chat new to the rail starts from its state now.
  useLayoutEffect(() => {
    for (const chat of observed) if (!seen.has(chat.id) || chat.id === active) seen.set(chat.id, stateKey(chat));
  }, [observed, active, seen]);

  useLayoutEffect(() => {
    if (!strip) return;
    const measure = () => {
      const style = getComputedStyle(strip);
      setSpace({
        room: strip.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        gap: parseFloat(style.columnGap) || 0,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [strip]);

  // Every commit, not only when the chats change: a status icon, a rename or a new active chat changes a tab's width.
  useLayoutEffect(() => {
    const row = measurer.current;
    if (!row) return;
    const next = Array.from(row.children, (child) => child.getBoundingClientRect().width);
    setWidths((current) => (current.length === next.length && current.every((width, index) => width === next[index]) ? current : next));
  });

  if (chats.length === 0) {
    const empty = selectedCount === 0 ? "No chats yet" : selectedCount >= 2 ? "Nothing said about these yet. Your first message starts a chat." : undefined;
    return (
      <div ref={setStrip} className={STRIP_CLASS} data-testid="chat-tabs">
        {empty !== undefined && <p className="m-0 truncate px-1 text-xs text-muted-foreground">{empty}</p>}
      </div>
    );
  }
  const activeIndex = chats.findIndex((chat) => chat.id === active);
  const shownIndexes = new Set(
    inlineTabs({
      widths: chats.map((_, index) => widths[index] ?? 0),
      active: activeIndex,
      room: space.room,
      moreWidth: widths[chats.length] ?? 0,
      gap: space.gap,
    }),
  );
  const inline = chats.filter((_, index) => shownIndexes.has(index));
  const more = chats.filter((_, index) => !shownIndexes.has(index));
  // The rename box grows with the text: its field is as wide as the name in characters.
  const renameWidth = (value: string) => ({ width: `${Math.max(6, value.length + 2)}ch` });
  const renameField = (chat: ChatSummary) =>
    renaming?.id === chat.id && (
      <Input
        key={chat.id}
        size="compact"
        className="w-auto max-w-56"
        style={renameWidth(renaming.value)}
        aria-label="Rename chat"
        value={renaming.value}
        placeholder={tabLabel({ ...chat, title: "" })}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setRenaming({ id: chat.id, value: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            abandoned.current = true;
            event.currentTarget.blur();
          }
        }}
        onBlur={commit}
      />
    );
  return (
    <div ref={setStrip} className={STRIP_CLASS} role="tablist" aria-label="Chats" data-testid="chat-tabs">
      {inline.map(
        (chat) =>
          renameField(chat) || (
            <Tip key={chat.id} label={tabTooltip(chat)}>
              <Button
                variant="ghost-muted"
                size="xs"
                className={TAB_CLASS}
                role="tab"
                aria-selected={chat.id === active}
                data-pressed={chat.id === active ? "" : undefined}
                data-chat-id={chat.id}
                onClick={(event) => {
                  // A click on the active tab opens its menu; the second click of a double-click renames instead.
                  if (chat.id === active && event.detail === 1) setMenuFor({ id: chat.id, anchor: event.currentTarget });
                  choose(chat.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  choose(chat.id);
                  setMenuFor({ id: chat.id, anchor: event.currentTarget });
                }}
                onDoubleClick={() => {
                  setMenuFor(undefined);
                  rename(chat);
                }}
              >
                <span className="min-w-0 truncate">{tabLabel(chat)}</span>
                <TabStatusIcon status={statusOf(chat, active, seen)} />
              </Button>
            </Tip>
          ),
      )}
      {/*
        Not modal, so the second click of a double-click reaches the tab. The menu opens at the
        tab or row it is for (its anchor), but Base UI wires a submenu (Detach from) to its
        parent through a trigger, so the menu keeps one that is never shown or clicked.
      */}
      <Menu modal={false} triggerId={TAB_MENU_TRIGGER} open={menuChat !== undefined} onOpenChange={(open) => !open && setMenuFor(undefined)}>
        <MenuTrigger id={TAB_MENU_TRIGGER} nativeButton={false} render={<span hidden />} />
        {menuChat && menuFor && (
          // Rename puts a field where the tab was: focus goes there, not back to the tab.
          <MenuPopup
            anchor={menuFor.anchor}
            side="bottom"
            align="start"
            sideOffset={4}
            className="max-w-[260px]"
            finalFocus={() => false}
            aria-label={`${tabLabel(menuChat)} actions`}
          >
            <MenuItem onClick={() => rename(menuChat)}>
              <Pencil aria-hidden />
              Rename
            </MenuItem>
            <DetachItems client={client} chat={menuChat} />
            <MenuSeparator />
            <MenuItem variant="destructive" disabled={menuChat.status === "running"} onClick={() => onDelete(menuChat.id)}>
              <Trash2 aria-hidden />
              Delete
            </MenuItem>
          </MenuPopup>
        )}
      </Menu>
      {more.length > 0 && (
        <Menu open={moreOpen} onOpenChange={setMoreOpen}>
          <MenuTrigger
            ref={moreTrigger}
            render={<Button variant="ghost-muted" size="xs" className={cn("ml-auto", TAB_CLASS)} />}
            aria-label="More chats"
          >
            <span className="min-w-0 truncate">More ({more.length})</span>
            <ChevronDown aria-hidden />
          </MenuTrigger>
          <MenuPopup side="bottom" align="end" sideOffset={4} className="max-w-[300px]">
            {more.map((chat) => (
              <MenuItem
                key={chat.id}
                data-chat-id={chat.id}
                onClick={() => choose(chat.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMoreMenu(chat.id);
                }}
              >
                <TabStatusIcon status={statusOf(chat, active, seen)} />
                <span className="min-w-0 flex-1 truncate">{tabLabel(chat)}</span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      )}
      {/*
        Off screen, one tab per chat and the More trigger at their natural widths, so the strip
        can tell what fits. Its row is as wide as its content, not the strip, so the tabs keep
        their size; the strip hides whatever overflows.
      */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
        <div ref={measurer} className="flex w-max items-center gap-1">
          {chats.map((chat) =>
            renaming?.id === chat.id ? (
              <Input key={chat.id} size="compact" className="w-auto max-w-56" style={renameWidth(renaming.value)} readOnly tabIndex={-1} value={renaming.value} />
            ) : (
              <Button key={chat.id} variant="ghost-muted" size="xs" className={TAB_CLASS} tabIndex={-1}>
                <span className="min-w-0 truncate">{tabLabel(chat)}</span>
                <TabStatusIcon status={statusOf(chat, active, seen)} measure />
              </Button>
            ),
          )}
          <Button variant="ghost-muted" size="xs" className={TAB_CLASS} tabIndex={-1}>
            <span className="min-w-0 truncate">More ({chats.length})</span>
            <ChevronDown aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
};
