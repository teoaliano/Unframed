import type { EditBox } from "@unframed/domain";
import type { CSSProperties, ReactNode } from "react";
import type { EditReport } from "../artifacts/editor/editSession.ts";
import { badgeText, chipText, unionOf, type ElementLayout } from "./designLayout.ts";

const UNSCALE = "scale(var(--screen-unscale))";

export const ring = (times: number): string => `calc(var(--screen-ring) * ${times})`;

export const placed = (box: EditBox): CSSProperties => ({ left: box.x, top: box.y, width: box.w, height: box.h });

export const Pinned = ({ x, y, origin, shift = "", children }: { readonly x: number; readonly y: number; readonly origin: string; readonly shift?: string; readonly children: ReactNode }) => (
  <div className="absolute size-0" style={{ left: x, top: y }}>
    <div className="absolute top-0 left-0" style={{ transform: `${UNSCALE} ${shift}`.trim(), transformOrigin: origin }}>
      {children}
    </div>
  </div>
);

export const Chip = ({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) => (
  <span className="block whitespace-nowrap rounded-sm bg-(--edit-overlay-tag-surface) px-1 font-sans text-xs leading-4 text-(--edit-overlay-tag-foreground)" data-testid={testId}>
    {children}
  </span>
);

const Outline = ({ box, kind, width = 1, dashed = false }: { readonly box: EditBox; readonly kind: string; readonly width?: number; readonly dashed?: boolean }) => (
  <div
    data-design-outline={kind}
    className={`absolute border-(--edit-overlay-border-selected) ${dashed ? "border-dashed" : "border-solid"}`}
    style={{ ...placed(box), borderWidth: ring(width) }}
  />
);

const CORNERS = [
  { name: "nw", at: (box: EditBox) => ({ x: box.x, y: box.y }) },
  { name: "ne", at: (box: EditBox) => ({ x: box.x + box.w, y: box.y }) },
  { name: "se", at: (box: EditBox) => ({ x: box.x + box.w, y: box.y + box.h }) },
  { name: "sw", at: (box: EditBox) => ({ x: box.x, y: box.y + box.h }) },
] as const;

export interface OverlayView {
  readonly hovered: EditReport | null;
  readonly selection: readonly string[];
  readonly reports: Readonly<Record<string, EditReport>>;
  readonly boxes: Readonly<Record<string, EditBox>>;
  readonly layouts: Readonly<Record<string, ElementLayout>>;
}

export const boxOf = (view: Pick<OverlayView, "boxes" | "reports">, id: string): EditBox | undefined => view.boxes[id] ?? view.reports[id]?.box;

export const selectionBox = (view: Pick<OverlayView, "boxes" | "reports" | "selection">): EditBox | undefined =>
  unionOf(view.selection.flatMap((id) => {
    const box = boxOf(view, id);
    return box === undefined ? [] : [box];
  }));

export const DesignOverlay = ({ view, hideHover = false, children }: { readonly view: OverlayView; readonly hideHover?: boolean; readonly children?: ReactNode }) => {
  const { hovered, selection, reports, layouts } = view;
  const hoverId = hovered?.id ?? null;
  const hoverBox = hoverId === null ? undefined : boxOf(view, hoverId);
  const hoverLines = hoverId === null ? [] : (layouts[hoverId]?.lines ?? []);
  const union = selectionBox(view);
  const [only] = selection;
  const single = selection.length === 1 && only !== undefined;
  const parent = single ? layouts[only]?.parent : null;
  return (
    <div aria-hidden data-testid="design-overlay" className="pointer-events-none absolute inset-0">
      {parent && <Outline box={parent.box} kind="parent" dashed />}
      {selection.map((id) => {
        const box = boxOf(view, id);
        return box === undefined ? null : <Outline key={id} box={box} kind="selected" width={id === hoverId && !hideHover ? 2 : 1} />;
      })}
      {selection.length > 1 && union !== undefined && <Outline box={union} kind="union" />}
      {!hideHover && hovered !== null && hoverBox !== undefined && (
        <>
          {!selection.includes(hoverId!) && <Outline box={hoverBox} kind="hover" width={2} />}
          {hoverLines.map((line, index) => (
            <div key={index} data-design-underline="" className="absolute bg-(--edit-overlay-border-selected)" style={{ left: line.x, top: line.y + line.h, width: line.w, height: ring(1) }} />
          ))}
          <Pinned x={hoverBox.x} y={hoverBox.y} origin="0 0" shift="translateY(-100%)">
            <span className="block pb-0.5">
              <Chip testId="design-hover-chip">{chipText(reports[hoverId!] ?? hovered, hoverBox)}</Chip>
            </span>
          </Pinned>
        </>
      )}
      {union !== undefined && (
        <>
          {CORNERS.map((corner) => {
            const at = corner.at(union);
            return (
              <Pinned key={corner.name} x={at.x} y={at.y} origin="0 0" shift="translate(-50%, -50%)">
                <span data-design-corner={corner.name} className="block size-2 border border-(--edit-overlay-border-selected) bg-(--edit-overlay-halo-inner)" />
              </Pinned>
            );
          })}
          <Pinned x={union.x + union.w / 2} y={union.y + union.h} origin="0 0" shift="translateX(-50%)">
            <span className="block pt-1">
              <Chip testId="design-size-badge">{badgeText(union)}</Chip>
            </span>
          </Pinned>
        </>
      )}
      {children}
    </div>
  );
};
