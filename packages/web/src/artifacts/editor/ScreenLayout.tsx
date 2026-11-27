import { alignLabel, alignmentOf, alignmentWrite, SIZE_MODE_LABEL, sizeModeOf, sizeModeValue, snapToken, spacingPresets, type AlignSpot, type SizeMode } from "@unframed/domain";
import { ArrowDown, ArrowRight, ChevronDown, Grid2x2, Link2, Minus, MoveHorizontal, MoveVertical, RotateCw, Square, WrapText } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from "~/components/ui/menu";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tip } from "../../chrome/ui.tsx";
import { ChangedDot, ScrubField } from "../../design/fields.tsx";
import { IconToggle, InspectorSection, NumberRow, type ScreenFields, type ScreenSubject } from "./ScreenDesign.tsx";
import { PresetMenu } from "./ScreenTypography.tsx";

const FLEX = ["flex", "inline-flex"];
const GRID = ["grid", "inline-grid"];

type Axis = "width" | "height";

const SizingMenu = ({ fields, axis, mode, px, onAdd }: { readonly fields: ScreenFields; readonly axis: Axis; readonly mode: SizeMode; readonly px: number; readonly onAdd: (property: string) => void }) => {
  const word = axis === "width" ? "width" : "height";
  const set = (next: SizeMode) => fields.write(axis, () => sizeModeValue(next, px));
  const presets = spacingPresets(fields.scale, axis);
  const shown = mode === "fixed" ? "" : SIZE_MODE_LABEL[mode];
  return (
    <Menu>
      <Tip label={`${axis === "width" ? "Width" : "Height"} sizing`}>
        <MenuTrigger render={<Button variant="ghost" size="xs" aria-label={`${axis === "width" ? "Width" : "Height"} sizing`} />}>
          {shown}
          <ChevronDown aria-hidden />
        </MenuTrigger>
      </Tip>
      <MenuPopup align="end" className="min-w-44">
        <MenuItem onClick={() => set("fixed")}>{`Fixed ${word} (${Math.round(px * 10) / 10})`}</MenuItem>
        <MenuItem onClick={() => set("hug")}>Hug contents</MenuItem>
        <MenuItem onClick={() => set("fill")}>Fill container</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => onAdd(`min-${axis}`)}>{`Add min ${word}…`}</MenuItem>
        <MenuItem onClick={() => onAdd(`max-${axis}`)}>{`Add max ${word}…`}</MenuItem>
        {presets.length > 0 && (
          <>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>Size tokens…</MenuSubTrigger>
              <MenuSubPopup className="max-h-80">
                {presets.map((group) => (
                  <MenuGroup key={group.group}>
                    <MenuGroupLabel>{group.group}</MenuGroupLabel>
                    {group.items.map((item) => (
                      <MenuItem key={item.name} onClick={() => fields.write(axis, () => `${item.px}px`, snapToken(fields.scale, axis, item.px, 0))}>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.name}</span>
                        <span className="shrink-0 text-xs text-(--artifact-editor-meta)">{item.note}</span>
                      </MenuItem>
                    ))}
                  </MenuGroup>
                ))}
              </MenuSubPopup>
            </MenuSub>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
};

const LIMITS = ["min-width", "max-width", "min-height", "max-height"] as const;
const LIMIT_LABEL: Readonly<Record<(typeof LIMITS)[number], string>> = { "min-width": "Min width", "max-width": "Max width", "min-height": "Min height", "max-height": "Max height" };
const unset = (value: string | undefined): boolean => value === undefined || value === "" || value === "none" || value === "auto" || value === "0px";

export const SizeSection = ({ fields, subjects, text }: { readonly fields: ScreenFields; readonly subjects: readonly ScreenSubject[]; readonly text: boolean }) => {
  const [first] = subjects;
  const report = first!.report;
  const [locked, setLocked] = useState(false);
  const [added, setAdded] = useState<readonly string[]>([]);
  const modeOf = (axis: Axis): SizeMode => {
    const draft = fields.single ? fields.draftOf(first!.id, axis) : undefined;
    return sizeModeOf(axis, report.className, draft?.asked ?? report.inline[axis] ?? null);
  };
  const width = fields.field("width");
  const height = fields.field("height");
  const ratio = width.raw !== undefined && height.raw !== undefined && height.raw !== 0 ? width.raw / height.raw : undefined;
  const limits = LIMITS.filter((property) => added.includes(property) || !unset(report.computed[property]));
  const resizing = modeOf("width") === "hug" && report.computed["white-space"] === "nowrap" ? "auto-width" : modeOf("height") === "hug" ? "auto-height" : "fixed";
  const commit = (axis: Axis) => (typed: number) => {
    fields.write(axis, () => `${typed}px`);
    if (!locked || ratio === undefined) return;
    const other: Axis = axis === "width" ? "height" : "width";
    const next = axis === "width" ? typed / ratio : typed * ratio;
    fields.write(other, () => `${Math.round(next * 100) / 100}px`);
  };
  return (
    <InspectorSection name="Size">
      {text && (
        <ToggleGroup
          aria-label="Resizing"
          value={[resizing]}
          onValueChange={(next) => {
            const [picked] = next as string[];
            if (picked === "auto-width") {
              fields.write("width", () => "max-content");
              fields.write("white-space", () => "nowrap");
            } else if (picked === "auto-height") {
              fields.write("width", () => `${report.box.w}px`);
              fields.write("height", () => "auto");
              if (report.computed["white-space"] === "nowrap") fields.write("white-space", () => "normal");
            } else if (picked === "fixed") {
              fields.write("width", () => `${report.box.w}px`);
              fields.write("height", () => `${report.box.h}px`);
            }
          }}
        >
          <Toggle value="auto-width" aria-label="Auto width">
            <MoveHorizontal aria-hidden />
          </Toggle>
          <Toggle value="auto-height" aria-label="Auto height">
            <MoveVertical aria-hidden />
          </Toggle>
          <Toggle value="fixed" aria-label="Fixed size">
            <Square aria-hidden />
          </Toggle>
        </ToggleGroup>
      )}
      <div className="flex min-w-0 items-center gap-1">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          {(["width", "height"] as const).map((axis) => (
            <NumberRow
              key={axis}
              fields={fields}
              label={axis === "width" ? "Width" : "Height"}
              field={axis === "width" ? width : height}
              icon={<span className="text-xs">{axis === "width" ? "W" : "H"}</span>}
              onCommit={commit(axis)}
              suffix={<SizingMenu fields={fields} axis={axis} mode={modeOf(axis)} px={axis === "width" ? report.box.w : report.box.h} onAdd={(property) => setAdded([...added, property])} />}
            />
          ))}
        </div>
        <IconToggle label="Lock aspect ratio" pressed={locked} onPressedChange={setLocked}>
          <Link2 aria-hidden />
        </IconToggle>
      </div>
      {limits.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {limits.map((property) => (
            <NumberRow
              key={property}
              fields={fields}
              label={LIMIT_LABEL[property]}
              field={fields.field(property)}
              icon={<span className="text-xs">{property.startsWith("min") ? "≥" : "≤"}</span>}
              suffix={
                <Button
                  variant="ghost"
                  size="icon-micro"
                  aria-label={`Remove ${LIMIT_LABEL[property].toLowerCase()}`}
                  onClick={() => {
                    setAdded(added.filter((each) => each !== property));
                    fields.write(property, () => (property.startsWith("max") ? "none" : "0px"));
                  }}
                >
                  <Minus aria-hidden />
                </Button>
              }
            />
          ))}
        </div>
      )}
    </InspectorSection>
  );
};

