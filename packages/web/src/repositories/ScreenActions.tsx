import type { ScreenShapeProps } from "@unframed/contracts";
import { mapFlowInstruction, SCREEN_VIEWPORTS, screenUrl, setupTag } from "@unframed/domain";
import { ChevronDown, CopyPlus, ExternalLink, Info, MonitorSmartphone, TriangleAlert, Workflow } from "lucide-react";
import { useState } from "react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuTrigger } from "~/components/ui/menu";
import { messageOf } from "../agent/store.ts";
import { Tip } from "../chrome/ui.tsx";
import { useCanvasProject } from "../context.ts";
import { showError } from "../toasts.tsx";
import { useAskAgent } from "./askAgent.ts";
import { BranchChip, placeScreenBeside, screenPropsOf, useScreenInstance } from "./BranchChip.tsx";
import { repositoryState, useRepositorySetup } from "./store.ts";

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
  const instance = useScreenInstance(shapeId);
  return (
    <Tip label="Duplicate">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Duplicate"
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

const MapFlow = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const project = useCanvasProject();
  const ask = useAskAgent();
  const [busy, setBusy] = useState(false);
  const map = () => {
    const props = screenPropsOf(editor, shapeId);
    const instance = props === undefined ? undefined : repositoryState(project).instances.get().get(props.instance);
    if (props === undefined || instance === undefined) return;
    setBusy(true);
    ask(shapeId, mapFlowInstruction({ shape: shapeId.replace(/^shape:/, ""), state: props.state?.trim() || props.route, route: props.route, branch: instance.branch, worktree: instance.worktree }))
      .catch((error: unknown) => showError(messageOf(error)))
      .finally(() => setBusy(false));
  };
  return (
    <Tip label="Map a Flow">
      <Button variant="ghost" size="icon-sm" aria-label="Map a Flow" disabled={busy} onClick={map}>
        <Workflow aria-hidden />
      </Button>
    </Tip>
  );
};

const SetupNotes = () => {
  const project = useCanvasProject();
  const setup = useRepositorySetup(project);
  const tag = setupTag(setup);
  const warnings = setup?.warnings ?? [];
  if (tag === undefined && warnings.length === 0) return null;
  const label = warnings.length === 0 ? "From Setup" : warnings.length === 1 ? "1 Setup warning" : `${warnings.length} Setup warnings`;
  return (
    <Popover>
      <Tip label={label}>
        <PopoverTrigger
          render={warnings.length === 0 ? <Button variant="ghost" size="icon-sm" aria-label={label} /> : <Button variant="warning-outline" size="sm" aria-label={label} />}
          data-testid="screen-setup-notes"
        >
          {warnings.length === 0 ? <Info aria-hidden /> : <TriangleAlert aria-hidden />}
          {warnings.length > 0 && warnings.length}
        </PopoverTrigger>
      </Tip>
      <PopoverPopup side="bottom" align="start" sideOffset={6} padding="compact" className="w-80" aria-label="From Setup">
        <div className="flex flex-col gap-2 text-xs">
          {warnings.length > 0 && (
            <ul className="m-0 flex list-disc flex-col gap-1 ps-4" aria-label="Setup warnings">
              {warnings.map((warning) => (
                <li key={warning} data-testid="setup-note-warning">
                  {warning}
                </li>
              ))}
            </ul>
          )}
          {tag !== undefined && (
            <span data-testid="setup-note-mocks">
              <span className="text-(--selection-toolbar-hint)">Mocked: </span>
              {tag}
            </span>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
};

export const ScreenActions = ({ shapeId }: { readonly shapeId: TLShapeId }) => (
  <>
    <BranchChip shapeId={shapeId} />
    <ViewportMenu shapeId={shapeId} />
    <OpenInBrowser shapeId={shapeId} />
    <SetupNotes />
    <KeepView shapeId={shapeId} />
    <MapFlow shapeId={shapeId} />
  </>
);
