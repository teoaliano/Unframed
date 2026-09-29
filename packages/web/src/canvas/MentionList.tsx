import type { MentionCandidate } from "@unframed/domain";
import { useLayoutEffect, useRef, type CSSProperties } from "react";

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
    // Not a kit Menu (the text editor keeps the keyboard), so it carries the kit menu popup and row recipes itself.
    <div
      ref={list}
      role="listbox"
      aria-label="Mentions"
      className="dropdown-glass pointer-events-auto absolute z-[600] box-border max-h-[168px] w-[260px] overflow-y-auto rounded-lg p-1 font-sans text-sm text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {rows.map((row, index) => (
        <div
          key={row.ref}
          role="option"
          aria-selected={index === highlight}
          data-index={index}
          className="flex min-h-7 cursor-default items-baseline gap-2 rounded-sm px-2 py-1 leading-5 whitespace-nowrap aria-selected:bg-accent aria-selected:text-accent-foreground"
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
