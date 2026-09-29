import type { MentionCandidate } from "@unframed/domain";
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { listboxPopupClass, listboxRowClass } from "../chrome/listbox.ts";

/**
 * The rows of an `@` mention menu: a prompt's while it is edited (spec 02) and the
 * composer's box (spec 03). A press on a row inserts it; the highlighted row stays in view.
 */
export const MentionList = ({
  rows,
  highlight,
  style,
  onPick,
  onHighlight,
}: {
  readonly rows: ReadonlyArray<MentionCandidate>;
  readonly highlight: number;
  readonly style: CSSProperties;
  readonly onPick: (ref: string) => void;
  readonly onHighlight: (index: number) => void;
}) => {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Mentions"
      className={`${listboxPopupClass} pointer-events-auto absolute z-[600] max-h-[168px] w-[260px]`}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {rows.map((row, index) => (
        <div
          key={row.ref}
          role="option"
          aria-selected={index === highlight}
          data-index={index}
          data-highlighted={index === highlight ? "" : undefined}
          className={`${listboxRowClass} whitespace-nowrap`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPick(row.ref);
          }}
          onPointerEnter={() => onHighlight(index)}
        >
          <span className="shrink-0 text-primary">@{row.ref}</span>
          {row.preview !== undefined && <span className="min-w-0 truncate text-muted-foreground">{row.preview}</span>}
        </div>
      ))}
    </div>
  );
};
