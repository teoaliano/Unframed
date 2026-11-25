import type { ScreenMock, ScreenShapeProps, ScreenStep } from "@unframed/contracts";
import { screenLabel } from "@unframed/domain";
import { useEffect, useState } from "react";
import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, useEditor, useValue, type RecordProps, type TLResizeInfo, type TLShape } from "tldraw";
import { isInteractive } from "../../artifacts/state.ts";
import { useCanvasProject } from "../../context.ts";
import { isDeviceClient } from "../../deviceMode.ts";
import { useFeature } from "../../features.ts";
import { noteRender } from "../../fps/renders.ts";
import { screenOnScreen } from "../../repositories/demand.ts";
import { repositoryState, useRepositorySetup } from "../../repositories/store.ts";
import { useScreenView } from "../../repositories/ScreenView.tsx";
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
  const repositories = useFeature("repositories");
  const props = shape.props as ScreenShapeProps;
  const state = repositoryState(project);
  const proxyPort = useValue(
    "screen proxy",
    () => {
      const instance = state.instances.get().get(props.instance);
      return instance?.state === "live" ? instance.proxyPort : null;
    },
    [state, props.instance],
  );
  const branch = useValue("screen branch", () => state.instances.get().get(props.instance)?.branch ?? props.title, [state, props.instance, props.title]);
  const setupWarnings = useRepositorySetup(project)?.warnings.length ?? 0;
  const label = screenLabel({ branch, route: props.route, state: props.state, warnings: setupWarnings });
  const onScreen = useValue("screen on screen", () => screenOnScreen(editor, shape.id), [editor, shape.id]);
  const selected = useValue("screen interactive", () => isInteractive(editor, shape.id), [editor, shape.id]);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!selected) return;
    const timer = setTimeout(() => setSettled(true), editor.options.doubleClickDurationMs);
    return () => clearTimeout(timer);
  }, [selected, editor]);
  const interactive = selected && settled;
  const live = repositories && !isDeviceClient() && onScreen && proxyPort !== null;
  const read = () => {
    const current = editor.getShape(shape.id);
    return current?.type === "screen" ? (current.props as ScreenShapeProps) : undefined;
  };
  const write = (next: ScreenShapeProps) => {
    const current = editor.getShape(shape.id);
    if (current?.type !== "screen" || !editor.getSelectedShapeIds().includes(shape.id)) return false;
    editor.markHistoryStoppingPoint("screen navigation");
    editor.store.put([{ ...current, props: next } as TLShape]);
    return true;
  };
  const view = useScreenView({ owner: editor, project, shapeId: shape.id, props, live, proxyPort, interactive, branch, read, write });
  return (
    <HTMLContainer
      id={shape.id}
      className={`${artifactCardClass} overflow-hidden`}
      data-testid="screen"
      data-route={props.route}
      data-state={props.state?.trim() ? props.state : undefined}
      data-live={live ? "true" : undefined}
      data-painted={view.painted ? "true" : undefined}
      style={{ width: props.w, height: props.h }}
    >
      <ShapeLabel shapeId={shape.id} kind="screen" width={props.w} text={label} />
      {view.content}
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
