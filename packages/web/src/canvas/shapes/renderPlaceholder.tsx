/**
 * The render placeholder (spec 04): where a paid video render lands. Its state comes from
 * the shape's own `meta.unframed` fields, so every tab and every reload agrees.
 */
import { runMarkerOf, unframedMetaOf } from "@unframed/contracts";
import { readRef } from "@unframed/domain";
import { useEffect, useState, type SyntheticEvent } from "react";
import { HTMLContainer, useEditor, type TLVideoShape } from "tldraw";
import { Button } from "~/components/ui/button";
import { Tip } from "../../chrome/ui.tsx";
import { useCanvasProject, useEngine } from "../../context.ts";
import { noteRender } from "../../fps/renders.ts";
import { showError } from "../../toasts.tsx";
import { mediaCardClass } from "./looks.ts";
import { waitingLabel } from "./labels.ts";
import { ShapeLabel } from "./ShapeLabel.tsx";

export const FORGET_LABEL = "Forget this job";
export const FORGET_TIP =
  "Stops tracking this job here. It does not cancel the render upstream. If it finishes anyway, the clip is still saved in the project folder but will not appear on the canvas.";

/** A video shape that is a render placeholder: rendering (a durable marker) or failed (a run error, no clip). */
export const isRenderPlaceholder = (shape: TLVideoShape): boolean =>
  !shape.props.assetId && (runMarkerOf(shape)?.durable !== undefined || typeof unframedMetaOf(shape).runError === "string");

/** Whole minutes since `startedAt`, re-read at least once a minute. */
const useMinutesSince = (startedAt: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 60_000));
};

const Rendering = ({ shape, jobId, startedAt }: { readonly shape: TLVideoShape; readonly jobId: string; readonly startedAt: number }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const minutes = useMinutesSince(startedAt);
  const handled = (event: SyntheticEvent) => editor.markEventAsHandled(event);
  return (
    <>
      <p role="status" className="m-0 text-sm leading-snug text-muted-foreground">
        Rendering… ({minutes} min)
      </p>
      <Tip label={FORGET_TIP} side="bottom">
        <Button
          variant="ghost-muted"
          size="xs"
          className="pointer-events-auto"
          onPointerDown={handled}
          onPointerUp={handled}
          onClick={(event) => {
            handled(event);
            engine.call("video.forget", { project, jobId }).catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
          }}
          data-shape={shape.id}
        >
          {FORGET_LABEL}
        </Button>
      </Tip>
    </>
  );
};

export const RenderPlaceholder = ({ shape }: { readonly shape: TLVideoShape }) => {
  noteRender(shape.id);
  const marker = runMarkerOf(shape);
  const runError = unframedMetaOf(shape).runError;
  return (
    <HTMLContainer
      id={shape.id}
      className={mediaCardClass}
      data-testid="media-empty"
      data-render={marker ? "pending" : "failed"}
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <ShapeLabel shapeId={shape.id} kind="video" name={readRef(shape)} width={shape.props.w} text={waitingLabel(shape, "Video")} />
      <div className="box-border flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
        {marker ? (
          <Rendering shape={shape} jobId={marker.runId} startedAt={marker.startedAt} />
        ) : (
          <p role="alert" className="m-0 text-sm leading-snug wrap-anywhere text-destructive-foreground">
            {typeof runError === "string" ? runError : ""}
          </p>
        )}
      </div>
    </HTMLContainer>
  );
};
