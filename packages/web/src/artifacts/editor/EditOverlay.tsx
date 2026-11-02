/**
 * The outlines the editor draws over the frame (spec 18, Outlines): a 1 px ring under the pointer,
 * a 2 px primary outline on each selected element with its name above. The frame is never drawn
 * on; the boxes come from the edit bridge, and the layer takes no pointer.
 */
import type { EditBox } from "@unframed/domain";
import type { EditReport } from "./editSession.ts";

export interface EditOverlayProps {
  readonly hovered: EditReport | null;
  /** The element a Layers row hovers. It is outlined in place of the pointer's own hover. */
  readonly layerHover?: string | null;
  readonly selection: readonly string[];
  readonly reports: Readonly<Record<string, EditReport>>;
  readonly boxes: Readonly<Record<string, EditBox>>;
  /** The name each element shows: its layer name or derived label, by element id. */
  readonly names: Readonly<Record<string, string>>;
}

const place = (box: EditBox) => ({ left: box.x, top: box.y, width: box.w, height: box.h });

export const EditOverlay = ({ hovered, layerHover = null, selection, reports, boxes, names }: EditOverlayProps) => (
  <div aria-hidden data-testid="edit-overlay" className="pointer-events-none absolute inset-0">
    {layerHover === null && hovered !== null && hovered.id !== null && !selection.includes(hovered.id) && (
      <div
        data-edit-outline="hover"
        className="absolute"
        style={{ ...place(boxes[hovered.id] ?? hovered.box), border: "1px solid var(--ring)" }}
      />
    )}
    {layerHover !== null && !selection.includes(layerHover) && boxes[layerHover] !== undefined && (
      <div data-edit-outline="hover" className="absolute" style={{ ...place(boxes[layerHover]!), border: "1px solid var(--ring)" }} />
    )}
    {selection.map((id) => {
      const box = boxes[id] ?? reports[id]?.box;
      if (box === undefined) return null;
      const label = names[id] ?? reports[id]?.tag ?? id;
      return (
        <div key={id} data-edit-outline="selected" className="absolute" style={{ ...place(box), border: "2px solid var(--primary)" }}>
          <span
            className="absolute bottom-full left-0 mb-0.5 max-w-60 truncate rounded-sm px-1 text-xs leading-4 text-primary-foreground"
            style={{ background: "var(--primary)" }}
          >
            {label}
            {reports[id] !== undefined && <span className="ms-1 opacity-75">{reports[id]!.tag}</span>}
          </span>
        </div>
      );
    })}
  </div>
);
