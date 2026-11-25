import { customPreviewSide, DEFAULT_EDITOR_PREVIEW_SIZE, EDITOR_PREVIEW_SIZES, type EditorPreviewChoice, type EditorPreviewSize } from "@unframed/domain";
import { ChevronDown, Monitor, Proportions, Ruler, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { useReducer, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { RadioRow } from "../../agent/composer/pickers.tsx";

const remembered = new Map<string, EditorPreviewSize>();

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

const Side = ({ label, value, onCommit }: { readonly label: string; readonly value: number; readonly onCommit: (value: number) => void }) => {
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

export interface PreviewPreset {
  readonly name: string;
  readonly w: number;
  readonly h: number;
}

const presetOf = (size: EditorPreviewSize, presets: ReadonlyArray<PreviewPreset> | undefined): PreviewPreset | undefined =>
  presets?.find((preset) => size.choice === "custom" && preset.w === size.custom.width && preset.h === size.custom.height);

const labelOf = (size: EditorPreviewSize, preset: PreviewPreset | undefined): string =>
  preset !== undefined
    ? `${preset.name} ${preset.w}`
    : size.choice === "custom"
      ? `${size.custom.width} × ${size.custom.height}`
      : (EDITOR_PREVIEW_SIZES.find((each) => each.choice === size.choice)?.label ?? "Fill");

export const PreviewSizeControl = ({ size, onChange, scale, presets }: { readonly size: EditorPreviewSize; readonly onChange: (next: EditorPreviewSize) => void; readonly scale: number; readonly presets?: ReadonlyArray<PreviewPreset> | undefined }) => {
  const [open, setOpen] = useState(false);
  const width = useRef<HTMLDivElement>(null);
  const preset = presetOf(size, presets);
  const Icon = preset !== undefined ? Monitor : ICONS[size.choice];
  const rows: ReadonlyArray<{ readonly key: string; readonly label: string; readonly checked: boolean; readonly pick: () => void }> =
    presets === undefined
      ? EDITOR_PREVIEW_SIZES.map((each) => ({
          key: each.choice,
          label: each.label,
          checked: size.choice === each.choice,
          pick: () => {
            onChange({ ...size, choice: each.choice });
            if (each.choice === "custom") width.current?.querySelector("input")?.focus();
            else setOpen(false);
          },
        }))
      : [
          ...presets.map((each) => ({
            key: each.name,
            label: `${each.name} ${each.w}`,
            checked: preset === each,
            pick: () => {
              onChange({ choice: "custom", custom: { width: each.w, height: each.h } });
              setOpen(false);
            },
          })),
          { key: "custom", label: "Custom", checked: preset === undefined, pick: () => width.current?.querySelector("input")?.focus() },
        ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-0 shrink-0" />} aria-label="Preview size" data-testid="preview-size">
        <Icon aria-hidden />
        <span className="@max-[760px]/editor-header:sr-only">{labelOf(size, preset)}</span>
        {scale < 1 && (
          <span data-testid="artifact-preview-scale" className="text-(--artifact-editor-meta) tabular-nums @max-[760px]/editor-header:sr-only">
            {`${Math.round(scale * 100)}%`}
          </span>
        )}
        <ChevronDown aria-hidden className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" sideOffset={6} padding="compact" className="w-(--artifact-editor-preview-size-width)" aria-label="Preview size" initialFocus={false}>
        <div role="radiogroup" aria-label="Preview size" className="flex flex-col gap-px">
          {rows.map((row) => (
            <RadioRow key={row.key} checked={row.checked} label={row.label} onSelect={row.pick} />
          ))}
        </div>
        <div ref={width} className="mt-1 flex items-center gap-1.5 border-t px-2 pt-2 pb-1">
          <span className="flex-1 text-xs text-(--artifact-editor-meta)">Size</span>
          <Side label="Preview width" value={size.custom.width} onCommit={(next) => onChange({ choice: "custom", custom: { ...size.custom, width: next } })} />
          <span aria-hidden className="shrink-0 text-xs text-(--artifact-editor-meta)">
            ×
          </span>
          <Side label="Preview height" value={size.custom.height} onCommit={(next) => onChange({ choice: "custom", custom: { ...size.custom, height: next } })} />
        </div>
      </PopoverPopup>
    </Popover>
  );
};
