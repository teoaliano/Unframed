import type { SourceEdit } from "@unframed/contracts";
import { classStep, DEFAULT_TYPE_SCALE, elementKind, fieldAria, pairShown, stepOfClass, styleValueRefusal, type ClassStep, type DraftChange, type NumberBounds } from "@unframed/domain";
import { Eye, EyeOff, MoveHorizontal, MoveVertical, Scan, SunDim } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { Tip } from "../../chrome/ui.tsx";
import { showError } from "../../toasts.tsx";
import { numberOf as numberText } from "../../design/controls.tsx";
import { ChangedDot, ScrubField, type FieldChange } from "../../design/fields.tsx";
import type { EngineConnection } from "../../rpc/engine.ts";
import type { EditReport, EditSession } from "./editSession.ts";
import { ScreenHeader } from "./ScreenHeader.tsx";
import { TypographySection } from "./ScreenTypography.tsx";

export interface ScreenDesignContext {
  readonly engine: EngineConnection;
  readonly project: string;
  readonly instance: string | undefined;
}

export interface ScreenSubject {
  readonly id: string;
  readonly report: EditReport;
}

const SIDES = ["left", "top", "right", "bottom"] as const;
type Side = (typeof SIDES)[number];

const shortOf = (value: string): string => {
  if (value === "") return "none";
  const number = /^-?\d*\.?\d+(px)?$/.test(value.trim()) ? numberText(value) : "";
  return number === "" ? value : number;
};

export const SectionTitle = ({ name, actions }: { readonly name: string; readonly actions?: ReactNode }) => (
  <div className="flex min-h-6 min-w-0 items-center gap-1">
    <h3 className="m-0 min-w-0 flex-1 truncate text-xs font-medium text-(--design-panel-title)">{name}</h3>
    {actions}
  </div>
);

export const InspectorSection = ({ name, actions, children }: { readonly name: string; readonly actions?: ReactNode; readonly children?: ReactNode }) => (
  <section aria-label={name} className="flex min-w-0 flex-col gap-2 border-b border-(--design-panel-border) px-2.5 py-3 last:border-b-0">
    <SectionTitle name={name} actions={actions} />
    {children}
  </section>
);

export const IconToggle = ({ label, pressed, onPressedChange, children }: { readonly label: string; readonly pressed: boolean; readonly onPressedChange: (next: boolean) => void; readonly children: ReactNode }) => (
  <Tip label={label}>
    <Toggle aria-label={label} pressed={pressed} onPressedChange={onPressedChange} size="sm">
      {children}
    </Toggle>
  </Tip>
);

export interface Field {
  readonly reads: string;
  readonly writes: string;
  readonly values: readonly string[];
  readonly mixed: boolean;
  readonly px: string;
  readonly raw: number | undefined;
  readonly bound: ClassStep | undefined;
  readonly shown: string;
}

