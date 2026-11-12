import { AlignCenter, AlignJustify, AlignLeft, AlignRight, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Autocomplete, AutocompleteInput, AutocompleteItem, AutocompleteList, AutocompletePopup } from "~/components/ui/autocomplete";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tip } from "../chrome/ui.tsx";

export const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
export const ALIGNS = [
  { value: "left", label: "Left", Icon: AlignLeft },
  { value: "center", label: "Center", Icon: AlignCenter },
  { value: "right", label: "Right", Icon: AlignRight },
  { value: "justify", label: "Justify", Icon: AlignJustify },
] as const;
export const BORDER_STYLES = ["none", "solid", "dashed", "dotted"];
export const GENERIC_FAMILIES = ["system-ui", "serif", "monospace"];
export const MIXED = "Mixed";
export const hexOf = (value: string | undefined): string => {
  const match = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (match === null) return "#000000";
  const [r = 0, g = 0, b = 0, a = 1] = match[1]!.split(/[\s,/]+/).filter((part) => part !== "").map(Number);
  const pair = (channel: number) => Math.round(channel).toString(16).padStart(2, "0");
  return `#${pair(r)}${pair(g)}${pair(b)}${a < 1 ? pair(a * 255) : ""}`;
};

export const numberOf = (value: string | undefined): string => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? String(Math.round(parsed * 100) / 100) : "";
};
export const noteText = (text: string) => <p className="m-0 text-xs text-(--design-panel-note)">{text}</p>;
export const ParameterMark = ({ path }: { readonly path: string }) => (
  <Tip label={`Parameter ${path}`}>
    <span role="img" aria-label={`Parameter ${path}`} className="inline-flex shrink-0 text-(--design-panel-icon)">
      <SlidersHorizontal aria-hidden className="size-3.5" />
    </span>
  </Tip>
);

export const NumberControl = ({
  label,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string | undefined;
  readonly disabled: boolean;
  readonly onCommit: (typed: number) => void;
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const typed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(typed) || draft === value) return;
    onCommit(typed);
  };
  return (
    <Input
      aria-label={label}
      type="number"
      step={1}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const base = Number(draft === "" ? value : draft);
        if (!Number.isFinite(base)) return;
        const next = base + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1);
        setDraft(String(next));
        onCommit(next);
      }}
    />
  );
};

export const FontControl = ({
  value,
  disabled,
  families,
  generics = GENERIC_FAMILIES,
  placeholder,
  onCommit,
}: {
  readonly value: string;
  readonly disabled: boolean;
  readonly families: readonly string[];
  readonly generics?: readonly string[];
  readonly placeholder?: string | undefined;
  readonly onCommit: (typed: string) => boolean;
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (typed: string) => {
    const next = typed.trim();
    if (next === "" || next === value) return;
    if (!onCommit(next)) setDraft(value);
  };
  const items = [...new Set([...families, ...generics])];
  return (
    <Autocomplete
      items={items}
      value={draft}
      onValueChange={(next, details) => {
        setDraft(next);
        if (details.reason === "item-press") commit(next);
      }}
    >
      <AutocompleteInput
        aria-label="Font"
        disabled={disabled}
        placeholder={placeholder}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(draft);
        }}
      />
      <AutocompletePopup>
        <AutocompleteList>{(item: string) => <AutocompleteItem key={item} value={item}>{item}</AutocompleteItem>}</AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
};

export const KeywordControl = ({
  label,
  value,
  mixed,
  options,
  disabled,
  onPick,
}: {
  readonly label: string;
  readonly value: string;
  readonly mixed: boolean;
  readonly options: readonly string[];
  readonly disabled: boolean;
  readonly onPick: (next: string) => void;
}) => (
  <Select value={mixed ? null : value} disabled={disabled} onValueChange={(next) => next && onPick(String(next))}>
    <SelectTrigger aria-label={label}>
      <SelectValue>{mixed ? MIXED : value}</SelectValue>
    </SelectTrigger>
    <SelectPopup alignItemWithTrigger={false}>
      {options.map((option) => (
        <SelectItem key={option} value={option}>
          {option}
        </SelectItem>
      ))}
    </SelectPopup>
  </Select>
);

export const Swatch = ({ colour }: { readonly colour: string | undefined }) => <span aria-hidden className="size-3.5 shrink-0 rounded-sm border border-(--design-panel-swatch-border)" style={{ background: colour }} />;

export const ColourControl = ({
  label,
  hex,
  mixed,
  disabled,
  empty,
  onCommit,
}: {
  readonly label: string;
  readonly hex: string;
  readonly mixed: boolean;
  readonly disabled: boolean;
  readonly empty?: string | undefined;
  readonly onCommit: (next: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(hex);
  useEffect(() => setDraft(hex), [hex]);
  const commit = (typed: string) => {
    const trimmed = typed.trim();
    if (trimmed === "") return;
    const next = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (next !== hex) onCommit(next);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-0 justify-start" aria-label={label} disabled={disabled} />}>
        <span className="flex min-w-0 items-center gap-2">
          <Swatch colour={mixed || hex === "" ? undefined : hex} />
          <span className="truncate font-mono text-xs">{mixed ? MIXED : hex === "" ? (empty ?? "") : hex}</span>
        </span>
      </PopoverTrigger>
      <PopoverPopup side="left" align="start" padding="compact" className="w-60" aria-label={`${label} colour`} initialFocus={false}>
        <div className="flex items-center gap-2">
          <Input
            type="color"
            aria-label={`${label} picker`}
            className="w-12 shrink-0"
            value={mixed || hex === "" ? "#000000" : hex.slice(0, 7)}
            onChange={(event) => onCommit(event.currentTarget.value)}
          />
          <Input
            aria-label="Hex"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(draft);
            }}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
};

export const Caption = ({ children }: { readonly children: ReactNode }) => <span className="mb-0.5 block text-xs text-(--design-panel-label)">{children}</span>;

export const Row = ({ label, mark, token, children }: { readonly label: string; readonly mark?: string | undefined; readonly token?: ReactNode; readonly children: ReactNode }) => (
  <div className="grid grid-cols-[var(--design-panel-label-width)_minmax(0,1fr)] items-center gap-2">
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-(--design-panel-label)">
      <span className="truncate">{label}</span>
      {mark !== undefined && <ParameterMark path={mark} />}
    </span>
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <div className="min-w-28 flex-1">{children}</div>
      {token}
    </div>
  </div>
);

export const Section = ({ name, note, action, children }: { readonly name: string; readonly note: ReactNode; readonly action?: ReactNode; readonly children: ReactNode }) => (
  <fieldset aria-label={name} className="m-0 flex flex-col gap-2 border-0 p-0">
    <legend className="mb-1 flex min-w-0 items-center gap-1 text-xs font-medium text-(--design-panel-label)">
      {name}
      {action}
    </legend>
    {children}
    {note}
  </fieldset>
);
