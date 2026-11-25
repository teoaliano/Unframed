import type { ScreenShapeProps } from "@unframed/contracts";
import { DEFAULT_RUNTIME_MODE, flowInstruction, flowRoutes, SCREEN_VIEWPORTS, screenUrl } from "@unframed/domain";
import { ChevronDown, CopyPlus, ExternalLink, MonitorSmartphone, Workflow } from "lucide-react";
import { useState } from "react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { readyProviders } from "../agent/providers.ts";
import { createChat, sendMessage } from "../agent/send.ts";
import { useChatClient } from "../agent/store.ts";
import { Tip } from "../chrome/ui.tsx";
import { useCanvasProject, useEngine } from "../context.ts";
import { BranchChip, placeScreenBeside } from "./BranchChip.tsx";
import { usePendingWork } from "./pendingWork.ts";
import { repositoryState } from "./store.ts";

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

const KeepView = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const project = useCanvasProject();
  const instance = useValue(
    "screen instance",
    () => {
      const props = screenPropsOf(editor, shapeId);
      return props === undefined ? undefined : repositoryState(project).instances.get().get(props.instance);
    },
    [editor, shapeId, project],
  );
  return (
    <Tip label="Keep this view">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Keep this view"
        disabled={instance === undefined || instance.state === "removed"}
        onClick={() => instance !== undefined && placeScreenBeside(editor, shapeId, instance, "keep this view", "view")}
      >
        <CopyPlus aria-hidden />
      </Button>
    </Tip>
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

const NO_PROVIDER = "Connect Claude or Codex first.";

const ExplodeForm = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const client = useChatClient(engine, project);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { busy, problem, setProblem, run } = usePendingWork();
  const explode = () =>
    run(async () => {
      const routes = flowRoutes(text);
      if ("error" in routes) throw new Error(routes.error);
      const { group } = await engine.call("screens.explode", { project, shapeId, routes: [...routes.routes] });
      editor.select(group as TLShapeId);
      setOpen(false);
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
      setOpen(false);
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
    <BranchChip shapeId={shapeId} />
    <ViewportMenu shapeId={shapeId} />
    <OpenInBrowser shapeId={shapeId} />
    <KeepView shapeId={shapeId} />
    <ExplodeForm shapeId={shapeId} />
  </>
);
