/**
 * The artifact editor (spec 09): the full-screen view of one artifact. The chat rail on the
 * left filtered to it, the artifact live in the centre, its parameters on the right.
 */
import type { ArtifactShapeProps } from "@unframed/contracts";
import { artifactTitle, type ArtifactKind, type DialsAnnouncement } from "@unframed/domain";
import { AppWindow, ArrowLeft, Clapperboard, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { AgentRail } from "../../agent/rail/AgentRail.tsx";
import { Tip } from "../../chrome/ui.tsx";
import { useCanvasProject } from "../../context.ts";
import { ArtifactFrame, urlOf } from "../ArtifactFrame.tsx";
import { previewPort } from "../state.ts";
import { Parameters } from "./Parameters.tsx";
import "./editor.css";

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
      if (!shape || (shape.type !== "page" && shape.type !== "motion")) return undefined;
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

  if (!facts) return null;
  const displayTitle = artifactTitle(facts);
  const title = displayTitle === "" ? shapeId.replace(/^shape:/, "") : displayTitle;
  const Icon = facts.kind === "page" ? AppWindow : Clapperboard;

  return (
    <div className="unframed-artifact-editor" {...KEEP_FROM_CANVAS}>
      <section className="unframed-artifact-editor__column unframed-artifact-editor__rail">
        <AgentRail project={project} embedded filterTo={[shapeId]} onOpenEditor={onOpen} />
      </section>
      <section className="unframed-artifact-editor__column unframed-artifact-editor__centre" aria-label={`Editing ${title}`}>
        <header className="unframed-artifact-editor__header">
          <Tip label="Back to canvas (Esc)">
            <button type="button" className="unframed-artifact-editor__icon" aria-label="Back to canvas" onClick={onClose}>
              <ArrowLeft size={16} aria-hidden />
            </button>
          </Tip>
          <Icon size={16} aria-hidden className="unframed-artifact-editor__kind-icon" />
          <span className="unframed-artifact-editor__title">{title}</span>
          <span className="unframed-artifact-editor__kind">{facts.kind}</span>
          <span className="flex-1" />
          {facts.file !== "" && port !== undefined && (
            <Tip label="Open in a new tab">
              <button
                type="button"
                className="unframed-artifact-editor__icon"
                aria-label="Open in a new tab"
                onClick={() => window.open(urlOf(project, facts.kind, facts.file, port), "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={16} aria-hidden />
              </button>
            </Tip>
          )}
        </header>
        <div className="unframed-artifact-editor__body">
          {facts.file === "" ? (
            <p className="unframed-artifact-editor__empty">{`This ${facts.kind} has no file yet. Ask the agent to write one.`}</p>
          ) : port === undefined ? null : (
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
          )}
        </div>
      </section>
      <section className="unframed-artifact-editor__column unframed-artifact-editor__parameters">
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
