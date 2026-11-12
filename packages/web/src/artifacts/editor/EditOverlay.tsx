import { Fragment } from "react";
import type { EditBox } from "@unframed/domain";
import type { EditReport } from "./editSession.ts";

interface EditOverlayProps {
  readonly hovered: EditReport | null;
  readonly layerHover?: string | null;
  readonly selection: readonly string[];
  readonly reports: Readonly<Record<string, EditReport>>;
  readonly boxes: Readonly<Record<string, EditBox>>;
  readonly copies?: Readonly<Record<string, readonly EditBox[]>>;
  readonly names: Readonly<Record<string, string>>;
}

const place = (box: EditBox) => ({ left: box.x, top: box.y, width: box.w, height: box.h });

const sameBox = (a: EditBox, b: EditBox): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export const EditOverlay = ({ hovered, layerHover = null, selection, reports, boxes, copies = {}, names }: EditOverlayProps) => (
  <div aria-hidden data-testid="edit-overlay" className="pointer-events-none absolute inset-0">
    {layerHover === null && hovered !== null && hovered.id !== null && !selection.includes(hovered.id) && (
      <div
        data-edit-outline="hover"
        className="absolute border border-(--edit-overlay-border-hover)"
        style={place(boxes[hovered.id] ?? hovered.box)}
      />
    )}
    {layerHover !== null && !selection.includes(layerHover) && boxes[layerHover] !== undefined && (
      <div data-edit-outline="hover" className="absolute border border-(--edit-overlay-border-hover)" style={place(boxes[layerHover]!)} />
    )}
    {selection.map((id) => {
      const box = boxes[id] ?? reports[id]?.box;
      if (box === undefined) return null;
      const label = names[id] ?? reports[id]?.tag ?? id;
      const others = (copies[id] ?? []).filter((copy) => !sameBox(copy, box));
      return (
        <Fragment key={id}>
          {others.map((copy, index) => (
            <div key={index} data-edit-outline="copy" className="absolute border border-(--edit-overlay-border-copy) opacity-50" style={place(copy)} />
          ))}
        <div data-edit-outline="selected" className="absolute border-2 border-(--edit-overlay-border-selected) shadow-[0_0_0_1px_var(--edit-overlay-halo-inner),0_0_0_2px_var(--edit-overlay-halo-outer)]" style={place(box)}>
          <span
            className="absolute bottom-full left-0 mb-0.5 max-w-60 truncate rounded-sm px-1 text-xs leading-4 text-(--edit-overlay-tag-foreground)"
            style={{ background: "var(--edit-overlay-tag-surface)" }}
          >
            {label}
            {reports[id] !== undefined && <span className="ms-1 opacity-75">{reports[id]!.tag}</span>}
          </span>
        </div>
        </Fragment>
      );
    })}
  </div>
);
