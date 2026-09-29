/**
 * The editor's right column (spec 09): the artifact's parameters as DialKit controls, and the
 * box that asks the agent to add one.
 */
import { addParameterInstruction, continuableChat, DEFAULT_RUNTIME_MODE, mergeDialValues, normaliseDials, type ArtifactKind, type DialsAnnouncement } from "@unframed/domain";
import { createDialKit, createDialRoot } from "dialkit/vanilla";
import "dialkit/vanilla/styles.css";
import { SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { readyProviders } from "../../agent/providers.ts";
import { createChat, sendMessage } from "../../agent/send.ts";
import { messageOf, useChatClient, useChats, useProviders } from "../../agent/store.ts";
import { useCanvasProject, useEngine } from "../../context.ts";

/** Each editor column is a card: the kit's card fill, border and radius. */
export const COLUMN = "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card";

/** A column's one-row header, 48 px tall over a border. */
export const ColumnHeader = ({ children }: { readonly children: ReactNode }) => <header className="flex h-12 flex-none items-center gap-2 border-b px-2.5">{children}</header>;

/** A dial change is written to the shape this long after the last one. */
const WRITE_DELAY_MS = 400;

export interface ParametersProps {
  readonly shapeId: TLShapeId;
  readonly kind: ArtifactKind;
  /** The artifact's title, or its id when it has none. */
  readonly title: string;
  /** What the artifact last announced; `undefined` until it announces. */
  readonly announcement: DialsAnnouncement | undefined;
  readonly saved: Readonly<Record<string, unknown>> | undefined;
  /** Posts `unframed:dials:set` to the artifact's frame. */
  readonly post: (values: unknown) => void;
}

/** DialKit, inline, on the announced config. Rebuilt only when a new announcement arrives. */
const Controls = ({ shapeId, announcement, saved, post }: Pick<ParametersProps, "shapeId" | "saved" | "post"> & { readonly announcement: DialsAnnouncement }) => {
  const editor = useEditor();
  const host = useRef<HTMLDivElement>(null);
  const savedNow = useRef(saved);
  savedNow.current = saved;
  const postNow = useRef(post);
  postNow.current = post;
  const pending = useRef<Record<string, unknown> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // One tldraw history step per settled change, so Cmd-Z on the canvas takes a whole drag back.
  const write = () => {
    clearTimeout(timer.current);
    const values = pending.current;
    pending.current = undefined;
    const shape = values === undefined ? undefined : editor.getShape(shapeId);
    if (!shape || values === undefined) return;
    editor.markHistoryStoppingPoint("tune parameters");
    editor.updateShape({ id: shapeId, type: shape.type, props: { dials: values } } as Parameters<typeof editor.updateShape>[0]);
  };
  const writeNow = useRef(write);
  writeNow.current = write;

  // A change made just before the column goes away is flushed, never dropped.
  useEffect(() => () => writeNow.current(), []);

  useEffect(() => {
    const target = host.current;
    const normalised = normaliseDials(announcement.config);
    if (!target || !normalised.ok) return;
    const name = announcement.name === "" ? "Parameters" : announcement.name;
    const root = createDialRoot({ target, mode: "inline", theme: "dark", productionEnabled: true, defaultOpen: true });
    const kit = createDialKit(name, normalised.dialkit as Parameters<typeof createDialKit>[1], { id: `unframed-${name}` });
    const merged = mergeDialValues(normalised.schema, savedNow.current ?? null);
    for (const [key, value] of Object.entries(merged)) {
      try {
        kit.setValues({ [key]: value } as Parameters<typeof kit.setValues>[0]);
      } catch {
        // DialKit refused this value: the control keeps its default.
      }
    }
    const stop = kit.subscribe((values) => {
      postNow.current(values);
      pending.current = values as Record<string, unknown>;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => writeNow.current(), WRITE_DELAY_MS);
    }, false);
    return () => {
      stop();
      writeNow.current();
      kit.destroy();
      root.destroy();
    };
  }, [announcement]);

  return <div ref={host} data-testid="artifact-dials" />;
};

/** The box at the foot of the column: describe a parameter, and the agent adds it through the artifact's own chat. */
const AddParameter = ({ shapeId, kind, title, hasParameters }: Pick<ParametersProps, "shapeId" | "kind" | "title"> & { readonly hasParameters: boolean }) => {
  const client = useChatClient(useEngine(), useCanvasProject());
  const chats = useChats(client);
  const { statuses } = useProviders(client);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const send = async () => {
    const wanted = text.trim();
    if (wanted === "" || sending) return;
    setSending(true);
    setError(undefined);
    try {
      if (client.providers === undefined) await client.loadProviders();
      const ready = readyProviders(client.providers ?? statuses);
      if (ready.length === 0) {
        setError("Connect Claude or Codex first.");
        return;
      }
      const instruction = addParameterInstruction({ wanted, kind, title });
      const target =
        continuableChat(chats, [shapeId])?.id ??
        (await createChat(
          client,
          { modelSelection: { provider: ready[0]!, model: "", traits: {} }, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default", tags: [shapeId] },
          instruction,
        ));
      client.setUi({ chosen: target, pinned: null });
      await sendMessage(client, target, { text: instruction, selection: [shapeId], attachments: [] });
      setText("");
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-none flex-col gap-1.5 border-t p-2.5">
      <Textarea
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
      {error !== undefined && (
        <p role="alert" className="m-0 text-xs text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  );
};

export const Parameters = ({ shapeId, kind, title, announcement, saved, post }: ParametersProps) => {
  const hasParameters = announcement !== undefined && Object.keys(announcement.schema ?? {}).length > 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ColumnHeader>
        <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">Parameters</span>
      </ColumnHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {announcement === undefined ? (
          <p className="mx-2.5 my-4 text-sm text-muted-foreground">No parameters yet.</p>
        ) : (
          <Controls shapeId={shapeId} announcement={announcement} saved={saved} post={post} />
        )}
      </div>
      <AddParameter shapeId={shapeId} kind={kind} title={title} hasParameters={hasParameters} />
    </div>
  );
};
