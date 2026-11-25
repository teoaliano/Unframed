/**
 * A motion's render (spec 09): started from the selection toolbar or the editor's header,
 * followed until the engine lands the MP4, and shown under the shape while it runs. The
 * state is the canvas's, by shape, so every place that starts or shows a render agrees.
 */
import { UnframedError, type RenderStatus } from "@unframed/contracts";
import { artifactTitle } from "@unframed/domain";
import { Clapperboard } from "lucide-react";
import { useValue } from "tldraw";
import { Button } from "~/components/ui/button";
import { useCanvasDoc, type CanvasDoc, type StoreOwner } from "../canvas/doc.ts";
import { useCanvasProject, useEngine } from "../context.ts";
import type { EngineConnection } from "../rpc/engine.ts";
import { artifactsOf, setProblem } from "./state.ts";

/** How often a render in flight is asked for its progress. */
const POLL_MS = 700;

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

const setRender = (owner: StoreOwner, id: string, view: { starting: boolean; status?: RenderStatus } | undefined) =>
  artifactsOf(owner).renders.update((current) => {
    const next = new Map(current);
    if (view === undefined) next.delete(id);
    else next.set(id, view);
    return next;
  });

export const renderOf = (owner: StoreOwner, id: string) => artifactsOf(owner).renders.get().get(id);

export const isRendering = (owner: StoreOwner, id: string): boolean => {
  const view = renderOf(owner, id);
  return !!view && (view.starting || view.status?.status === "queued" || view.status?.status === "rendering");
};

const follow = (doc: CanvasDoc, engine: EngineConnection, project: string, shapeId: string, renderId: string) => {
  setTimeout(() => {
    engine.call("motion.renderStatus", { project, id: renderId }).then(
      (status) => {
        setRender(doc, shapeId, { starting: false, status });
        if (status.status === "failed") setProblem(doc, shapeId, status.error ?? "The render failed.");
        if (status.status === "queued" || status.status === "rendering") follow(doc, engine, project, shapeId, renderId);
      },
      (error: unknown) => {
        setRender(doc, shapeId, undefined);
        setProblem(doc, shapeId, messageOf(error));
      },
    );
  }, POLL_MS);
};

export const startRender = async (doc: CanvasDoc, engine: EngineConnection, project: string, shapeId: string): Promise<void> => {
  const shape = doc.shape(shapeId);
  if (!shape || isRendering(doc, shapeId)) return;
  const props = shape.props as { file: string; title: string; fileName: string; dials?: Record<string, unknown> };
  setProblem(doc, shapeId, undefined);
  setRender(doc, shapeId, { starting: true });
  try {
    const started = await engine.call("motion.renderStart", {
      project,
      file: props.file,
      title: artifactTitle(props),
      shapeId,
      ...(props.dials === undefined ? {} : { dials: props.dials }),
    });
    setRender(doc, shapeId, { starting: false, status: { id: started.id, file: props.file, status: started.status, progress: 0, message: "", output: null, error: null } });
    follow(doc, engine, project, shapeId, started.id);
  } catch (error) {
    setRender(doc, shapeId, undefined);
    setProblem(doc, shapeId, messageOf(error));
  }
};

/** Render, as the kit's small outline Button: in the selection toolbar and the editor's header. */
export const RenderButton = ({ shapeId }: { readonly shapeId: string }) => {
  const doc = useCanvasDoc();
  const engine = useEngine();
  const project = useCanvasProject();
  const rendering = useValue("rendering", () => isRendering(doc, shapeId), [doc, shapeId]);
  return (
    <Button variant="outline" size="sm" disabled={rendering} onClick={() => void startRender(doc, engine, project, shapeId)}>
      <Clapperboard aria-hidden />
      {/* In a narrow editor header the icon stays and the word leaves the screen, not the button's name. */}
      <span className="@max-[520px]/editor-header:sr-only">Render</span>
    </Button>
  );
};
