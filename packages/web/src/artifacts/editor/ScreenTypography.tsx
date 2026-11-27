import type { TokenScale } from "@unframed/contracts";
import { classForToken, DEFAULT_LEADING, fieldAria, snapToken, textStyleOf, trackingPercent, trackingValue, WEIGHT_STYLES, weightLabel, type ScalePreset, type TypeStep } from "@unframed/domain";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, Settings2, Type } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { Select, SelectGroup, SelectGroupLabel, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "~/components/ui/tabs";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tip } from "../../chrome/ui.tsx";
import { ChangedDot, ScrubField } from "../../design/fields.tsx";
import { InspectorSection, NumberRow, type ScreenFields, type ScreenSubject } from "./ScreenDesign.tsx";

export const SYSTEM_FONTS: ReadonlyArray<{ readonly label: string; readonly family: string; readonly name?: string }> = [
  { label: "Default sans", family: "ui-sans-serif, system-ui, sans-serif", name: "font-sans" },
  { label: "Default serif", family: "ui-serif, Georgia, serif", name: "font-serif" },
  { label: "Default mono", family: "ui-monospace, monospace", name: "font-mono" },
  { label: "BlinkMacSystemFont", family: "BlinkMacSystemFont" },
  { label: "Helvetica Neue", family: '"Helvetica Neue"' },
  { label: "Helvetica", family: "Helvetica" },
  { label: "Arial", family: "Arial" },
  { label: "Georgia", family: "Georgia" },
  { label: "Times New Roman", family: '"Times New Roman"' },
  { label: "Courier New", family: '"Courier New"' },
  { label: "Verdana", family: "Verdana" },
];

const firstFamily = (value: string): string => value.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
const familyValue = (family: string): string => (/^[\w-]+$/.test(family) || family.includes(",") || family.startsWith('"') ? family : `"${family}"`);

export const PresetMenu = ({ label, presets, onPick, footer }: { readonly label: string; readonly presets: ReadonlyArray<{ readonly group?: string; readonly items: readonly ScalePreset[] }>; readonly onPick: (preset: ScalePreset) => void; readonly footer?: ReactNode }) => (
  <Menu>
    <Tip label={label}>
      <MenuTrigger render={<Button variant="ghost" size="icon-micro" aria-label={label} />}>
        <ChevronDown aria-hidden />
      </MenuTrigger>
    </Tip>
    <MenuPopup align="end" className="max-h-80 min-w-44">
      {presets.map((group, index) => (
        <MenuGroup key={group.group ?? index}>
          {group.group !== undefined && <MenuGroupLabel>{group.group}</MenuGroupLabel>}
          {group.items.map((preset) => (
            <MenuItem key={preset.name} onClick={() => onPick(preset)}>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{preset.name}</span>
              <span className="shrink-0 text-xs text-(--artifact-editor-meta)">{preset.note ?? preset.px}</span>
            </MenuItem>
          ))}
        </MenuGroup>
      ))}
      {footer}
    </MenuPopup>
  </Menu>
);

export interface ProjectFont {
  readonly label: string;
  readonly family: string;
  readonly name?: string | undefined;
}

export const projectFonts = (scale: TokenScale, families: readonly string[]): ProjectFont[] => {
  const tokens = scale.families.map((token) => ({ label: firstFamily(token.resolved), family: token.variable === null ? token.resolved : `var(${token.variable})`, name: classForToken("font-family", token) }));
  const named = new Set(tokens.map((font) => font.label));
  return [...tokens, ...families.filter((family) => !named.has(family)).map((family) => ({ label: family, family: familyValue(family) }))];
};

