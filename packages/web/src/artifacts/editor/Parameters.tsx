import { addParameterInstruction, applyParametersInstruction, continuableChat, DEFAULT_RUNTIME_MODE, type ArtifactKind, type DialsAnnouncement } from "@unframed/domain";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { readyProviders } from "../../agent/providers.ts";
import { createChat, sendMessage } from "../../agent/send.ts";
import { messageOf, useChatClient, useChats, useProviders } from "../../agent/store.ts";
import { Tip } from "../../chrome/ui.tsx";
import { useCanvasProject, useEngine } from "../../context.ts";
import { DialControls, type DialChrome } from "../DialControls.tsx";

export const COLUMN = "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card";

export const ColumnHeader = ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
  <header className={cn("flex h-12 min-w-0 flex-none items-center gap-2 border-b px-2.5", className)}>{children}</header>
);

interface ParametersProps {
  readonly shapeId: TLShapeId;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly announcement: DialsAnnouncement | undefined;
  readonly saved: Readonly<Record<string, unknown>> | undefined;
  readonly post: (values: unknown) => void;
  readonly onWrite?: (values: Readonly<Record<string, unknown>>) => void;
  readonly openRail?: boolean;
}

const NO_PROVIDER = "Connect Claude or Codex first.";

const useArtifactChat = (shapeId: TLShapeId, openRail: boolean) => {
  const client = useChatClient(useEngine(), useCanvasProject());
  const chats = useChats(client);
  const { statuses } = useProviders(client);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const send = async (instruction: string): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    setError(undefined);
    try {
      if (client.providers === undefined) await client.loadProviders();
      const ready = readyProviders(client.providers ?? statuses);
      if (ready.length === 0) {
        setError(NO_PROVIDER);
        return false;
      }
      const target =
        continuableChat(chats, [shapeId])?.id ??
        (await createChat(
          client,
          { modelSelection: { provider: ready[0]!, model: "", traits: {} }, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default", tags: [shapeId] },
          instruction,
        ));
      client.setUi(openRail ? { open: true, chosen: target, pinned: null } : { chosen: target, pinned: null });
      await sendMessage(client, target, { text: instruction, selection: [shapeId], attachments: [] });
      return true;
    } catch (failure) {
      setError(messageOf(failure));
      return false;
    } finally {
      setSending(false);
    }
  };

  return { send, sending, error, clearError: () => setError(undefined) };
};

const Failure = ({ error }: { readonly error: string | undefined }) =>
  error === undefined ? null : (
    <p role="alert" className="m-0 text-xs text-destructive-foreground">
      {error}
    </p>
  );

const AddParameterToggle = ({
  open,
  controls,
  onToggle,
  button,
}: {
  readonly open: boolean;
  readonly controls: string;
  readonly onToggle: () => void;
  readonly button: RefObject<HTMLButtonElement | null>;
}) => {
  const toggle = useRef(onToggle);
  toggle.current = onToggle;
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const click = () => toggle.current();
    element.addEventListener("click", click);
    return () => element.removeEventListener("click", click);
  }, []);
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
  error,
  onSend,
  onCancel,
}: {
  readonly id: string;
  readonly hasParameters: boolean;
  readonly sending: boolean;
  readonly error: string | undefined;
  readonly onSend: (wanted: string) => Promise<boolean>;
  readonly onCancel: () => void;
}) => {
  const [text, setText] = useState("");
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
    if (wanted === "" || sending) return;
    if (await onSend(wanted)) setText("");
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
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.altKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void send();
        }}
      />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">The agent writes it</span>
        <Button variant="outline" size="xs" disabled={text.trim() === "" || sending} onClick={() => void send()}>
          <Sparkles aria-hidden />
          {sending ? "Asking…" : "Add"}
        </Button>
      </div>
      <Failure error={error} />
    </div>
  );
};

const ApplyButton = ({ onApply, sending }: { readonly onApply: () => Promise<boolean>; readonly sending: boolean }) => {
  const button = useRef<HTMLButtonElement>(null);
  const apply = useRef(onApply);
  apply.current = onApply;
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const click = async () => {
      if (!(await apply.current())) return;
      setSent(true);
      clearTimeout(timer);
      timer = setTimeout(() => setSent(false), 1500);
    };
    element.addEventListener("click", click);
    return () => {
      clearTimeout(timer);
      element.removeEventListener("click", click);
    };
  }, []);
  return (
    <Tip label="Send these values to the agent">
      <Button ref={button} size="sm" className="h-8 sm:h-8" disabled={sending}>
        {sent ? <Check aria-hidden /> : null}
        {sending ? "Applying…" : sent ? "Sent" : "Apply"}
      </Button>
    </Tip>
  );
};

export const ParametersContent = ({ shapeId, kind, title, announcement, saved, post, onWrite, openRail = false }: ParametersProps) => {
  const adding = useArtifactChat(shapeId, openRail);
  const applying = useArtifactChat(shapeId, openRail);
  const [composing, setComposing] = useState(false);
  const [chrome, setChrome] = useState<DialChrome>();
  const composerId = useId();
  const toggleButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (composing || !refocus.current) return;
    refocus.current = false;
    toggleButton.current?.focus();
  }, [composing]);
  const fold = () => {
    refocus.current = true;
    setComposing(false);
  };
  const hasParameters = announcement !== undefined && Object.keys(announcement.schema ?? {}).length > 0;

  const toggle = () => {
    adding.clearError();
    applying.clearError();
    setComposing((open) => !open);
  };
  const addParameter = async (wanted: string) => {
    applying.clearError();
    const sent = await adding.send(addParameterInstruction({ wanted, kind, title }));
    if (sent) fold();
    return sent;
  };
  const apply = () => {
    adding.clearError();
    return applying.send(applyParametersInstruction({ name: announcement?.name || "Parameters", kind, title, values: chrome?.values() ?? saved ?? {} }));
  };

  const composer = composing && (
    <AddParameterComposer
      id={composerId}
      hasParameters={hasParameters}
      sending={adding.sending}
      error={adding.error}
      onSend={addParameter}
      onCancel={fold}
    />
  );
  const toggler = <AddParameterToggle open={composing} controls={composerId} onToggle={toggle} button={toggleButton} />;

  if (announcement === undefined) {
    return (
      <div className="flex flex-col gap-2 px-2.5 pt-2.5">
        <div className="flex items-center gap-2">
          <p className="m-0 flex-1 text-sm text-muted-foreground">No parameters yet.</p>
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
            <ApplyButton onApply={apply} sending={applying.sending} />
          </>,
          chrome.toolbar,
        )}
      {chrome &&
        createPortal(
          <>
            {composer}
            {applying.error !== undefined && (
              <div className="pb-2.5">
                <Failure error={applying.error} />
              </div>
            )}
          </>,
          chrome.below,
        )}
    </>
  );
};

export const ParametersBody = (props: ParametersProps) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-auto">
      <ParametersContent {...props} />
    </div>
  </div>
);
