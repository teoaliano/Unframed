import type { ScreenShapeProps } from "@unframed/contracts";
import { STARTUP_GRACE_MS, pictureKeyOf, startupCover } from "@unframed/domain";
import { useEffect, useState } from "react";
import { Box, useEditor, useValue } from "tldraw";
import { Empty, EmptyDescription, EmptyMedia } from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { useCanvasProject } from "../context.ts";
import { repositoryState } from "./store.ts";

const SHOW_AFTER_MS = 200;

export const ScreensStarting = () => {
  const editor = useEditor();
  const project = useCanvasProject();
  const state = repositoryState(project);
  const loaded = useValue("screens loaded", () => state.loaded.get(), [state]);
  const [shown, setShown] = useState(false);
  const [graceOver, setGraceOver] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => setGraceOver(true), STARTUP_GRACE_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
  const label = useValue(
    "screens starting",
    () => {
      const instances = state.instances.get();
      const repository = state.repository.get();
      const viewport = editor.getViewportPageBounds();
      const inView = editor
        .getCurrentPageShapes()
        .filter((shape) => {
          if (shape.type !== "screen" || pictureKeyOf(shape.props as ScreenShapeProps) !== undefined) return false;
          const bounds = editor.getShapePageBounds(shape.id);
          return bounds !== undefined && Box.Collides(bounds, viewport);
        })
        .map((shape) => instances.get((shape.props as ScreenShapeProps).instance));
      return startupCover({ repository: repository === null ? null : repository?.status, loaded: state.loaded.get(), instances: inView, graceOver });
    },
    [editor, state, graceOver],
  );
  useEffect(() => {
    if (label === undefined) setDone(true);
  }, [label]);
  if (done || label === undefined || !(shown || loaded)) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-[calc(var(--tl-layer-watermark)_-_1)] flex bg-(--screens-starting-surface)" data-testid="screens-starting" data-screens-starting="">
      <Empty>
        <EmptyMedia>
          <Spinner size="lg" tone="muted" aria-hidden />
        </EmptyMedia>
        <EmptyDescription role="status">{label}</EmptyDescription>
      </Empty>
    </div>
  );
};
