/**
 * The editor's Design and Layers tabs (spec 18). Design shows the selected element's Text section
 * and writes each change through the owner rule; Layers lists the source's elements.
 */
import type { SourceTreeElement } from "@unframed/contracts";
import { fieldOwner, styleValueRefusal, type FieldOwner } from "@unframed/domain";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { showError } from "../../toasts.tsx";
import type { EditReport, EditSession } from "./editSession.ts";

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const ALIGNS = [
  { value: "left", label: "Left", Icon: AlignLeft },
  { value: "center", label: "Center", Icon: AlignCenter },
  { value: "right", label: "Right", Icon: AlignRight },
  { value: "justify", label: "Justify", Icon: AlignJustify },
] as const;

type Control = "text" | "number" | "weight" | "align" | "colour";

/** The Text section's fields, in the spec's order: label, the CSS property they write, and the control. */
const TEXT_FIELDS: ReadonlyArray<{ readonly label: string; readonly property: string; readonly control: Control }> = [
  { label: "Font", property: "font-family", control: "text" },
  { label: "Size", property: "font-size", control: "number" },
  { label: "Weight", property: "font-weight", control: "weight" },
  { label: "Line height", property: "line-height", control: "number" },
  { label: "Letter spacing", property: "letter-spacing", control: "number" },
  { label: "Align", property: "text-align", control: "align" },
  { label: "Colour", property: "color", control: "colour" },
];

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

/** The value a field writes for a typed number: px, or unitless for a line height the source set unitless. */
const numberValue = (property: string, typed: number, inline: string | null | undefined): string => {
  if (property === "line-height" && inline !== null && inline !== undefined && /^\d*\.?\d+$/.test(inline.trim())) return String(typed);
  return `${typed}px`;
};

const LOCKED = "Locked. Unlock it in Layers to edit it.";

/** The sentence a read-only owner shows, or null for a source-owned value. */
const ownerLine = (owner: FieldOwner): string | null => {
  if (owner.owner === "source") return null;
  if (owner.owner === "script") return "Set by the agent's code.";
  if (owner.owner === "animated") return "Animated by the agent's code.";
  if (owner.owner === "locked") return LOCKED;
  return owner.owner === "dial" ? `Set by parameter ${owner.path}.` : null;
};

const NumberControl = ({ label, value, disabled, onCommit }: { readonly label: string; readonly value: string; readonly disabled: boolean; readonly onCommit: (typed: number) => void }) => {
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
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
};

const TextControl = ({ label, value, disabled, onCommit }: { readonly label: string; readonly value: string; readonly disabled: boolean; readonly onCommit: (typed: string) => void }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() === "" || draft === value) return;
    onCommit(draft.trim());
  };
  return (
    <Input
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
};

const Row = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2">
    <span className="truncate text-sm text-muted-foreground">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

/** The source's inline declarations of an element, property names lowercased. */
const sourceInline = (element: SourceTreeElement | undefined): Record<string, string> => element?.style ?? {};

export interface DesignTabProps {
  readonly session: EditSession;
  readonly kind: "page" | "motion";
  readonly dials: Readonly<Record<string, unknown>> | undefined;
  readonly locked: readonly string[];
}

/** The chain of an element's ancestors in the source, the element first. */
const chainOf = (elements: readonly SourceTreeElement[], id: string): string[] => {
  const chain: string[] = [];
  let current: string | null = id;
  while (current !== null && chain.length < 1000) {
    chain.push(current);
    current = elements.find((element) => element.id === current)?.parent ?? null;
  }
  return chain;
};

