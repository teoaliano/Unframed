import type { ScreenShapeProps } from "@unframed/contracts";
import { UnframedError, type Instance } from "@unframed/contracts";
import { DEFAULT_RUNTIME_MODE, flowInstruction, flowRoutes, forkBranchName, normaliseRoute, SCREEN_GAP, SCREEN_VIEWPORTS, screenUrl } from "@unframed/domain";
import { ChevronDown, ExternalLink, GitBranchPlus, GitFork, MonitorSmartphone, Route, Workflow } from "lucide-react";
import { useState, type ReactNode } from "react";
import { createShapeId, useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { readyProviders } from "../agent/providers.ts";
import { createChat, sendMessage } from "../agent/send.ts";
import { useChatClient } from "../agent/store.ts";
import { Tip } from "../chrome/ui.tsx";
import { useCanvasProject, useEngine } from "../context.ts";
import { repositoryState } from "./store.ts";

export const BAD_ROUTE = "A route starts with / and has no spaces, like /settings?tab=2.";

export const screenPropsOf = (editor: Editor, shapeId: TLShapeId): ScreenShapeProps | undefined => {
  const shape = editor.getShape(shapeId);
  return shape?.type === "screen" ? (shape.props as ScreenShapeProps) : undefined;
};

const updateScreen = (editor: Editor, shapeId: TLShapeId, patch: Partial<ScreenShapeProps>, mark: string) => {
  const shape = editor.getShape(shapeId);
  if (!shape) return;
  editor.markHistoryStoppingPoint(mark);
  editor.store.put([{ ...shape, props: { ...shape.props, ...patch } } as TLShape]);
};

const OpenInBrowser = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const project = useCanvasProject();
  const url = useValue(
    "screen url",
    () => {
      const props = screenPropsOf(editor, shapeId);
      const instance = props === undefined ? undefined : repositoryState(project).instances.get().get(props.instance);
      return props === undefined || instance?.state !== "live" || instance.proxyPort === null ? undefined : screenUrl(instance.proxyPort, props.route);
    },
    [editor, shapeId, project],
  );
  return (
    <Tip label="Open in browser">
      <Button variant="ghost" size="icon-sm" aria-label="Open in browser" disabled={url === undefined} onClick={() => url !== undefined && window.open(url, "_blank", "noopener,noreferrer")}>
        <ExternalLink aria-hidden />
      </Button>
    </Tip>
  );
};

const RouteField = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const route = useValue("screen route", () => screenPropsOf(editor, shapeId)?.route ?? "/", [editor, shapeId]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(route);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setText(route);
          setProblem(undefined);
        }
      }}
    >
      <Tip label="Change route">
        <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={`Route ${route}`} data-testid="screen-route" />}>
          <Route aria-hidden />
          <span className="max-w-40 truncate">{route}</span>
        </PopoverTrigger>
      </Tip>
      <PopoverPopup side="bottom" align="start" sideOffset={6} padding="compact" className="w-72" aria-label="Change route">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = normaliseRoute(text);
            if (next === undefined) return setProblem(BAD_ROUTE);
            if (next !== route) updateScreen(editor, shapeId, { route: next }, "screen route");
            setOpen(false);
          }}
        >
          <Input aria-label="Route" value={text} autoFocus onChange={(event) => setText(event.target.value)} />
          {problem !== undefined && <span className="text-xs text-(--artifact-editor-error-foreground)">{problem}</span>}
          <Button type="submit" size="sm" className="self-end">
            Show route
          </Button>
        </form>
      </PopoverPopup>
    </Popover>
  );
};

