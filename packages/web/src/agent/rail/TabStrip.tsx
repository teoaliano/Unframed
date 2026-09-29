import { Menu } from "@base-ui/react/menu";
import type { ChatSummary } from "@unframed/contracts";
import { tabLabel, tabTooltip } from "@unframed/domain";
import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { itemClass, popupClass, Tip } from "../../chrome/ui.tsx";
import type { ChatClient } from "../store.ts";

const INLINE_TABS = 3;

const LiveDot = () => <span className="unframed-agent-live-dot" data-testid="live-dot" aria-label="Running" />;

/** A chat is live while its turn runs or it waits on the person. */
const isLive = (chat: ChatSummary) => chat.status === "running" || chat.hasPendingApproval || chat.hasPendingUserInput;

export interface TabStripProps {
  readonly client: ChatClient;
  readonly chats: ReadonlyArray<ChatSummary>;
  readonly active: string | null;
  /** How many artifacts are selected, for the empty strip's copy. */
  readonly selectedCount: number;
}

/**
 * One folder tab per visible chat, newest first: three inline, the rest under More, whose
 * trigger names the active chat when it is one of them. A running chat shows a live dot.
 */
export const TabStrip = ({ client, chats, active, selectedCount }: TabStripProps) => {
  const choose = (id: string) => client.setUi({ chosen: id, pinned: client.ui.pinned === id ? id : null });
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly value: string }>();
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
      <div className="unframed-agent-tabs" data-empty="">
        {empty !== undefined && <p className="unframed-agent-tabs__empty">{empty}</p>}
      </div>
    );
  }
  const inline = chats.slice(0, INLINE_TABS);
  const more = chats.slice(INLINE_TABS);
  const activeInMore = more.find((chat) => chat.id === active);
  return (
    <div className="unframed-agent-tabs" role="tablist" aria-label="Chats">
      {inline.map((chat) =>
        renaming?.id === chat.id ? (
          <input
            key={chat.id}
            aria-label="Rename chat"
            className="unframed-agent-tab-rename"
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
          <button
            type="button"
            role="tab"
            aria-selected={chat.id === active}
            className="unframed-agent-tab"
            data-chat-id={chat.id}
            onClick={() => choose(chat.id)}
            onDoubleClick={() => {
              abandoned.current = false;
              choose(chat.id);
              setRenaming({ id: chat.id, value: chat.title });
            }}
          >
            <span className="unframed-agent-tab__label">{tabLabel(chat)}</span>
            {isLive(chat) && <LiveDot />}
          </button>
        </Tip>
        ),
      )}
      {more.length > 0 && (
        <Menu.Root>
          <Menu.Trigger className="unframed-agent-tab unframed-agent-tab--more" data-active={activeInMore ? "" : undefined} aria-label={activeInMore ? `More chats: ${tabLabel(activeInMore)}` : "More chats"}>
            <span className="unframed-agent-tab__label">{activeInMore ? tabLabel(activeInMore) : "More"}</span>
            <ChevronDown size={13} aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[800]">
              <Menu.Popup className={`${popupClass} max-w-[300px]`}>
                {more.map((chat) => (
                  <Menu.Item key={chat.id} className={itemClass} data-chat-id={chat.id} onClick={() => choose(chat.id)}>
                    {isLive(chat) && <LiveDot />}
                    <span className="truncate" data-active={chat.id === active ? "" : undefined}>
                      {tabLabel(chat)}
                    </span>
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  );
};
