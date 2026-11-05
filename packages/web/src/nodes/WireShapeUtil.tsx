import { type WireRole, type WireShapeProps } from "@unframed/contracts";
import { rolesFor, sourceOf } from "@unframed/domain";
import { Polyline2d, ShapeUtil, SVGContainer, T, useEditor, useValue, Vec, type Editor, type RecordProps, type TLShapeId } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { controlEvents } from "../canvas/shapes/media.tsx";
import { labelHue } from "../chrome/hue.ts";
import { noteRender } from "../fps/renders.ts";
import { nodeCanvas, type WireShape } from "./facts.ts";
import { nodeFrames, nodeRoles, setWireFiles, setWireRole } from "./operations.ts";

const wireProps: RecordProps<WireShape> = {
  from: T.string,
  to: T.string,
  role: T.literalEnum("prompt", "reference", "first", "last", "both"),
  files: T.literalEnum("entry", "linked").optional(),
};

const SAMPLES = 24;

interface Ends {
  readonly start: Vec;
  readonly end: Vec;
}

/** Where a wire runs: from the right edge of its source to the left edge of its node, in page space. */
const endsOf = (editor: Editor, props: WireShapeProps): Ends | undefined => {
  const from = editor.getShapePageBounds(props.from as TLShapeId);
  const to = editor.getShapePageBounds(props.to as TLShapeId);
  if (!from || !to) return undefined;
  return { start: new Vec(from.maxX, from.midY), end: new Vec(to.minX, to.midY) };
};

const control = (ends: Ends) => {
  const reach = Math.max(60, Math.abs(ends.end.x - ends.start.x) / 2);
  return { c1: new Vec(ends.start.x + reach, ends.start.y), c2: new Vec(ends.end.x - reach, ends.end.y) };
};

const pointAt = (ends: Ends, t: number): Vec => {
  const { c1, c2 } = control(ends);
  const u = 1 - t;
  return new Vec(
    u * u * u * ends.start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * ends.end.x,
    u * u * u * ends.start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * ends.end.y,
  );
};

const pathOf = (ends: Ends): string => {
  const { c1, c2 } = control(ends);
  return `M ${ends.start.x} ${ends.start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${ends.end.x} ${ends.end.y}`;
};

const PAGE_CHOICES: ReadonlyArray<{ role: WireRole; label: string }> = [
  { role: "prompt", label: "HTML" },
  { role: "reference", label: "Picture" },
  { role: "both", label: "Both" },
];

const ROLE_WORDS: Record<WireRole, string> = { prompt: "Prompt", reference: "Reference", first: "First frame", last: "Last frame", both: "Both" };

const RoleChip = ({ wire, at }: { readonly wire: WireShape; readonly at: Vec }) => {
  const editor = useEditor();
  const label = useValue("wire role", () => nodeRoles(editor, wire.props.to)[wire.id] ?? wire.props.role, [editor, wire.props.to, wire.id]);
  const offered = useValue(
    "wire roles offered",
    () => {
      const canvas = nodeCanvas(editor);
      const node = canvas.nodes.get(wire.props.to);
      const source = sourceOf(canvas, wire.props.from);
      return node && source ? { page: source === "page" || source === "node-page", roles: rolesFor(node.medium, nodeFrames(node), source) } : { page: false, roles: [] as WireRole[] };
    },
    [editor, wire.props.to, wire.props.from],
  );
  const events = controlEvents(editor);
  const chosen = (wire.meta.unframed as { chosen?: boolean } | undefined)?.chosen === true;
  return (
    <div className="pointer-events-auto absolute top-0 left-0" style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)` }} data-testid="wire-chip" data-wire-id={wire.id} {...events}>
      <Menu>
        <MenuTrigger
          render={
            <Badge
              // oxlint-disable-next-line react/forbid-elements -- the role chip is spec 12's badge, pressed to open its menu
              render={<button type="button" />}
              variant="label"
              style={labelHue(label === "—" || label === "choose" ? "orange" : "blue")}
              aria-label={`Wire role: ${label}`}
              data-role={wire.props.role}
            />
          }
        >
          {label === "choose" ? "Choose what it sends" : label}
        </MenuTrigger>
        <MenuPopup align="center" className="min-w-40">
          <MenuGroup>
            <MenuGroupLabel>{offered.page ? "This page sends" : "Role"}</MenuGroupLabel>
            <MenuRadioGroup value={chosen || !offered.page ? wire.props.role : ""} onValueChange={(value) => setWireRole(editor, wire.id, value as WireRole)}>
              {(offered.page ? PAGE_CHOICES.filter((choice) => offered.roles.includes(choice.role)) : offered.roles.map((role) => ({ role, label: ROLE_WORDS[role] }))).map((choice) => (
                <MenuRadioItem key={choice.role} value={choice.role} closeOnClick>
                  <span className="flex items-center justify-between gap-3">
                    {choice.label}
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
          {offered.page && (
            <>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>Files</MenuGroupLabel>
                <MenuRadioGroup value={wire.props.files ?? ""} onValueChange={(value) => setWireFiles(editor, wire.id, value as "entry" | "linked")}>
                  <MenuRadioItem value="entry" closeOnClick>
                    <span className="flex items-center justify-between gap-3">
                      The page alone
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                  <MenuRadioItem value="linked" closeOnClick>
                    <span className="flex items-center justify-between gap-3">
                      With its linked files
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                </MenuRadioGroup>
              </MenuGroup>
            </>
          )}
        </MenuPopup>
      </Menu>
    </div>
  );
};

const Wire = ({ wire }: { readonly wire: WireShape }) => {
  noteRender(wire.id);
  const editor = useEditor();
  const ends = useValue("wire ends", () => endsOf(editor, wire.props), [editor, wire.props.from, wire.props.to]);
  const selected = useValue("wire selected", () => editor.getSelectedShapeIds().includes(wire.id), [editor, wire.id]);
  if (!ends) return null;
  return (
    <>
      <SVGContainer data-testid="wire" data-wire-id={wire.id}>
        <path d={pathOf(ends)} fill="none" className={selected ? "stroke-ring" : "stroke-border"} strokeWidth={selected ? 2.5 : 2} strokeLinecap="round" />
        <circle cx={ends.end.x} cy={ends.end.y} r={3.5} className={selected ? "fill-ring" : "fill-border"} />
      </SVGContainer>
      <RoleChip wire={wire} at={pointAt(ends, 0.5)} />
    </>
  );
};

export class WireShapeUtil extends ShapeUtil<WireShape> {
  static override type = "wire" as const;
  static override props = wireProps;

  override getDefaultProps(): WireShapeProps {
    return { from: "shape:none", to: "shape:none", role: "prompt" };
  }

  override canResize() {
    return false;
  }

  override canEdit() {
    return false;
  }

  override canBind() {
    return false;
  }

  override hideResizeHandles() {
    return true;
  }

  override hideRotateHandle() {
    return true;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  override getGeometry(shape: WireShape) {
    const ends = endsOf(this.editor, shape.props);
    if (!ends) return new Polyline2d({ points: [new Vec(0, 0), new Vec(1, 0)] });
    return new Polyline2d({ points: Array.from({ length: SAMPLES + 1 }, (_, index) => pointAt(ends, index / SAMPLES)) });
  }

  override component(shape: WireShape) {
    return <Wire wire={shape} />;
  }

  override canSnap() {
    return false;
  }

  override canBeLaidOut() {
    return false;
  }

  override getIndicatorPath(shape: WireShape) {
    const ends = endsOf(this.editor, shape.props);
    return new Path2D(ends ? pathOf(ends) : "");
  }
}
