import { changeLine, elementKind, pictureKeyOf, pictureUrl, type DraftChange } from "@unframed/domain";
import { ChevronDown, Columns2, Eye, PencilLine, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button, InlineButton } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tip } from "../chrome/ui.tsx";
import type { EditSession } from "../artifacts/editor/editSession.ts";
import { Chip, Pinned, boxOf, ring } from "./DesignOverlay.tsx";
import { APPLY_STATE_TEXT, type ApplyRow, type ApplyRun } from "./screenApply.ts";

const counted = (count: number) => (count === 1 ? "1 change" : `${count} changes`);

const layerOf = (change: DraftChange): string => {
  const element = change.element;
  const named = element.component ?? elementKind(element.tag);
  const text = change.kind === "text" ? (change.before ?? "") : "";
  return text === "" ? named : `${named} · “${text}”`;
};

const Row = ({ index, change, row, session, busy }: { readonly index: number; readonly change: DraftChange; readonly row: ApplyRow | undefined; readonly session: EditSession; readonly busy: boolean }) => (
  <li className="group flex min-w-0 items-start gap-2 py-1.5" data-draft-row={change.id} data-draft-state={row?.state ?? "draft"}>
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-(--artifact-editor-column-border) text-xs leading-4">{index + 1}</span>
    <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
      <span className="w-full min-w-0 truncate text-sm" data-testid="draft-layer">
        <InlineButton onClick={() => session.setSelection([change.element.stamp])}>{layerOf(change)}</InlineButton>
      </span>
      <span className="w-full min-w-0 truncate font-mono text-xs text-(--artifact-editor-meta)" data-testid="draft-line">
        {changeLine(change)}
      </span>
    </div>
    {row === undefined ? (
      <Button variant="ghost" size="icon-xs" aria-label={`Discard: ${changeLine(change)}`} disabled={busy} onClick={() => session.discardDraft(change.id)}>
        <X aria-hidden />
      </Button>
    ) : (
      <span className="shrink-0 text-xs text-(--artifact-editor-meta)" data-testid="draft-state">
        {APPLY_STATE_TEXT[row.state]}
      </span>
    )}
  </li>
);

const Swipe = ({ project, picture, size }: { readonly project: string; readonly picture: string; readonly size: { readonly w: number; readonly h: number } }) => {
  const [at, setAt] = useState(0.5);
  const area = useRef<HTMLDivElement>(null);
  const drag = (event: ReactPointerEvent<HTMLElement>) => {
    const box = area.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    setAt(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  };
  return (
    <div ref={area} className="absolute top-0 left-0" style={{ width: size.w, height: size.h }} data-testid="design-swipe" data-at={at.toFixed(2)}>
      <img alt="" src={pictureUrl(project, picture, "full")} className="absolute inset-0 size-full" style={{ clipPath: `inset(0 ${(1 - at) * 100}% 0 0)` }} />
      <div className="absolute top-0 bottom-0 bg-(--edit-overlay-halo-outer)" style={{ left: at * size.w, width: ring(1) }} />
      <Pinned x={at * size.w} y={0} origin="0 0" shift="translate(-100%, 0)">
        <span className="block pe-1 pt-1">
          <Chip>Code</Chip>
        </span>
      </Pinned>
      <Pinned x={at * size.w} y={0} origin="0 0">
        <span className="block ps-1 pt-1">
          <Chip>Your edits</Chip>
        </span>
      </Pinned>
      <Pinned x={at * size.w} y={size.h / 2} origin="0 0" shift="translate(-50%, -50%)">
        <span
          role="slider"
          aria-label="Swipe"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(at * 100)}
          tabIndex={0}
          className="pointer-events-auto flex size-6 cursor-ew-resize items-center justify-center rounded-full border border-(--edit-overlay-halo-inner) bg-(--edit-overlay-halo-outer) text-xs text-(--edit-overlay-halo-inner)"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setAt((value) => Math.max(0, value - 0.05));
            if (event.key === "ArrowRight") setAt((value) => Math.min(1, value + 0.05));
          }}
        >
          ‹›
        </span>
      </Pinned>
    </div>
  );
};

const EDGE = 8;

interface BarPlace {
  readonly left: number;
  readonly top: number;
}

const placeBar = (host: HTMLElement, container: HTMLElement, bar: HTMLElement): BarPlace => {
  const area = container.getBoundingClientRect();
  const screen = host.getBoundingClientRect();
  const panel = container.querySelector<HTMLElement>('[data-testid="screen-design-panel"]')?.getBoundingClientRect();
  const toolbar = container.querySelector<HTMLElement>('[data-testid="bottom-toolbar"]')?.getBoundingClientRect();
  const right = Math.min(screen.right, area.right, panel === undefined ? area.right : panel.left);
  const left = Math.max(screen.left, area.left);
  const centre = (left < right ? (left + right) / 2 : screen.left + screen.width / 2) - area.left;
  const floor = (toolbar === undefined || toolbar.height === 0 ? area.bottom : toolbar.top) - area.top - EDGE - bar.offsetHeight;
  const room = (panel === undefined ? area.width : panel.left - area.left) - EDGE - bar.offsetWidth;
  return {
    left: Math.max(EDGE, Math.min(room, centre - bar.offsetWidth / 2)),
    top: Math.max(EDGE, Math.min(floor, screen.bottom - area.top + EDGE)),
  };
};

