import { type NodeShapeProps, type NodeVersion } from "@unframed/contracts";
import { EllipsisVertical } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useEditor, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { useCanvasProject, useEngine } from "../context.ts";
import { showError } from "../toasts.tsx";
import { dragOutVersion } from "./dragOut.ts";
import type { NodeShape } from "./facts.ts";
import { VersionView } from "./NodeShapeUtil.tsx";
import { updateNode } from "./operations.ts";

const DRAG_START_PX = 6;

const usable = (version: NodeVersion) => version.status === "done" && version.error === undefined;

const Thumb = ({ shape, version, index }: { readonly shape: NodeShape; readonly version: NodeVersion; readonly index: number }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const current = shape.props.currentVersionId === version.id;
  const press = useRef<{ x: number; y: number; dragging: boolean }>(undefined);
  const [ghost, setGhost] = useState<{ x: number; y: number }>();
  const props: NodeShapeProps = shape.props;

  const remove = () =>
    void engine.call("node.removeVersion", { project, shapeId: shape.id, versionId: version.id }).catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
  const use = () => {
    if (!usable(version) || current) return;
    editor.markHistoryStoppingPoint("use version");
    updateNode(editor, shape.id, { currentVersionId: version.id }, false);
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !usable(version)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.clientX, y: event.clientY, dragging: false };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const start = press.current;
    if (!start) return;
    if (!start.dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_START_PX) return;
    start.dragging = true;
    setGhost({ x: event.clientX, y: event.clientY });
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = press.current;
    press.current = undefined;
    setGhost(undefined);
    if (!start) return;
    if (!start.dragging) return use();
    const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
    const bounds = editor.getShapePageBounds(shape.id as TLShapeId);
    if (bounds?.containsPoint(point)) return;
    void dragOutVersion({ editor, project, node: shape, version, at: point }).catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
  };

  return (
    <li className="relative shrink-0" data-testid="node-version" data-version-id={version.id} data-current={current ? "true" : undefined}>
      {/* oxlint-disable-next-line react/forbid-elements -- a version thumbnail, pressed to use it and dragged to put it on the board */}
      <button
        type="button"
        className={`relative block size-14 cursor-grab touch-none overflow-hidden rounded-md border bg-muted/40 p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring ${current ? "border-ring ring-2 ring-ring/40" : ""}`}
        aria-label={`Version ${index + 1}${current ? ", current" : ""}`}
        aria-pressed={current}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            use();
          }
        }}
      >
        {version.status === "running" ? (
          <span className="flex size-full items-center justify-center" role="status" aria-label="Being made">
            <Spinner aria-hidden />
          </span>
        ) : version.error !== undefined ? (
          <span className="flex size-full items-center justify-center p-1 text-center text-2xs text-destructive-foreground" title={version.error}>
            Failed
          </span>
        ) : (
          <VersionView version={version} medium={props.medium} fit="cover" />
        )}
      </button>
      <Menu>
        <MenuTrigger render={<Button variant="outline" size="icon-micro" className="absolute -top-1.5 -right-1.5" aria-label={`Version ${index + 1} actions`} data-testid="node-version-menu" />}>
          <EllipsisVertical aria-hidden />
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-40">
          <MenuItem disabled={!usable(version) || current} onClick={use}>
            Use this version
          </MenuItem>
          <MenuItem disabled={version.status === "running"} onClick={remove}>
            Remove version
          </MenuItem>
        </MenuPopup>
      </Menu>
      {ghost &&
        createPortal(
          <div className="pointer-events-none fixed z-[1000] size-16 -translate-1/2 overflow-hidden rounded-md border bg-card opacity-80 shadow-lg" style={{ left: ghost.x, top: ghost.y }} data-testid="node-version-ghost">
            <VersionView version={version} medium={props.medium} fit="cover" />
          </div>,
          document.body,
        )}
    </li>
  );
};

export const VersionsStrip = ({ shape }: { readonly shape: NodeShape }) => {
  const { versions, medium } = shape.props;
  if (versions.length === 0) return null;
  const current = versions.find((version) => version.id === shape.props.currentVersionId && usable(version));
  return (
    <div className="flex flex-col gap-1.5">
      {current && (
        <div className="relative h-36 overflow-hidden rounded-lg border bg-muted/40" data-testid="node-result">
          <VersionView version={current} medium={medium} />
        </div>
      )}
      <ol className="m-0 flex list-none gap-2 overflow-x-auto p-0 pt-1.5 pr-1.5" aria-label="Versions" data-testid="node-versions">
        {versions.map((version, index) => (
          <Thumb key={version.id} shape={shape} version={version} index={versions.length - 1 - index} />
        ))}
      </ol>
    </div>
  );
};
