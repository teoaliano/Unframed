import { META_REF_TYPES, nextRef, readRef, type CanvasRecordLike } from "@unframed/domain";
import { DefaultFontStyle, DefaultSizeStyle, DefaultTextAlignStyle, type Editor, type TLShape } from "tldraw";


/**
 * Mints refs from the live store, which holds every other tab's synced shapes. Refs minted
 * in the same synchronous run count too, so several shapes created at once get distinct
 * numbers in order.
 */
export class RefMinter {
  private recent: CanvasRecordLike[] = [];
  private clearing = false;
  private readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  mint(): string {
    const ref = nextRef([...this.editor.store.allRecords(), ...this.recent]);
    this.recent.push({ typeName: "shape", type: "text", meta: { ref } });
    if (!this.clearing) {
      this.clearing = true;
      queueMicrotask(() => {
        this.recent = [];
        this.clearing = false;
      });
    }
    return ref;
  }
}

const heldBy = (editor: Editor, ref: string, except: string): boolean =>
  editor.getCurrentPageShapes().some((other) => other.id !== except && readRef(other) === ref);

/**
 * Gives every shape this tab creates its ref, and a new group its name, before the store
 * validates it. A shape that arrives with a ref another shape holds (a duplicate) gets a
 * fresh one.
 */
export const installRefMinting = (editor: Editor, minter: RefMinter): (() => void) =>
  editor.sideEffects.registerBeforeCreateHandler("shape", (shape: TLShape, source) => {
    if (source !== "user") return shape;
    if (shape.type === "frame") {
      const props = shape.props as { name: string };
      return props.name === "" || heldBy(editor, props.name, shape.id)
        ? ({ ...shape, props: { ...props, name: minter.mint() } } as TLShape)
        : shape;
    }
    if (!META_REF_TYPES.has(shape.type)) return shape;
    const withDefaults = shape.type === "text" ? promptDefaults(editor, shape) : shape;
    const meta = withDefaults.meta as { ref?: unknown };
    if (typeof meta.ref === "string" && !heldBy(editor, meta.ref, shape.id)) return withDefaults;
    return { ...withDefaults, meta: { ...withDefaults.meta, ref: minter.mint() } } as TLShape;
  });

/**
 * A new prompt takes tldraw's sans font, size s, left aligned, unless the person picked
 * another in the style panel, and never tldraw's own auto size: its box is its own.
 */
const promptDefaults = (editor: Editor, shape: TLShape): TLShape => {
  const chosen = editor.getInstanceState().stylesForNextShape;
  const props = shape.props as Record<string, unknown>;
  return {
    ...shape,
    props: {
      ...props,
      autoSize: false,
      ...(chosen[DefaultFontStyle.id] === undefined ? { font: "sans" } : {}),
      ...(chosen[DefaultSizeStyle.id] === undefined ? { size: "s" } : {}),
      ...(chosen[DefaultTextAlignStyle.id] === undefined ? { textAlign: "start" } : {}),
    },
  } as TLShape;
};
