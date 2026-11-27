import { scrubbed, stepped, type NumberBounds } from "@unframed/domain";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { InlineButton } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Tip } from "../chrome/ui.tsx";

export interface FieldChange {
  readonly before: string;
  readonly discard: () => void;
}

export const ChangedDot = ({ change }: { readonly change: FieldChange | undefined }) =>
  change === undefined ? (
    <span aria-hidden className="size-1.5 shrink-0" />
  ) : (
    <Tip label={`Changed from ${change.before}`}>
      <InlineButton aria-label={`Changed from ${change.before} · click the dot to discard`} onClick={change.discard}>
        <span aria-hidden className="size-1.5 rounded-full bg-(--design-panel-foreground)" />
      </InlineButton>
    </Tip>
  );

export const ScrubHandle = ({
  name,
  start,
  bounds,
  disabled,
  onScrub,
  children,
}: {
  readonly name: string;
  readonly start: number | undefined;
  readonly bounds?: NumberBounds | undefined;
  readonly disabled?: boolean | undefined;
  readonly onScrub: (next: number) => void;
  readonly children: ReactNode;
}) => {
  const drag = useRef<{ readonly x: number; readonly from: number; last: number } | null>(null);
  return (
    <span
      aria-hidden
      data-scrub={name}
      className="inline-flex shrink-0 cursor-ew-resize touch-none items-center text-(--design-panel-icon) select-none"
      onPointerDown={(event) => {
        if (disabled || start === undefined || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, from: start, last: start };
      }}
      onPointerMove={(event) => {
        const held = drag.current;
        if (held === null) return;
        const next = scrubbed(held.from, event.clientX - held.x, bounds);
        if (next === held.last) return;
        held.last = next;
        onScrub(next);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      {children}
    </span>
  );
};

export const ScrubField = ({
  label,
  aria,
  shown,
  raw,
  placeholder,
  icon,
  disabled,
  bounds,
  change,
  suffix,
  onCommit,
}: {
  readonly label: string;
  readonly aria?: string | undefined;
  readonly shown: string;
  readonly raw: number | undefined;
  readonly placeholder?: string | undefined;
  readonly icon: ReactNode;
  readonly disabled?: boolean | undefined;
  readonly bounds?: NumberBounds | undefined;
  readonly change?: FieldChange | undefined;
  readonly suffix?: ReactNode;
  readonly onCommit: (typed: number) => void;
}) => {
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const text = draft.trim().replace(/%$|°$/, "");
    const typed = Number(text);
    if (draft === shown || text === "" || !Number.isFinite(typed)) {
      setDraft(shown);
      return;
    }
    onCommit(typed);
  };
  return (
    <div className="flex min-w-0 items-center gap-1">
      <ChangedDot change={change} />
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon>
          <ScrubHandle name={label} start={raw} bounds={bounds} disabled={disabled} onScrub={onCommit}>
            {icon}
          </ScrubHandle>
        </InputGroupAddon>
        <InputGroupInput
          role="spinbutton"
          aria-label={aria ?? label}
          aria-valuenow={raw}
          size="sm"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
              return;
            }
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const typed = Number(draft.trim().replace(/%$|°$/, ""));
            const base = draft !== shown && Number.isFinite(typed) ? typed : raw;
            if (base === undefined) return;
            onCommit(stepped(base, event.key === "ArrowUp", event.shiftKey, bounds));
          }}
        />
        {suffix !== undefined && <InputGroupAddon align="inline-end">{suffix}</InputGroupAddon>}
      </InputGroup>
    </div>
  );
};
