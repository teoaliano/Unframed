import type { OffTokenFound, SourceEdit } from "@unframed/contracts";
import { cssName, dialAt, DESIGN_FIELDS, fieldOwner, kitCssNames, resolve, styleValueRefusal, TEXT_STYLE_SUFFIX, tokensForField, type ArtifactKind, type ChipElement, type ComponentDeclaration, type FieldOwner, type Kit, type TextStyleField, type Token } from "@unframed/domain";
import { Component, Diamond, Link, MessageSquarePlus, Unlink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tip } from "../../chrome/ui.tsx";
import { showError } from "../../toasts.tsx";
import { previewUrl } from "../../canvas/assetStore.ts";
import { ComponentSection } from "./ComponentSection.tsx";
import { InstanceSection, instanceFieldsOf } from "./InstanceSection.tsx";
import { chainOf } from "./EditPanels.tsx";
import { ImagePicker } from "./ImagePicker.tsx";
import type { EditReport, EditSession } from "./editSession.ts";
import { chipDataFor } from "./chipData.ts";
import { expandShorthand } from "./expandShorthand.ts";
import { fieldNameOf } from "./tellAgent.ts";
import { sheetFieldOf, type SheetField } from "./sheetOwner.ts";
import { ALIGNS, BORDER_STYLES, Caption, ColourControl, FontControl, hexOf, KeywordControl, MIXED, noteText, NumberControl, numberOf, Row, Section, Swatch, WEIGHTS } from "../../design/controls.tsx";

const DIRECTIONS = ["row", "column", "row-reverse", "column-reverse"];
const ALIGN_ITEMS = ["flex-start", "center", "flex-end", "stretch", "baseline"];
const JUSTIFY = ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"];
const WRAPS = ["nowrap", "wrap"];
const FLEX_DISPLAYS = ["flex", "inline-flex"];
const GAP_DISPLAYS = ["flex", "inline-flex", "grid", "inline-grid"];
const SIDES = ["top", "right", "bottom", "left"] as const;
const LOCKED = "Locked. Unlock it in Layers to edit it.";
const OVERRIDDEN = "A stylesheet rule wins over this value.";
const SEVERAL_SHADOWS = "Several shadows. Ask the agent to change them.";


const numberValue = (property: string, typed: number, inline: string | null | undefined): string => {
  const written = (inline ?? "").trim();
  if (property === "line-height" && /^\d*\.?\d+$/.test(written)) return String(typed);
  const unit = /(px|em|rem|%)$/.exec(written)?.[1] ?? "px";
  return `${typed}${unit}`;
};

const firstFamily = (value: string): string => value.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";

export interface Shadow {
  readonly x: string;
  readonly y: string;
  readonly blur: string;
  readonly spread: string;
  readonly colour: string;
  readonly several: boolean;
}

const SHADOW_CAPTION: Record<Exclude<ShadowPart, "colour">, string> = { x: "X", y: "Y", blur: "Blur", spread: "Spread" };
const SHADOW_PARTS = ["x", "y", "blur", "spread", "colour"] as const;
type ShadowPart = (typeof SHADOW_PARTS)[number];

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

const shadowWith = (shadow: Shadow, part: ShadowPart, value: string): string => {
  const next = { x: shadow.x, y: shadow.y, blur: shadow.blur, spread: shadow.spread, colour: shadow.colour, [part]: value };
  return `${next.x}px ${next.y}px ${next.blur}px ${next.spread}px ${next.colour}`;
};

interface View {
  readonly value: string;
  readonly mixed: boolean;
  readonly owner: FieldOwner;
  readonly editable: boolean;
  readonly ask: () => void;
  readonly reveal?: (() => void) | undefined;
  readonly sheet?: SheetField | null;
}

const dialPathOf = (view: View): string | undefined => (view.owner.owner === "dial" && view.editable ? view.owner.path : undefined);

interface Subject {
  readonly id: string;
  readonly report: EditReport;
  readonly element: { readonly style: Record<string, string>; readonly text: string | null; readonly src?: string | undefined; readonly hidden: boolean } | undefined;
  readonly locked: boolean;
}


const ownerLine = (owner: FieldOwner, single: boolean, ask: () => void, reveal?: () => void, sentence = "Set by the agent's code."): ReactNode => {
  if (owner.owner === "source" || owner.owner === "locked") return null;
  if (owner.owner === "script") {
    return (
      <>
        {noteText(sentence)}
        <Button variant="ghost" size="xs" className="justify-self-start" onClick={ask}>
          Ask the agent to make this editable
        </Button>
      </>
    );
  }
  if (owner.owner === "animated") {
    return (
      <>
        {noteText("Animated by the agent's code.")}
        {reveal !== undefined && (
          <Button variant="ghost" size="xs" className="justify-self-start" onClick={reveal}>
            Show on timeline
          </Button>
        )}
      </>
    );
  }
  if (owner.owner !== "dial" || single) return null;
  return noteText(`Set by parameter ${owner.path}.`);
};


