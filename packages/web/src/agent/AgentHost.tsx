/**
 * The agent on the canvas (spec 08): the Agent button in the top-right chrome, the
 * composer's Agent tray, and the chat: docked to the left edge, floating as a composer
 * with the conversation above it, or floating as a window, as the chat layout setting says.
 */
import { CHAT_WINDOW_LIMITS, chatContainer, PANEL_MARGIN, readChatWindow, type ChatContainer, type PanelEdge } from "@unframed/domain";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TldrawUiButtonIcon, TldrawUiToolbarButton, useEditor, type TLShapeId } from "tldraw";
import { registerSlot, type AgentTrayProps } from "../chrome/slots.ts";
import { useSlots } from "../chrome/slots.ts";
import { Button } from "~/components/ui/button";
import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { TOP_BAR_HEIGHT } from "~/components/ui/top-bar";
import { cn } from "~/lib/utils";
import { useFloatingPlacement } from "../artifacts/panelPlacement.ts";
import { panelPrefsHook } from "../artifacts/panelPrefs.ts";
import { useCanvasProject, useEngine } from "../context.ts";
import { AgentRail } from "./rail/AgentRail.tsx";
import { useNarrowWindow } from "../chrome/narrowWindow.ts";
import { ToolbarAgentTray } from "./composer/AgentTray.tsx";
import { providerMessage } from "./providers.ts";
import { QueueSender } from "./queue.tsx";
import { EMPTY_DRAFT, NEW_CHAT, useChatClient, useChatLayout, useProviders, useRailUi, type ChatClient } from "./store.ts";

export const CHAT_WINDOW_KEY = "agent.chatWindow";

const useChatWindowPrefs = panelPrefsHook(CHAT_WINDOW_KEY, readChatWindow);

/** The floating composer keeps this far above the bottom toolbar, and the conversation this far below the top bar. */
const COMPOSER_GAP = 12;

const EDGES: ReadonlyArray<readonly [PanelEdge, string]> = [
  ["n", "inset-x-3 top-0 h-1.5 cursor-ns-resize"],
  ["s", "inset-x-3 bottom-0 h-1.5 cursor-ns-resize"],
  ["w", "inset-y-3 start-0 w-1.5 cursor-ew-resize"],
  ["e", "inset-y-3 end-0 w-1.5 cursor-ew-resize"],
  ["nw", "top-0 start-0 size-3 cursor-nwse-resize"],
  ["se", "bottom-0 end-0 size-3 cursor-nwse-resize"],
  ["ne", "top-0 end-0 size-3 cursor-nesw-resize"],
  ["sw", "bottom-0 start-0 size-3 cursor-nesw-resize"],
];


/** How long the rail waits for its own transitionend before it unmounts anyway: a hidden tab fires none. */
const EXIT_GUARANTEE_MS = 600;

/**
 * Keeps the rail mounted through its exit and unmounts it on its own `transitionend`
 * (transform or opacity). A CSS transition, so reopening mid-exit reverses from where it is.
 */
const RailMotion = ({ open, children }: { readonly open: boolean; readonly children: (ref: (element: HTMLElement | null) => void, state: "open" | "closed") => ReactNode }) => {
  const [mounted, setMounted] = useState(open);
  const element = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    if (open || !mounted) return;
    const rail = element.current;
    const done = () => setMounted(false);
    const onEnd = (event: TransitionEvent) => {
      if (event.target === rail && (event.propertyName === "transform" || event.propertyName === "opacity")) done();
    };
    rail?.addEventListener("transitionend", onEnd);
    const timer = setTimeout(done, EXIT_GUARANTEE_MS);
    return () => {
      rail?.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
    };
  }, [open, mounted]);
  if (!open && !mounted) return null;
  return <>{children((node) => (element.current = node), open ? "open" : "closed")}</>;
};

/**
 * The selection toolbar's outline Agent button; with no provider ready its tooltip is the
 * provider's message. A native tooltip: a tooltip component in the bar, which morphs into
 * the composer under the pointer, took the composer's focus now and then.
 */