const usePlace = (host: HTMLElement, container: HTMLElement, bar: { readonly current: HTMLElement | null }): BarPlace | undefined => {
  const [place, setPlace] = useState<BarPlace | undefined>(undefined);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const element = bar.current;
      if (element !== null) {
        const next = placeBar(host, container, element);
        setPlace((previous) => (previous?.left === next.left && previous.top === next.top ? previous : next));
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [host, container, bar]);
  return place;
};

export const DesignDrafts = ({ host, container, session, run, project, picture, size, onApply, onDismiss, onDiscardAll }: {
  readonly host: HTMLElement;
  readonly container: HTMLElement;
  readonly session: EditSession;
  readonly run: ApplyRun | undefined;
  readonly project: string;
  readonly picture: string | undefined;
  readonly size: { readonly w: number; readonly h: number };
  readonly onApply: () => void;
  readonly onDismiss: () => void;
  readonly onDiscardAll: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [comparing, setComparing] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const place = usePlace(host, container, barRef);
  const drafts = session.drafts;
  const showRun = drafts.length === 0 && run !== undefined;
  const changes = showRun ? run.rows.map((row) => row.change) : drafts;
  const key = picture === undefined ? undefined : pictureKeyOf({ picture });
  if (changes.length === 0) return null;
  const busy = run?.busy === true;
  return (
    <>
      {createPortal(
        <div className="pointer-events-none absolute inset-0" data-testid="design-drafts-layer">
          {all &&
            !showRun &&
            drafts.map((change, index) => {
              const box = boxOf(session, change.element.stamp);
              return box === undefined ? null : (
                <Pinned key={change.id} x={box.x} y={box.y} origin="0 0" shift="translate(-50%, -50%)">
                  <span data-design-pin={index + 1} className="flex size-4 items-center justify-center rounded-full bg-(--edit-overlay-halo-outer) font-sans text-xs leading-4 text-(--edit-overlay-halo-inner)">
                    {index + 1}
                  </span>
                </Pinned>
              );
            })}
          {comparing && key !== undefined && !showRun && <Swipe project={project} picture={key} size={size} />}
        </div>,
        host,
      )}
      {createPortal(
        <div
          ref={barRef}
          className="pointer-events-auto absolute z-[calc(var(--tl-layer-watermark)_-_1)] flex items-center gap-1 rounded-lg border border-(--artifact-editor-column-border) bg-(--artifact-editor-surface) p-1 font-sans text-(--artifact-editor-foreground) shadow-sm"
          style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place === undefined ? "hidden" : "visible" }}
          data-testid="design-drafts"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Popover open={open} onOpenChange={setOpen}>
            <Tip label="Changes in this Screen">
              <PopoverTrigger render={<Button variant="ghost" size="sm" aria-label={showRun ? (busy ? "Applying" : "Applied") : counted(changes.length)} data-testid="design-drafts-count" />}>
                <PencilLine aria-hidden />
                {showRun ? (busy ? "Applying…" : "Applied") : changes.length}
                <ChevronDown aria-hidden />
              </PopoverTrigger>
            </Tip>
            <PopoverPopup side="top" align="start" padding="compact" className="w-80" aria-label="Changes" initialFocus={false}>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <p className="m-0 flex-1 text-sm font-semibold">{showRun ? "Applied changes" : "Changes in this Screen"}</p>
                  {!showRun && (
                    <Tip label="Show every change on the Screen">
                      <Button variant={all ? "secondary" : "ghost"} size="xs" aria-pressed={all} onClick={() => setAll(!all)}>
                        <Eye aria-hidden />
                        Show all
                      </Button>
                    </Tip>
                  )}
                </div>
                <ul className="m-0 flex list-none flex-col divide-y divide-(--artifact-editor-column-border) p-0" aria-label="Changes">
                  {changes.map((change, index) => (
                    <Row key={change.id} index={index} change={change} row={showRun ? run.rows.find((row) => row.change.id === change.id) : undefined} session={session} busy={busy} />
                  ))}
                </ul>
                {showRun && (
                  <div className="flex items-center justify-end gap-2">
                    <span className="mr-auto text-xs text-(--artifact-editor-note)">{busy ? "" : "Undo puts back what Apply wrote."}</span>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
                      Done
                    </Button>
                  </div>
                )}
              </div>
            </PopoverPopup>
          </Popover>
          {!showRun && (
            <>
              <Tip label={key === undefined ? "Compare needs a picture of this Screen" : "Swipe: the code on one side, your edits on the other"}>
                <Button variant={comparing ? "secondary" : "ghost"} size="icon-sm" aria-label="Compare" aria-pressed={comparing} disabled={key === undefined} onClick={() => setComparing(!comparing)}>
                  <Columns2 aria-hidden />
                </Button>
              </Tip>
              <Tip label="Discard all changes (⌘Z brings them back)">
                <Button variant="ghost" size="icon-sm" aria-label="Discard all" disabled={busy} onClick={onDiscardAll}>
                  <Trash2 aria-hidden />
                </Button>
              </Tip>
              <Tip label="Write these changes into the code">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setComparing(false);
                    setAll(false);
                    onApply();
                  }}
                >
                  Apply
                </Button>
              </Tip>
            </>
          )}
        </div>,
        container,
      )}
    </>
  );
};
