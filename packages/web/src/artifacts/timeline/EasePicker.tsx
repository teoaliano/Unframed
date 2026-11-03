import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { useState } from "react";
import { Tip } from "../../chrome/ui.tsx";
import { type EaseChoice, type EaseValue } from "./ease.ts";

const Curve = ({ samples }: { readonly samples: readonly number[] }) => {
  const points = samples.map((value, index) => `${(index / (samples.length - 1)) * 24},${16 - value * 12 - 2}`).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 24 16" className="h-4 w-6 shrink-0 overflow-visible text-muted-foreground">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  );
};

const GROUP_HEADING: Readonly<Record<EaseChoice["group"], string | null>> = { written: null, catalogue: null, kit: "Kit" };

export interface EasePickerProps {
  readonly label: string;
  readonly choices: readonly EaseChoice[];
  readonly onChoose: (value: EaseValue) => void;
  readonly disabled: boolean;
}

export const EasePicker = ({ label, choices, onChoose, disabled }: EasePickerProps) => {
  const [open, setOpen] = useState(false);
  let heading: string | null = null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" aria-label="Ease" disabled={disabled} className="min-w-0 max-w-40 justify-start" />}>
        <span className="truncate font-mono text-xs">{label}</span>
      </PopoverTrigger>
      <PopoverPopup side="left" align="start" padding="compact" className="max-h-96 w-64 overflow-y-auto" aria-label="Eases" initialFocus={false}>
        <div className="flex flex-col gap-0.5">
          {choices.map((choice) => {
            const title = GROUP_HEADING[choice.group];
            const showHeading = title !== null && title !== heading;
            heading = title;
            const option = (
              <Button
                variant={choice.checked ? "secondary" : "ghost"}
                size="sm"
                role="menuitemradio"
                aria-checked={choice.checked}
                aria-label={choice.label}
                disabled={choice.disabled}
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false);
                  onChoose(choice.value);
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {choice.samples !== null && <Curve samples={choice.samples} />}
                  <span className="truncate">{choice.label}</span>
                </span>
              </Button>
            );
            return (
              <div key={choice.key} className="contents">
                {showHeading && <p className="px-2 pt-2 text-xs text-muted-foreground">{title}</p>}
                {choice.disabled ? (
                  <Tip label={choice.title}>
                    <span className="flex">{option}</span>
                  </Tip>
                ) : (
                  option
                )}
              </div>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
};
