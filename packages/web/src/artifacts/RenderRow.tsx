import { useEditor, useValue, type TLShape, type TLShapeId } from "tldraw";
import { Spinner } from "~/components/ui/spinner";
import { isRendering, renderOf } from "./render.tsx";
import { artifactsOf } from "./state.ts";

/**
 * Under a motion, outside it, while it renders: a thin progress bar and `{progress}%` or
 * `{progress}% · {message}`. Render itself is in the selection toolbar and the editor's
 * header; the engine fills the placeholder when the MP4 lands.
 */
export const RenderRow = ({ shape }: { readonly shape: TLShape }) => {
  const editor = useEditor();
  const rendering = useValue("rendering", () => isRendering(editor, shape.id), [editor, shape.id]);
  const status = useValue("render status", () => renderOf(editor, shape.id)?.status, [editor, shape.id]);
  if (!rendering) return null;
  const props = shape.props as { w: number; h: number };
  const progress = status?.progress ?? 0;
  return (
    <div role="status" data-testid="render-progress" className="absolute left-0 mt-1 flex h-7.5 items-center gap-2 font-sans text-xs text-muted-foreground" style={{ top: props.h, width: props.w }}>
      <Spinner size="xs" aria-hidden />
      <div aria-hidden className="h-1 w-18 shrink-0 overflow-hidden rounded-full bg-input">
        <div data-testid="render-fill" className="h-full rounded-full bg-highlight transition-[width] duration-200 ease-out" style={{ width: `${progress}%` }} />
      </div>
      <span className="truncate tabular-nums">{status?.message ? `${progress}% · ${status.message}` : `${progress}%`}</span>
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