const TEXT_PROPERTIES = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing"];
const TOKEN_FIELDS = new Set(["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "background-color", "border-width", "border-color", "border-radius", "box-shadow", "padding", "margin", "gap", "text-style"]);

const tokenValueOf = (token: Token, kit: Kit, mode: string, suffix?: string): { readonly text: string; readonly colour?: string } => {
  const value = resolve(kit, token.path, mode);
  if (value === undefined) return { text: "" };
  if (typeof value === "object") {
    const field = (Object.keys(TEXT_STYLE_SUFFIX) as TextStyleField[]).find((candidate) => TEXT_STYLE_SUFFIX[candidate] === suffix);
    return { text: field === undefined ? `${value.fontFamily} · ${value.fontSize}` : String(value[field]) };
  }
  return token.type === "color" ? { text: String(value), colour: String(value) } : { text: String(value) };
};

const literalsOf = (token: Token, kit: Kit, mode: string, properties: readonly string[]): Array<{ readonly property: string; readonly value: string }> => {
  const value = resolve(kit, token.path, mode);
  if (value === undefined) return [];
  if (typeof value !== "object") return properties.map((property) => ({ property, value: String(value) }));
  return (Object.keys(TEXT_STYLE_SUFFIX) as TextStyleField[])
    .filter((field) => properties.includes(TEXT_STYLE_SUFFIX[field]))
    .map((field) => ({ property: TEXT_STYLE_SUFFIX[field], value: String(value[field]) }));
};

const shortPathOf = (path: string): string => path.split("/").slice(-2).join("/");

const tokenNamed = (kit: Kit | null, name: string): { readonly token: Token; readonly suffix?: string } | undefined => {
  for (const token of kit?.tokens ?? []) {
    for (const base of [cssName(token.path), ...(token.formerNames ?? [])]) {
      if (base === name) return { token };
      if (token.type === "textStyle") {
        const suffix = Object.values(TEXT_STYLE_SUFFIX).find((candidate) => `${base}-${candidate}` === name);
        if (suffix !== undefined) return { token, suffix };
      }
    }
  }
  return undefined;
};

const TokenLine = ({ path, text, colour }: { readonly path: string; readonly text: string; readonly colour?: string | undefined }) => (
  <>
    {colour !== undefined && <Swatch colour={colour} />}
    <span className="truncate font-mono text-xs">{path}</span>
    <span className="ml-auto truncate text-xs text-muted-foreground">{text}</span>
  </>
);

const ChipFace = ({ token, suffix, kit, mode }: { readonly token: Token; readonly suffix?: string | undefined; readonly kit: Kit; readonly mode: string }) => {
  const { text, colour } = tokenValueOf(token, kit, mode, suffix);
  return <TokenLine path={shortPathOf(token.path)} text={text} colour={colour} />;
};

const TokenPicker = ({
  field,
  label,
  kit,
  mode,
  editable,
  edits,
  session,
  onOpenKit,
  chip,
  detach,
  onOpenChange,
}: {
  readonly field: string;
  readonly label: string;
  readonly kit: Kit | null;
  readonly mode: string;
  readonly editable: boolean;
  readonly edits: (token: Token) => SourceEdit[];
  readonly session: EditSession;
  readonly onOpenKit: () => void;
  readonly chip?: { readonly token: Token; readonly suffix?: string } | undefined;
  readonly detach?: (() => void) | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const close = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) {
      session.previewEdits(null);
      setQuery("");
    }
  };
  const search = query.trim().toLowerCase();
  const offered = kit === null ? [] : tokensForField(field, kit).filter((token) => search === "" || token.path.includes(search) || cssName(token.path).includes(search));
  return (
    <Popover open={open} onOpenChange={close}>
      {chip === undefined || kit === null ? (
        <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Use a token for ${label}`} data-token-trigger={field} disabled={!editable} />}>
          <Diamond aria-hidden />
        </PopoverTrigger>
      ) : (
        <Tip label={chip.token.path}>
          <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-0 justify-start" data-token-trigger={field} />}>
            <ChipFace token={chip.token} suffix={chip.suffix} kit={kit} mode={mode} />
          </PopoverTrigger>
        </Tip>
      )}
      <PopoverPopup
        side="left"
        align="start"
        padding="compact"
        className="w-72"
        aria-label="Use a token"
        initialFocus={false}
        finalFocus={() => document.querySelector<HTMLElement>(`[data-token-trigger="${CSS.escape(field)}"]`)}
      >
        {detach !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => {
              close(false);
              detach();
            }}
          >
            Detach
          </Button>
        )}
        {kit === null ? (
          <p className="m-0 text-sm text-muted-foreground">No kit yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Input aria-label="Search tokens" placeholder="Search tokens…" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
            <div className="flex max-h-64 flex-col gap-0.5 overflow-auto">
              {offered.map((token) => {
                const { text, colour } = tokenValueOf(token, kit, mode);
                return (
                  <Button
                    key={token.path}
                    variant="ghost"
                    size="sm"
                    className="min-w-0 justify-start"
                    onMouseEnter={() => session.previewEdits(edits(token))}
                    onMouseLeave={() => session.previewEdits(null)}
                    onFocus={() => session.previewEdits(edits(token))}
                    onBlur={() => session.previewEdits(null)}
                    onClick={() => {
                      close(false);
                      for (const edit of edits(token)) session.patch(edit);
                    }}
                  >
                    <TokenLine path={token.path} text={text} colour={colour} />
                  </Button>
                );
              })}
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          onClick={() => {
            close(false);
            onOpenKit();
          }}
        >
          Edit kit
        </Button>
      </PopoverPopup>
    </Popover>
  );
};

const SidesRow = ({
  label,
  prefix,
  views,
  onWrite,
  token,
}: {
  readonly label: string;
  readonly prefix: "padding" | "margin";
  readonly views: Record<(typeof SIDES)[number], View>;
  readonly onWrite: (property: string, typed: number) => void;
  readonly token?: ReactNode;
}) => {
  const [linked, setLinked] = useState(false);
  return (
    <Row label={label} mark={SIDES.map((side) => dialPathOf(views[side])).find((path) => path !== undefined)} token={token}>
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

const pictureOf = (report: EditReport): { readonly target: "src" | "background"; readonly file: string } | null => {
  if (report.tag === "img") return { target: "src", file: report.src ?? "" };
  const match = /^url\(\s*["']?([^"')]*)["']?\s*\)$/.exec(report.computed["background-image"] ?? "");
  return match === null ? null : { target: "background", file: match[1] ?? "" };
};

const fileNameOf = (url: string): string => {
  const last = url.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last.split("?")[0] ?? "");
  } catch {
    return last;
  }
};

const OffTokens = ({
  values,
  labelOf,
  onSelect,
  onUse,
}: {
  readonly values: readonly OffTokenFound[];
  readonly labelOf: (value: OffTokenFound) => string;
  readonly onSelect: (value: OffTokenFound) => void;
  readonly onUse: (value: OffTokenFound) => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <fieldset aria-label="Off-token values" className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">
        <Button variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen(!open)}>{`Off-token values (${values.length})`}</Button>
      </legend>
      {open &&
        (values.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Every value here is on the kit.</p>
        ) : (
          values.map((value, index) => (
            <div key={`${index}-${value.property}-${value.value}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <Button variant="ghost" size="sm" className="min-w-0 justify-start" onClick={() => onSelect(value)}>
                <span className="flex min-w-0 flex-col items-start">
                  <span className="max-w-full truncate text-sm">{labelOf(value)}</span>
                  <span className="max-w-full truncate font-mono text-xs text-muted-foreground">{`${value.property}: ${value.value} ${value.exact ? "=" : "≈"} ${value.css}`}</span>
                </span>
              </Button>
              <Button variant="outline" size="xs" onClick={() => onUse(value)}>
                Use token
              </Button>
            </div>
          ))
        ))}
    </fieldset>
  );
};

