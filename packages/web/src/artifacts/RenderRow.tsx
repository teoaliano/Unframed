import { UnframedError, type RenderStatus } from "@unframed/contracts";
import { artifactTitle } from "@unframed/domain";
import { Clapperboard } from "lucide-react";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useEditor, useValue, type TLShape, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useCanvasProject, useEngine } from "../context.ts";
import { artifactsOf, setProblem } from "./state.ts";

/** How often a render in flight is asked for its progress. */
const POLL_MS = 700;

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

/** Keeps a press on a control under a shape from starting a canvas drag or selection. */
const useControlEvents = () => {
  const editor = useEditor();
  const handled = (event: SyntheticEvent) => editor.markEventAsHandled(event);
  return { onPointerDown: handled, onPointerUp: handled, onPointerMove: handled, onDoubleClick: handled };
};

/**
 * Under a filled motion, outside it: Render, and while it renders a thin progress bar and
 * `{progress}%` or `{progress}% · {message}`. The engine fills the placeholder when the MP4
 * lands; polling here only drives this row, and stops when the shape unmounts.
 */
export const RenderRow = ({ shape }: { readonly shape: TLShape }) => {
  const engine = useEngine();
  const editor = useEditor();
  const project = useCanvasProject();
  const [status, setStatus] = useState<RenderStatus>();
  const [starting, setStarting] = useState(false);
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const events = useControlEvents();
  const props = shape.props as { w: number; h: number; file: string; title: string; fileName: string; dials?: Record<string, unknown> };

  useEffect(() => () => clearTimeout(poll.current), []);

  const follow = (id: string) => {
    poll.current = setTimeout(() => {
      engine.call("motion.renderStatus", { project, id }).then(
        (next) => {
          setStatus(next);
          if (next.status === "failed") setProblem(editor, shape.id, next.error ?? "The render failed.");
          if (next.status === "queued" || next.status === "rendering") follow(id);
        },
        (error: unknown) => {
          setStatus(undefined);
          setProblem(editor, shape.id, messageOf(error));
        },
      );
    }, POLL_MS);
  };

  const rendering = starting || status?.status === "queued" || status?.status === "rendering";

  const start = async () => {
    if (rendering) return;
    setProblem(editor, shape.id, undefined);
    setStarting(true);
    try {
      const started = await engine.call("motion.renderStart", {
        project,
        file: props.file,
        title: artifactTitle(props),
        shapeId: shape.id,
        ...(props.dials === undefined ? {} : { dials: props.dials }),
      });
      setStatus({ id: started.id, file: props.file, status: started.status, progress: 0, message: "", output: null, error: null });
      follow(started.id);
    } catch (error) {
      setProblem(editor, shape.id, messageOf(error));
    } finally {
      setStarting(false);
    }
  };

  const progress = status?.progress ?? 0;
  return (
    <div className="pointer-events-auto absolute left-0 mt-1 flex h-7.5 items-center gap-2 font-sans text-xs text-muted-foreground" style={{ top: props.h, width: props.w }} {...events}>
      <Button variant="outline" size="xs" disabled={rendering} onClick={() => void start()} {...events}>
        <Clapperboard aria-hidden />
        Render
      </Button>
      {rendering && (
        <div role="status" data-testid="render-progress" className="flex min-w-0 flex-1 items-center gap-2">
          <Spinner size="xs" aria-hidden />
          <div aria-hidden className="h-1 w-18 shrink-0 overflow-hidden rounded-full bg-input">
            <div data-testid="render-fill" className="h-full rounded-full bg-highlight transition-[width] duration-200 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <span className="truncate tabular-nums">{status?.message ? `${progress}% · ${status.message}` : `${progress}%`}</span>
        </div>
      )}
    </div>
  );
};

/** The status line under an artifact: the last upload or render error, until the next one starts. */
export const ProblemLine = ({ shapeId, offset, width }: { readonly shapeId: TLShapeId; readonly offset: number; readonly width: number }) => {
  const editor = useEditor();
  const problem = useValue("artifact problem", () => artifactsOf(editor).problems.get().get(shapeId), [editor, shapeId]);
  if (problem === undefined) return null;
  return (
    <p role="alert" className="absolute left-0 mt-1.5 mb-0 font-sans text-xs leading-snug text-destructive-foreground" style={{ top: offset, width }}>
      {problem}
    </p>
  );
};
