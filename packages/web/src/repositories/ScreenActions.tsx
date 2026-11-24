import type { ScreenShapeProps } from "@unframed/contracts";
import { normaliseRoute, SCREEN_VIEWPORTS, screenUrl } from "@unframed/domain";
import { ChevronDown, ExternalLink, MonitorSmartphone, Route } from "lucide-react";
import { useState } from "react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tip } from "../chrome/ui.tsx";
import { useCanvasProject } from "../context.ts";
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

export const ScreenActions = ({ shapeId }: { readonly shapeId: TLShapeId }) => (
  <>
    <RouteField shapeId={shapeId} />
    <ViewportMenu shapeId={shapeId} />
    <OpenInBrowser shapeId={shapeId} />
  </>
);
