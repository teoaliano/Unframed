import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Badge } from "~/components/ui/badge";

export interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly badge?: string;
  readonly icon?: ReactNode;
}

/**
 * The composer's menu (t3code's command menu), for `@` mentions, `/` commands and `$`
 * skills: a listbox over the box, the highlighted row kept in view. The keys stay with
 * the box; a press on a row chooses it.
 */
export const ComposerMenu = ({
  label,
  items,
  highlight,
  empty,
  anchor,
  onPick,
  onHighlight,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<MenuItem>;
  readonly highlight: number;
  readonly empty: string;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly onPick: (item: MenuItem) => void;
  readonly onHighlight: (index: number) => void;
}) => {
  const list = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; bottom: number; width: number }>();
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (box) setPlace({ left: box.left, bottom: window.innerHeight - box.top + 6, width: box.width });
  }, [anchor, items.length]);
  useLayoutEffect(() => {
    list.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  if (!place) return null;
  return createPortal(
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      className="dropdown-glass fixed z-[130] box-border max-h-65 overflow-y-auto rounded-lg p-1 font-sans text-foreground shadow-lg/5"
      style={{ left: place.left, bottom: place.bottom, width: place.width }}
      onPointerDown={(event) => event.preventDefault()}
    >
      {items.length === 0 ? (
        <p className="m-0 px-2 py-1.5 text-xs text-secondary-label">{empty}</p>
      ) : (
        items.map((item, index) => (
          <div
            key={item.key}
            role="option"
            aria-selected={index === highlight}
            data-index={index}
            data-highlighted={index === highlight ? "" : undefined}
            className="flex min-h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPick(item);
            }}
            onPointerEnter={() => onHighlight(index)}
          >
            {item.icon !== undefined && <span className="inline-flex shrink-0 text-muted-foreground">{item.icon}</span>}
            <span className="min-w-0 max-w-[45%] shrink-0 truncate text-xs font-medium">{item.label}</span>
            {item.description !== undefined && item.description !== "" && <span className="min-w-0 flex-1 truncate text-left text-xs text-secondary-label">{item.description}</span>}
            {item.badge !== undefined && (
              <Badge variant="secondary" className="ms-auto">
                {item.badge}
              </Badge>
            )}
          </div>
        ))
      )}
    </div>,
    document.body,
  );
};
