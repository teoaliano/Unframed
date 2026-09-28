/**
 * What the canvas shows about generation without being a shape: the role badges while the
 * Generate tray is open, and the provenance tether of a selected result. Neither can be
 * selected, and neither carries anything.
 */
import { composeSelection, SKETCH_ROLE } from "@unframed/domain";
import { useValue, useEditor, type Editor, type TLShapeId } from "tldraw";
import { resultMetaOf } from "@unframed/contracts";
import { canvasShapes, pageBox } from "./facts.ts";
import { mediumDefinition } from "./mediumRegistry.ts";
import { composerState } from "./state.ts";
import { trayView } from "./trayView.ts";

interface Badge {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

const badgesOf = (editor: Editor): ReadonlyArray<Badge> => {
  const { mode, medium, recipe } = composerState(editor).get();
  if (mode !== "generate" || recipe) return [];
  const composition = composeSelection({ shapes: canvasShapes(editor), selected: editor.getSelectedShapeIds(), instruction: "", medium });
  const sketch = composition.references.find((slot) => slot.source.type === "sketch");
  const view = trayView(editor).get();
  const own = mediumDefinition(medium)?.roles;
  const roles = own && view?.medium === medium ? { ...composition.roles, ...own({ composition, props: view.props, entry: view.entry }) } : composition.roles;
  return Object.entries(roles).flatMap(([id, text]) => {
    if (id === SKETCH_ROLE) {
      const bounds = sketch?.source.type === "sketch" ? sketch.source.bounds : undefined;
      return bounds ? [{ key: id, x: bounds.x, y: bounds.y, text }] : [];
    }
    const box = pageBox(editor, id as TLShapeId);
    return box ? [{ key: id, x: box.x, y: box.y, text }] : [];
  });
};

/**
 * The role of every selected medium and artifact, and of the sketch, while the Generate tray
 * is open: where a bare media shape's one fact goes, above its top-left corner.
 */
export const RoleBadges = () => {
  const editor = useEditor();
  const badges = useValue("role badges", () => badgesOf(editor), [editor]);
  return (
    <>
      {badges.map((badge) => (
        <div key={badge.key} className="unframed-role-badge" data-role-for={badge.key} style={{ transform: `translate(${badge.x}px, ${badge.y - 22}px)` }}>
          {badge.text}
        </div>
      ))}
    </>
  );
};

interface Line {
  readonly key: string;
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
}

/** Where a line from `from` towards the centre of `box` meets its edge. */
const edgePoint = (from: { x: number; y: number }, box: { x: number; y: number; w: number; h: number }) => {
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const dx = centre.x - from.x;
  const dy = centre.y - from.y;
  if (dx === 0 && dy === 0) return centre;
  const scale = Math.min(Math.abs(box.w / 2 / (dx || Number.EPSILON)), Math.abs(box.h / 2 / (dy || Number.EPSILON)));
  return { x: centre.x - dx * Math.min(1, scale), y: centre.y - dy * Math.min(1, scale) };
};

const tetherOf = (editor: Editor): ReadonlyArray<Line> => {
  const only = editor.getOnlySelectedShape();
  const result = only ? resultMetaOf(only) : undefined;
  if (!only || !result) return [];
  const target = pageBox(editor, only.id);
  if (!target) return [];
  const toScreen = (box: { x: number; y: number; w: number; h: number }) => {
    const topLeft = editor.pageToViewport({ x: box.x, y: box.y });
    const bottomRight = editor.pageToViewport({ x: box.x + box.w, y: box.y + box.h });
    return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
  };
  const end = toScreen(target);
  return result.sources.flatMap((id) => {
    if (id === only.id || !editor.getShape(id as TLShapeId)) return [];
    const box = pageBox(editor, id as TLShapeId);
    if (!box) return [];
    const start = toScreen(box);
    const startCentre = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
    const endCentre = { x: end.x + end.w / 2, y: end.y + end.h / 2 };
    return [{ key: id, from: edgePoint(endCentre, start), to: edgePoint(startCentre, end) }];
  });
};

/** A dashed line from each of a selected result's sources still on the canvas to the result. */
export const Tether = () => {
  const editor = useEditor();
  const lines = useValue("tether", () => tetherOf(editor), [editor]);
  if (lines.length === 0) return null;
  return (
    <svg className="unframed-tether" aria-hidden data-testid="tether">
      <defs>
        <marker id="unframed-tether-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="var(--unframed-border-emphasized)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      {lines.map((line) => (
        <line
          key={line.key}
          data-tether-from={line.key}
          x1={line.from.x}
          y1={line.from.y}
          x2={line.to.x}
          y2={line.to.y}
          stroke="var(--unframed-border-emphasized)"
          strokeWidth={1.5}
          strokeDasharray="4 5"
          markerEnd="url(#unframed-tether-head)"
        />
      ))}
    </svg>
  );
};