export const DesignTab = ({ session, kind, dials, locked }: DesignTabProps) => {
  const { selection, reports, tree, preparing, prepareError, pending } = session;
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
  if (selection.length > 1) {
    return <p className="m-0 p-2.5 text-sm text-muted-foreground">{`${selection.length} elements`}</p>;
  }

  const [id] = selection;
  const report: EditReport | undefined = reports[id!];
  const element = tree?.elements.find((candidate) => candidate.id === id);
  if (report === undefined) return <p className="m-0 p-2.5 text-sm text-muted-foreground">Reading the element…</p>;

  const isLocked = chainOf(tree?.elements ?? [], id!).some((ancestor) => locked.includes(ancestor));
  const sourceStyle = sourceInline(element);
  const burst = pending;

  const ownerOf = (property: string, normalise: (value: string) => string): FieldOwner => {
    if (element === undefined) return { owner: "script" };
    // An edit still in the burst is the person's own: the owner stays the source until it is written.
    if (burst.some((edit) => edit.type === "style" && edit.elementId === id && edit.property === property)) return { owner: "source" };
    return fieldOwner({
      field: { kind: "style", property },
      source: { inline: sourceStyle, text: element.text, src: element.src ?? null },
      live: { inline: report.inline, text: report.text, src: report.src, animated: report.animated },
      dials: dials ?? {},
      locked: isLocked,
      normalise,
    });
  };

  const write = (property: string, value: string) => {
    const refusal = styleValueRefusal(property, value);
    if (refusal !== null) {
      showError(refusal);
      return;
    }
    session.patch({ type: "style", elementId: id!, property, value });
  };

  const normaliserFor = (property: string) => (value: string) => {
    const probe = document.createElement("i");
    probe.style.setProperty(property, value);
    return probe.style.getPropertyValue(property);
  };

  const owners = TEXT_FIELDS.map((field) => ownerOf(field.property, normaliserFor(field.property)));
  const blocked = owners.map(ownerLine).find((line) => line !== null) ?? null;

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto p-2.5" data-testid="design-tab">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-semibold">{element?.name ?? report.tag}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{report.tag}</span>
      </div>
      <fieldset aria-label="Text" className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Text</legend>
        {TEXT_FIELDS.map((field, index) => {
          const owner = owners[index]!;
          const disabled = owner.owner !== "source";
          const inline = report.inline[field.property];
          const computed = report.computed[field.property];
          return (
            <Row key={field.property} label={field.label}>
              {field.control === "text" && (
                <TextControl label={field.label} value={computed ?? ""} disabled={disabled} onCommit={(typed) => write(field.property, typed.includes(" ") ? `"${typed}"` : typed)} />
              )}
              {field.control === "number" && (
                <NumberControl
                  label={field.label}
                  value={numberOf(computed)}
                  disabled={disabled}
                  onCommit={(typed) => write(field.property, numberValue(field.property, typed, inline))}
                />
              )}
              {field.control === "weight" && (
                <Select value={computed ?? ""} disabled={disabled} onValueChange={(next) => next && write(field.property, String(next))}>
                  <SelectTrigger aria-label={field.label}>
                    <SelectValue>{computed}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {WEIGHTS.map((weight) => (
                      <SelectItem key={weight} value={String(weight)}>
                        {weight}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              )}
              {field.control === "align" && (
                <ToggleGroup
                  aria-label={field.label}
                  value={[computed === "start" ? "left" : computed === "end" ? "right" : (computed ?? "")]}
                  onValueChange={(next) => {
                    const [picked] = next as string[];
                    if (picked !== undefined) write(field.property, picked);
                  }}
                >
                  {ALIGNS.map(({ value, label, Icon }) => (
                    <Toggle key={value} value={value} aria-label={label} disabled={disabled}>
                      <Icon aria-hidden />
                    </Toggle>
                  ))}
                </ToggleGroup>
              )}
              {field.control === "colour" && (
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    aria-label={`${field.label} swatch`}
                    className="w-12"
                    disabled={disabled}
                    value={hexOf(computed).slice(0, 7)}
                    onChange={(event) => write(field.property, event.currentTarget.value)}
                  />
                  <TextControl label={field.label} value={hexOf(computed)} disabled={disabled} onCommit={(typed) => write(field.property, typed)} />
                </div>
              )}
            </Row>
          );
        })}
        {blocked !== null && <p className="m-0 text-xs text-muted-foreground">{blocked}</p>}
      </fieldset>
    </div>
  );
};

export interface LayersTabProps {
  readonly session: EditSession;
  readonly kind: "page" | "motion";
}

/** The source's elements in document order, indented by depth. Selecting a row selects the element. */
export const LayersTab = ({ session, kind }: LayersTabProps) => {
  const { tree, preparing, selection } = session;
  if (preparing) return <p className="m-0 p-2.5 text-sm text-muted-foreground">{`Getting this ${kind} ready for editing…`}</p>;
  if (tree === undefined) return null;
  const depth = (element: SourceTreeElement): number => chainOf(tree.elements, element.id).length - 1;
  return (
    <ul aria-label="Layers" className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-auto p-1.5">
      {tree.elements.map((element) => {
        const selected = selection.includes(element.id);
        return (
          <li key={element.id} style={{ paddingInlineStart: `${depth(element) * 12}px` }}>
            <Button
              variant="ghost"
              size="sm"
              data-layer={element.id}
              aria-pressed={selected}
              className="w-full justify-start"
              onClick={(event) => {
                if (event.shiftKey) {
                  session.setSelection(selected ? selection.filter((other) => other !== element.id) : [...selection, element.id]);
                } else {
                  session.setSelection([element.id]);
                }
              }}
            >
              <span className="truncate">{element.name}</span>
              <span className="shrink-0 text-muted-foreground">{element.tag}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
};
