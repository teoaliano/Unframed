import type { ChatSummary } from "@unframed/contracts";
import { useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import type { ChatClient, RailUi } from "~/agent/store.ts";
import { TabStrip } from "~/agent/rail/TabStrip.tsx";
import { Demos, Row, Section } from "../frame.tsx";

const chat = (id: string, title: string, overrides: Partial<ChatSummary> = {}): ChatSummary => ({
  id,
  title,
  titledBy: "user",
  preview: "",
  tags: [],
  provider: "claude",
  model: "claude-sonnet-5-5",
  status: "idle",
  hasPendingApproval: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  turnCount: 2,
  createdAt: "2026-10-16T09:00:00.000Z",
  updatedAt: "2026-10-16T09:00:00.000Z",
  ...overrides,
});

const CHATS: ChatSummary[] = [
  chat("c1", "Hero copy for the landing"),
  chat("c2", "Moodboard", { status: "running" }),
  chat("c3", "Render the product shot"),
  chat("c4", "Failed export", { status: "failed" }),
  chat("c5", "Logo variations"),
  chat("c6", "Notes on the pricing page"),
  chat("c7", "Video intro"),
  chat("c8", "Tagline options"),
  chat("c9", "Chat nine"),
  chat("c10", "Chat ten"),
];

/**
 * The agent rail's own tab strip (`agent/rail/TabStrip.tsx`), rendered at the rail's 380 px width.
 * The rail's chat client is replaced by a local one that keeps the rail's UI state in this page
 * and does nothing else, so clicks change the active tab and the menus open, but no chat is
 * sent, renamed or deleted. "Finish the running chat" moves the spinner to a check, as a turn ends.
 */
export default function ChatTabsDemo() {
  const [ui, setUi] = useState<Partial<RailUi>>({ chosen: "c1", pinned: null });
  const [chats, setChats] = useState(CHATS);
  const uiRef = useRef<Partial<RailUi>>(ui);
  uiRef.current = ui;
  const client = useMemo(
    () =>
      ({
        get ui() {
          return uiRef.current as RailUi;
        },
        setUi(update: Partial<RailUi> | ((current: RailUi) => Partial<RailUi>)) {
          setUi((current) => ({ ...current, ...(typeof update === "function" ? update(current as RailUi) : update) }));
        },
        dispatch: () => Promise.resolve({ sequence: 0 }),
        reportError: (error: unknown) => console.error(error),
      }) as unknown as ChatClient,
    [],
  );
  const finish = () =>
    setChats((current) => current.map((each) => (each.id === "c2" ? { ...each, status: "idle", turnCount: each.turnCount + 1 } : each)));
  return (
    <Demos>
      <Section title="In the rail, 380 px">
        <Row label="many tabs">
          <div className="w-[380px] max-w-full overflow-hidden rounded-br-xl border-r border-b bg-background font-sans text-foreground">
            <TabStrip client={client} chats={chats} observed={chats} active={ui.chosen ?? null} selectedCount={0} onDelete={() => undefined} />
          </div>
        </Row>
        <Row label="one chat">
          <div className="w-[380px] max-w-full overflow-hidden rounded-br-xl border-r border-b bg-background font-sans text-foreground">
            <TabStrip client={client} chats={chats.slice(0, 1)} observed={chats} active="c1" selectedCount={0} onDelete={() => undefined} />
          </div>
        </Row>
        <Row label="empty">
          <div className="w-[380px] max-w-full overflow-hidden rounded-br-xl border-r border-b bg-background font-sans text-foreground">
            <TabStrip client={client} chats={[]} observed={[]} active={null} selectedCount={0} onDelete={() => undefined} />
          </div>
        </Row>
        <Row label="status">
          <Button variant="outline" size="sm" onClick={finish}>
            Finish the running chat
          </Button>
        </Row>
      </Section>
    </Demos>
  );
}
