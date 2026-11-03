/**
 * The values panel of a tween (spec 21, The values panel): the header, the timing fields (Start, Duration, Ease, Stagger), the
 * repeat line, and the values at the keyframe the person opened it from. Each field shows its owner: a literal is editable, a
 * parameter shows its chip and moves the parameter, a token shows its chip with Change and Detach, and anything the agent's code
 * sets is read-only with its reason. The panel only draws what it is given; the strip works out the fields.
 */
import { SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tip } from "../../chrome/ui.tsx";
import { EasePicker } from "./EasePicker.tsx";
import type { EaseChoice, EaseValue } from "./ease.ts";

/** A token chip's choices: the kit's tokens of the field's type, and what Detach writes. */
export interface PanelToken {
  /** The token's path, which the chip shows its last two segments of. */
  readonly name: string;
  /** The value the chip shows, in the artifact's mode. */
  readonly value: string;
  /** The tokens of the field's type. */
  readonly options: ReadonlyArray<{ readonly path: string; readonly value: string }>;
  readonly onChoose: (path: string) => void;
  readonly onDetach: () => void;
}

export type PanelControl =
  | { readonly kind: "number"; readonly value: number; readonly unit: string; readonly editable: boolean; readonly onCommit: (value: number) => void }
  | { readonly kind: "colour"; readonly value: string; readonly editable: boolean; readonly onCommit: (value: string) => void }
  | { readonly kind: "text"; readonly value: string };

export interface PanelField {
  readonly key: string;
  readonly label: string;
  readonly control: PanelControl;
  /** The parameter path that sets the value, which the chip names. */
  readonly parameter?: string;
  readonly token?: PanelToken;
  /** The sentence under the field: why it cannot be edited, or what it means. */
  readonly note?: string;
  /** Ask the agent to make the field editable (spec 18's point and tell). */
  readonly ask?: () => void;
}

export interface ValuesPanelProps {
  /** The element's name, and the group the bar is in (`Title · Visual`). */
  readonly title: string;
  readonly group: string | null;
  /** The method, in muted text. */
  readonly method: string;
  readonly fields: readonly PanelField[];
  readonly ease: { readonly label: string; readonly choices: readonly EaseChoice[]; readonly disabled: boolean } | null;
  readonly onEase: (value: EaseValue) => void;
  /** Repeats, as the panel says them, or null for a tween that does not repeat. */
  readonly repeat: string | null;
  /** The sentence for a diamond with no value of its own (a `to`'s start, a `from`'s end), or null. */
  readonly sentence: string | null;
  /** The reason a whole tween is read-only, or null. Shown under `Set by the agent's code.` */
  readonly readOnly: string | null;
  /** Ask the agent to make a read-only tween editable (spec 18's point and tell), or null when there is nothing to ask. */
  readonly ask: (() => void) | null;
  readonly onClose: () => void;
  /** The bar or keyframe the panel opened from: the popover sits beside it (spec 21, The values panel). */
  readonly anchor: () => Element | null;
  readonly className?: string;
}

const FORMAT = { useGrouping: false, maximumFractionDigits: 3 } as const;

/** A token's last two path segments, which is what a chip names (spec 19). */
const shortPath = (path: string): string => path.split("/").slice(-2).join("/");

const TokenChip = ({ token }: { readonly token: PanelToken }) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-0 justify-start" title={token.name} aria-label={`${shortPath(token.name)} token`} />}>
        <span className="truncate font-mono text-xs">{`${shortPath(token.name)} · ${token.value}`}</span>
      </PopoverTrigger>
      <PopoverPopup side="left" align="start" padding="compact" className="w-60" aria-label="Tokens" initialFocus={false}>
        <div className="flex flex-col gap-0.5">
          {token.options.map((option) => (
            <Button
              key={option.path}
              variant={option.path === token.name ? "secondary" : "ghost"}
              size="sm"
              className="justify-between"
              onClick={() => {
                setOpen(false);
                token.onChoose(option.path);
              }}
            >
              <span className="truncate">{option.path}</span>
              <span className="font-mono text-xs text-muted-foreground">{option.value}</span>
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              token.onDetach();
            }}
          >
            Detach
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
};

