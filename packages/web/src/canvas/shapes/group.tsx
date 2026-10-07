import { GROUP_DEFAULT, GROUP_MAX, GROUP_MIN, mayBeGroupMember, recipeChip, type GroupRecipe } from "@unframed/domain";
import { openOnRecipe } from "../../generate/recipeRuns.ts";
import { groupRecipeOf } from "../groupRecipes.ts";
import {
  FrameShapeUtil,
  Group2d,
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  useEditor,
  useValue,
  type Editor,
  type Geometry2d,
  type TLFrameShape,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { Badge } from "~/components/ui/badge";
import { ShapeLabel } from "./ShapeLabel.tsx";
import { noteRender } from "../../fps/renders.ts";
import { startRename } from "../rename.ts";
import { fieldEvents } from "./RenameField.tsx";

const LABEL_BAND = 22;
const LABEL_CHAR_WIDTH = 8;

const labelWidth = (shape: TLFrameShape) => Math.min(shape.props.w, LABEL_CHAR_WIDTH * (shape.props.name.length + 1) + 8);

/** A recipe group's chip, after its name: what its Generate makes. A click opens the composer on the recipe. */
const RecipeChip = ({ shape, recipe }: { readonly shape: TLFrameShape; readonly recipe: GroupRecipe }) => {
  const editor = useEditor();
  // The chip reads as the recipe spells it, not in the label's capitals: the wrapper sets the case the Badge inherits.
  return (
    <span className="ml-1.5">
      <Badge
        variant="outline"
        className="pointer-events-auto"
        // oxlint-disable-next-line react/forbid-elements -- the kit Badge rendered as a button: spec 12 makes the recipe chip a Badge
        render={<button type="button" />}
        data-testid="recipe-chip"
        {...fieldEvents(editor)}
        onClick={(event) => {
          event.stopPropagation();
          openOnRecipe(editor, shape.id, recipe);
        }}
      >
        {recipeChip(recipe)}
      </Badge>
    </span>
  );
};

const GroupBox = ({ shape }: { readonly shape: TLFrameShape }) => {
  noteRender(shape.id);
  const editor = useEditor();
  const id: TLShapeId = shape.id;
  const selected = useValue("group selected", () => editor.getSelectedShapeIds().includes(id), [editor, id]);
  const recipe = groupRecipeOf(shape);
  return (
    <HTMLContainer
      id={shape.id}
      className="box-border rounded-xl border-[1.5px] border-dashed border-border bg-group-fill data-[selected]:rounded-none data-[selected]:border-solid data-[selected]:border-highlight"
      data-testid="group-frame"
      data-selected={selected ? "true" : undefined}
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <ShapeLabel shapeId={shape.id} kind="group" name={shape.props.name} after={recipe && <RecipeChip shape={shape} recipe={recipe} />}>
        @{shape.props.name}
      </ShapeLabel>
    </HTMLContainer>
  );
};

/**
 * A group is tldraw's frame with Unframed's look: a dashed box, its name as the `@` label,
 * and a membership rule. Its name is its ref; double-clicking the label, or F2, renames it.
 */
export class GroupShapeUtil extends FrameShapeUtil {
  override getDefaultProps(): TLFrameShape["props"] {
    return { ...GROUP_DEFAULT, name: "", color: "black" };
  }

  // The rename field is Unframed's own, not tldraw's editing state.
  override canEdit() {
    return false;
  }

  override canReceiveNewChildrenOfType(shape: TLFrameShape, type: TLShape["type"]) {
    return !shape.isLocked && mayBeGroupMember(type);
  }

  override getGeometry(shape: TLFrameShape): Geometry2d {
    return new Group2d({
      children: [
        new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: false }),
        new Rectangle2d({ y: -LABEL_BAND, width: labelWidth(shape), height: LABEL_BAND, isFilled: true, isLabel: true, excludeFromShapeBounds: true }),
      ],
    });
  }

  /**
   * A double-click on the label opens the name field; anywhere else is tldraw's. A shown
   * label handles its own double-click; a hidden one (zoomed out) takes no press, so the
   * label's band in the geometry is what tldraw hits.
   */
  override onDoubleClick(shape: TLFrameShape) {
    const point = this.editor.getPointInShapeSpace(shape, this.editor.inputs.getCurrentPagePoint());
    if (point.y >= 0 || point.y < -LABEL_BAND || point.x < 0 || point.x > labelWidth(shape)) return undefined;
    startRename(this.editor, shape.id);
    // A change, even an empty one, keeps tldraw from making a prompt at the click.
    return { id: shape.id, type: shape.type };
  }

  override component(shape: TLFrameShape) {
    noteRender(shape.id);
    return <GroupBox shape={shape} />;
  }

  override onResize(shape: TLFrameShape, info: TLResizeInfo<TLFrameShape>) {
    return resizeBox(shape, info, { minWidth: GROUP_MIN.w, minHeight: GROUP_MIN.h, maxWidth: GROUP_MAX.w, maxHeight: GROUP_MAX.h });
  }
}
