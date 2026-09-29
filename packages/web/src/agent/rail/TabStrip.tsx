import type { ChatSummary } from "@unframed/contracts";
import { tabLabel, tabTooltip } from "@unframed/domain";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tip } from "../../chrome/ui.tsx";
import type { ChatClient } from "../store.ts";

const INLINE_TABS = 3;

const LiveDot = () => <span className="size-1.5 shrink-0 rounded-full bg-highlight" data-testid="live-dot" aria-label="Running" />;

/** A chat is live while its turn runs or it waits on the person. */
const isLive = (chat: ChatSummary) => chat.status === "running" || chat.hasPendingApproval || chat.hasPendingUserInput;

export interface TabStripProps {
  readonly client: ChatClient;
  readonly chats: ReadonlyArray<ChatSummary>;
  readonly active: string | null;
  /** How many artifacts are selected, for the empty strip's copy. */
  readonly selectedCount: number;
  /** Asks to delete a chat; the rail confirms first. */
  readonly onDelete: (id: string) => void;
}

const STRIP_CLASS = "flex h-9 shrink-0 items-center gap-1 border-b px-2";

/**
 * One panel tab per visible chat (t3code's right panel tabs), newest first: three inline,
 * the rest under More, whose trigger names the active chat when it is one of them. A
 * running chat shows a live dot. The selected look is the kit Button's pressed state.
 * A right-click on a tab, or a click on the active one, opens its menu: Rename and Delete.
 */
export const TabStrip = ({ client, chats, active, selectedCount, onDelete }: TabStripProps) => {
  const choose = (id: string) => client.setUi({ chosen: id, pinned: client.ui.pinned === id ? id : null });
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly value: string }>();
  const [menuFor, setMenuFor] = useState<{ readonly id: string; readonly anchor: HTMLElement }>();
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
  if (chats.length === 0) {
    const empty = selectedCount === 0 ? "No chats yet" : selectedCount >= 2 ? "Nothing said about these yet. Your first message starts a chat." : undefined;
    return (
      <div className={STRIP_CLASS} data-testid="chat-tabs">
        {empty !== undefined && <p className="m-0 truncate px-1 text-xs text-muted-foreground">{empty}</p>}
      </div>
    );
  }
  const inline = chats.slice(0, INLINE_TABS);
  const more = chats.slice(INLINE_TABS);
  const activeInMore = more.find((chat) => chat.id === active);
  return (
    <div className={STRIP_CLASS} role="tablist" aria-label="Chats" data-testid="chat-tabs">
      {inline.map((chat) =>
        renaming?.id === chat.id ? (
          // The rename box grows with the text: its field is as wide as the name in characters.
          <Input
            key={chat.id}
            size="compact"
            className="w-auto max-w-56"
            style={{ width: `${Math.max(6, renaming.value.length + 2)}ch` }}
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
        ) : (
          <Tip key={chat.id} label={tabTooltip(chat)}>
            <Button
              variant="ghost-muted"
              size="xs"
              className="min-w-0 max-w-36"
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
              {isLive(chat) && <LiveDot />}
            </Button>
          </Tip>
        ),
      )}
      {/* Not modal, so the second click of a double-click reaches the tab. */}
      <Menu modal={false} open={menuChat !== undefined} onOpenChange={(open) => !open && setMenuFor(undefined)}>
        {menuChat && menuFor && (
          // Rename puts a field where the tab was: focus goes there, not back to the tab.
          <MenuPopup anchor={menuFor.anchor} side="bottom" align="start" sideOffset={4} finalFocus={() => false} aria-label={`${tabLabel(menuChat)} actions`}>
            <MenuItem onClick={() => rename(menuChat)}>
              <Pencil aria-hidden />
              Rename
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" disabled={menuChat.status === "running"} onClick={() => onDelete(menuChat.id)}>
              <Trash2 aria-hidden />
              Delete
            </MenuItem>
          </MenuPopup>
        )}
      </Menu>
      {more.length > 0 && (
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost-muted" size="xs" className="ml-auto min-w-0 max-w-36" data-pressed={activeInMore ? "" : undefined} />}
            aria-label={activeInMore ? `More chats: ${tabLabel(activeInMore)}` : "More chats"}
          >
            <span className="min-w-0 truncate">{activeInMore ? tabLabel(activeInMore) : "More"}</span>
            <ChevronDown aria-hidden />
          </MenuTrigger>
          <MenuPopup side="bottom" align="end" sideOffset={4} className="max-w-[300px]">
            {more.map((chat) => (
              <MenuItem key={chat.id} data-chat-id={chat.id} data-active={chat.id === active ? "" : undefined} onClick={() => choose(chat.id)}>
                {isLive(chat) && <LiveDot />}
                <span className="min-w-0 truncate">{tabLabel(chat)}</span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
};
