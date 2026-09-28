import { GROUP_DEFAULT, GROUP_MAX, GROUP_MIN, mayBeGroupMember } from "@unframed/domain";
import {
  FrameShapeUtil,
  Group2d,
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  useEditor,
  useValue,
  type Geometry2d,
  type TLFrameShape,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { ShapeLabel } from "./ShapeLabel.tsx";

const LABEL_BAND = 22;
const LABEL_CHAR_WIDTH = 8;

const GroupBox = ({ shape }: { readonly shape: TLFrameShape }) => {
  const editor = useEditor();
  const id: TLShapeId = shape.id;
  const selected = useValue("group selected", () => editor.getSelectedShapeIds().includes(id), [editor, id]);
  return (
    <HTMLContainer id={shape.id} className="unframed-group" data-selected={selected ? "true" : undefined} style={{ width: shape.props.w, height: shape.props.h }}>
      <ShapeLabel shapeId={shape.id} kind="group">
        @{shape.props.name}
      </ShapeLabel>
    </HTMLContainer>
  );
};

/**
 * A group is tldraw's frame with Unframed's look: a dashed box, its name as the `@` label,
 * and a membership rule. Its name is its ref and cannot be edited here (spec 06 renames).
 */
export class GroupShapeUtil extends FrameShapeUtil {
  override getDefaultProps(): TLFrameShape["props"] {
    return { ...GROUP_DEFAULT, name: "", color: "black" };
  }

  override canEdit() {
    return false;
  }

  override canReceiveNewChildrenOfType(shape: TLFrameShape, type: TLShape["type"]) {
    return !shape.isLocked && mayBeGroupMember(type);
  }

  override getGeometry(shape: TLFrameShape): Geometry2d {
    const labelWidth = Math.min(shape.props.w, LABEL_CHAR_WIDTH * (shape.props.name.length + 1) + 8);
    return new Group2d({
      children: [
        new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: false }),
        new Rectangle2d({ y: -LABEL_BAND, width: labelWidth, height: LABEL_BAND, isFilled: true, isLabel: true, excludeFromShapeBounds: true }),
      ],
    });
  }

  override component(shape: TLFrameShape) {
    return <GroupBox shape={shape} />;
  }

  override onResize(shape: TLFrameShape, info: TLResizeInfo<TLFrameShape>) {
    return resizeBox(shape, info, { minWidth: GROUP_MIN.w, minHeight: GROUP_MIN.h, maxWidth: GROUP_MAX.w, maxHeight: GROUP_MAX.h });
  }
}
