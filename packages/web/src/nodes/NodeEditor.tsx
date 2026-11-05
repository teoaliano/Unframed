import { NODE_MEDIA, type GenerationProvider, type NodeMedium, type NodeShapeProps, type NodeVersion } from "@unframed/contracts";
import {
  currentVersion,
  GENERATION_PROVIDER_IDS,
  GENERATION_PROVIDERS,
  generationProviders,
  nodeCatalogueOf,
  nodeName,
  nodeProvider,
  nodeRequest,
  shapeName,
  VERCEL_VIDEO_BLOCKER,
  type Composition,
} from "@unframed/domain";
import { ChevronDown, GripVertical, Play } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { controlEvents } from "../canvas/shapes/media.tsx";
import { Tip } from "../chrome/ui.tsx";
import { useCanvasProject, useEngine, useSettings } from "../context.ts";
import { useCatalogue, usePricing } from "../generate/catalogue.ts";
import { InstructionEditor } from "../generate/composer/InstructionEditor.tsx";
import { ModelDialog } from "../generate/composer/ModelDialog.tsx";
import { PropTray } from "../generate/composer/PropTray.tsx";
import { NoKeyLine, StatusBand, StatusLine } from "../generate/composer/StatusLine.tsx";
import { canvasShapes } from "../generate/facts.ts";
import { mediumDefinition, type PropValue, type RunSource } from "../generate/mediumRegistry.ts";
import { nodeRunsProp, RUNS_KEY } from "../generate/runsProp.tsx";
import { type NodeShape } from "./facts.ts";
import { downstreamCounts, nodeRequestOf, nodeStatusOf, nodeView } from "./graph.ts";
import { moveWire, nodeFrames, updateNode } from "./operations.ts";
import { isRoutedNode, nodeCatalogueProvider, nodeStartValues, rememberNode, splitTray } from "./nodeTray.ts";
import { runNodes } from "./runs.ts";
import { VersionsStrip } from "./VersionsStrip.tsx";

export const NODE_INSTRUCTION_PLACEHOLDER = "What should this node make?";

const MEDIUM_LABELS: Record<NodeMedium, string> = { image: "image", video: "video", text: "text", audio: "audio", page: "page" };

const definitionOf = (medium: NodeMedium) => mediumDefinition(nodeCatalogueOf(medium))!;

const trayProps = (props: NodeShapeProps): Record<string, PropValue> => ({ ...props.params, ...(props.medium === "image" && props.runs !== undefined ? { [RUNS_KEY]: props.runs } : {}) });

const ProviderSwitch = ({ provider, onChange }: { readonly provider: GenerationProvider; readonly onChange: (provider: GenerationProvider) => void }) => (
  <ToggleGroup
    role="radiogroup"
    aria-label="Provider"
    size="sm"
    value={[provider]}
    onValueChange={(next) => {
      const [picked] = next as GenerationProvider[];
      if (picked !== undefined) onChange(picked);
    }}
  >
    {GENERATION_PROVIDER_IDS.map((each) => (
      <Toggle key={each} value={each} role="radio" aria-checked={each === provider}>
        {GENERATION_PROVIDERS[each].label}
      </Toggle>
    ))}
  </ToggleGroup>
);

const InputList = ({ shape }: { readonly shape: NodeShape }) => {
  const editor = useEditor();
  const wiresKey = useValue(
    "node inputs",
    () => {
      const canvas = nodeView(editor, shape.id);
      const roles = nodeRequestOf(editor, shape.id)?.roles ?? {};
      return JSON.stringify(canvas.wires.filter((wire) => wire.to === shape.id).map((wire) => ({ id: wire.id, name: shapeName(canvas, wire.from), role: roles[wire.id] ?? wire.role })));
    },
    [editor, shape.id],
  );
  const wires = JSON.parse(wiresKey) as Array<{ id: string; name: string; role: string }>;
  const dragged = useRef<string>(undefined);
  const [over, setOver] = useState<string>();
  if (wires.length === 0) {
    return (
      <p className="m-0 rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground" data-testid="node-inputs-empty">
        No inputs yet. Drag from the dot on a shape's right edge onto this node.
      </p>
    );
  }
  const drop = (event: DragEvent, before: string | undefined) => {
    event.preventDefault();
    const id = dragged.current;
    dragged.current = undefined;
    setOver(undefined);
    if (id !== undefined && id !== before) moveWire(editor, id as TLShapeId, before as TLShapeId | undefined);
  };
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Inputs" data-testid="node-inputs">
      {wires.map((wire) => (
        <li
          key={wire.id}
          draggable
          className={`flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 text-xs ${over === wire.id ? "border-ring" : ""}`}
          data-testid="node-input"
          data-wire-id={wire.id}
          onDragStart={(event) => {
            dragged.current = wire.id;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", wire.id);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(wire.id);
          }}
          onDragLeave={() => setOver((current) => (current === wire.id ? undefined : current))}
          onDrop={(event) => drop(event, wire.id)}
          onClick={() => editor.select(wire.id as TLShapeId)}
        >
          <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{wire.name}</span>
          <span className="shrink-0 text-muted-foreground" data-testid="node-input-role">
            {wire.role === "choose" ? "Choose what it sends" : wire.role}
          </span>
        </li>
      ))}
      <li className="h-2" aria-hidden onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, undefined)} />
    </ol>
  );
};

