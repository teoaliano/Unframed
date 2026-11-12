import { addParameterInstruction, applyParametersInstruction, continuableChat, DEFAULT_RUNTIME_MODE, railShown, type ArtifactKind, type DialsAnnouncement } from "@unframed/domain";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { readyProviders } from "../../agent/providers.ts";
import { latestCompletedTool } from "../../agent/queue.tsx";
import { createChat, sendMessage } from "../../agent/send.ts";
import { messageOf, NEW_CHAT, useChatClient, useProviders } from "../../agent/store.ts";
import { Tip } from "../../chrome/ui.tsx";
import { useCanvasProject, useEngine } from "../../context.ts";
import { DialControls, type DialChrome } from "../DialControls.tsx";

export const COLUMN = "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-(--artifact-editor-column-border) bg-(--artifact-editor-column-surface)";

export const ColumnHeader = ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
  <header className={cn("flex h-12 min-w-0 flex-none items-center gap-2 border-b px-2.5", className)}>{children}</header>
);

type Place = "canvas" | "editor";

interface ParametersProps {
  readonly shapeId: TLShapeId;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly announcement: DialsAnnouncement | undefined;
  readonly saved: Readonly<Record<string, unknown>> | undefined;
  readonly post: (values: unknown) => void;
  readonly onWrite?: (values: Readonly<Record<string, unknown>>) => void;
  readonly place: Place;
  readonly railVisible?: boolean;
}

const NO_PROVIDER = "Connect Claude or Codex first.";

type Sent = { readonly sent: boolean; readonly openedRail: boolean };

const NOT_SENT: Sent = { sent: false, openedRail: false };

const useArtifactChat = (shapeId: TLShapeId, place: Place, railVisible: boolean) => {
  const client = useChatClient(useEngine(), useCanvasProject());
  const { statuses } = useProviders(client);
  const inFlight = useRef(false);
  const [sending, setSending] = useState<"add" | "apply">();
  const [error, setError] = useState<{ readonly by: "add" | "apply"; readonly text: string }>();
  const visible = useRef(railVisible);
  visible.current = railVisible;

  const shownChat = (): string | null => {
    const ui = client.ui;
    if (!(place === "canvas" ? ui.open : visible.current)) return null;
    return railShown({ chats: client.chats(), selected: [shapeId], chosen: ui.chosen, pinned: ui.pinned, drafting: ui.chosen === NEW_CHAT }).active;
  };

  const send = async (by: "add" | "apply", instruction: string, toShown: boolean): Promise<Sent> => {
    if (inFlight.current) return NOT_SENT;
    inFlight.current = true;
    setSending(by);
    setError(undefined);
    try {
      if (client.providers === undefined) await client.loadProviders();
      const ready = readyProviders(client.providers ?? statuses);
      if (ready.length === 0) {
        setError({ by, text: NO_PROVIDER });
        return NOT_SENT;
      }
      const outgoing = { text: instruction, selection: [shapeId], attachments: [] };
      const shown = toShown ? shownChat() : null;
      if (shown !== null) {
        const thread = client.thread(shown);
        const running = thread?.latestTurn?.state === "running" || client.chats().find((chat) => chat.id === shown)?.status === "running";
        if (running) client.enqueue(shown, outgoing, latestCompletedTool(thread));
        else await sendMessage(client, shown, outgoing);
        return { sent: true, openedRail: false };
      }
      const target =
        continuableChat(client.chats(), [shapeId])?.id ??
        (await createChat(
          client,
          { modelSelection: { provider: ready[0]!, model: "", traits: {} }, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default", tags: [shapeId] },
          instruction,
        ));
      const opens = place === "canvas";
      client.setUi(opens ? { open: true, chosen: target, pinned: null } : { chosen: target, pinned: null });
      await sendMessage(client, target, outgoing);
      return { sent: true, openedRail: opens };
    } catch (failure) {
      setError({ by, text: messageOf(failure) });
      return NOT_SENT;
    } finally {
      inFlight.current = false;
      setSending(undefined);
    }
  };

  return { send, sending, error, clearError: () => setError(undefined) };
};

const Failure = ({ error }: { readonly error: string | undefined }) =>
  error === undefined ? null : (
    <p role="alert" className="m-0 text-xs text-(--artifact-editor-error-foreground)">
      {error}
    </p>
  );

const useNativeClick = (button: RefObject<HTMLButtonElement | null>, onClick: () => void) => {
  const handler = useRef(onClick);
  handler.current = onClick;
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const click = () => handler.current();
    element.addEventListener("click", click);
    return () => element.removeEventListener("click", click);
  }, [button]);
};

const AddParameterToggle = ({
  open,
  controls,
  disabled,
  onToggle,
  button,
}: {
  readonly open: boolean;
  readonly controls: string;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly button: RefObject<HTMLButtonElement | null>;
}) => {
  useNativeClick(button, onToggle);
  return (
    <Tip label="Add a parameter">
      <Button
        ref={button}
        variant="outline"
        size="icon-sm"
        className="size-8 sm:size-8"
        aria-label="Add a parameter"
        aria-expanded={open}
        aria-controls={controls}
        data-pressed={open ? "" : undefined}
        disabled={disabled}
      >
        <Sparkles aria-hidden />
      </Button>
    </Tip>
  );
};

