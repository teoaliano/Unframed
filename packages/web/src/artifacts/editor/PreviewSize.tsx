/**
 * The editor's preview size (spec 09): Fill, three named sizes or a typed one, chosen in a
 * popover from the centre header and remembered per artifact for the session only, never on
 * the shape.
 */
import { customPreviewSide, DEFAULT_EDITOR_PREVIEW_SIZE, EDITOR_PREVIEW_SIZES, type EditorPreviewChoice, type EditorPreviewSize } from "@unframed/domain";
import { ChevronDown, Monitor, Proportions, Ruler, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { useReducer, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { RadioRow } from "../../agent/composer/pickers.tsx";

const remembered = new Map<string, EditorPreviewSize>();

/** The size chosen for this artifact in this session, and how to change it. */
export const usePreviewSize = (project: string, shapeId: string): readonly [EditorPreviewSize, (next: EditorPreviewSize) => void] => {
  const [, changed] = useReducer((count: number) => count + 1, 0);
  const key = `${project}\n${shapeId}`;
  const set = (next: EditorPreviewSize) => {
    remembered.set(key, next);
    changed();
  };
  return [remembered.get(key) ?? DEFAULT_EDITOR_PREVIEW_SIZE, set] as const;
};

const ICONS: Readonly<Record<EditorPreviewChoice, LucideIcon>> = { fill: Proportions, desktop: Monitor, tablet: Tablet, mobile: Smartphone, custom: Ruler };

/** One side of the typed size: applied when the field is left or Enter is pressed; an empty or refused entry shows the side in use again. */
const Side = ({ label, value, onCommit }: { readonly label: string; readonly value: number; readonly onCommit: (value: number) => void }) => {
  // Remounting the field is what puts the side in use back into it after an entry that changed nothing.
  const [round, setRound] = useState(0);
  return (
    <NumberField
      key={`${value}-${round}`}
      size="sm"
      className="w-auto shrink-0"
      defaultValue={value}
      format={{ useGrouping: false }}
      onValueCommitted={(typed) => {
        setRound((count) => count + 1);
        onCommit(customPreviewSide(typed, value));
      }}
    >
      <NumberFieldGroup className="w-16">
        <NumberFieldInput
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </NumberFieldGroup>
    </NumberField>
  );
};

/** What the trigger names: the choice, or the typed size. */
const labelOf = (size: EditorPreviewSize): string =>
  size.choice === "custom" ? `${size.custom.width} × ${size.custom.height}` : (EDITOR_PREVIEW_SIZES.find((each) => each.choice === size.choice)?.label ?? "Fill");

export const PreviewSizeControl = ({ size, onChange, scale }: { readonly size: EditorPreviewSize; readonly onChange: (next: EditorPreviewSize) => void; readonly scale: number }) => {
  const [open, setOpen] = useState(false);
  const width = useRef<HTMLDivElement>(null);
  const Icon = ICONS[size.choice];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-0 shrink-0" />} aria-label="Preview size" data-testid="preview-size">
        <Icon aria-hidden />
        {/* A narrow header keeps the icon; the label and scale leave the screen, not the accessible tree. */}
        <span className="@max-[520px]/editor-header:sr-only">{labelOf(size)}</span>
        {scale < 1 && (
          <span data-testid="artifact-preview-scale" className="text-muted-foreground tabular-nums @max-[520px]/editor-header:sr-only">
            {`${Math.round(scale * 100)}%`}
          </span>
        )}
        <ChevronDown aria-hidden className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" sideOffset={6} padding="compact" className="w-[248px]" aria-label="Preview size" initialFocus={false}>
        <div role="radiogroup" aria-label="Preview size" className="flex flex-col gap-px">
          {EDITOR_PREVIEW_SIZES.map((each) => (
            <RadioRow
              key={each.choice}
              checked={size.choice === each.choice}
              label={each.label}
              onSelect={() => {
                onChange({ ...size, choice: each.choice });
                if (each.choice === "custom") width.current?.querySelector("input")?.focus();
                else setOpen(false);
              }}
            />
          ))}
        </div>
        {/* The typed size lives here, not in the header, so a narrow header never overflows. Typing one chooses Custom. */}
        <div ref={width} className="mt-1 flex items-center gap-1.5 border-t px-2 pt-2 pb-1">
          <span className="flex-1 text-xs text-muted-foreground">Size</span>
          <Side label="Preview width" value={size.custom.width} onCommit={(next) => onChange({ choice: "custom", custom: { ...size.custom, width: next } })} />
          <span aria-hidden className="shrink-0 text-xs text-muted-foreground">
            ×
          </span>
          <Side label="Preview height" value={size.custom.height} onCommit={(next) => onChange({ choice: "custom", custom: { ...size.custom, height: next } })} />
        </div>
      </PopoverPopup>
    </Popover>
  );
};