const RunRow = ({ shape, estimate, blocked }: { readonly shape: NodeShape; readonly estimate: string | undefined; readonly blocked: boolean }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const [busy, setBusy] = useState(false);
  const running = shape.props.run !== undefined;
  const countsKey = useValue("downstream counts", () => JSON.stringify(downstreamCounts(editor, shape.id)), [editor, shape.id]);
  const counts = JSON.parse(countsKey) as { pending: number; all: number };
  const run = async (downstream?: "pending" | "all") => {
    if (busy || running) return;
    setBusy(true);
    try {
      await runNodes({ editor, engine, project, ids: [shape.id], downstream });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center justify-end gap-2">
      {estimate !== undefined && (
        <span className="mr-auto text-xs text-muted-foreground tabular-nums" data-testid="node-estimate">
          {estimate}
        </span>
      )}
      {counts.all > 1 && (
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="sm" disabled={running} data-testid="node-downstream" />}>
            Run downstream
            <ChevronDown aria-hidden className="opacity-72" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-56">
            <MenuItem onClick={() => void run("pending")}>{`Run downstream: failed, waiting or never run (${counts.pending})`}</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => void run("all")}>{`Run downstream: all (${counts.all})`}</MenuItem>
          </MenuPopup>
        </Menu>
      )}
      <Button size="sm" disabled={running || busy || blocked} onClick={() => void run()} data-testid="node-run" aria-busy={running || busy || undefined}>
        {running || busy ? <Spinner aria-hidden /> : <Play aria-hidden />}
        {running ? "Running…" : "Run"}
      </Button>
    </div>
  );
};

