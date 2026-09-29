/**
 * A motion's render (spec 09): started from the selection toolbar or the editor's header,
 * followed until the engine lands the MP4, and shown under the shape while it runs. The
 * state is the canvas's, by shape, so every place that starts or shows a render agrees.
 */
import { UnframedError, type RenderStatus } from "@unframed/contracts";
import { artifactTitle } from "@unframed/domain";
import { Clapperboard } from "lucide-react";
import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { Button } from "~/components/ui/button";
import { useCanvasProject, useEngine } from "../context.ts";
import type { EngineConnection } from "../rpc/engine.ts";
import { artifactsOf, setProblem } from "./state.ts";

/** How often a render in flight is asked for its progress. */
const POLL_MS = 700;

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

const setRender = (editor: Editor, id: string, view: { starting: boolean; status?: RenderStatus } | undefined) =>
  artifactsOf(editor).renders.update((current) => {
    const next = new Map(current);
    if (view === undefined) next.delete(id);
    else next.set(id, view);
    return next;
  });

export const renderOf = (editor: Editor, id: string) => artifactsOf(editor).renders.get().get(id);

export const isRendering = (editor: Editor, id: string): boolean => {
  const view = renderOf(editor, id);
  return !!view && (view.starting || view.status?.status === "queued" || view.status?.status === "rendering");
};

const follow = (editor: Editor, engine: EngineConnection, project: string, shapeId: string, renderId: string) => {
  setTimeout(() => {
    engine.call("motion.renderStatus", { project, id: renderId }).then(
      (status) => {
        setRender(editor, shapeId, { starting: false, status });
        if (status.status === "failed") setProblem(editor, shapeId, status.error ?? "The render failed.");
        if (status.status === "queued" || status.status === "rendering") follow(editor, engine, project, shapeId, renderId);
      },
      (error: unknown) => {
        setRender(editor, shapeId, undefined);
        setProblem(editor, shapeId, messageOf(error));
      },
    );
  }, POLL_MS);
};

export const startRender = async (editor: Editor, engine: EngineConnection, project: string, shapeId: TLShapeId): Promise<void> => {
  const shape = editor.getShape(shapeId);
  if (!shape || isRendering(editor, shapeId)) return;
  const props = shape.props as { file: string; title: string; fileName: string; dials?: Record<string, unknown> };
  setProblem(editor, shapeId, undefined);
  setRender(editor, shapeId, { starting: true });
  try {
    const started = await engine.call("motion.renderStart", {
      project,
      file: props.file,
      title: artifactTitle(props),
      shapeId,
      ...(props.dials === undefined ? {} : { dials: props.dials }),
    });
    setRender(editor, shapeId, { starting: false, status: { id: started.id, file: props.file, status: started.status, progress: 0, message: "", output: null, error: null } });
    follow(editor, engine, project, shapeId, started.id);
  } catch (error) {
    setRender(editor, shapeId, undefined);
    setProblem(editor, shapeId, messageOf(error));
  }
};

/** Render, as the kit's small outline Button: in the selection toolbar and the editor's header. */
export const RenderButton = ({ shapeId }: { readonly shapeId: TLShapeId }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const rendering = useValue("rendering", () => isRendering(editor, shapeId), [editor, shapeId]);
  return (
    <Button variant="outline" size="sm" disabled={rendering} onClick={() => void startRender(editor, engine, project, shapeId)}>
      <Clapperboard aria-hidden />
      Render
    </Button>
  );
};