interface DesignTabProps {
  readonly session: EditSession;
  readonly kind: ArtifactKind;
  readonly project: string;
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly locked: readonly string[];
  readonly kit: Kit | null;
  readonly mode: string | undefined;
  readonly onOpenKit: () => void;
  readonly onTell: (elements: ChipElement[]) => void;
  readonly onAsk: (field: string, elements: ChipElement[]) => void;
  readonly onShowOnTimeline?: (element: string, property: string) => void;
  readonly component?: ComponentDeclaration | null;
  readonly onAskComponent?: () => void;
  readonly componentTitle?: string | undefined;
  readonly componentOf?: ((tag: string) => { readonly shapeId: string; readonly title: string; readonly file?: string | undefined } | undefined) | undefined;
  readonly onUpdateComponent?: ((tag: string) => void) | undefined;
  readonly onGoToMain?: ((shapeId: string) => void) | undefined;
  readonly onMake?: ((element: ChipElement) => void) | undefined;
}

const dialValueFor = (current: unknown, css: string): unknown => {
  if (typeof current !== "number") return css;
  const parsed = Number.parseFloat(css);
  return Number.isFinite(parsed) ? parsed : current;
};

const normaliserFor = (property: string) => (value: string) => {
  const probe = document.createElement("i");
  probe.style.setProperty(property, value);
  return probe.style.getPropertyValue(property);
};

