/**
 * The editor's Design tab (spec 18, The Design tab): the selected elements' fields in sections. A
 * field shows the computed value and writes through the owner rule: a source value becomes a source
 * edit in the burst, and a read-only value says why. With several elements selected a value they
 * share shows, a value they differ on shows Mixed, and an edit reaches each of them.
 */
import { dialAt, DESIGN_FIELDS, fieldOwner, styleValueRefusal, type FieldOwner } from "@unframed/domain";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Link, SlidersHorizontal, Unlink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Autocomplete, AutocompleteInput, AutocompleteItem, AutocompleteList, AutocompletePopup } from "~/components/ui/autocomplete";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tip } from "../../chrome/ui.tsx";
import { showError } from "../../toasts.tsx";
import { previewUrl } from "../../canvas/assetStore.ts";
import { chainOf } from "./EditPanels.tsx";
import { ImagePicker } from "./ImagePicker.tsx";
import type { EditReport, EditSession } from "./editSession.ts";

const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
const ALIGNS = [
  { value: "left", label: "Left", Icon: AlignLeft },
  { value: "center", label: "Center", Icon: AlignCenter },
  { value: "right", label: "Right", Icon: AlignRight },
  { value: "justify", label: "Justify", Icon: AlignJustify },
] as const;
const BORDER_STYLES = ["none", "solid", "dashed", "dotted"];
const DIRECTIONS = ["row", "column", "row-reverse", "column-reverse"];
const ALIGN_ITEMS = ["flex-start", "center", "flex-end", "stretch", "baseline"];
const JUSTIFY = ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"];
const WRAPS = ["nowrap", "wrap"];
/** The generic families the Font field always offers, after the document's own. */
const GENERIC_FAMILIES = ["system-ui", "serif", "monospace"];
const FLEX_DISPLAYS = ["flex", "inline-flex"];
const GAP_DISPLAYS = ["flex", "inline-flex", "grid", "inline-grid"];
const SIDES = ["top", "right", "bottom", "left"] as const;
const MIXED = "Mixed";
const LOCKED = "Locked. Unlock it in Layers to edit it.";
const OVERRIDDEN = "A stylesheet rule wins over this value.";
const SEVERAL_SHADOWS = "Several shadows. Ask the agent to change them.";

/** A computed colour as `#rrggbb`, with two more digits below full opacity. */
export const hexOf = (value: string | undefined): string => {
  const match = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (match === null) return "#000000";
  const [r = 0, g = 0, b = 0, a = 1] = match[1]!.split(/[\s,/]+/).filter((part) => part !== "").map(Number);
  const pair = (channel: number) => Math.round(channel).toString(16).padStart(2, "0");
  return `#${pair(r)}${pair(g)}${pair(b)}${a < 1 ? pair(a * 255) : ""}`;
};

/** The number a computed length shows, without its unit; empty when it has none (`normal`). */
const numberOf = (value: string | undefined): string => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? String(Math.round(parsed * 100) / 100) : "";
};

/**
 * The value a typed number writes: a unitless line height stays unitless when the source set it so;
 * otherwise the unit the inline value already uses (px, em, rem or %), and px when it has none.
 */
export const numberValue = (property: string, typed: number, inline: string | null | undefined): string => {
  const written = (inline ?? "").trim();
  if (property === "line-height" && /^\d*\.?\d+$/.test(written)) return String(typed);
  const unit = /(px|em|rem|%)$/.exec(written)?.[1] ?? "px";
  return `${typed}${unit}`;
};

/** The first family of a computed font stack, unquoted. */
const firstFamily = (value: string): string => value.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";

/** One shadow: its offsets, blur and spread as numbers in px, and its colour as hex. A value with several shadows reads its first. */
export interface Shadow {
  readonly x: string;
  readonly y: string;
  readonly blur: string;
  readonly spread: string;
  readonly colour: string;
  readonly several: boolean;
}

const SHADOW_PARTS = ["x", "y", "blur", "spread", "colour"] as const;
type ShadowPart = (typeof SHADOW_PARTS)[number];