export const useScreenFields = (session: EditSession, subjects: readonly ScreenSubject[], tokenNames: readonly string[]) => {
  const single = subjects.length === 1;
  const draftOf = (id: string, property: string): DraftChange | undefined => session.drafts.find((draft) => draft.element.stamp === id && draft.property === property);
  const boundOf = (subject: ScreenSubject, reads: string, writes: string): ClassStep | undefined => {
    const draft = draftOf(subject.id, writes) ?? (reads === writes ? undefined : draftOf(subject.id, reads));
    if (draft !== undefined) return draft.kind === "class" && draft.after !== null ? stepOfClass(draft.after) : undefined;
    return classStep(subject.report.className, reads);
  };
  const field = (reads: string, writes: string = reads, pick: (subject: ScreenSubject) => string = (subject) => subject.report.computed[reads] ?? ""): Field => {
    const values = subjects.map(pick);
    const mixed = values.some((value) => value !== values[0]);
    const px = mixed ? "" : numberText(values[0]);
    const parsed = Number(px);
    const bound = single ? boundOf(subjects[0]!, reads, writes) : undefined;
    return { reads, writes, values, mixed, px, raw: px === "" || !Number.isFinite(parsed) ? undefined : parsed, bound, shown: mixed ? "" : (bound?.step ?? px) };
  };
  const changeOf = (properties: readonly string[]): FieldChange | undefined => {
    const found = subjects.flatMap((subject) => properties.flatMap((property) => draftOf(subject.id, property) ?? []));
    const [earliest] = found;
    if (earliest === undefined) return undefined;
    return {
      before: properties.length > 1 && found.length > 1 ? [...new Set(found.map((draft) => shortOf(draft.shownBefore)))].join(" · ") : shortOf(earliest.kind === "text" ? (earliest.before ?? "") : earliest.shownBefore),
      discard: () => found.forEach((draft) => session.discardDraft(draft.id)),
    };
  };
  const write = (property: string, valueOf: (subject: ScreenSubject) => string): boolean => {
    const writes = subjects.map((subject) => ({ subject, value: valueOf(subject) }));
    for (const { value } of writes) {
      const refusal = styleValueRefusal(property, value, tokenNames);
      if (refusal !== null) {
        showError(refusal);
        return false;
      }
    }
    for (const { subject, value } of writes) session.patch({ type: "style", elementId: subject.id, property, value } satisfies SourceEdit);
    return true;
  };
  return { field, changeOf, write, draftOf, single };
};

export type ScreenFields = ReturnType<typeof useScreenFields>;

export const NumberRow = ({
  fields,
  label,
  field,
  icon,
  bounds = { min: 0 },
  unit = "px",
  disabled,
  suffix,
  onCommit,
}: {
  readonly fields: ScreenFields;
  readonly label: string;
  readonly field: Field;
  readonly icon: ReactNode;
  readonly bounds?: NumberBounds;
  readonly unit?: string;
  readonly disabled?: boolean;
  readonly suffix?: ReactNode;
  readonly onCommit?: (typed: number) => void;
}) => (
  <ScrubField
    label={label}
    aria={fieldAria(label, field.bound, field.px)}
    shown={field.shown}
    raw={field.raw}
    placeholder={field.mixed ? "Mixed" : undefined}
    icon={icon}
    bounds={bounds}
    disabled={disabled}
    change={fields.changeOf(field.reads === field.writes ? [field.writes] : [field.writes, field.reads])}
    suffix={suffix}
    onCommit={onCommit ?? ((typed) => fields.write(field.writes, () => `${typed}${unit}`))}
  />
);

const SideIcon = ({ side }: { readonly side: Side | "x" | "y" }) => <span className="w-3.5 text-center text-xs">{side === "x" ? "↔" : side === "y" ? "↕" : side.charAt(0).toUpperCase()}</span>;

let paddingIndividual = false;