export const PositionSection = ({ fields, subjects }: { readonly fields: ScreenFields; readonly subjects: readonly ScreenSubject[] }) => {
  const [first] = subjects;
  const report = first!.report;
  const placed = /^(absolute|fixed|relative|sticky)$/.test(report.computed.position ?? "");
  const rotation = fields.field("rotate", "rotate", (subject) => {
    const value = subject.report.computed.rotate ?? "none";
    return value === "none" ? "0" : String(Number.parseFloat(value) || 0);
  });
  const coordinate = (label: string, property: "left" | "top", box: number) => (
    <ScrubField
      label={label}
      shown={String(Math.round(box * 10) / 10)}
      raw={Math.round(box)}
      icon={<span className="text-xs">{label}</span>}
      bounds={{}}
      disabled={!placed}
      change={fields.changeOf([property])}
      onCommit={(typed) => placed && fields.write(property, () => `${typed}px`)}
    />
  );
  return (
    <InspectorSection
      name="Position"
      actions={
        <Tip label="position: absolute · where it is">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="position: absolute · where it is"
            onClick={() => {
              fields.write("position", () => "absolute");
              fields.write("left", () => "0px");
              fields.write("top", () => "0px");
              fields.write("width", (subject) => `${subject.report.box.w}px`);
            }}
          >
            <Square aria-hidden />
          </Button>
        </Tip>
      }
    >
      <div className="grid grid-cols-3 gap-1.5">
        {coordinate("X", "left", report.box.x)}
        {coordinate("Y", "top", report.box.y)}
        <NumberRow
          fields={fields}
          label="Rotation"
          field={{ ...rotation, bound: undefined, shown: rotation.mixed ? "" : `${rotation.px}°` }}
          icon={<RotateCw aria-hidden className="size-3" />}
          bounds={{}}
          onCommit={(typed) => fields.write("rotate", () => `${typed}deg`)}
        />
      </div>
    </InspectorSection>
  );
};