/** Reads a computed `box-shadow`: the first shadow's lengths and colour, and whether a second one follows it. */
export const shadowOf = (computed: string | undefined): Shadow => {
  const text = computed ?? "";
  let depth = 0;
  let commas = 0;
  for (const character of text) {
    if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (character === "," && depth === 0) commas++;
  }
  const lengths = Array.from(text.matchAll(/(-?\d*\.?\d+)px/g), (match) => numberOf(match[0]));
  const colour = /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/.exec(text)?.[0];
  return {
    x: lengths[0] ?? "0",
    y: lengths[1] ?? "0",
    blur: lengths[2] ?? "0",
    spread: lengths[3] ?? "0",
    colour: colour === undefined ? "#000000" : hexOf(colour),
    several: commas > 0,
  };
};

/** The shadow's value with one part replaced: lengths in px, the colour as written. */
const shadowWith = (shadow: Shadow, part: ShadowPart, value: string): string => {
  const next = { x: shadow.x, y: shadow.y, blur: shadow.blur, spread: shadow.spread, colour: shadow.colour, [part]: value };
  return `${next.x}px ${next.y}px ${next.blur}px ${next.spread}px ${next.colour}`;
};

/** The value a field shows: the one the selection shares, or Mixed, with the owner that blocks an edit. */
interface View {
  readonly value: string;
  readonly mixed: boolean;
  readonly owner: FieldOwner;
  readonly editable: boolean;
}

/** The parameter a view's field is driven by, when it is editable as a dial. */
const dialPathOf = (view: View): string | undefined => (view.owner.owner === "dial" && view.editable ? view.owner.path : undefined);

interface Subject {
  readonly id: string;
  readonly report: EditReport;
  /** The element in the source, or undefined for a runtime element. */
  readonly element: { readonly style: Record<string, string>; readonly text: string | null; readonly src?: string | undefined; readonly hidden: boolean } | undefined;
  readonly locked: boolean;
}

const noteText = (text: string) => <p className="m-0 text-xs text-muted-foreground">{text}</p>;

/**
 * The line a read-only owner shows under its section, or null when the value is the source's own or locked (the tab says that once).
 * A dial's value is editable with one element selected, so it shows no line then; with several it names its parameter.
 */
const ownerLine = (owner: FieldOwner, single: boolean): ReactNode => {
  if (owner.owner === "source" || owner.owner === "locked") return null;
  if (owner.owner === "script") {
    return (
      <>
        {noteText("Set by the agent's code.")}
        {/* Asking the agent to make it editable fills the composer's draft (spec 18 task 41); until that exists the button waits. */}
        <Button variant="ghost" size="xs" className="justify-self-start" disabled>
          Ask the agent to make this editable
        </Button>
      </>
    );
  }
  if (owner.owner === "animated") return noteText("Animated by the agent's code.");
  if (owner.owner !== "dial" || single) return null;
  return noteText(`Set by parameter ${owner.path}.`);
};

/** The parameter mark a dial-owned field carries, its tooltip naming the parameter. */
const ParameterMark = ({ path }: { readonly path: string }) => (
  <Tip label={`Parameter ${path}`}>
    <span role="img" aria-label={`Parameter ${path}`} className="inline-flex shrink-0 text-muted-foreground">
      <SlidersHorizontal aria-hidden className="size-3.5" />
    </span>
  </Tip>
);

