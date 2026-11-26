import type { ScreenMock, ScreenShapeProps, ScreenStep } from "@unframed/contracts";
import { screenLabel } from "@unframed/domain";
import { useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, useEditor, useValue, type RecordProps, type TLResizeInfo, type TLShape } from "tldraw";
import { isInteractive } from "../../artifacts/state.ts";
import { useCanvasProject } from "../../context.ts";
import { noteRender } from "../../fps/renders.ts";
import { forgetScreenFrame, useScreenSlot } from "../../repositories/framePool.tsx";
import { screenLoadRank } from "../../repositories/loadQueue.ts";
import { useRepositorySetup } from "../../repositories/store.ts";
import { ScreenPlaceholder, useScreenBranch } from "../../repositories/ScreenView.tsx";
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
};

const ScreenCard = ({ shape }: { readonly shape: ScreenShape }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const project = useCanvasProject();
  const props = shape.props as ScreenShapeProps;
  const setupWarnings = useRepositorySetup(project)?.warnings.length ?? 0;
  const selected = useValue("screen selected", () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id]);
  const ready = useValue("screen interactive", () => isInteractive(editor, shape.id), [editor, shape.id]);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!ready) return;
    const timer = setTimeout(() => setSettled(true), editor.options.doubleClickDurationMs);
    return () => clearTimeout(timer);
  }, [ready, editor]);
  const element = useRef<HTMLDivElement>(null);
  const write = (next: ScreenShapeProps) => {
    const current = editor.getShape(shape.id);
    if (current?.type !== "screen" || !editor.getSelectedShapeIds().includes(shape.id)) return false;
    editor.markHistoryStoppingPoint("screen navigation");
    editor.store.put([{ ...current, props: next } as TLShape]);
    return true;
  };
  const status = useScreenSlot(project, shape.id, {
    element,
    clip: () => editor.getContainer().querySelector(".tl-canvas"),
    owner: editor,
    props,
    interactive: ready && settled,
    selected,
    editor: false,
    write,
    rank: () => screenLoadRank(editor, shape.id),
  });
  useEffect(
    () => () => {
      if (editor.getShape(shape.id) === undefined) forgetScreenFrame(project, shape.id);
    },
    [editor, project, shape.id],
  );
  const branch = useScreenBranch(project, props);
  const label = screenLabel({ branch, route: props.route, state: props.state, warnings: setupWarnings });
  return (
    <HTMLContainer
      id={shape.id}
      className={`${artifactCardClass} overflow-hidden`}
      data-testid="screen"
      data-route={props.route}
      data-state={props.state?.trim() ? props.state : undefined}
      data-live={status.live ? "true" : undefined}
      data-queued={status.queued ? "true" : undefined}
      data-painted={status.painted ? "true" : undefined}
      style={{ width: props.w, height: props.h }}
    >
      <ShapeLabel shapeId={shape.id} kind="screen" width={props.w} text={label} />
      <div ref={element} className="absolute inset-0" data-screen-slot="">
        <ScreenPlaceholder project={project} shapeId={shape.id} props={props} status={status} />
      </div>
    </HTMLContainer>
  );
};

export class ScreenShapeUtil extends BaseBoxShapeUtil<ScreenShape> {
  static override type = "screen" as const;
  static override props = screenProps;

  override getDefaultProps(): ScreenShape["props"] {
    return { w: 1280, h: 800, instance: "", route: "/", title: "" };
  }

  override canEdit() {
    return false;
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