export const NodeEditor = ({ shape, footer }: { readonly shape: NodeShape; readonly footer: HTMLElement | null }) => {
  const editor = useEditor();
  const engine = useEngine();
  const settings = useSettings();
  const project = useCanvasProject();
  const props = shape.props;
  const definition = definitionOf(props.medium);
  const provider = nodeProvider(props);
  const routed = isRoutedNode(props.medium);
  const keys = settings ?? { hasKey: true, hasVercelKey: false };
  const offered = routed ? generationProviders(keys, props.medium as "image" | "text") : [];
  const catalogue = useCatalogue(engine, nodeCatalogueOf(props.medium), nodeCatalogueProvider(props.medium, provider));
  const model = props.model !== "" ? props.model : catalogue?.default;
  const entry = catalogue?.models.find((each) => each.id === model);
  const tray = useMemo(() => trayProps(props), [props]);
  const params = useMemo(() => definition.params(entry, tray), [definition, entry, tray]);
  const pricing = usePricing(engine, definition, GENERATION_PROVIDERS[provider].listPriced ? undefined : model);
  const [dialogOpen, setDialogOpen] = useState(false);
  const box = useRef<{ readonly element: () => HTMLElement | null }>(null);
  const marked = useRef(false);
  const events = controlEvents(editor);

  const request = useValue(
    "node request",
    () => {
      const canvas = nodeView(editor, shape.id);
      const node = canvas.nodes.get(shape.id);
      return node ? nodeRequest({ node, canvas, frames: nodeFrames(node), referenceCap: params.referenceCap, model }) : undefined;
    },
    [editor, shape.id, params.referenceCap, model],
  );
  const status = useValue("node state", () => nodeStatusOf(editor, shape.id)?.state, [editor, shape.id]);

  const source: RunSource = useMemo(() => {
    const composition: Composition = {
      promptParts: [],
      prompt: request?.ok ? "x" : "",
      instruction: "",
      references: request?.ok ? request.references : [],
      roles: {},
      usable: true,
      sources: [],
      warnings: [],
    };
    return { kind: "selection", composition, selected: [], shapes: canvasShapes(editor), instruction: "" };
  }, [request, editor]);
  const estimate = definition.estimate({ pricing, props: tray, source, entry, provider });
  const needsKey =
    settings === undefined ? false : props.medium === "audio" ? !settings.hasElevenLabsKey : !GENERATION_PROVIDERS[provider].hasKey(settings);
  const keyMessage = props.medium === "audio" ? undefined : props.medium === "video" && settings?.hasVercelKey === true ? VERCEL_VIDEO_BLOCKER : GENERATION_PROVIDERS[provider].noKeyMessage;
  const refused = request !== undefined && !request.ok && request.kind === "refused" ? request.message : undefined;

  const setTray = useCallback(
    (next: Record<string, PropValue>, picked?: string) => {
      const split = splitTray(props.medium, next);
      updateNode(editor, shape.id, { ...split, ...(picked === undefined ? {} : { model: picked }), runs: split.runs });
      void rememberNode(engine, props.medium, { model: picked ?? props.model, picked: true, provider: nodeCatalogueProvider(props.medium, props.provider), tray: next });
    },
    [editor, engine, shape.id, props.medium, props.model, props.provider],
  );

  const switchMedium = async (medium: NodeMedium) => {
    if (medium === props.medium) return;
    const values = await nodeStartValues(engine, settings, medium);
    updateNode(editor, shape.id, { medium, model: values.model, params: values.params, runs: values.runs, provider: values.provider });
  };

  const switchProvider = async (next: GenerationProvider) => {
    if (next === provider) return;
    const values = await nodeStartValues(engine, settings, props.medium, { provider: next, model: props.model, tray });
    updateNode(editor, shape.id, { model: values.model, params: values.params, runs: props.runs, provider: values.provider });
    void rememberNode(engine, props.medium, { model: values.model, picked: values.model !== "", provider: values.provider, tray: trayProps({ ...props, params: values.params }) });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (props.run === undefined && refused === undefined) void runNodes({ editor, engine, project, ids: [shape.id] });
    }
  };

  const onMenuOpen = useCallback(() => undefined, []);

  return (
    <div className="pointer-events-auto flex flex-col gap-2" data-testid="node-editor" onKeyDownCapture={onKeyDown} {...events}>
      <ToggleGroup
        role="radiogroup"
        aria-label="Node medium"
        value={[props.medium]}
        onValueChange={(next) => {
          const [picked] = next as NodeMedium[];
          if (picked !== undefined) void switchMedium(picked);
        }}
      >
        {NODE_MEDIA.filter((medium) => mediumDefinition(nodeCatalogueOf(medium)) !== undefined).map((medium) => (
          <Toggle key={medium} value={medium} role="radio" aria-checked={medium === props.medium} size="sm">
            {MEDIUM_LABELS[medium]}
          </Toggle>
        ))}
      </ToggleGroup>
      <InputList shape={shape} />
      <div
        className="relative flex min-h-20 flex-col rounded-lg border border-input bg-background px-3 pt-2 pb-2 shadow-xs/5 ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px] dark:bg-input/32"
        data-testid="node-instruction-box"
        onFocus={() => {
          if (marked.current) return;
          marked.current = true;
          editor.markHistoryStoppingPoint("node instruction");
        }}
        onBlur={() => (marked.current = false)}
      >
        <InstructionEditor
          key={shape.id}
          initial={props.instruction}
          placeholder={NODE_INSTRUCTION_PLACEHOLDER}
          onChange={(text) => {
            const now = editor.getShape(shape.id);
            if (now && (now.props as NodeShapeProps).instruction !== text) updateNode(editor, shape.id, { instruction: text }, false);
          }}
          onMenuOpen={() => undefined}
          handle={box}
          autofocus={false}
        />
      </div>
      {(refused !== undefined || needsKey) && status !== "waiting" && (
        <StatusBand>
          {refused !== undefined && <StatusLine kind="blocked">{refused}</StatusLine>}
          {needsKey && <NoKeyLine message={keyMessage} />}
        </StatusBand>
      )}
      <PropTray
        lead={
          routed && (offered.length > 1 || (offered.length === 1 && offered[0] !== provider)) ? (
            <ProviderSwitch provider={provider} onChange={(next) => void switchProvider(next)} />
          ) : definition.Lead ? (
            <definition.Lead props={tray} onChange={(next) => setTray(next)} onMenuOpen={onMenuOpen} />
          ) : undefined
        }
        model={model}
        catalogueReady={catalogue !== undefined && catalogue.models.length > 0}
        params={params}
        extra={props.medium === "image" ? [nodeRunsProp] : []}
        props={tray}
        addable={definition.addable}
        onModelClick={() => setDialogOpen(true)}
        onChange={(next) => setTray(next)}
        onMenuOpen={onMenuOpen}
      />
      {footer && createPortal(<RunRow shape={shape} estimate={estimate} blocked={refused !== undefined || needsKey || status === "waiting"} />, footer)}
      <VersionsStrip shape={shape} />
      <ModelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={props.medium === "page" ? "Page models" : definition.dialogTitle}
        browseUrl={routed ? GENERATION_PROVIDERS[provider].browse[props.medium as "image" | "text"] : definition.browseUrl}
        browseLabel={routed ? GENERATION_PROVIDERS[provider].browseLabel : (definition.browseLabel ?? "Browse on OpenRouter")}
        columns={definition.modelColumns ?? "openrouter"}
        models={catalogue?.models ?? []}
        current={model}
        finalFocus={() => box.current?.element() ?? null}
        onPick={(picked) => {
          const next = picked === model ? tray : definition.reset(tray, definition.params(catalogue?.models.find((each) => each.id === picked)));
          setTray(next, picked);
        }}
      />
    </div>
  );
};

export const versionOf = (props: NodeShapeProps, id: string): NodeVersion | undefined => props.versions.find((version) => version.id === id);
export const currentOf = (shape: NodeShape) => currentVersion({ ...shape.props, id: shape.id } as Parameters<typeof currentVersion>[0]);
export { nodeName };