const PaddingSection = ({ fields }: { readonly fields: ScreenFields }) => {
  const [individual, setIndividualState] = useState(paddingIndividual);
  const setIndividual = (next: boolean) => {
    paddingIndividual = next;
    setIndividualState(next);
  };
  const side = (each: Side) => fields.field(`padding-${each}`);
  const pair = (label: string, a: Field, b: Field, icon: "x" | "y") => {
    const parts = [a, b].map((each) => (each.bound === undefined ? each.px : `${each.bound.name} (${each.px})`));
    const aria = a.bound === undefined && b.bound === undefined ? label : `${label}: ${[...new Set(parts)].join(" · ")}`;
    const mixed = a.mixed || b.mixed;
    return (
      <ScrubField
        label={label}
        aria={aria}
        shown={mixed ? "" : pairShown(a.shown, b.shown)}
        raw={a.raw}
        placeholder={mixed ? "Mixed" : undefined}
        icon={<SideIcon side={icon} />}
        bounds={{ min: 0 }}
        change={fields.changeOf([a.writes, b.writes])}
        onCommit={(typed) => {
          fields.write(a.writes, () => `${typed}px`);
          fields.write(b.writes, () => `${typed}px`);
        }}
      />
    );
  };
  return (
    <InspectorSection
      name="Padding"
      actions={
        <IconToggle label="Individual padding" pressed={individual} onPressedChange={setIndividual}>
          <Scan aria-hidden />
        </IconToggle>
      }
    >
      {individual ? (
        <div className="grid grid-cols-2 gap-1.5">
          {(["left", "top", "right", "bottom"] as const).map((each) => (
            <NumberRow key={each} fields={fields} label={`Padding ${each}`} field={side(each)} icon={<SideIcon side={each} />} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {pair("Horizontal padding", side("left"), side("right"), "x")}
          {pair("Vertical padding", side("top"), side("bottom"), "y")}
        </div>
      )}
    </InspectorSection>
  );
};

const AppearanceSection = ({ fields, subjects, session }: { readonly fields: ScreenFields; readonly subjects: readonly ScreenSubject[]; readonly session: EditSession }) => {
  const opacity = fields.field("opacity", "opacity", (subject) => {
    const value = Number(subject.report.computed.opacity ?? "1");
    return Number.isFinite(value) ? String(Math.round(value * 100)) : "";
  });
  const hidden = subjects.every((subject) => fields.draftOf(subject.id, "display")?.asked === "none");
  const hideChange = fields.changeOf(["display"]);
  return (
    <InspectorSection
      name="Appearance"
      actions={
        <span className="flex items-center gap-1">
          <ChangedDot change={hideChange} />
          <Tip label={hidden ? "Show" : "Hide"}>
            <Button variant="ghost" size="icon-xs" aria-label={hidden ? "Show" : "Hide"} onClick={() => subjects.forEach((subject) => session.patch({ type: "hide", elementId: subject.id, hidden: !hidden }))}>
              {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </Tip>
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-1.5">
        <NumberRow
          fields={fields}
          label="Opacity"
          field={{ ...opacity, bound: undefined, shown: opacity.mixed ? "" : `${opacity.px}%` }}
          icon={<SunDim aria-hidden className="size-3.5" />}
          bounds={{ min: 0, max: 100 }}
          onCommit={(typed) => fields.write("opacity", () => String(Math.min(100, Math.max(0, typed)) / 100))}
        />
      </div>
    </InspectorSection>
  );
};

const SizeSection = ({ fields }: { readonly fields: ScreenFields }) => (
  <InspectorSection name="Size">
    <div className="grid grid-cols-2 gap-1.5">
      <NumberRow fields={fields} label="Width" field={fields.field("width")} icon={<MoveHorizontal aria-hidden className="size-3.5" />} />
      <NumberRow fields={fields} label="Height" field={fields.field("height")} icon={<MoveVertical aria-hidden className="size-3.5" />} />
    </div>
  </InspectorSection>
);

export const ScreenDesign = ({
  session,
  subjects,
  context,
  name,
  tokenNames = [],
  onTell,
}: {
  readonly session: EditSession;
  readonly subjects: readonly ScreenSubject[];
  readonly context: ScreenDesignContext;
  readonly name: string;
  readonly tokenNames?: readonly string[];
  readonly onTell: () => void;
}) => {
  const fields = useScreenFields(session, subjects, tokenNames);
  const [first] = subjects;
  const text = subjects.every((subject) => subject.report.text !== null);
  return (
    <div className="flex min-h-0 flex-col overflow-auto" data-testid="design-tab" data-screen-design="">
      <ScreenHeader session={session} context={context} name={name} kind={fields.single ? elementKind(first!.report.tag) : `${subjects.length} elements`} onTell={onTell} />
      {text ? (
        <>
          <TypographySection fields={fields} subjects={subjects} families={session.families} scale={DEFAULT_TYPE_SCALE} />
          <PaddingSection fields={fields} />
          <SizeSection fields={fields} />
        </>
      ) : (
        <>
          <SizeSection fields={fields} />
          <PaddingSection fields={fields} />
        </>
      )}
      <AppearanceSection fields={fields} subjects={subjects} session={session} />
    </div>
  );
};
