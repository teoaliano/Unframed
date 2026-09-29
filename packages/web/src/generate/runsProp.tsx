/**
 * The Runs prop (spec 05), image medium only: a count up to the domain's `RUNS_CAP` fires that many
 * generations as one batch; Free takes the count from a list in the selection. It is not a
 * model trait, so a model change leaves it. Its values live in the tray's props as `runs`
 * and `viewFinalPrompt`, which is also how last-used values store them.
 */
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { clampRuns, readRunsValue, runsDraft, type RunsValue } from "@unframed/domain";
import { useRef, useState } from "react";
import { itemClass, popupClass } from "../chrome/ui.tsx";
import { chipClass } from "./composer/PropTray.tsx";
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
  // What was typed, kept while the field has focus; the clamped value shows on blur.
  const [draft, setDraft] = useState<string>();
  const field = useRef<HTMLInputElement>(null);
  const free = useRef<HTMLButtonElement>(null);
  const set = (next: Record<string, PropValue>) => onChange({ ...props, ...next });
  const fixed = () => {
    if (runs === "free") set({ [RUNS_KEY]: clampRuns(draft ?? "") });
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger className={chipClass} data-prop={RUNS_KEY} aria-label={`Runs ${chipText(runs)}`}>
        {chipText(runs)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6} className="z-[1250]">
          <Popover.Popup
            className={`${popupClass} w-[200px]`}
            aria-label="Runs"
            initialFocus={() => (runs === "free" ? free.current : field.current)}
            onKeyDown={(event) => {
              // The composer keeps its keys from tldraw, so this popup closes itself on Esc.
              if (event.key !== "Escape") return;
              event.preventDefault();
              onOpenChange(false);
            }}
          >
            <label className={`${itemClass} justify-between`}>
              <span>Runs</span>
              <input
                ref={field}
                aria-label="Number of runs"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1"
                className="h-6 w-12 rounded-md border border-input bg-card px-1.5 text-right text-[13px] text-foreground outline-none focus:border-primary"
                value={draft ?? (runs === "free" ? "" : String(runs))}
                onFocus={fixed}
                onPointerDown={fixed}
                onChange={(event) => {
                  const typed = runsDraft(event.target.value);
                  setDraft(typed);
                  set({ [RUNS_KEY]: clampRuns(typed) });
                }}
                onBlur={() => setDraft(undefined)}
              />
            </label>
            <Tooltip.Root>
              <Tooltip.Trigger
                render={
                  <button
                    ref={free}
                    type="button"
                    aria-pressed={runs === "free"}
                    className={`${itemClass} w-full border-0 bg-transparent text-left text-foreground aria-pressed:font-semibold`}
                    onClick={() => {
                      setDraft(undefined);
                      set({ [RUNS_KEY]: "free" });
                    }}
                  />
                }
              >
                Free
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner side="right" sideOffset={8} className="z-[1260]">
                  <Tooltip.Popup className="max-w-[280px] rounded-md bg-primary px-2 py-1 text-[12px] leading-snug text-primary-foreground shadow-lg">{FREE_TOOLTIP}</Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
            {runs === "free" && (
              <label className={itemClass}>
                <input type="checkbox" checked={viewsFinalPrompt(props)} onChange={(event) => set({ [VIEW_FINAL_PROMPT_KEY]: event.target.checked })} />
                View final prompt
              </label>
            )}
            <div className="my-1 h-px bg-[var(--unframed-border)]" role="separator" />
            <button
              type="button"
              className={`${itemClass} w-full border-0 bg-transparent text-left text-foreground`}
              onClick={() => {
                const { [RUNS_KEY]: _runs, ...rest } = props;
                onChange(rest);
                onOpenChange(false);
              }}
            >
              Remove
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
