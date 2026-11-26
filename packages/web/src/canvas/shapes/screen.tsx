import type { ScreenMock, ScreenShapeProps, ScreenStep } from "@unframed/contracts";
import { picturePartsUrl, pictureUrl, screenLabel, tierOf } from "@unframed/domain";
import { useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, useEditor, useValue, type Editor, type RecordProps, type TLResizeInfo, type TLShape, type TLShapeId } from "tldraw";
import { isInteractive } from "../../artifacts/state.ts";
import { useCanvasProject } from "../../context.ts";
import { useFeature } from "../../features.ts";
import { noteRender } from "../../fps/renders.ts";
import { mountPageCopy, preparePageCopy } from "../../repositories/pageCopy.ts";
import { schedulePageBuild } from "../../repositories/pageBuilds.ts";
import { pictureKeyOf, ScreenPicture } from "../../repositories/ScreenPicture.tsx";
import { forgetScreenFrame, useScreenSlot } from "../../repositories/framePool.tsx";
import { useRepositorySetup } from "../../repositories/store.ts";
import { dispatchTier, screenLevel, tierEntry } from "../../repositories/tiers.ts";
import { ScreenOverlay, useScreenBranch } from "../../repositories/ScreenView.tsx";
import { artifactCardClass } from "./looks.ts";
import { ShapeLabel } from "./ShapeLabel.tsx";
import { currentSlots } from "../../chrome/slots.ts";

type ScreenShape = TLShape<"screen">;

const SCREEN_MIN = { w: 240, h: 160 };

const screenProps: RecordProps<ScreenShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  instance: T.string,
  route: T.string,
  title: T.string,
  dials: T.dict(T.string, T.jsonValue).optional(),
  mode: T.string.optional(),
  steps: T.arrayOf(T.jsonValue).optional() as T.Validatable<ScreenStep[] | undefined>,
  mocks: T.arrayOf(T.jsonValue).optional() as T.Validatable<ScreenMock[] | undefined>,
  state: T.string.optional(),
  picture: T.string.optional(),
};

const PageCopy = ({ editor, project, shapeId, pictureKey, w, h }: { readonly editor: Editor; readonly project: string; readonly shapeId: TLShapeId; readonly pictureKey: string; readonly w: number; readonly h: number }) => {
  const host = useRef<HTMLDivElement>(null);
  const [built, setBuilt] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let cancelled = false;
    let unmount: (() => void) | undefined;
    let cancelBuild: (() => void) | undefined;
    setBuilt(false);
    preparePageCopy(pictureUrl(project, pictureKey, "html"), picturePartsUrl(project)).then(
      (copy) => {
        if (cancelled) return;
        cancelBuild = schedulePageBuild(
          editor,
          () => tierEntry(project, shapeId)?.distance ?? Number.POSITIVE_INFINITY,
          () => {
            if (cancelled) return;
            unmount = mountPageCopy(element, copy, { w, h });
            setBuilt(true);
            dispatchTier(project, { type: "pageBuilt", id: shapeId });
          },
        );
      },
      () => {
        if (!cancelled) dispatchTier(project, { type: "pageMissing", id: shapeId });
      },
    );
    return () => {
      cancelled = true;
      cancelBuild?.();
      unmount?.();
    };
  }, [editor, project, shapeId, pictureKey, w, h]);
  return <div ref={host} className={`pointer-events-none absolute inset-0 overflow-hidden ${built ? "bg-(--canvas-artifact-page)" : ""}`} data-testid="screen-page-copy" data-built={built ? "true" : undefined} />;
};