const AddParameterComposer = ({
  id,
  hasParameters,
  sending,
  busy,
  error,
  text,
  onText,
  onSend,
  onCancel,
}: {
  readonly id: string;
  readonly hasParameters: boolean;
  readonly sending: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly onSend: (wanted: string) => Promise<boolean>;
  readonly onCancel: () => void;
}) => {
  const field = useRef<HTMLTextAreaElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      cancel.current();
    };
    element.addEventListener("keydown", onKey);
    return () => element.removeEventListener("keydown", onKey);
  }, []);

  const send = async () => {
    const wanted = text.trim();
    if (wanted === "" || busy) return;
    if (await onSend(wanted)) onText("");
  };

  return (
    <div id={id} data-testid="add-parameter-composer" className="flex flex-col gap-1.5 pb-2.5">
      <Textarea
        ref={field}
        aria-label="Add a parameter"
        rows={2}
        size="sm"
        placeholder={hasParameters ? "Add a parameter… (e.g. the background colour, the title size)" : "Describe a parameter… (e.g. the accent colour and the intro speed)"}
        value={text}
        onChange={(event) => onText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.altKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void send();
        }}
      />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-(--artifact-editor-meta)">The agent writes it</span>
        <Button variant="outline" size="xs" disabled={text.trim() === "" || busy} onClick={() => void send()}>
          <Sparkles aria-hidden />
          {sending ? "Asking…" : "Add"}
        </Button>
      </div>
      <Failure error={error} />
    </div>
  );
};

const ApplyButton = ({ onApply, sending, busy }: { readonly onApply: () => Promise<boolean>; readonly sending: boolean; readonly busy: boolean }) => {
  const button = useRef<HTMLButtonElement>(null);
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useNativeClick(button, () => {
    void onApply().then((done) => {
      if (!done) return;
      setSent(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSent(false), 1500);
    });
  });
  return (
    <Tip label="Send these values to the agent">
      <Button ref={button} size="sm" className="h-8 sm:h-8" disabled={busy}>
        {sent && !sending ? <Check aria-hidden /> : null}
        {sending ? "Applying…" : sent ? "Sent" : "Apply"}
      </Button>
    </Tip>
  );
};

export const ParametersContent = ({ shapeId, kind, title, announcement, saved, post, onWrite, place, railVisible = true }: ParametersProps) => {
  const chat = useArtifactChat(shapeId, place, railVisible);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [chrome, setChrome] = useState<DialChrome>();
  const composerId = useId();
  const toggleButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (composing || !refocus.current) return;
    refocus.current = false;
    toggleButton.current?.focus();
  }, [composing]);
  const fold = (returnFocus: boolean) => {
    refocus.current = returnFocus;
    setComposing(false);
    setDraft("");
  };
  const hasParameters = announcement !== undefined && Object.keys(announcement.schema ?? {}).length > 0;
  const busy = chat.sending !== undefined;

  const toggle = () => {
    chat.clearError();
    if (composing) setDraft("");
    setComposing(!composing);
  };
  const addParameter = async (wanted: string) => {
    const result = await chat.send("add", addParameterInstruction({ wanted, kind, title }), false);
    if (result.sent) fold(!result.openedRail);
    return result.sent;
  };
  const apply = async () => {
    if (!chrome || kind === "component") return false;
    const values = chrome.values();
    return (await chat.send("apply", applyParametersInstruction({ name: announcement?.name || "Parameters", kind, title, values }), true)).sent;
  };

  const composer = composing && (
    <AddParameterComposer
      id={composerId}
      hasParameters={hasParameters}
      sending={chat.sending === "add"}
      busy={busy}
      error={chat.error?.by === "add" ? chat.error.text : undefined}
      text={draft}
      onText={setDraft}
      onSend={addParameter}
      onCancel={() => fold(true)}
    />
  );
  const toggler = <AddParameterToggle open={composing} controls={composerId} disabled={busy && !composing} onToggle={toggle} button={toggleButton} />;

  if (announcement === undefined) {
    return (
      <div className="flex flex-col gap-2 px-2.5 pt-2.5">
        <div className="flex items-center gap-2">
          <p className="m-0 flex-1 text-sm text-(--artifact-editor-note)">No parameters yet.</p>
          {toggler}
        </div>
        {composer}
      </div>
    );
  }

  return (
    <>
      <DialControls shapeId={shapeId} announcement={announcement} saved={saved} post={post} onChrome={setChrome} {...(onWrite ? { onWrite } : {})} />
      {chrome &&
        createPortal(
          <>
            {toggler}
            {kind !== "component" && <ApplyButton onApply={apply} sending={chat.sending === "apply"} busy={busy} />}
          </>,
          chrome.toolbar,
        )}
      {chrome &&
        createPortal(
          <>
            {composer}
            {chat.error?.by === "apply" && (
              <div className="pb-2.5">
                <Failure error={chat.error.text} />
              </div>
            )}
          </>,
          chrome.below,
        )}
    </>
  );
};