const ViewportMenu = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const size = useValue(
    "screen viewport",
    () => {
      const props = screenPropsOf(editor, shapeId);
      return props === undefined ? "" : `${Math.round(props.w)}×${Math.round(props.h)}`;
    },
    [editor, shapeId],
  );
  return (
    <Menu>
      <Tip label="Change viewport">
        <MenuTrigger render={<Button variant="outline" size="sm" aria-label={`Viewport ${size}`} data-testid="screen-viewport" />}>
          <MonitorSmartphone aria-hidden />
          <span className="tabular-nums">{size}</span>
          <ChevronDown aria-hidden className="opacity-72" />
        </MenuTrigger>
      </Tip>
      <MenuPopup align="start" className="min-w-44">
        <MenuRadioGroup
          value={size}
          onValueChange={(value) => {
            const viewport = SCREEN_VIEWPORTS.find((choice) => `${choice.w}×${choice.h}` === value);
            if (viewport) updateScreen(editor, shapeId, { w: viewport.w, h: viewport.h }, "screen viewport");
          }}
        >
          {SCREEN_VIEWPORTS.map((choice) => (
            <MenuRadioItem key={choice.name} value={`${choice.w}×${choice.h}`} closeOnClick>
              <span className="flex w-full items-center justify-between gap-3">
                {choice.name}
                <span className="tabular-nums opacity-72">{`${choice.w}×${choice.h}`}</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
};

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

export const placeScreenBeside = (editor: Editor, shapeId: TLShapeId, instance: Instance): void => {
  const shape = editor.getShape(shapeId);
  const props = screenPropsOf(editor, shapeId);
  if (!shape || props === undefined) return;
  const bounds = editor.getShapePageBounds(shapeId)!;
  const id = createShapeId();
  editor.markHistoryStoppingPoint("screen for a new instance");
  editor.createShape({ id, type: "screen", x: bounds.maxX + SCREEN_GAP, y: bounds.minY, props: { w: props.w, h: props.h, instance: instance.id, route: props.route, title: instance.branch } });
  editor.select(id);
};

const BranchForm = ({ shapeId, label, icon, title, submit, base }: {
  readonly shapeId: TLShapeId;
  readonly label: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly submit: string;
  readonly base: "fork" | "pick";
}) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<ReadonlyArray<string>>([]);
  const [from, setFrom] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const forkedFrom = () => {
    const props = screenPropsOf(editor, shapeId);
    return props === undefined ? undefined : repositoryState(project).instances.get().get(props.instance);
  };
  const prepare = async () => {
    setProblem(undefined);
    setName("");
    try {
      const answer = await engine.call("instances.branches", { project });
      setBranches(answer.branches);
      const source = forkedFrom();
      if (base === "fork") {
        setFrom(source?.branch ?? answer.current);
        if (source !== undefined) setName(forkBranchName(source.branch, answer.branches));
      } else setFrom(answer.current);
    } catch (error) {
      setProblem(messageOf(error));
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void prepare();
      }}
    >
      <Tip label={title}>
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} />}>{icon}</PopoverTrigger>
      </Tip>
      <PopoverPopup side="bottom" align="start" sideOffset={6} padding="compact" className="w-80" aria-label={title}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || from === "") return;
            setBusy(true);
            setProblem(undefined);
            engine
              .call("instances.create", { project, base: from, ...(name.trim() === "" ? {} : { branch: name.trim() }) })
              .then((instance) => {
                placeScreenBeside(editor, shapeId, instance);
                setOpen(false);
              })
              .catch((error: unknown) => setProblem(messageOf(error)))
              .finally(() => setBusy(false));
          }}
        >
          {base === "pick" ? (
            <Select value={from} onValueChange={(value) => value && setFrom(value)}>
              <SelectTrigger aria-label="Base branch">
                <SelectValue>{from}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {branches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : (
            <span className="text-xs text-(--selection-toolbar-hint)">{from === "" ? "" : `From ${from}`}</span>
          )}
          <Input aria-label="Branch name" placeholder={base === "pick" ? "A new branch, named for you" : undefined} value={name} autoFocus onChange={(event) => setName(event.target.value)} />
          {problem !== undefined && <span className="text-xs text-(--artifact-editor-error-foreground)">{problem}</span>}
          <Button type="submit" size="sm" className="self-end" disabled={busy || from === ""}>
            {submit}
          </Button>
        </form>
      </PopoverPopup>
    </Popover>
  );
};

const NO_PROVIDER = "Connect Claude or Codex first.";

const ExplodeForm = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const client = useChatClient(engine, project);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    work()
      .then(() => setOpen(false))
      .catch((error: unknown) => setProblem(messageOf(error)))
      .finally(() => setBusy(false));
  };
  const explode = () =>
    run(async () => {
      const routes = flowRoutes(text);
      if ("error" in routes) throw new Error(routes.error);
      const { group } = await engine.call("screens.explode", { project, shapeId, routes: [...routes.routes] });
      editor.select(group as TLShapeId);
    });
  const ask = () =>
    run(async () => {
      const props = screenPropsOf(editor, shapeId);
      const instance = props === undefined ? undefined : repositoryState(project).instances.get().get(props.instance);
      if (props === undefined || instance === undefined) throw new Error("That Screen's Instance is not available.");
      if (client.providers === undefined) await client.loadProviders();
      const ready = readyProviders(client.providers);
      if (ready.length === 0) throw new Error(NO_PROVIDER);
      const instruction = flowInstruction({ shape: shapeId.replace(/^shape:/, ""), route: props.route, branch: instance.branch, worktree: instance.worktree });
      const chatId = await createChat(client, { modelSelection: { provider: ready[0]!, model: "", traits: {} }, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default", tags: [shapeId] }, instruction);
      client.setUi({ open: true, chosen: chatId, pinned: null });
      await sendMessage(client, chatId, { text: instruction, selection: [shapeId], attachments: [] });
    });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setText(screenPropsOf(editor, shapeId)?.route ?? "/");
          setProblem(undefined);
        }
      }}
    >
      <Tip label="Explode into a Flow">
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Explode into a Flow" />}>
          <Workflow aria-hidden />
        </PopoverTrigger>
      </Tip>
      <PopoverPopup side="bottom" align="start" sideOffset={6} padding="compact" className="w-80" aria-label="Explode into a Flow">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            explode();
          }}
        >
          <Textarea aria-label="Routes, one per line" value={text} autoFocus onChange={(event) => setText(event.currentTarget.value)} />
          {problem !== undefined && <span className="text-xs text-(--artifact-editor-error-foreground)">{problem}</span>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={ask}>
              Ask the agent
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              Explode
            </Button>
          </div>
        </form>
      </PopoverPopup>
    </Popover>
  );
};

export const ScreenActions = ({ shapeId }: { readonly shapeId: TLShapeId }) => (
  <>
    <RouteField shapeId={shapeId} />
    <ViewportMenu shapeId={shapeId} />
    <OpenInBrowser shapeId={shapeId} />
    <BranchForm shapeId={shapeId} base="fork" label="Fork" title="Fork into a new Instance" submit="Fork" icon={<GitFork aria-hidden />} />
    <BranchForm shapeId={shapeId} base="pick" label="New Instance" title="New Instance from a branch" submit="Create Instance" icon={<GitBranchPlus aria-hidden />} />
    <ExplodeForm shapeId={shapeId} />
  </>
);