const SPOTS: ReadonlyArray<readonly [AlignSpot, AlignSpot]> = [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => [row as AlignSpot, column as AlignSpot] as const));

export const LayoutSection = ({ fields, subjects }: { readonly fields: ScreenFields; readonly subjects: readonly ScreenSubject[] }) => {
  const [first] = subjects;
  const computed = first!.report.computed;
  const display = computed.display ?? "block";
  const flex = FLEX.includes(display);
  const grid = GRID.includes(display);
  if (!flex && !grid)
    return (
      <InspectorSection name="Layout">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="text-(--design-panel-label)">
            display: <code className="font-mono">{display}</code>
          </span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => fields.write("display", () => "flex")}>
            Use flexbox
          </Button>
        </div>
      </InspectorSection>
    );
  const direction = computed["flex-direction"] ?? "row";
  const spot = alignmentOf(direction, computed["justify-content"] ?? "normal", computed["align-items"] ?? "normal");
  const gap = fields.field("row-gap", "gap");
  const wraps = computed["flex-wrap"] === "wrap";
  const clipped = computed.overflow === "hidden" || computed.overflow === "clip";
  const kind = grid ? "grid" : direction.startsWith("column") ? "column" : "row";
  return (
    <InspectorSection
      name="Flexbox"
      actions={
        flex ? (
          <IconToggle label="Wrap" pressed={wraps} onPressedChange={(next) => fields.write("flex-wrap", () => (next ? "wrap" : "nowrap"))}>
            <WrapText aria-hidden />
          </IconToggle>
        ) : undefined
      }
    >
      <div className="flex min-w-0 items-center gap-1">
        <ChangedDot change={fields.changeOf(["flex-direction", "display"])} />
        <ToggleGroup
          aria-label="Direction"
          value={[kind]}
          onValueChange={(next) => {
            const [picked] = next as string[];
            if (picked === "grid") fields.write("display", () => "grid");
            else if (picked !== undefined) {
              if (grid) fields.write("display", () => "flex");
              fields.write("flex-direction", () => picked);
            }
          }}
        >
          <Toggle value="row" aria-label="Row · flex-direction: row">
            <ArrowRight aria-hidden />
          </Toggle>
          <Toggle value="column" aria-label="Column · flex-direction: column">
            <ArrowDown aria-hidden />
          </Toggle>
          <Toggle value="grid" aria-label="Grid · display: grid">
            <Grid2x2 aria-hidden />
          </Toggle>
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5">
        <div className="flex items-center gap-1">
          <ChangedDot change={fields.changeOf(["justify-content", "align-items"])} />
          <div role="radiogroup" aria-label="Alignment" className="grid grid-cols-3 gap-0.5">
            {SPOTS.map(([row, column]) => {
              const on = spot.row === row && spot.column === column;
              return (
                <Toggle
                  key={`${row}-${column}`}
                  role="radio"
                  aria-checked={on}
                  aria-label={alignLabel(row, column)}
                  pressed={on}
                  size="sm"
                  onPressedChange={() => {
                    const write = alignmentWrite(direction, row, column);
                    fields.write("justify-content", () => write["justify-content"]);
                    fields.write("align-items", () => write["align-items"]);
                  }}
                >
                  <span aria-hidden className="text-xs">{on ? "▪" : "·"}</span>
                </Toggle>
              );
            })}
          </div>
        </div>
        <NumberRow
          fields={fields}
          label="Gap between items"
          field={gap}
          icon={<span className="text-xs">|↔|</span>}
          suffix={
            <PresetMenu
              label="Gap between items presets"
              presets={spacingPresets(fields.scale, "gap").map((group) => ({ group: group.group, items: group.items.map((item) => ({ name: item.name, px: item.px })) }))}
              onPick={(preset) => fields.write("gap", () => `${preset.px}px`, snapToken(fields.scale, "gap", preset.px, 0))}
              footer={
                flex ? (
                  <>
                    <MenuSeparator />
                    <MenuItem onClick={() => fields.write("justify-content", () => "space-between")}>Auto</MenuItem>
                  </>
                ) : undefined
              }
            />
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <ChangedDot change={fields.changeOf(["overflow"])} />
        <Label>
          <Checkbox checked={clipped} onCheckedChange={(next) => fields.write("overflow", () => (next ? "hidden" : "visible"))} />
          Clip content
        </Label>
      </div>
    </InspectorSection>
  );
};