const FontPicker = ({ value, project, onPick }: { readonly value: string; readonly project: readonly ProjectFont[]; readonly onPick: (family: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const matches = (text: string) => search === "" || text.toLowerCase().includes(search);
  const shown = firstFamily(value);
  const row = (label: string, family: string, name: string | undefined) => (
    <Button
      key={`${label}|${family}`}
      role="option"
      aria-selected={firstFamily(family) === shown}
      variant="ghost"
      size="sm"
      className="min-w-0 justify-start"
      onClick={() => {
        setOpen(false);
        setQuery("");
        onPick(family);
      }}
    >
      <span className="min-w-0 flex-1 truncate text-left" style={{ fontFamily: family }}>
        {label}
      </span>
      {name !== undefined && <span className="shrink-0 font-mono text-xs text-(--artifact-editor-meta)">{name}</span>}
    </Button>
  );
  const inProject = project.filter((font) => matches(font.label) || matches(font.name ?? ""));
  const system = SYSTEM_FONTS.filter((font) => matches(font.label) || matches(font.name ?? ""));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-0 flex-1 justify-between" aria-label={`Font: ${shown}`} />}>
        <span className="truncate">{shown}</span>
        <ChevronDown aria-hidden />
      </PopoverTrigger>
      <PopoverPopup side="left" align="start" padding="compact" className="w-64" aria-label="Fonts">
        <PopoverTitle>Fonts</PopoverTitle>
        <Input aria-label="Search fonts" placeholder="Search fonts" size="sm" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <div role="listbox" aria-label="Fonts" className="mt-1.5 flex max-h-72 flex-col gap-0.5 overflow-auto">
          {inProject.length > 0 && (
            <div role="group" aria-label="In this project" className="flex flex-col gap-0.5">
              <span className="px-2 py-1 text-xs text-(--artifact-editor-meta)">In this project</span>
              {inProject.map((font) => row(font.label, font.family, font.name))}
            </div>
          )}
          {system.length > 0 && (
            <div role="group" aria-label="System" className="flex flex-col gap-0.5">
              <span className="px-2 py-1 text-xs text-(--artifact-editor-meta)">System</span>
              {system.map((font) => row(font.label, font.family, font.name))}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
};

const WeightPicker = ({ weight, italic, onPick }: { readonly weight: string; readonly italic: boolean; readonly onPick: (weight: string, italic: boolean) => void }) => (
  <Select
    value={`${weight}${italic ? " italic" : ""}`}
    onValueChange={(next) => {
      if (next === null) return;
      const [picked = "400", style] = String(next).split(" ");
      onPick(picked, style === "italic");
    }}
  >
    <SelectTrigger aria-label="Font weight" size="sm">
      <SelectValue>{weightLabel(weight, italic)}</SelectValue>
    </SelectTrigger>
    <SelectPopup alignItemWithTrigger={false}>
      <SelectGroup>
        <SelectGroupLabel>Styles</SelectGroupLabel>
        {WEIGHT_STYLES.map((each) => (
          <SelectItem key={each.weight} value={each.weight}>
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex-1">{each.label}</span>
              <span className="font-mono text-xs text-(--artifact-editor-meta)">{each.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectGroup>
      <SelectGroup>
        <SelectGroupLabel>Italic</SelectGroupLabel>
        {WEIGHT_STYLES.map((each) => (
          <SelectItem key={`${each.weight} italic`} value={`${each.weight} italic`}>
            {weightLabel(each.weight, true)}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectPopup>
  </Select>
);

const Choice = ({ label, value, options, onPick }: { readonly label: string; readonly value: string; readonly options: ReadonlyArray<{ readonly value: string; readonly label: string; readonly face: ReactNode }>; readonly onPick: (value: string) => void }) => (
  <div className="grid grid-cols-[var(--design-panel-label-width)_minmax(0,1fr)] items-center gap-2">
    <span className="text-xs text-(--design-panel-label)">{label}</span>
    <ToggleGroup aria-label={label} value={[value]} onValueChange={(next) => (next as string[])[0] !== undefined && onPick((next as string[])[0]!)}>
      {options.map((option) => (
        <Toggle key={option.value} value={option.value} aria-label={option.label}>
          {option.face}
        </Toggle>
      ))}
    </ToggleGroup>
  </div>
);

const TypeSettings = ({ fields, computed }: { readonly fields: ScreenFields; readonly computed: Readonly<Record<string, string>> }) => {
  const set = (property: string) => (value: string) => fields.write(property, () => value);
  const wrap = computed["text-wrap"] ?? "wrap";
  const [tab, setTab] = useState("basics");
  return (
    <Popover>
      <Tip label="Type settings">
        <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Type settings" />}>
          <Settings2 aria-hidden />
        </PopoverTrigger>
      </Tip>
      <PopoverPopup side="left" align="start" padding="compact" className="w-80" aria-label="Type settings">
        <PopoverTitle>Type settings</PopoverTitle>
        <p className="m-0 my-1.5 truncate text-sm" style={{ textDecorationLine: computed["text-decoration-line"], textTransform: computed["text-transform"] as never }}>
          The quick brown fox jumps over 17 lazy dogs.
        </p>
        <Tabs value={tab} onValueChange={(next) => setTab(String(next))}>
          <TabsList variant="underline" aria-label="Type settings">
            <TabsTab value="basics">Basics</TabsTab>
            <TabsTab value="details">Details</TabsTab>
          </TabsList>
          <TabsPanel value="basics">
            <div className="mt-2 flex flex-col gap-2">
            <Choice
              label="Alignment"
              value={computed["text-align"] === "start" ? "left" : (computed["text-align"] ?? "left")}
              options={[
                { value: "left", label: "Left", face: <AlignLeft aria-hidden /> },
                { value: "center", label: "Center", face: <AlignCenter aria-hidden /> },
                { value: "right", label: "Right", face: <AlignRight aria-hidden /> },
                { value: "justify", label: "Justify", face: "≡" },
              ]}
              onPick={set("text-align")}
            />
            <Choice
              label="Decoration"
              value={(computed["text-decoration-line"] ?? "none").split(" ")[0]!}
              options={[
                { value: "none", label: "None", face: "–" },
                { value: "underline", label: "Underline", face: <span className="underline">U</span> },
                { value: "line-through", label: "Strikethrough", face: <span className="line-through">S</span> },
              ]}
              onPick={set("text-decoration-line")}
            />
            <Choice
              label="Case"
              value={computed["text-transform"] ?? "none"}
              options={[
                { value: "none", label: "As typed", face: "–" },
                { value: "uppercase", label: "Upper case", face: "AG" },
                { value: "lowercase", label: "Lower case", face: "ag" },
                { value: "capitalize", label: "Title case", face: "Ag" },
              ]}
              onPick={set("text-transform")}
            />
            <Choice
              label="Truncate text"
              value={computed["text-overflow"] === "ellipsis" ? "ellipsis" : "clip"}
              options={[
                { value: "clip", label: "Do not truncate", face: "–" },
                { value: "ellipsis", label: "Truncate", face: "A…" },
              ]}
              onPick={(value) => {
                fields.write("text-overflow", () => value);
                fields.write("overflow", () => (value === "ellipsis" ? "hidden" : "visible"));
                fields.write("white-space", () => (value === "ellipsis" ? "nowrap" : "normal"));
              }}
            />
            <Choice
              label="Wrap style"
              value={/pretty|balance/.exec(wrap)?.[0] ?? "wrap"}
              options={[
                { value: "wrap", label: "Auto", face: "Auto" },
                { value: "pretty", label: "Pretty", face: "Pretty" },
                { value: "balance", label: "Balance", face: "Balance" },
              ]}
              onPick={set("text-wrap")}
            />
            </div>
          </TabsPanel>
          <TabsPanel value="details">
            <div className="mt-2 flex flex-col gap-2">
            <Choice
              label="Number spacing"
              value={(computed["font-variant-numeric"] ?? "").includes("tabular-nums") ? "tabular-nums" : "normal"}
              options={[
                { value: "normal", label: "Proportional", face: "1 1" },
                { value: "tabular-nums", label: "Tabular", face: "11" },
              ]}
              onPick={set("font-variant-numeric")}
            />
            </div>
          </TabsPanel>
        </Tabs>
      </PopoverPopup>
    </Popover>
  );
};

const TextStyleChip = ({ style, scale, onPick, onDetach }: { readonly style: TypeStep; readonly scale: readonly TypeStep[]; readonly onPick: (step: TypeStep) => void; readonly onDetach: () => void }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const label = `${style.name} · ${style.size}/${style.leading}`;
  const offered = scale.filter((step) => step.name.includes(query.trim().toLowerCase()));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-0 justify-start" aria-label={`Text style: ${label}`} />}>
        <span className="text-xs font-semibold">Ag</span>
        <span className="truncate font-mono text-xs">{style.name}</span>
        <span className="truncate text-xs text-(--artifact-editor-meta)">{`· ${style.size}/${style.leading}`}</span>
      </PopoverTrigger>
      <PopoverPopup side="left" align="start" padding="compact" className="w-64" aria-label="Text styles">
        <PopoverTitle>Text styles</PopoverTitle>
        <Input aria-label="Search text styles" placeholder="Search text styles" size="sm" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <div className="mt-1.5 flex max-h-64 flex-col gap-0.5 overflow-auto">
          {offered.map((step) => (
            <Button
              key={step.name}
              variant="ghost"
              size="sm"
              className="min-w-0 justify-start"
              onClick={() => {
                setOpen(false);
                onPick(step);
              }}
            >
              <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">{step.name}</span>
              <span className="shrink-0 text-xs text-(--artifact-editor-meta)">{`${step.size}/${step.leading}`}</span>
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          onClick={() => {
            setOpen(false);
            onDetach();
          }}
        >
          Detach style
        </Button>
      </PopoverPopup>
    </Popover>
  );
};

export const TypographySection = ({
  fields,
  subjects,
  families,
  scale,
  leading = DEFAULT_LEADING,
}: {
  readonly fields: ScreenFields;
  readonly subjects: readonly ScreenSubject[];
  readonly families: readonly string[];
  readonly scale: readonly TypeStep[];
  readonly leading?: readonly ScalePreset[];
}) => {
  const [first] = subjects;
  const computed = first!.report.computed;
  const size = fields.field("font-size");
  const sizeDraft = fields.single ? fields.draftOf(first!.id, "font-size") : undefined;
  const style = fields.single ? (sizeDraft === undefined ? textStyleOf(scale, first!.report.className) : scale.find((step) => step.name === sizeDraft.after)) : undefined;
  const line = fields.field("line-height");
  const tracking = fields.field("letter-spacing", "letter-spacing", (subject) => String(trackingPercent(subject.report.computed["letter-spacing"], subject.report.computed["font-size"])));
  const weight = computed["font-weight"] ?? "400";
  const italic = computed["font-style"] === "italic";
  const align = computed["text-align"] === "start" ? "left" : computed["text-align"] === "end" ? "right" : (computed["text-align"] ?? "left");
  const writeSize = (px: number, picked = false) => fields.write("font-size", () => `${px}px`, picked ? snapToken(fields.scale, "font-size", px, 0) : undefined);
  return (
    <InspectorSection name="Typography">
      {style !== undefined && <TextStyleChip style={style} scale={scale} onPick={(step) => writeSize(step.size, true)} onDetach={() => writeSize(style.size)} />}
      <div className="flex min-w-0 items-center gap-1">
        <ChangedDot change={fields.changeOf(["font-family"])} />
        <FontPicker value={computed["font-family"] ?? ""} project={projectFonts(fields.scale, families)} onPick={(family) => fields.write("font-family", () => family)} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <ChangedDot change={fields.changeOf(["font-weight", "font-style"])} />
          <WeightPicker
            weight={weight}
            italic={italic}
            onPick={(next, nextItalic) => {
              fields.write("font-weight", () => next);
              if (nextItalic !== italic) fields.write("font-style", () => (nextItalic ? "italic" : "normal"));
            }}
          />
        </div>
        <NumberRow
          fields={fields}
          label="Font size"
          field={size}
          icon={<Type aria-hidden className="size-3.5" />}
          bounds={{ min: 1 }}
          suffix={<PresetMenu label="Font size presets" presets={[{ items: scale.map((step) => ({ name: step.name, px: step.size })) }]} onPick={(preset) => writeSize(preset.px, true)} />}
        />
        <NumberRow
          fields={fields}
          label="Line height"
          field={line}
          icon={<span className="text-xs">↕</span>}
          suffix={<PresetMenu label="Line height presets" presets={[{ items: leading }]} onPick={(preset) => fields.write("line-height", () => `${preset.px}px`, snapToken(fields.scale, "line-height", preset.px, 0))} />}
        />
        <ScrubField
          label="Letter spacing"
          aria={fieldAria("Letter spacing", tracking.bound, tracking.px)}
          shown={tracking.mixed ? "" : `${tracking.px}%`}
          raw={tracking.raw}
          placeholder={tracking.mixed ? "Mixed" : undefined}
          icon={<span className="text-xs">|A|</span>}
          change={fields.changeOf(["letter-spacing"])}
          onCommit={(typed) => fields.write("letter-spacing", () => trackingValue(typed))}
        />
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <ChangedDot change={fields.changeOf(["text-align"])} />
        <ToggleGroup aria-label="Text align" value={[align]} onValueChange={(next) => (next as string[])[0] !== undefined && fields.write("text-align", () => (next as string[])[0]!)}>
          <Toggle value="left" aria-label="Align left">
            <AlignLeft aria-hidden />
          </Toggle>
          <Toggle value="center" aria-label="Align center">
            <AlignCenter aria-hidden />
          </Toggle>
          <Toggle value="right" aria-label="Align right">
            <AlignRight aria-hidden />
          </Toggle>
        </ToggleGroup>
        <span className="ml-auto">
          <TypeSettings fields={fields} computed={computed} />
        </span>
      </div>
    </InspectorSection>
  );
};
