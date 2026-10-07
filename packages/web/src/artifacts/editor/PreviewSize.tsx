/**
 * The editor's preview size (spec 09): Fill, three named sizes or a typed one, chosen in the
 * centre header and remembered per artifact for the session only, never on the shape.
 */
import { customPreviewSide, DEFAULT_EDITOR_PREVIEW_SIZE, EDITOR_PREVIEW_SIZES, type EditorPreviewChoice, type EditorPreviewSize } from "@unframed/domain";
import { useReducer } from "react";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";

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

const ITEMS = EDITOR_PREVIEW_SIZES.map((size) => ({ value: size.choice, label: size.label }));

/** One side of the typed size: applied when the field is left or Enter is pressed. */
const Side = ({ label, value, onCommit }: { readonly label: string; readonly value: number; readonly onCommit: (value: number) => void }) => (
  <NumberField key={value} size="sm" className="w-auto shrink-0" defaultValue={value} format={{ useGrouping: false }} onValueCommitted={(typed) => onCommit(customPreviewSide(typed, value))}>
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

export const PreviewSizeControl = ({ size, onChange, scale }: { readonly size: EditorPreviewSize; readonly onChange: (next: EditorPreviewSize) => void; readonly scale: number }) => (
  <>
    {scale < 1 && (
      <span data-testid="artifact-preview-scale" className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {`${Math.round(scale * 100)}%`}
      </span>
    )}
    <Select items={ITEMS} value={size.choice} onValueChange={(value) => value && onChange({ ...size, choice: value as EditorPreviewChoice })}>
      <SelectTrigger size="sm" aria-label="Preview size" className="w-auto min-w-0 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
    {size.choice === "custom" && (
      <>
        <Side label="Preview width" value={size.custom.width} onCommit={(width) => onChange({ ...size, custom: { ...size.custom, width } })} />
        <span aria-hidden className="shrink-0 text-xs text-muted-foreground">
          ×
        </span>
        <Side label="Preview height" value={size.custom.height} onCommit={(height) => onChange({ ...size, custom: { ...size.custom, height } })} />
      </>
    )}
  </>
);
