/**
 * The Runs prop (spec 05), image medium only: a count up to the domain's `RUNS_CAP` fires that many
 * generations as one batch; Free takes the count from a list in the selection. It is not a
 * model trait, so a model change leaves it. Its values live in the tray's props as `runs`
 * and `viewFinalPrompt`, which is also how last-used values store them.
 */
import { clampRuns, readRunsValue, RUNS_CAP, type RunsValue } from "@unframed/domain";
import { useRef } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Separator } from "~/components/ui/separator";
import { Toggle } from "~/components/ui/toggle";
import { Tip } from "../chrome/ui.tsx";
import { TrayChip } from "./composer/PropTray.tsx";
import type { PropValue, TrayPropChipProps, TrayPropDefinition, TrayProps } from "./mediumRegistry.ts";

export const RUNS_KEY = "runs";
export const VIEW_FINAL_PROMPT_KEY = "viewFinalPrompt";

export const FREE_TOOLTIP =
  "Free takes the number of runs from the selection. Select a prompt or text result listing what to generate, as sections split by lines containing only ---, or prose a text model can split, and each item becomes one image.";

/** The Runs value the tray holds: 1 when the prop is not in it. */
export const runsOf = (props: TrayProps): RunsValue => readRunsValue(props[RUNS_KEY]);

export const viewsFinalPrompt = (props: TrayProps): boolean => props[VIEW_FINAL_PROMPT_KEY] === true;

const chipText = (runs: RunsValue) => (runs === "free" ? "Free" : `${runs}×`);

const RunsChip = ({ props, onChange, open, onOpenChange }: TrayPropChipProps) => {
  const runs = runsOf(props);
  const field = useRef<HTMLInputElement>(null);
  const free = useRef<HTMLButtonElement>(null);
  const set = (next: Record<string, PropValue>) => onChange({ ...props, ...next });
  // Focusing the field leaves Free for a count.
  const fixed = () => {
    if (runs === "free") set({ [RUNS_KEY]: 1 });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger data-prop={RUNS_KEY} aria-label={`Runs ${chipText(runs)}`} render={<TrayChip />}>
        {chipText(runs)}
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        align="start"
        sideOffset={6}
        padding="compact"
        className="w-[200px]"
        aria-label="Runs"
        initialFocus={() => (runs === "free" ? free.current : field.current)}
        onKeyDown={(event) => {
          // The composer keeps its keys from tldraw, so this popup closes itself on Esc.
          if (event.key !== "Escape") return;
          event.preventDefault();
          onOpenChange(false);
        }}
      >
        <div className="flex flex-col gap-2">
          {/* The field keeps what is typed (digits, at most two) and clamps on blur; the chip follows the clamped count. */}
          <NumberField
            size="sm"
            min={1}
            max={RUNS_CAP}
            value={runs === "free" ? null : runs}
            onValueChange={(value) => set({ [RUNS_KEY]: clampRuns(value ?? "") })}
            className="flex-row items-center justify-between"
          >
            <span className="text-sm text-foreground">Runs</span>
            <NumberFieldGroup className="w-14">
              <NumberFieldInput
                ref={field}
                aria-label="Number of runs"
                placeholder="1"
                maxLength={2}
                onFocus={fixed}
                onPointerDown={fixed}
                onKeyDown={(event) => {
                  // Digits only (spec 05): the number field would also take a sign or a separator.
                  if (event.key.length === 1 && !/\d/.test(event.key) && !event.metaKey && !event.ctrlKey) event.preventDefault();
                }}
              />
            </NumberFieldGroup>
          </NumberField>
          <Tip label={FREE_TOOLTIP} side="right">
            <Toggle
              ref={free}
              size="sm"
              pressed={runs === "free"}
              onPressedChange={() => set({ [RUNS_KEY]: "free" })}
              className="w-full justify-start"
            >
              Free
            </Toggle>
          </Tip>
          {runs === "free" && (
            <Label>
              <Checkbox checked={viewsFinalPrompt(props)} onCheckedChange={(checked) => set({ [VIEW_FINAL_PROMPT_KEY]: checked })} />
              View final prompt
            </Label>
          )}
          <Separator />
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              const { [RUNS_KEY]: _runs, ...rest } = props;
              onChange(rest);
              onOpenChange(false);
            }}
          >
            Remove
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
};

export const runsProp: TrayPropDefinition = {
  key: RUNS_KEY,
  label: "Runs",
  inTray: (props) => runsOf(props) !== 1,
  addValue: () => "1",
  add: (props) => ({ ...props, [RUNS_KEY]: 1 }),
  Chip: RunsChip,
};
