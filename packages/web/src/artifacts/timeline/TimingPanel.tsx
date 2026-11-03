/**
 * A tween's timing fields (spec 21, The values panel, Timing): Start, Duration and Stagger in seconds. Each one applies on
 * Enter or when the field loses focus. A field the file does not own is read-only. The panel is the timing part of the values
 * panel; the rest of it (the diamonds' values, the ease and the owners' chips) comes with the values panel.
 */
import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { cn } from "~/lib/utils";
import { EasePicker } from "./EasePicker.tsx";
import type { EaseChoice, EaseValue } from "./ease.ts";

export interface TimingPanelProps {
  /** The element's name and the group, as the header names them. */
  readonly title: string;
  readonly method: string;
  readonly start: number;
  readonly duration: number;
  /** The seconds between targets, or null when the tween does not stagger. */
  readonly stagger: number | null;
  readonly startEditable: boolean;
  readonly durationEditable: boolean;
  readonly staggerEditable: boolean;
  readonly onStart: (seconds: number) => void;
  readonly onDuration: (seconds: number) => void;
  readonly onStagger: (seconds: number) => void;
  /** The ease field, or null for a tween that has none (a `set`). */
  readonly ease: { readonly label: string; readonly choices: readonly EaseChoice[]; readonly disabled: boolean } | null;
  readonly onEase: (value: EaseValue) => void;
  readonly onClose: () => void;
  readonly className?: string;
}

const FORMAT = { useGrouping: false, maximumFractionDigits: 3 } as const;

const field = (label: string, value: number, editable: boolean, onCommit: (seconds: number) => void) => (
  <div className="flex items-center justify-between gap-2 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <NumberField key={`${label}:${value}`} size="sm" className="w-24" defaultValue={value} format={FORMAT} disabled={!editable} onValueCommitted={(typed) => {
      if (typed !== null && Number.isFinite(typed) && typed >= 0 && typed !== value) onCommit(typed);
    }}>
      <NumberFieldGroup>
        <NumberFieldInput
          aria-label={label}
          onKeyDown={(event) => {
            // Enter applies the field the way leaving it does, as the editor's size field does.
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </NumberFieldGroup>
    </NumberField>
  </div>
);

export const TimingPanel = ({ title, method, start, duration, stagger, startEditable, durationEditable, staggerEditable, ease, onEase, onStart, onDuration, onStagger, onClose, className }: TimingPanelProps) => (
  <section aria-label={`Timing for ${title}`} data-testid="timing-panel" className={cn("absolute right-3 top-12 z-30 w-[280px] rounded-lg border bg-popover p-3 text-popover-foreground shadow-md", className)}>
    <header className="mb-2 flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {title}
        <span className="ml-1 text-muted-foreground">{`· ${method}`}</span>
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Close timing" onClick={onClose}>
        <X aria-hidden />
      </Button>
    </header>
    <div className="flex flex-col gap-2">
      {field("Start", start, startEditable, onStart)}
      {field("Duration", duration, durationEditable, onDuration)}
      {stagger !== null && field("Stagger", stagger, staggerEditable, onStagger)}
      {ease !== null && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Ease</span>
          <EasePicker label={ease.label} choices={ease.choices} disabled={ease.disabled} onChoose={onEase} />
        </div>
      )}
    </div>
  </section>
);