const ScreenCard = ({ shape }: { readonly shape: ScreenShape }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const project = useCanvasProject();
  const repositories = useFeature("repositories");
  const props = shape.props as ScreenShapeProps;
  const setupWarnings = useRepositorySetup(project)?.warnings.length ?? 0;
  const entry = useValue("screen tier", () => tierEntry(project, shape.id), [project, shape.id]);
  const tier = entry === undefined ? "picture" : tierOf(entry);
  const level = useValue("screen level", () => screenLevel(editor, project, shape.id, props.w), [editor, project, shape.id, props.w]);
  const selected = useValue("screen selected", () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id]);
  const ready = useValue("screen interactive", () => isInteractive(editor, shape.id) && editor.getCameraState() === "idle", [editor, shape.id]);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!ready) return;
    const timer = setTimeout(() => setSettled(true), editor.options.doubleClickDurationMs);
    return () => clearTimeout(timer);
  }, [ready, editor]);
  const element = useRef<HTMLDivElement>(null);
  const canvas = useRef<Element | null>(null);
  const write = (next: ScreenShapeProps) => {
    const current = editor.getShape(shape.id);
    if (current?.type !== "screen" || !editor.getSelectedShapeIds().includes(shape.id)) return false;
    editor.markHistoryStoppingPoint("screen navigation");
    editor.store.put([{ ...current, props: next } as TLShape]);
    return true;
  };
  const status = useScreenSlot(project, shape.id, {
    element,
    clip: () => (canvas.current ??= editor.getContainer().querySelector(".tl-canvas")),
    upright: () => editor.getShapePageTransform(shape.id).rotation() === 0,
    owner: editor,
    props,
    interactive: ready && settled && tier === "live",
    selected,
    editor: false,
    write,
  });
  useEffect(
    () => () => {
      if (editor.getShape(shape.id) === undefined) forgetScreenFrame(project, shape.id);
    },
    [editor, project, shape.id],
  );
  const key = pictureKeyOf(props);
  const shownKey = useRef(key);
  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    dispatchTier(project, { type: "picture", id: shape.id });
  }, [key, project, shape.id]);
  const revealed = tier === "live" && status.painted;
  const showPage = repositories && key !== undefined && level === "page" && (entry?.page === "loading" || entry?.page === "built");
  const size = level === "tiny" ? "tiny" : level === "small" ? "small" : !repositories || entry?.page === "missing" ? "full" : "small";
  const branch = useScreenBranch(project, props);
  const label = screenLabel({ branch, route: props.route, state: props.state, warnings: setupWarnings });
  return (
    <HTMLContainer
      id={shape.id}
      className={artifactCardClass}
      data-testid="screen"
      data-route={props.route}
      data-state={props.state?.trim() ? props.state : undefined}
      data-tier={tier}
      data-level={level}
      data-picture={key}
      data-live={tier === "live" ? "true" : undefined}
      data-painted={revealed ? "true" : undefined}
      style={{ width: props.w, height: props.h }}
    >
      <ShapeLabel shapeId={shape.id} kind="screen" width={props.w} text={label} />
      <div ref={element} className="absolute inset-0 overflow-hidden" style={{ contain: "strict" }} data-screen-slot="">
        {!revealed && level !== undefined && <ScreenPicture project={project} shapeId={shape.id} props={props} branch={branch} size={size} />}
        {!revealed && showPage && key !== undefined && <PageCopy editor={editor} project={project} shapeId={shape.id} pictureKey={key} w={props.w} h={props.h} />}
        <ScreenOverlay project={project} instance={props.instance} />
      </div>
    </HTMLContainer>
  );
};

export const keepScreensUpright = (editor: Editor): (() => void) =>
  editor.sideEffects.registerBeforeChangeHandler("shape", (_, next) => (next.type === "screen" && next.rotation !== 0 ? { ...next, rotation: 0 } : next));

export class ScreenShapeUtil extends BaseBoxShapeUtil<ScreenShape> {
  static override type = "screen" as const;
  static override props = screenProps;

  override getDefaultProps(): ScreenShape["props"] {
    return { w: 1280, h: 800, instance: "", route: "/", title: "" };
  }

  override canEdit() {
    return false;
  }

  override hideRotateHandle() {
    return true;
  }

  override component(shape: ScreenShape) {
    return <ScreenCard shape={shape} />;
  }

  override getIndicatorPath(shape: ScreenShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override onResize(shape: ScreenShape, info: TLResizeInfo<ScreenShape>) {
    return resizeBox(shape, info, { minWidth: SCREEN_MIN.w, minHeight: SCREEN_MIN.h });
  }

  override onDoubleClick(shape: ScreenShape) {
    currentSlots().openArtifact?.(this.editor, shape.id);
    return { id: shape.id, type: shape.type };
  }
}