export const DesignTab = ({ session, kind, project, dials, locked, kit, mode, onOpenKit, onTell, onAsk, onShowOnTimeline, component, onAskComponent, componentTitle, componentOf, onGoToMain, onMake, onUpdateComponent }: DesignTabProps) => {
  const [openChip, setOpenChip] = useState<{ readonly field: string; readonly named: { readonly token: Token; readonly suffix?: string } } | null>(null);
  const { selection, reports, tree, preparing, prepareError, pending, families, overridden } = session;
  if (preparing) return <p className="m-0 p-2.5 text-sm text-muted-foreground">{`Getting this ${kind} ready for editing…`}</p>;
  if (prepareError !== undefined) return <p className="m-0 p-2.5 text-sm text-destructive-foreground">{prepareError}</p>;
  if (selection.length === 0) {
    return (
      <div className="flex min-h-0 flex-col gap-3 overflow-auto p-2.5">
        {component && onAskComponent && <ComponentSection declaration={component} onAsk={onAskComponent} />}
        <div className="flex flex-col gap-1 text-sm text-muted-foreground" data-testid="design-empty">
          <p className="m-0">Select an element to edit it.</p>
          {session.mode === "interact" && <p className="m-0">{`Switch to Edit (V) to select in the ${kind}.`}</p>}
        </div>
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
  const instance = single && first!.report.component ? first!.report.component : null;
  const instanceFields =
    instance === null
      ? []
      : instanceFieldsOf({
          declaration: instance.declaration,
          attributes: instance.attributes,
          source: elements.find((candidate) => candidate.id === first!.id)?.attributes ?? {},
          pending: new Set(pending.flatMap((edit) => (edit.type === "attribute" && edit.elementId === first!.id ? [edit.name] : []))),
        });
  const anyLocked = subjects.some((subject) => subject.locked);
  const name = single ? (elements.find((candidate) => candidate.id === first!.id)?.name ?? first!.report.tag) : `${subjects.length} elements`;

  const sheetOf = (subject: Subject, property: string): SheetField | null =>
    sheetFieldOf(subject.report.sheetRules, subject.report.inline, property, expandShorthand, kit === null ? [] : kitCssNames(kit), subject.report.sheetOverrides);

  const ownerOf = (subject: Subject, property: string): FieldOwner => {
    if (pending.some((edit) => (edit.type === "style" || edit.type === "token") && edit.elementId === subject.id && edit.property === property)) return { owner: "source" };
    const owner = fieldOwner({
      field: { kind: "style", property },
      source: subject.element === undefined ? null : { inline: subject.element.style, text: subject.element.text, src: subject.element.src ?? null },
      live: { inline: subject.report.inline, text: subject.report.text, src: subject.report.src, animated: subject.report.animated },
      dials: dials ?? {},
      locked: subject.locked,
      normalise: normaliserFor(property),
      expand: expandShorthand,
      kitNames: kit === null ? [] : kitCssNames(kit),
    });
    if (owner.owner !== "source") return owner;
    const sheet = sheetOf(subject, property);
    if (sheet?.kind === "script") return { owner: "script" };
    if (sheet?.kind === "token") return { owner: "token", name: sheet.name };
    return owner;
  };

  const chipDataOf = (subject: Subject): ChipElement => {
    const source = elements.find((candidate) => candidate.id === subject.id);
    return chipDataFor(subject.id, source, subject.report, source !== undefined && elements.some((candidate) => candidate.parent === subject.id));
  };

  const colourView = (property: string) => viewOf(property, (subject) => hexOf(subject.report.computed[property]));
  const viewOf = (property: string, pick: (subject: Subject) => string = (subject) => subject.report.computed[property] ?? ""): View => {
    const owners = subjects.map((subject) => ownerOf(subject, property));
    const values = subjects.map(pick);
    const mixed = values.some((value) => value !== values[0]);
    const owner = owners.find((candidate) => candidate.owner !== "source") ?? { owner: "source" as const };
    const ask = () => onAsk(fieldNameOf(property), subjects.filter((_, index) => owners[index]!.owner !== "source").map(chipDataOf));
    const animated = owners.findIndex((candidate) => candidate.owner === "animated");
    const reveal = animated === -1 || onShowOnTimeline === undefined ? undefined : () => onShowOnTimeline(subjects[animated]!.id, property);
    const sheet = single ? sheetOf(first!, property) : null;
    return { value: mixed ? "" : (values[0] ?? ""), mixed, owner, editable: owner.owner === "source" || (owner.owner === "dial" && single), ask, reveal, sheet };
  };

  const write = (property: string, valueOf: (subject: Subject) => string) => {
    const writes = subjects.map((subject) => ({ subject, value: valueOf(subject) }));
    for (const { value } of writes) {
      const refusal = styleValueRefusal(property, value);
      if (refusal !== null) {
        showError(refusal);
        return false;
      }
    }
    for (const { subject, value } of writes) {
      const owner = ownerOf(subject, property);
      const sheet = sheetOf(subject, property);
      if (owner.owner === "source" && sheet?.kind === "variants" && sheet.rule !== undefined) {
        session.patch({ type: "componentRule", rule: sheet.rule, property, value });
      } else if (owner.owner === "dial") session.patchDial(owner.path, dialValueFor(dialAt(dials ?? {}, owner.path), value));
      else session.patch({ type: "style", elementId: subject.id, property, value });
    }
    return true;
  };

  const currentMode = kit === null ? "" : mode !== undefined && kit.modes.includes(mode) ? mode : (kit.modes[0] ?? "");
  const tokenEdits =
    (properties: readonly string[]) =>
    (token: Token): SourceEdit[] =>
      subjects.flatMap((subject) =>
        properties.map((property): SourceEdit => {
          const sheet = sheetOf(subject, property);
          return sheet?.kind === "token" || (sheet?.kind === "variants" && sheet.rule !== undefined)
            ? { type: "token", rule: sheet.rule!, property, token: token.path }
            : { type: "token", elementId: subject.id, property, token: token.path };
        }),
      );
  const tokenSlot = (field: string, editable: boolean, properties: readonly string[] = [field], label: string = field) =>
    TOKEN_FIELDS.has(field) ? (
      <TokenPicker field={field} label={label} kit={kit} mode={currentMode} editable={editable} edits={tokenEdits(properties)} session={session} onOpenKit={onOpenKit} />
    ) : undefined;
  const detachWith = (token: Token, properties: readonly string[]) => {
    if (kit === null) return;
    for (const subject of subjects) {
      for (const literal of literalsOf(token, kit, currentMode, properties)) {
        const sheet = sheetOf(subject, literal.property);
        if (sheet?.kind === "token") session.patch({ type: "componentRule", rule: sheet.rule, property: literal.property, value: literal.value });
        else session.patch({ type: "style", elementId: subject.id, property: literal.property, value: literal.value });
      }
    }
  };
  const chipFor = (field: string, view: View, properties: readonly string[] = [field], label: string = field): ReactNode => {
    const named = view.owner.owner === "token" ? tokenNamed(kit, view.owner.name) : openChip?.field === field ? openChip.named : undefined;
    if (named === undefined || kit === null) return null;
    return (
      <TokenPicker
        field={field}
        label={label}
        kit={kit}
        mode={currentMode}
        editable
        edits={tokenEdits(properties)}
        session={session}
        onOpenKit={onOpenKit}
        chip={named}
        detach={() => detachWith(named.token, properties)}
        onOpenChange={(next) => setOpenChip(next ? { field, named } : null)}
      />
    );
  };

  const withSheet = (view: View, slot: ReactNode): ReactNode => {
    if (view.sheet?.kind !== "variants") return slot;
    const chip = (
      <Tip label={view.sheet.chip}>
        <Badge variant="outline" size="sm" className="min-w-0 max-w-full">
          <span className="block min-w-0 truncate">{view.sheet.chip}</span>
        </Badge>
      </Tip>
    );
    return view.sheet.rule === undefined ? (<>{chip}{slot}</>) : chip;
  };

  const numberField = (label: string, property: string, options: { readonly format?: (value: string) => string; readonly write?: (typed: number, subject: Subject) => string; readonly placeholder?: string } = {}) => {
    const view = viewOf(property);
    const chip = chipFor(property, view, [property], label);
    return (
      <Row label={label} mark={dialPathOf(view)} token={chip === null ? (withSheet(view, tokenSlot(property, view.editable, [property], label)) ?? <span aria-hidden className="size-6 shrink-0" />) : undefined}>
        {chip ?? <NumberControl
          label={label}
          value={view.mixed ? "" : (options.format ?? numberOf)(view.value)}
          placeholder={view.mixed ? MIXED : options.placeholder}
          disabled={!view.editable}
          onCommit={(typed) => write(property, (subject) => (options.write ?? ((value, s) => numberValue(property, value, s.report.inline[property])))(typed, subject))}
        />}
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
    const view = colourView(property);
    const chip = chipFor(property, view, [property], label);
    return (
      <Row label={label} mark={dialPathOf(view)} token={chip === null ? (withSheet(view, tokenSlot(property, view.editable, [property], label)) ?? <span aria-hidden className="size-6 shrink-0" />) : undefined}>
        {chip ?? <ColourControl label={label} hex={view.value} mixed={view.mixed} disabled={!view.editable} onCommit={(next) => write(property, () => next)} />}
      </Row>
    );
  };

  const noteOf = (...views: View[]): ReactNode => {
    for (const view of views) {
      const line = ownerLine(view.owner, single, view.ask, view.reveal, view.sheet?.kind === "script" ? "Set by the component's style." : undefined);
      if (line !== null) return line;
    }
    return null;
  };

  const fontView = viewOf("font-family", (subject) => firstFamily(subject.report.computed["font-family"] ?? ""));
  const fontChip = chipFor("font-family", fontView, undefined, "Font");
  const weightView = viewOf("font-weight");
  const weightChip = chipFor("font-weight", weightView, undefined, "Weight");
  const textStyleOwned = (() => {
    if (openChip?.field === "text-style") return openChip.named.token;
    const named = TEXT_PROPERTIES.map((property) => {
      const view = viewOf(property);
      return view.owner.owner === "token" ? tokenNamed(kit, view.owner.name) : undefined;
    });
    const [first] = named;
    if (first === undefined || first.token.type !== "textStyle") return undefined;
    return named.every((candidate) => candidate !== undefined && candidate.token.path === first.token.path) ? first.token : undefined;
  })();
  const alignView = viewOf("text-align");
  const textNote = noteOf(fontView, viewOf("font-size"), weightView, viewOf("line-height"), viewOf("letter-spacing"), alignView, viewOf("color"));

  const borderWidthView = viewOf("border-width");
  const borderWidthChip = chipFor("border-width", borderWidthView, undefined, "Border");
  const borderStyleView = viewOf("border-style");
  const borderColourView = colourView("border-color");
  const radiusView = viewOf("border-radius");
  const opacityView = viewOf("opacity");
  const opacityField = numberField("Opacity", "opacity", {
    format: (value) => (value === "" ? "" : String(Math.round(Number(value) * 100))),
    write: (typed) => String(Math.min(100, Math.max(0, typed)) / 100),
  });
  const shadowOwner = viewOf("box-shadow");
  const several = subjects.some((subject) => shadowOf(subject.report.computed["box-shadow"]).several);
  const shadowEditable = shadowOwner.editable && !several;
  const shadowPart = (part: ShadowPart) => viewOf("box-shadow", (subject) => shadowOf(subject.report.computed["box-shadow"])[part]);
  const shadowFields: Record<ShadowPart, View> = { x: shadowPart("x"), y: shadowPart("y"), blur: shadowPart("blur"), spread: shadowPart("spread"), colour: shadowPart("colour") };
  const shapeNote = noteOf(borderWidthView, borderStyleView, borderColourView, radiusView, opacityView, shadowOwner) ?? (several ? noteText(SEVERAL_SHADOWS) : null);

  const shadowNumber = (part: Exclude<ShadowPart, "colour">, label: string) => {
    const view = shadowFields[part];
    return (
      <div>
        <Caption>{SHADOW_CAPTION[part]}</Caption>
        <NumberControl
          label={label}
          value={view.mixed ? "" : view.value}
          placeholder={view.mixed ? MIXED : undefined}
          disabled={!shadowEditable}
          onCommit={(typed) => write("box-shadow", (subject) => shadowWith(shadowOf(subject.report.computed["box-shadow"]), part, String(typed)))}
        />
      </div>
    );
  };

  const sideViews = (prefix: "padding" | "margin") => Object.fromEntries(SIDES.map((side) => [side, viewOf(`${prefix}-${side}`)])) as Record<(typeof SIDES)[number], View>;
  const paddingViews = sideViews("padding");
  const marginViews = sideViews("margin");
  const displayOf = (subject: Subject) => subject.report.computed.display ?? "";
  const flex = subjects.every((subject) => FLEX_DISPLAYS.includes(displayOf(subject)));
  const gapped = subjects.every((subject) => GAP_DISPLAYS.includes(displayOf(subject)));
  const sidesWrite = (property: string, typed: number) => write(property, (subject) => numberValue(property, typed, subject.report.inline[property]));
  const sidesToken = (prefix: "padding" | "margin", views: Record<(typeof SIDES)[number], View>) => {
    const editable = SIDES.every((side) => views[side].editable);
    return withSheet(views.top, tokenSlot(prefix, editable, SIDES.map((side) => `${prefix}-${side}`), prefix === "padding" ? "Padding" : "Margin"));
  };

  const labelOfOff = (value: OffTokenFound): string => {
    const place = value.place;
    if ("elementId" in place) return elements.find((candidate) => candidate.id === place.elementId)?.name ?? place.elementId;
    return `In styles: ${place.rule.selector}`;
  };
  const selectOff = (value: OffTokenFound) => {
    const place = value.place;
    if ("elementId" in place) session.setSelection([place.elementId]);
    else session.selectMatching(place.rule.selector);
  };
  const useOff = (value: OffTokenFound) => {
    const place = value.place;
    const edit: SourceEdit = "elementId" in place ? { type: "token", elementId: place.elementId, property: value.property, token: value.path } : { type: "token", rule: place.rule, property: value.property, token: value.path };
    session.patch(edit);
  };

  const hiddenNow = (subject: Subject): boolean => {
    const edit = session.pending.find((item) => item.type === "hide" && item.elementId === subject.id);
    return edit?.type === "hide" ? edit.hidden : subject.element?.hidden === true;
  };
  const visible = subjects.every((subject) => subject.element === undefined || !hiddenNow(subject));
  const visibleEditable = subjects.every((subject) => subject.element !== undefined && !subject.locked);

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
          expand: expandShorthand,
        })
    : ownerOf(first!, "background-image");
  const pictureLine = picture === null ? null : ownerLine(pictureOwner, true, () => onAsk("Picture", [chipDataOf(first!)]));

  const makeShown = single && instance === null && kind !== "component" && first!.report.id !== null && onMake !== undefined;
  const variant = single && first!.report.variant ? Object.values(first!.report.variant) : null;
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto p-2.5" data-testid="design-tab">
      {variant !== null && componentTitle !== undefined && (
        <p className="m-0 min-w-0 shrink-0 truncate text-xs text-muted-foreground" data-testid="variant-line">{`Editing ${[componentTitle, ...variant].join(" · ")}`}</p>
      )}
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
        {single && <span className="shrink-0 text-xs text-muted-foreground">{first!.report.tag}</span>}
        <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => onTell(subjects.map(chipDataOf))}>
          <MessageSquarePlus aria-hidden />
          Tell the agent
        </Button>
        {makeShown &&
          (() => {
            const button = (
              <Button variant="outline" size="sm" className="shrink-0" aria-disabled={first!.locked} onClick={() => !first!.locked && onMake?.(chipDataOf(first!))}>
                <Component aria-hidden />
                Make component
              </Button>
            );
            return first!.locked ? <Tip label="Unlock it first. The agent replaces it with the component.">{button}</Tip> : button;
          })()}
      </div>
      {kit !== null && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Button variant="ghost" size="xs" className="min-w-0" onClick={onOpenKit}>{`Kit: ${kit.name}`}</Button>
          <span className="truncate">{currentMode}</span>
        </div>
      )}
      {anyLocked && noteText(LOCKED)}
      {subjects.some((subject) => overridden[subject.id] === true) && noteText(OVERRIDDEN)}
      {instance !== null && (
        <InstanceSection
          title={componentOf?.(instance.tag)?.title || instance.tag}
          older={(() => {
            const main = componentOf?.(instance.tag);
            return main?.file !== undefined && main.file !== instance.sheet && onUpdateComponent !== undefined ? () => onUpdateComponent(instance.tag) : null;
          })()}
          goToMain={(() => {
            const main = componentOf?.(instance.tag);
            return main === undefined || onGoToMain === undefined ? null : () => onGoToMain(main.shapeId);
          })()}
          fields={instanceFields}
          project={project}
          onSet={(name, value) => session.patch({ type: "attribute", elementId: first!.id, name, value })}
          onAsk={(name) => onAsk(name, [chipDataOf(first!)])}
        />
      )}

      {instance === null ? (
        <>
      <Section
        name="Text"
        note={textNote}
        action={
          textStyleOwned === undefined ? (
            tokenSlot("text-style", fontView.editable, ["font-size"], "Text style")
          ) : (
            <TokenPicker
              field="text-style"
              label="Text style"
              kit={kit}
              mode={currentMode}
              editable
              edits={tokenEdits(["font-size"])}
              session={session}
              onOpenKit={onOpenKit}
              chip={{ token: textStyleOwned }}
              detach={() => detachWith(textStyleOwned, TEXT_PROPERTIES)}
              onOpenChange={(next) => setOpenChip(next ? { field: "text-style", named: { token: textStyleOwned } } : null)}
            />
          )
        }
      >
        <Row label="Font" token={fontChip === null ? tokenSlot("font-family", fontView.editable, undefined, "Font") : undefined}>
          {fontChip ?? (
            <FontControl
              value={fontView.mixed ? "" : fontView.value}
              disabled={!fontView.editable}
              families={families}
              onCommit={(typed) => write("font-family", () => (typed.includes(" ") ? `"${typed.replace(/"/g, "")}"` : typed))}
            />
          )}
        </Row>
        {numberField("Size", "font-size")}
        <Row label="Weight" mark={dialPathOf(weightView)} token={weightChip === null ? tokenSlot("font-weight", weightView.editable, undefined, "Weight") : undefined}>
          {weightChip ?? (
            <KeywordControl label="Weight" value={weightView.value} mixed={weightView.mixed} options={WEIGHTS} disabled={!weightView.editable} onPick={(next) => write("font-weight", () => next)} />
          )}
        </Row>
        {numberField("Line height", "line-height", { placeholder: "auto" })}
        {numberField("Letter spacing", "letter-spacing", { placeholder: "normal" })}
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

      <Section name="Fill" note={noteOf(colourView("background-color"))}>
        {colourField("Background", "background-color")}
      </Section>

      <Section name="Shape" note={shapeNote}>
        <Row label="Border" mark={dialPathOf(borderWidthView) ?? dialPathOf(borderStyleView) ?? dialPathOf(borderColourView)} token={borderWidthChip === null ? tokenSlot("border-width", borderWidthView.editable, undefined, "Border") : undefined}>
          <div role="group" aria-label="Border" className="flex min-w-0 flex-wrap items-center gap-1.5">
            {borderWidthChip ?? (
            <div className="w-20">
              <Caption>Width</Caption>
              <NumberControl
                label="Border width"
                value={borderWidthView.mixed ? "" : numberOf(borderWidthView.value)}
                placeholder={borderWidthView.mixed ? MIXED : undefined}
                disabled={!borderWidthView.editable}
                onCommit={(typed) => write("border-width", () => `${typed}px`)}
              />
            </div>
            )}
            <div className="min-w-24 flex-1">
              <Caption>Style</Caption>
              <KeywordControl label="Border style" value={borderStyleView.value} mixed={borderStyleView.mixed} options={BORDER_STYLES} disabled={!borderStyleView.editable} onPick={(next) => write("border-style", () => next)} />
            </div>
            <div>
              <Caption>Colour</Caption>
              <ColourControl label="Border colour" hex={borderColourView.value} mixed={borderColourView.mixed} disabled={!borderColourView.editable} onCommit={(next) => write("border-color", () => next)} />
            </div>
            {tokenSlot("border-color", borderColourView.editable, undefined, "Border colour")}
          </div>
        </Row>
        {numberField("Corner radius", "border-radius", { write: (typed) => `${typed}px` })}
        {opacityField}
        <Row label="Shadow" mark={Object.values(shadowFields).map(dialPathOf).find((path) => path !== undefined)} token={tokenSlot("box-shadow", shadowEditable, undefined, "Shadow")}>
          <div role="group" aria-label="Shadow" className="grid grid-cols-2 gap-1.5">
            {shadowNumber("x", "Shadow x")}
            {shadowNumber("y", "Shadow y")}
            {shadowNumber("blur", "Shadow blur")}
            {shadowNumber("spread", "Shadow spread")}
            <div className="col-span-2">
              <Caption>Colour</Caption>
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

      <Section name="Spacing" note={noteOf(...Object.values(paddingViews), ...Object.values(marginViews))}>
        <SidesRow label="Padding" prefix="padding" views={paddingViews} onWrite={sidesWrite} token={sidesToken("padding", paddingViews)} />
        <SidesRow label="Margin" prefix="margin" views={marginViews} onWrite={sidesWrite} token={sidesToken("margin", marginViews)} />
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

        </>
      ) : (
        <>
          <Section name="Spacing" note={noteOf(...Object.values(marginViews))}>
            <SidesRow label="Margin" prefix="margin" views={marginViews} onWrite={sidesWrite} token={sidesToken("margin", marginViews)} />
          </Section>
          <Section name="Shape" note={noteOf(opacityView)}>
            {opacityField}
          </Section>
        </>
      )}

      <Section name="Visibility" note={null}>
        <Row label="Visible">
          <Switch aria-label="Visible" checked={visible} disabled={!visibleEditable} onCheckedChange={(next) => subjects.forEach((subject) => session.patch({ type: "hide", elementId: subject.id, hidden: !next }))} />
        </Row>
      </Section>

      {kit !== null && <OffTokens values={tree?.offTokens ?? []} labelOf={labelOfOff} onSelect={selectOff} onUse={useOff} />}

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