/** A field's control: a number with its unit, a colour as a swatch and a text field, or read-only text. */
const Control = ({ label, control }: { readonly label: string; readonly control: PanelControl }): ReactNode => {
  if (control.kind === "text") return <code className="max-w-40 truncate font-mono text-xs text-muted-foreground">{control.value}</code>;
  if (control.kind === "colour") return <ColourField label={label} value={control.value} editable={control.editable} onCommit={control.onCommit} />;
  return <NumberControl label={label} value={control.value} unit={control.unit} editable={control.editable} onCommit={control.onCommit} />;
};

/** A number field that applies on Enter or when it loses focus, and shows its unit after the number. */
const NumberControl = ({ label, value, unit, editable, onCommit }: { readonly label: string; readonly value: number; readonly unit: string; readonly editable: boolean; readonly onCommit: (value: number) => void }) => (
  <span className="flex items-center gap-1">
    <NumberField key={`${label}:${value}`} size="sm" className="w-24" defaultValue={value} format={FORMAT} disabled={!editable} onValueCommitted={(typed) => {
      if (typed !== null && Number.isFinite(typed) && typed !== value) onCommit(typed);
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
    {unit !== "" && <span className="text-xs text-muted-foreground">{unit}</span>}
  </span>
);

/** A colour as a swatch and a text field; Enter or leaving the field applies the typed colour. */
const ColourField = ({ label, value, editable, onCommit }: { readonly label: string; readonly value: string; readonly editable: boolean; readonly onCommit: (value: string) => void }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const typed = draft.trim();
    if (typed !== "" && typed !== value) onCommit(typed);
  };
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="size-3.5 shrink-0 rounded-sm border" style={{ background: value }} />
      <Input
        aria-label={label}
        value={draft}
        disabled={!editable}
        className="w-32"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </span>
  );
};

const FieldRow = ({ field }: { readonly field: PanelField }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
        {field.label}
        {field.parameter !== undefined && (
          <Tip label={`Parameter ${field.parameter}`}>
            <span role="img" aria-label={`Parameter ${field.parameter}`} className="inline-flex shrink-0">
              <SlidersHorizontal aria-hidden className="size-3" />
            </span>
          </Tip>
        )}
      </span>
      {field.token !== undefined ? <TokenChip token={field.token} /> : <Control label={field.label} control={field.control} />}
    </div>
    {field.note !== undefined && <p className="m-0 text-xs text-muted-foreground">{field.note}</p>}
    {field.ask !== undefined && (
      <Button variant="ghost" size="xs" className="justify-self-start" onClick={field.ask}>
        Ask the agent to make this editable
      </Button>
    )}
  </div>
);

export const ValuesPanel = ({ title, group, method, fields, ease, onEase, repeat, sentence, readOnly, ask, onClose, anchor, className }: ValuesPanelProps) => (
  // A non-modal popover: Esc and a press outside close it. It takes no focus when it opens, so the strip's keys keep working.
  <Popover open onOpenChange={(open) => !open && onClose()}>
    <PopoverPopup anchor={anchor} side="bottom" align="start" padding="none" initialFocus={false} finalFocus={false} className={`w-[280px] ${className ?? ""}`}>
  <section aria-label={`Values for ${title}`} data-testid="values-panel" className="p-3">
    <header className="mb-2 flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {group === null ? title : `${title} · ${group}`}
        <span className="ml-1 text-muted-foreground">{method}</span>
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Close values" onClick={onClose}>
        <X aria-hidden />
      </Button>
    </header>
    <div className="flex flex-col gap-2">
      {readOnly !== null && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-xs text-muted-foreground">Set by the agent&apos;s code.</p>
          <p className="m-0 text-xs text-muted-foreground">{readOnly}</p>
          {ask !== null && (
            <Button variant="ghost" size="xs" className="justify-self-start" onClick={ask}>
              Ask the agent to make this editable
            </Button>
          )}
        </div>
      )}
      {fields.map((field) => (
        <FieldRow key={field.key} field={field} />
      ))}
      {ease !== null && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Ease</span>
          <EasePicker label={ease.label} choices={ease.choices} disabled={ease.disabled} onChoose={onEase} />
        </div>
      )}
      {repeat !== null && <p className="m-0 text-xs text-muted-foreground">{repeat}</p>}
      {sentence !== null && <p className="m-0 text-xs text-muted-foreground">{sentence}</p>}
    </div>
  </section>
    </PopoverPopup>
  </Popover>
);