const NumberControl = ({
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
        // Arrow keys step by 1, Shift by 10, and each step is applied at once.
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

const FontControl = ({ value, disabled, families, onCommit }: { readonly value: string; readonly disabled: boolean; readonly families: readonly string[]; readonly onCommit: (typed: string) => void }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (typed: string) => {
    const next = typed.trim();
    if (next === "" || next === value) return;
    onCommit(next);
  };
  const items = [...new Set([...families, ...GENERIC_FAMILIES])];
  return (
    <Autocomplete
      items={items}
      value={draft}
      onValueChange={(next, details) => {
        setDraft(next);
        // Picking a family from the list applies it at once; typing waits for Enter or leaving the field.
        if (details.reason === "item-press") commit(next);
      }}
    >
      <AutocompleteInput
        aria-label="Font"
        disabled={disabled}
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

const KeywordControl = ({
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

/** A colour as a swatch that opens a popover with the browser's colour input and a hex field. */
const ColourControl = ({ label, hex, mixed, disabled, onCommit }: { readonly label: string; readonly hex: string; readonly mixed: boolean; readonly disabled: boolean; readonly onCommit: (next: string) => void }) => {
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
          <span aria-hidden className="size-3.5 shrink-0 rounded-sm border" style={{ background: mixed ? undefined : hex }} />
          <span className="truncate font-mono text-xs">{mixed ? MIXED : hex}</span>
        </span>
      </PopoverTrigger>
      <PopoverPopup side="left" align="start" padding="compact" className="w-60" aria-label={`${label} colour`} initialFocus={false}>
        <div className="flex items-center gap-2">
          <Input
            type="color"
            aria-label={`${label} picker`}
            className="w-12 shrink-0"
            value={mixed ? "#000000" : hex.slice(0, 7)}
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

const Row = ({ label, mark, children }: { readonly label: string; readonly mark?: string | undefined; readonly children: ReactNode }) => (
  <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2">
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <span className="truncate">{label}</span>
      {mark !== undefined && <ParameterMark path={mark} />}
    </span>
    <div className="min-w-0">{children}</div>
  </div>
);

const Section = ({ name, note, children }: { readonly name: string; readonly note: ReactNode; readonly children: ReactNode }) => (
  <fieldset aria-label={name} className="m-0 flex flex-col gap-2 border-0 p-0">
    <legend className="mb-1 text-xs font-medium text-muted-foreground">{name}</legend>
    {children}
    {note}
  </fieldset>
);

/** Four sides of one spacing property (padding or margin), with a link toggle that sets all four at once. */
const SidesRow = ({
  label,
  prefix,
  views,
  onWrite,
}: {
  readonly label: string;
  readonly prefix: "padding" | "margin";
  readonly views: Record<(typeof SIDES)[number], View>;
  readonly onWrite: (property: string, typed: number) => void;
}) => {
  const [linked, setLinked] = useState(false);
  return (
    <Row label={label}>
      <div className="flex min-w-0 items-center gap-1.5">
        <div role="group" aria-label={label} className="grid min-w-0 flex-1 grid-cols-4 gap-1">
          {SIDES.map((side) => {
            const view = views[side];
            return (
              <NumberControl
                key={side}
                label={`${label} ${side}`}
                value={view.mixed ? "" : numberOf(view.value)}
                placeholder={view.mixed ? MIXED : undefined}
                disabled={!view.editable}
                onCommit={(typed) => {
                  if (linked) for (const other of SIDES) onWrite(`${prefix}-${other}`, typed);
                  else onWrite(`${prefix}-${side}`, typed);
                }}
              />
            );
          })}
        </div>
        <Toggle aria-label={`Link ${label.toLowerCase()}`} pressed={linked} onPressedChange={setLinked} size="sm">
          {linked ? <Link aria-hidden /> : <Unlink aria-hidden />}
        </Toggle>
      </div>
    </Row>
  );
};

/** The picture an element shows: an img's file, or the one url() of its background image; null when it shows none. */
const pictureOf = (report: EditReport): { readonly target: "src" | "background"; readonly file: string } | null => {
  if (report.tag === "img") return { target: "src", file: report.src ?? "" };
  const match = /^url\(\s*["']?([^"')]*)["']?\s*\)$/.exec(report.computed["background-image"] ?? "");
  return match === null ? null : { target: "background", file: match[1] ?? "" };
};

/** The bare project file name a picture's URL ends in: a computed background is an absolute URL. */
const fileNameOf = (url: string): string => {
  const last = url.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last.split("?")[0] ?? "");
  } catch {
    return last;
  }
};

export interface DesignTabProps {
  readonly session: EditSession;
  readonly kind: "page" | "motion";
  readonly project: string;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly locked: readonly string[];
}

/** The value a dial takes for a CSS value written to its field: a number dial takes the number, anything else the text. */
const dialValueFor = (current: unknown, css: string): unknown => {
  if (typeof current !== "number") return css;
  const parsed = Number.parseFloat(css);
  return Number.isFinite(parsed) ? parsed : current;
};

/** The computed value of a property normalised by the browser, so two spellings of one value compare equal. */
const normaliserFor = (property: string) => (value: string) => {
  const probe = document.createElement("i");
  probe.style.setProperty(property, value);
  return probe.style.getPropertyValue(property);
};

export const DesignTab = ({ session, kind, project, dials, locked }: DesignTabProps) => {
  const { selection, reports, tree, preparing, prepareError, pending, families, overridden } = session;
  if (preparing) return <p className="m-0 p-2.5 text-sm text-muted-foreground">{`Getting this ${kind} ready for editing…`}</p>;
  if (prepareError !== undefined) return <p className="m-0 p-2.5 text-sm text-destructive-foreground">{prepareError}</p>;
  if (selection.length === 0) {
    return (
      <div className="flex flex-col gap-1 p-2.5 text-sm text-muted-foreground" data-testid="design-empty">
        <p className="m-0">Select an element to edit it.</p>
        {session.mode === "interact" && <p className="m-0">{`Switch to Edit (V) to select in the ${kind}.`}</p>}
      </div>
    );
  }
  if (selection.some((id) => reports[id] === undefined)) return <p className="m-0 p-2.5 text-sm text-muted-foreground">Reading the element…</p>;

  const elements = tree?.elements ?? [];
  const subjects: Subject[] = selection.map((id) => {
    const element = elements.find((candidate) => candidate.id === id);
    return {
      id,
      report: reports[id]!,
      element: element === undefined ? undefined : { style: element.style, text: element.text, src: element.src, hidden: element.hidden },
      locked: chainOf(elements, id).some((ancestor) => locked.includes(ancestor)),
    };
  });
  const [first] = subjects;
  const single = subjects.length === 1;
  const anyLocked = subjects.some((subject) => subject.locked);
  const name = single ? (elements.find((candidate) => candidate.id === first!.id)?.name ?? first!.report.tag) : `${subjects.length} elements`;

  /** Who holds a style value of one element. An edit still in the burst is the person's own, so the owner stays the source until it is written. */
  const ownerOf = (subject: Subject, property: string): FieldOwner => {
    if (pending.some((edit) => edit.type === "style" && edit.elementId === subject.id && edit.property === property)) return { owner: "source" };
    return fieldOwner({
      field: { kind: "style", property },
      source: subject.element === undefined ? null : { inline: subject.element.style, text: subject.element.text, src: subject.element.src ?? null },
      live: { inline: subject.report.inline, text: subject.report.text, src: subject.report.src, animated: subject.report.animated },
      dials: dials ?? {},
      locked: subject.locked,
      normalise: normaliserFor(property),
    });
  };

  /** The field's value across the selection: the shared one, or Mixed; the owner that blocks an edit, if any. */
  const viewOf = (property: string, pick: (subject: Subject) => string = (subject) => subject.report.computed[property] ?? ""): View => {
    const owners = subjects.map((subject) => ownerOf(subject, property));
    const values = subjects.map(pick);
    const mixed = values.some((value) => value !== values[0]);
    const owner = owners.find((candidate) => candidate.owner !== "source") ?? { owner: "source" as const };
    // A dial's value moves its parameter, so it is editable with one element only.
    return { value: mixed ? "" : (values[0] ?? ""), mixed, owner, editable: owner.owner === "source" || (owner.owner === "dial" && single) };
  };

  /** Writes a value to a property of every selected element, refusing the whole write when one value cannot be written. A dial-owned value moves its dial. */
  const write = (property: string, valueOf: (subject: Subject) => string) => {
    const writes = subjects.map((subject) => ({ subject, value: valueOf(subject) }));
    for (const { value } of writes) {
      const refusal = styleValueRefusal(property, value);
      if (refusal !== null) {
        showError(refusal);
        return;
      }
    }
    for (const { subject, value } of writes) {
      const owner = ownerOf(subject, property);
      if (owner.owner === "dial") session.patchDial(owner.path, dialValueFor(dialAt(dials ?? {}, owner.path), value));
      else session.patch({ type: "style", elementId: subject.id, property, value });
    }
  };

  const numberField = (label: string, property: string, options: { readonly format?: (value: string) => string; readonly write?: (typed: number, subject: Subject) => string } = {}) => {
    const view = viewOf(property);
    return (
      <Row label={label} mark={dialPathOf(view)}>
        <NumberControl
          label={label}
          value={view.mixed ? "" : (options.format ?? numberOf)(view.value)}
          placeholder={view.mixed ? MIXED : undefined}
          disabled={!view.editable}
          onCommit={(typed) => write(property, (subject) => (options.write ?? ((value, s) => numberValue(property, value, s.report.inline[property])))(typed, subject))}
        />
      </Row>
    );
  };

  const keywordField = (label: string, property: string, options: readonly string[]) => {
    const view = viewOf(property);
    return (
      <Row label={label} mark={dialPathOf(view)}>
        <KeywordControl label={label} value={view.value} mixed={view.mixed} options={options} disabled={!view.editable} onPick={(next) => write(property, () => next)} />
      </Row>
    );
  };

  const colourField = (label: string, property: string) => {
    const view = viewOf(property, (subject) => hexOf(subject.report.computed[property]));
    return (
      <Row label={label} mark={dialPathOf(view)}>
        <ColourControl label={label} hex={view.value} mixed={view.mixed} disabled={!view.editable} onCommit={(next) => write(property, () => next)} />
      </Row>
    );
  };

  const noteOf = (...views: View[]): ReactNode => {
    for (const view of views) {
      const line = ownerLine(view.owner, single);
      if (line !== null) return line;
    }
    return null;
  };

  // Text
  const fontView = viewOf("font-family", (subject) => firstFamily(subject.report.computed["font-family"] ?? ""));
  const weightView = viewOf("font-weight");
  const alignView = viewOf("text-align");
  const textNote = noteOf(fontView, viewOf("font-size"), weightView, viewOf("line-height"), viewOf("letter-spacing"), alignView, viewOf("color"));

  // Shape
  const borderWidthView = viewOf("border-width");
  const borderStyleView = viewOf("border-style");
  const borderColourView = viewOf("border-color", (subject) => hexOf(subject.report.computed["border-color"]));
  const radiusView = viewOf("border-radius");
  const opacityView = viewOf("opacity");
  const shadowOwner = viewOf("box-shadow", (subject) => subject.report.computed["box-shadow"] ?? "");
  const several = subjects.some((subject) => shadowOf(subject.report.computed["box-shadow"]).several);
  const shadowEditable = shadowOwner.editable && !several;
  const shadowPart = (part: ShadowPart) => viewOf("box-shadow", (subject) => shadowOf(subject.report.computed["box-shadow"])[part]);
  const shadowFields: Record<ShadowPart, View> = { x: shadowPart("x"), y: shadowPart("y"), blur: shadowPart("blur"), spread: shadowPart("spread"), colour: shadowPart("colour") };
  const shapeNote = noteOf(borderWidthView, borderStyleView, borderColourView, radiusView, opacityView, shadowOwner) ?? (several ? noteText(SEVERAL_SHADOWS) : null);

  const shadowNumber = (part: Exclude<ShadowPart, "colour">, label: string) => {
    const view = shadowFields[part];
    return (
      <NumberControl
        label={label}
        value={view.mixed ? "" : view.value}
        placeholder={view.mixed ? MIXED : undefined}
        disabled={!shadowEditable}
        onCommit={(typed) => write("box-shadow", (subject) => shadowWith(shadowOf(subject.report.computed["box-shadow"]), part, String(typed)))}
      />
    );
  };

  // Spacing and layout: a flex element shows Layout, and Gap shows for flex or grid.
  const sideViews = (prefix: "padding" | "margin") =>
    Object.fromEntries(SIDES.map((side) => [side, viewOf(`${prefix}-${side}`)])) as Record<(typeof SIDES)[number], View>;
  const displayOf = (subject: Subject) => subject.report.computed.display ?? "";
  const flex = subjects.every((subject) => FLEX_DISPLAYS.includes(displayOf(subject)));
  const gapped = subjects.every((subject) => GAP_DISPLAYS.includes(displayOf(subject)));
  const sidesWrite = (property: string, typed: number) => write(property, (subject) => numberValue(property, typed, subject.report.inline[property]));

  // Visibility: a hide edit, for elements the source holds with an id and nothing locks them.
  const visible = subjects.every((subject) => subject.element === undefined || !subject.element.hidden);
  const visibleEditable = subjects.every((subject) => subject.element !== undefined && !subject.locked);

  // Image: one element at a time. An image edit still in the burst is the person's own, so its owner stays the source until it is written.
  const picture = single ? pictureOf(first!.report) : null;
  const pictureOwner: FieldOwner =
    picture === null ? { owner: "source" }
    : pending.some((edit) => edit.type === "image" && edit.elementId === first!.id && edit.target === picture.target) ? { owner: "source" }
    : picture.target === "src" ?
      first!.element === undefined ? { owner: "script" }
      : fieldOwner({
          field: { kind: "src" },
          source: { inline: first!.element.style, text: first!.element.text, src: first!.element.src ?? null },
          live: { inline: first!.report.inline, text: first!.report.text, src: first!.report.src, animated: first!.report.animated },
          dials: dials ?? {},
          locked: first!.locked,
          normalise: (value) => value,
        })
    : ownerOf(first!, "background-image");
  const pictureLine = picture === null ? null : ownerLine(pictureOwner, true);

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto p-2.5" data-testid="design-tab">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-semibold">{name}</span>
        {single && <span className="shrink-0 text-xs text-muted-foreground">{first!.report.tag}</span>}
      </div>
      {anyLocked && noteText(LOCKED)}
      {subjects.some((subject) => overridden[subject.id] === true) && noteText(OVERRIDDEN)}

      <Section name="Text" note={textNote}>
        <Row label="Font">
          <FontControl
            value={fontView.mixed ? "" : fontView.value}
            disabled={!fontView.editable}
            families={families}
            onCommit={(typed) => write("font-family", () => (typed.includes(" ") ? `"${typed.replace(/"/g, "")}"` : typed))}
          />
        </Row>
        {numberField("Size", "font-size")}
        <Row label="Weight" mark={dialPathOf(weightView)}>
          <KeywordControl label="Weight" value={weightView.value} mixed={weightView.mixed} options={WEIGHTS} disabled={!weightView.editable} onPick={(next) => write("font-weight", () => next)} />
        </Row>
        {numberField("Line height", "line-height")}
        {numberField("Letter spacing", "letter-spacing")}
        <Row label="Align">
          <ToggleGroup
            aria-label="Align"
            value={alignView.mixed ? [] : [alignView.value === "start" ? "left" : alignView.value === "end" ? "right" : alignView.value]}
            onValueChange={(next) => {
              const [picked] = next as string[];
              if (picked !== undefined) write("text-align", () => picked);
            }}
          >
            {ALIGNS.map(({ value, label, Icon }) => (
              <Toggle key={value} value={value} aria-label={label} disabled={!alignView.editable}>
                <Icon aria-hidden />
              </Toggle>
            ))}
          </ToggleGroup>
        </Row>
        {colourField("Colour", "color")}
      </Section>

      <Section name="Fill" note={noteOf(viewOf("background-color", (subject) => hexOf(subject.report.computed["background-color"])))}>
        {colourField("Background", "background-color")}
      </Section>

      <Section name="Shape" note={shapeNote}>
        <Row label="Border">
          <div role="group" aria-label="Border" className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div className="w-20">
              <NumberControl
                label="Border width"
                value={borderWidthView.mixed ? "" : numberOf(borderWidthView.value)}
                placeholder={borderWidthView.mixed ? MIXED : undefined}
                disabled={!borderWidthView.editable}
                onCommit={(typed) => write("border-width", () => `${typed}px`)}
              />
            </div>
            <div className="min-w-24 flex-1">
              <KeywordControl label="Border style" value={borderStyleView.value} mixed={borderStyleView.mixed} options={BORDER_STYLES} disabled={!borderStyleView.editable} onPick={(next) => write("border-style", () => next)} />
            </div>
            <ColourControl label="Border colour" hex={borderColourView.value} mixed={borderColourView.mixed} disabled={!borderColourView.editable} onCommit={(next) => write("border-color", () => next)} />
          </div>
        </Row>
        {numberField("Corner radius", "border-radius", { write: (typed) => `${typed}px` })}
        {numberField("Opacity", "opacity", {
          format: (value) => (value === "" ? "" : String(Math.round(Number(value) * 100))),
          write: (typed) => String(Math.min(100, Math.max(0, typed)) / 100),
        })}
        <Row label="Shadow">
          <div role="group" aria-label="Shadow" className="grid grid-cols-2 gap-1.5">
            {shadowNumber("x", "Shadow x")}
            {shadowNumber("y", "Shadow y")}
            {shadowNumber("blur", "Shadow blur")}
            {shadowNumber("spread", "Shadow spread")}
            <div className="col-span-2">
              <ColourControl
                label="Shadow colour"
                hex={shadowFields.colour.value}
                mixed={shadowFields.colour.mixed}
                disabled={!shadowEditable}
                onCommit={(next) => write("box-shadow", (subject) => shadowWith(shadowOf(subject.report.computed["box-shadow"]), "colour", next))}
              />
            </div>
          </div>
        </Row>
      </Section>

      <Section name="Spacing" note={noteOf(...SIDES.map((side) => sideViews("padding")[side]), ...SIDES.map((side) => sideViews("margin")[side]))}>
        <SidesRow label="Padding" prefix="padding" views={sideViews("padding")} onWrite={sidesWrite} />
        <SidesRow label="Margin" prefix="margin" views={sideViews("margin")} onWrite={sidesWrite} />
        {gapped && numberField("Gap", "gap")}
      </Section>

      {flex && (
        <Section name="Layout" note={noteOf(viewOf("flex-direction"), viewOf("align-items"), viewOf("justify-content"), viewOf("flex-wrap"))}>
          {keywordField("Direction", "flex-direction", DIRECTIONS)}
          {keywordField("Align", "align-items", ALIGN_ITEMS)}
          {keywordField("Justify", "justify-content", JUSTIFY)}
          {keywordField("Wrap", "flex-wrap", WRAPS)}
        </Section>
      )}

      <Section name="Visibility" note={null}>
        <Row label="Visible">
          <Switch aria-label="Visible" checked={visible} disabled={!visibleEditable} onCheckedChange={(next) => subjects.forEach((subject) => session.patch({ type: "hide", elementId: subject.id, hidden: !next }))} />
        </Row>
      </Section>

      {picture !== null && (
        <fieldset aria-label="Image" className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Image</legend>
          <div className="flex items-center gap-2">
            {fileNameOf(picture.file) !== "" && <img alt="" src={previewUrl(project, fileNameOf(picture.file), 512)} className="size-10 shrink-0 rounded-sm object-cover" />}
            {pictureOwner.owner === "source" && (
              <ImagePicker project={project} onChoose={(file) => session.patch({ type: "image", elementId: first!.id, target: picture.target, file })} />
            )}
          </div>
          {pictureLine}
        </fieldset>
      )}
    </div>
  );
};
