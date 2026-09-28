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
    <div ref={list} role="listbox" aria-label="Mentions" className="unframed-mention-menu" style={style} onPointerDown={(event) => event.stopPropagation()}>
      {rows.map((row, index) => (
        <div
          key={row.ref}
          role="option"
          aria-selected={index === highlight}
          data-index={index}
          className="unframed-mention-row"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPick(row.ref);
          }}
          onPointerEnter={() => onHighlight(index)}
        >
          <span className="unframed-mention-ref">@{row.ref}</span>
          {row.preview !== undefined && <span className="unframed-mention-preview">{row.preview}</span>}
        </div>
      ))}
    </div>
  );
};
