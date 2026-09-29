import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

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
      className="unframed-agent-menu"
      style={{ position: "fixed", left: place.left, bottom: place.bottom, width: place.width, zIndex: 1200 }}
      onPointerDown={(event) => event.preventDefault()}
    >
      {items.length === 0 ? (
        <p className="unframed-agent-menu__empty">{empty}</p>
      ) : (
        items.map((item, index) => (
          <div
            key={item.key}
            role="option"
            aria-selected={index === highlight}
            data-index={index}
            className="unframed-agent-menu__row"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPick(item);
            }}
            onPointerEnter={() => onHighlight(index)}
          >
            {item.icon !== undefined && <span className="unframed-agent-menu__icon">{item.icon}</span>}
            <span className="unframed-agent-menu__label">{item.label}</span>
            {item.description !== undefined && item.description !== "" && <span className="unframed-agent-menu__description">{item.description}</span>}
            {item.badge !== undefined && <span className="unframed-agent-menu__badge">{item.badge}</span>}
          </div>
        ))
      )}
    </div>,
    document.body,
  );
};
