/**
 * The agent on the canvas (spec 08): the Agent button in the top-right chrome, the
 * composer's Agent tray, and the chat rail docked to the left edge.
 */
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TldrawUiButtonIcon, TldrawUiToolbarButton, useEditor, type TLShapeId } from "tldraw";
import { registerSlot, type AgentTrayProps } from "../chrome/slots.ts";
import { useSlots } from "../chrome/slots.ts";
import { Button } from "~/components/ui/button";
import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { useCanvasProject, useEngine } from "../context.ts";
import { AgentRail } from "./rail/AgentRail.tsx";
import { ToolbarAgentTray } from "./composer/AgentTray.tsx";
import { providerMessage } from "./providers.ts";
import { QueueSender } from "./queue.tsx";
import { useChatClient, useProviders, useRailUi, type ChatClient } from "./store.ts";

/** t3code's width at and below which its right panel stops docking and opens as a Sheet. */
const SHEET_QUERY = "(max-width: 980px)";

const useNarrowWindow = (): boolean =>
  useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(SHEET_QUERY);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(SHEET_QUERY).matches,
  );

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
    const stops = [registerSlot("agentButton", Button), registerSlot("agentTray", ToolbarAgentTray), registerSlot("agentToolbarButton", OnToolbar)];
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

const CanvasRail = ({ client, openArtifact }: { readonly client: ChatClient; readonly openArtifact: ((id: string) => void) | undefined }) => {
  const editor = useEditor();
  const ui = useRailUi(client);
  const narrow = useNarrowWindow();
  useEffect(() => (ui.open && !narrow ? registerSlot("leftCardDocked", true) : undefined), [ui.open, narrow]);
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
  if (narrow) {
    return (
      <Sheet open={ui.open} onOpenChange={(open) => !open && close()}>
        <SheetPopup side="left" showCloseButton={false} className="w-[min(88vw,24rem)]">
          <AgentRail project={client.project} inSheet {...sheetProps} />
        </SheetPopup>
      </Sheet>
    );
  }
  // Beside tldraw's container, not in it: its own panels (the style panel) would sit on top of the rail.
  const host = editor.getContainer().parentElement;
  const rail = (
    <RailMotion open={ui.open}>
      {(ref, state) => <AgentRail project={client.project} motion={{ ref, state }} {...props} />}
    </RailMotion>
  );
  return host ? createPortal(rail, host) : rail;
};

export type { AgentTrayProps };
