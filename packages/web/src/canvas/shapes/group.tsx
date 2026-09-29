import { GROUP_DEFAULT, GROUP_MAX, GROUP_MIN, mayBeGroupMember, recipeChip, type GroupRecipe } from "@unframed/domain";
import { openOnRecipe } from "../../generate/recipeRuns.ts";
import { groupRecipeOf } from "../groupRecipes.ts";
import { useLayoutEffect, useRef, type SyntheticEvent } from "react";
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
import { Input } from "~/components/ui/input";
import { ShapeLabel } from "./ShapeLabel.tsx";
import { noteRender } from "../../fps/renders.ts";
import { renameGroup, renamingGroup, startRename, stopRename } from "../groupRename.ts";

const LABEL_BAND = 22;
const LABEL_CHAR_WIDTH = 8;

const labelWidth = (shape: TLFrameShape) => Math.min(shape.props.w, LABEL_CHAR_WIDTH * (shape.props.name.length + 1) + 8);

/** Keeps a press inside the name field from reaching the canvas. */
const fieldEvents = (editor: Editor) => ({
  onPointerDown: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onPointerUp: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onPointerMove: (event: SyntheticEvent) => editor.markEventAsHandled(event),
  onDoubleClick: (event: SyntheticEvent) => editor.markEventAsHandled(event),
});

/**
 * The name field in the label's place: a fixed `@`, then the name, fully selected. Enter
 * and blur commit; Escape abandons the draft; every other key stays in the field.
 */
const RenameField = ({ shape }: { readonly shape: TLFrameShape }) => {
  const editor = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const id: TLShapeId = shape.id;

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const finish = (commit: boolean) => {
      if (finished.current) return;
      finished.current = true;
      if (commit) renameGroup(editor, id, field.value);
      stopRename(editor);
    };
    // Native listeners, so tldraw's own key and pointer handlers never see what belongs to the field.
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    // tldraw keeps focus where it is on a canvas press, so a press anywhere else ends the rename here.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== field) finish(true);
    };
    field.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    // A double-click opens the field during its second press, whose own focus change comes after: take the keyboard once it has.
    const frame = requestAnimationFrame(() => {
      field.focus();
      field.select();
      field.addEventListener("blur", onBlur);
    });
    return () => {
      cancelAnimationFrame(frame);
      field.removeEventListener("keydown", onKeyDown);
      field.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [editor, id]);

  return (
    // The name is typed as it is, not in the label's capitals; the kit Input sits unstyled inside this frame.
    <span className="pointer-events-auto flex items-center gap-px tracking-normal normal-case">
      <span data-testid="group-rename-prefix">@</span>
      <span className="inline-flex h-5 items-center overflow-hidden rounded-md border border-primary bg-background text-foreground">
        <Input
          ref={input}
          unstyled
          aria-label="Group name"
          defaultValue={shape.props.name}
          size={Math.max(4, shape.props.name.length + 2)}
          spellCheck={false}
          autoComplete="off"
          {...fieldEvents(editor)}
        />
      </span>
    </span>
  );
};

/** A recipe group's chip, after its name: what its Generate makes. A click opens the composer on the recipe. */
const RecipeChip = ({ shape, recipe }: { readonly shape: TLFrameShape; readonly recipe: GroupRecipe }) => {
  const editor = useEditor();
  // The chip reads as the recipe spells it, not in the label's capitals: the wrapper sets the case the Badge inherits.
  return (
    <span className="ml-1.5 tracking-normal normal-case">
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
  const renaming = useValue("group renaming", () => renamingGroup(editor).get() === id, [editor, id]);
  const recipe = groupRecipeOf(shape);
  return (
    <HTMLContainer
      id={shape.id}
      className="box-border rounded-xl border-[1.5px] border-dashed border-border bg-group-fill data-[selected]:rounded-none data-[selected]:border-solid data-[selected]:border-primary"
      data-testid="group-frame"
      data-selected={selected ? "true" : undefined}
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <ShapeLabel shapeId={shape.id} kind="group" active={renaming}>
        {renaming ? <RenameField shape={shape} /> : <>@{shape.props.name}</>}
        {recipe && !renaming && <RecipeChip shape={shape} recipe={recipe} />}
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

  /** A double-click on the label opens the name field; anywhere else is tldraw's. */
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
