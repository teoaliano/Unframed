/**
 * The artifact editor (spec 09): the full-screen view of one artifact. The chat rail on the
 * left filtered to it, the artifact live in the centre, its parameters on the right.
 */
import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle, editorPreviewViewport, isArtifactKind, previewScale, type ArtifactKind, type DialsAnnouncement } from "@unframed/domain";
import { AppWindow, ArrowLeft, Clapperboard, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { AgentRail } from "../../agent/rail/AgentRail.tsx";
import { Tip } from "../../chrome/ui.tsx";
import { useCanvasProject } from "../../context.ts";
import { ArtifactFrame, urlOf } from "../ArtifactFrame.tsx";
import { previewPort } from "../state.ts";
import { RenderButton } from "../render.tsx";
import { COLUMN, ColumnHeader, Parameters } from "./Parameters.tsx";
import { PreviewSizeControl, usePreviewSize } from "./PreviewSize.tsx";

export interface ArtifactEditorProps {
  readonly shapeId: TLShapeId;
  readonly onClose: () => void;
  /** Opens another artifact, from the rail's recap card. */
  readonly onOpen: (shapeId: string) => void;
}

/** A key typed where text goes belongs to that field, not to the editor. */
const typingIn = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return element.isContentEditable || element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.closest("[contenteditable='true']") !== null;
};

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

/**
 * The editor is portaled beside the canvas but sits inside its React tree, where tldraw's
 * canvas handlers would hear these through the portal and pan or select beneath it.
 */
const KEEP_FROM_CANVAS = {
  onPointerDown: stop,
  onPointerMove: stop,
  onPointerUp: stop,
  onWheel: stop,
  onTouchStart: stop,
  onTouchEnd: stop,
  onDragOver: stop,
  onDrop: stop,
};

export const ArtifactEditor = ({ shapeId, onClose, onOpen }: ArtifactEditorProps) => {
  const editor = useEditor();
  const project = useCanvasProject();
  const facts = useValue(
    "edited artifact",
    () => {
      const shape = editor.getShape(shapeId);
      if (!shape || !isArtifactKind(shape.type)) return undefined;
      const props = shape.props as ArtifactShapeProps;
      return { kind: shape.type as ArtifactKind, file: props.file, title: props.title, fileName: props.fileName, dials: props.dials };
    },
    [editor, shapeId],
  );
  const port = useValue("preview port", () => previewPort.get(), []);
  const gone = facts === undefined;

  // The artifact deleted by the agent, another tab or an undo: the editor closes itself.
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || editor.wasEventAlreadyHandled(event) || typingIn(event.target) || typingIn(document.activeElement)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, onClose]);

  const [announcement, setAnnouncement] = useState<DialsAnnouncement>();
  const post = useRef<((values: unknown) => void) | undefined>(undefined);
  const file = facts?.file ?? "";
  useEffect(() => setAnnouncement(undefined), [file]);
  const onReady = useCallback((send: (values: unknown) => void) => {
    post.current = send;
  }, []);

  const [size, setSize] = usePreviewSize(project, shapeId);
  const body = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    // A sized preview sits 12 px inside the column, in a 1 px border.
    const measure = () => setArea({ w: element.clientWidth - 26, h: element.clientHeight - 26 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [facts === undefined]);
  const viewport = editorPreviewViewport(size);
  const scale = viewport === undefined ? 1 : previewScale(viewport, area);

  if (!facts) return null;
  const displayTitle = artifactTitle(facts);
  const title = displayTitle === "" ? shapeId.replace(/^shape:/, "") : displayTitle;
  const Icon = facts.kind === "page" ? AppWindow : Clapperboard;

  return (
    // It stops above tldraw's watermark band (8 px from the corner, 36 px tall), which stays uncovered.
    <div
      data-testid="artifact-editor"
      className="pointer-events-auto absolute inset-x-0 top-0 bottom-13 z-[700] box-border grid grid-cols-[360px_minmax(0,1fr)_320px] gap-3 bg-background p-3 font-sans text-foreground"
      {...KEEP_FROM_CANVAS}
    >
      <section data-editor-column="rail" className={COLUMN}>
        <AgentRail project={project} embedded filterTo={[shapeId]} onOpenEditor={onOpen} />
      </section>
      <section data-editor-column="centre" className={COLUMN} aria-label={`Editing ${title}`}>
        <ColumnHeader>
          <Tip label="Back to canvas (Esc)">
            <Button variant="ghost" size="icon" aria-label="Back to canvas" onClick={onClose}>
              <ArrowLeft aria-hidden />
            </Button>
          </Tip>
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span data-testid="artifact-editor-title" className="truncate text-sm font-semibold">
            {title}
          </span>
          <span data-testid="artifact-editor-kind" className="text-sm text-muted-foreground">
            {facts.kind}
          </span>
          <span className="flex-1" />
          {facts.file !== "" && <PreviewSizeControl size={size} onChange={setSize} scale={scale} />}
          {facts.kind === "motion" && facts.file !== "" && <RenderButton shapeId={shapeId} />}
          {facts.file !== "" && port !== undefined && (
            <Tip label="Open in a new tab">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open in a new tab"
                onClick={() => window.open(urlOf(project, facts.kind, facts.file, port), "_blank", "noopener,noreferrer")}
              >
                <ExternalLink aria-hidden />
              </Button>
            </Tip>
          )}
        </ColumnHeader>
        <div ref={body} className={cn("relative flex min-h-0 flex-1", viewport !== undefined && "items-center justify-center overflow-hidden")}>
          {facts.file === "" ? (
            <p className="m-auto p-6 text-center text-sm text-muted-foreground">{`This ${facts.kind} has no file yet. Ask the agent to write one.`}</p>
          ) : port === undefined ? null : (
            // The same two boxes hold the frame at every size, so changing the size never reloads the document.
            <div
              data-testid="artifact-preview"
              className={cn(viewport === undefined ? "size-full" : "box-content shrink-0 overflow-hidden border")}
              style={viewport === undefined ? undefined : { width: viewport.width * scale, height: viewport.height * scale }}
            >
              <div
                className={cn(viewport === undefined && "size-full")}
                style={viewport === undefined ? undefined : { width: viewport.width, height: viewport.height, transform: `scale(${scale})`, transformOrigin: "0 0" }}
              >
                <ArtifactFrame
                  key={facts.file}
                  project={project}
                  kind={facts.kind}
                  file={facts.file}
                  previewPort={port}
                  dials={facts.dials}
                  interactive
                  lazy={false}
                  onAnnounce={setAnnouncement}
                  onReady={onReady}
                />
              </div>
            </div>
          )}
        </div>
      </section>
      <section data-editor-column="parameters" className={COLUMN}>
        <Parameters
          key={facts.file}
          shapeId={shapeId}
          kind={facts.kind}
          title={title}
          announcement={announcement}
          saved={facts.dials}
          post={(values) => post.current?.(values)}
        />
      </section>
    </div>
  );
};