const ToolbarAgentButton = ({ client, onOpen }: { readonly client: ChatClient; readonly onOpen: () => void }) => {
  const { statuses } = useProviders(client);
  return (
    <Button
      variant="outline"
      size="sm"
      title={providerMessage(statuses)}
      onPointerEnter={() => void client.loadProviders()}
      onFocus={() => void client.loadProviders()}
      onClick={() => {
        void client.loadProviders();
        onOpen();
      }}
    >
      <Sparkles aria-hidden />
      Agent
    </Button>
  );
};

/** Agent in the bottom bar: a tldraw toolbar button that opens the rail, pressed while it is open. */
const AgentBarButton = ({ client }: { readonly client: ChatClient }) => {
  const ui = useRailUi(client);
  return (
    <TldrawUiToolbarButton
      type="tool"
      title="Agent"
      isActive={ui.open}
      onClick={() => {
        void client.loadProviders();
        client.setUi({ open: !ui.open });
      }}
    >
      <TldrawUiButtonIcon icon="sparkles" />
    </TldrawUiToolbarButton>
  );
};

export const AgentHost = () => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const { openArtifact } = useSlots();
  const client = useChatClient(engine, project);

  useEffect(() => {
    const Button = () => <AgentBarButton client={client} />;
    const OnToolbar = ({ onOpen }: { readonly onOpen: () => void }) => <ToolbarAgentButton client={client} onOpen={onOpen} />;
    const controls = {
      open: () => {
        void client.loadProviders();
        client.setUi({ open: true });
      },
      startChat: (text: string) => {
        void client.loadProviders();
        client.setUi({ open: true, chosen: NEW_CHAT, pinned: null });
        client.setDraft(NEW_CHAT, { ...EMPTY_DRAFT, text });
      },
    };
    const stops = [
      registerSlot("agentButton", Button),
      registerSlot("agentTray", ToolbarAgentTray),
      registerSlot("agentToolbarButton", OnToolbar),
      registerSlot("agentControls", controls),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [client]);

  return (
    <>
      <QueueSender client={client} />
      <CanvasRail client={client} openArtifact={openArtifact ? (id: string) => openArtifact(editor, id as TLShapeId) : undefined} />
    </>
  );
};

/** How far the floating composer's column ends above the host's bottom: clear of the bottom toolbar, with a gap. */
const useToolbarClearance = (on: boolean): number | undefined => {
  const editor = useEditor();
  const [clearance, setClearance] = useState<number>();
  useLayoutEffect(() => {
    if (!on) return;
    const container = editor.getContainer();
    const host = container.parentElement ?? container;
    const measure = () => {
      const bar = container.querySelector<HTMLElement>("[data-unframed-toolbar]")?.getBoundingClientRect();
      const bottom = host.getBoundingClientRect().bottom;
      setClearance(Math.max(0, Math.round(bottom - (bar && bar.height > 0 ? bar.top : bottom))) + COMPOSER_GAP);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const bar = container.querySelector<HTMLElement>("[data-unframed-toolbar]");
    if (bar) observer.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [editor, on]);
  return clearance;
};

interface ChatProps {
  readonly onClose: () => void;
  readonly onLocate: (id: string) => void;
  readonly onOpenEditor?: (id: string) => void;
}

/**
 * The chat on a wide enough canvas, in whichever container the layout setting picks. One
 * element whatever the container, so changing it keeps the transcript, the tabs and the draft.
 */
const CanvasChat = ({
  client,
  container,
  motion,
  chatProps,
}: {
  readonly client: ChatClient;
  readonly container: Exclude<ChatContainer, "sheet">;
  readonly motion: { readonly ref: (element: HTMLElement | null) => void; readonly state: "open" | "closed" };
  readonly chatProps: ChatProps;
}) => {
  const editor = useEditor();
  const engine = useEngine();
  const ui = useRailUi(client);
  const [prefs, savePrefs] = useChatWindowPrefs(engine);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const motionRef = useRef(motion.ref);
  motionRef.current = motion.ref;
  const ref = useCallback((node: HTMLElement | null) => {
    motionRef.current(node);
    setElement(node);
  }, []);
  const floating = container === "window" && prefs !== undefined;
  const placement = useFloatingPlacement({
    editor,
    element,
    firstPlace: () => ({ left: PANEL_MARGIN, top: TOP_BAR_HEIGHT + PANEL_MARGIN }),
    floating,
    prefs,
    save: savePrefs,
    limits: CHAT_WINDOW_LIMITS,
  });
  const clearance = useToolbarClearance(container === "composer");
  const style: CSSProperties | undefined = container === "composer" ? { top: TOP_BAR_HEIGHT + COMPOSER_GAP, bottom: clearance ?? 0, visibility: clearance === undefined ? "hidden" : undefined } : undefined;
  const onConversation = useCallback(
    (open: boolean) => {
      if (open) void client.loadProviders();
      client.setUi({ open });
    },
    [client],
  );
  return (
    <AgentRail
      project={client.project}
      motion={{ ref, state: motion.state }}
      container={container}
      conversationOpen={ui.open}
      onConversation={onConversation}
      onHeaderPointerDown={(event) => {
        if (floating && (event.target as Element).closest("button") === null) placement.startMove(event);
      }}
      onMoveKey={(key, resize) => floating && placement.nudge(key, resize ? "resize" : "move")}
      {...(style ? { style } : {})}
      {...chatProps}
    >
      {floating &&
        EDGES.map(([edge, place]) => (
          <div
            key={edge}
            aria-hidden
            data-panel-edge={edge}
            className={cn("absolute z-10 touch-none", place)}
            onPointerDown={(event) => {
              event.stopPropagation();
              placement.startResize(event, edge);
            }}
          />
        ))}
    </AgentRail>
  );
};

const CanvasRail = ({ client, openArtifact }: { readonly client: ChatClient; readonly openArtifact: ((id: string) => void) | undefined }) => {
  const editor = useEditor();
  const ui = useRailUi(client);
  const layout = useChatLayout(client);
  const narrow = useNarrowWindow();
  const container = chatContainer(layout, narrow);
  useEffect(() => (ui.open && container === "rail" ? registerSlot("leftCardDocked", true) : undefined), [ui.open, container]);
  const close = useCallback(() => client.setUi({ open: false }), [client]);
  const locate = useCallback(
    (id: string) => {
      const bounds = editor.getShapePageBounds(id as TLShapeId);
      if (bounds) editor.zoomToBounds(bounds, { inset: 120, targetZoom: Math.min(1, editor.getZoomLevel() * 2), animation: { duration: 220 } });
    },
    [editor],
  );
  const props = useMemo(() => ({ onClose: close, onLocate: locate, ...(openArtifact ? { onOpenEditor: openArtifact } : {}) }), [close, locate, openArtifact]);
  // The Sheet covers the canvas, so going to a shape or into the editor closes it first.
  const sheetProps = useMemo(
    () => ({
      onClose: close,
      onLocate: (id: string) => {
        close();
        locate(id);
      },
      ...(openArtifact
        ? {
            onOpenEditor: (id: string) => {
              close();
              openArtifact(id);
            },
          }
        : {}),
    }),
    [close, locate, openArtifact],
  );
  if (container === "sheet") {
    return (
      <Sheet open={ui.open} onOpenChange={(open) => !open && close()}>
        <SheetPopup side="left" showCloseButton={false} className="w-[min(88vw,24rem)]">
          <AgentRail project={client.project} inSheet {...sheetProps} />
        </SheetPopup>
      </Sheet>
    );
  }
  // Beside tldraw's container, not in it: its own panels (the style panel) would sit on top of the chat.
  const host = editor.getContainer().parentElement;
  // The floating composer stays on the canvas while its conversation is closed.
  const chat = <RailMotion open={ui.open || container === "composer"}>{(ref, state) => <CanvasChat client={client} container={container} motion={{ ref, state }} chatProps={props} />}</RailMotion>;
  return host ? createPortal(chat, host) : chat;
};

export type { AgentTrayProps };
